import assert from 'node:assert/strict';
import {DriveStore,DriveConflict} from '../site/drive.js';
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const store=new Map();let seq=0;
const calls=[];
const ok=(data)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
async function fakeFetch(url,{method='GET',headers={},body}={}){
 calls.push([method,new URL(url).pathname]);
 assert.equal(headers.Authorization,'Bearer test-token');
 const u=new URL(url),parts=u.pathname.split('/'),id=parts.at(-1);
 if(method==='GET' && u.searchParams.get('spaces')==='appDataFolder')return ok({files:[...store.entries()].map(([id,v])=>({id,name:v.name,version:String(v.version)}))});
 if(method==='GET' && u.searchParams.get('alt')==='media'){
  const entry=store.get(id); if(!entry)return new Response('Not found',{status:404});
  return new Response(entry.data,{status:200,headers:{'content-type':entry.type}});
 }
 if(method==='POST'){
  assert.equal(u.searchParams.get('uploadType'),'multipart');
  const raw=await body.text();
  const meta=JSON.parse(raw.match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n(.*?)\r\n--atlas-/s)[1]);
  assert.deepEqual(meta.parents,['appDataFolder']);
  const head=raw.indexOf(`Content-Type: ${meta.mimeType}\r\n\r\n`)+`Content-Type: ${meta.mimeType}\r\n\r\n`.length;
  const data=raw.slice(head,raw.lastIndexOf('\r\n--atlas-'));
  const fileId='f'+(++seq);store.set(fileId,{name:meta.name,data,version:1,type:meta.mimeType});return ok({id:fileId,name:meta.name});
 }
 if(method==='PATCH'){
  assert.equal(u.searchParams.get('uploadType'),'media');
  const entry=store.get(id);if(!entry)return new Response('Not found',{status:404});
  entry.data=await body.text();entry.version++;return ok({id,name:entry.name});
 }
 throw Error(method+' '+url);
}
const db={version:1,events:[{id:'abc',title:'Oficina'}],routines:[],archive:[{id:'z',attachment:{id:'asset1',name:'nota.txt'}}],exceptions:{}};
const drive=new DriveStore('test-token',fakeFetch);
assert.equal(await drive.read(),null);
const first=await drive.write(db,async id=>id==='asset1'?new Blob(['anexo'],{type:'text/plain'}):null);
assert.equal(first.revision,1);assert.equal(first.uploaded,1);assert.equal(first.missing,0);
const remote=await drive.read();assert.deepEqual(remote.data,db);
assert.equal((await drive.downloadAttachment('asset1')).size,5);
const next={...db,events:[...db.events,{id:'b',title:'Aula'}]};
assert.equal((await drive.write(next,async()=>null)).revision,2);
assert.equal((await drive.read()).data.events.length,2);
// Uma alteração remota interrompe a gravação local e preserva o backup do Drive.
const other=new DriveStore('test-token',fakeFetch);
await other.read();
await drive.write(db,async()=>null);
await assert.rejects(()=>other.write(next,async()=>null),DriveConflict);
assert.equal((await drive.read()).data.events.length,1);
// Regressão no Firefox: fetch nativo requer receptor Window/globalThis.
// A versão anterior guardava fetch sem vinculação e invocava como this.fetchImpl,
// ocasionando o TypeError "does not implement interface Window".
const originalFetch=globalThis.fetch;
try {
 globalThis.fetch=function(...args){
  assert.equal(this,globalThis,'fetch padrão deve receber Window/globalThis');
  return fakeFetch(...args);
 };
 const browserLikeStore=new DriveStore('test-token');
 assert.ok(await browserLikeStore.read(),'a chamada ao fetch nativo com receptor correto deve funcionar');
} finally {globalThis.fetch=originalFetch;}
console.log('DriveStore: criação, atualização, anexos, download, leitura e conflito OK; requisições:',calls.length);

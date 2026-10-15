/* Atlas Organizer — armazenamento privado no Google Drive appDataFolder.
 * O Client ID OAuth é público; o token OAuth deve permanecer somente na memória.
 * O versionamento lógico detecta alterações remotas anteriores ao envio.
 * Não é uma transação atômica multiusuário: desenvolvida para um usuário por vez.
 */
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.appdata';
const API='https://www.googleapis.com/drive/v3/files';
const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const DATA_FILENAME='atlas-organizer-data-v2.json';
const ASSET_PREFIX='atlas-attachment-';
export class DriveConflict extends Error { constructor(){super('A cópia no Drive foi alterada desde a última leitura. Compare as versões antes de enviar.');this.name='DriveConflict';} }
export class DriveStore {
 constructor(token, fetchImpl=(...args)=>globalThis.fetch(...args)){this.token=token;this.fetchImpl=fetchImpl;this.fileId=null;this.revision=0;this.remote=null;this.files=null;}
 async request(url,opts={}){
  if(!navigator.onLine)throw new Error('Sem internet: os dados continuam salvos neste dispositivo.');
  const res=await this.fetchImpl(url,{...opts,headers:{Authorization:`Bearer ${this.token}`,...opts.headers}});
  if(!res.ok){let details='';try{const e=await res.json();details=e.error?.message||''}catch{};
   if(res.status===401)throw new Error('A autorização do Google expirou. Conecte ao Drive novamente.');
   if(res.status===403)throw new Error('O Google recusou o acesso. Verifique a API Drive e as permissões OAuth. '+details);
   if(res.status===429 || res.status>=500)throw new Error('Google Drive temporariamente indisponível ('+res.status+'). Tente novamente.');
   throw new Error(`Google Drive ${res.status}: ${details||'erro ao acessar dados'}`);
  }
  return res;
 }
 async listFiles(){
  let next,files=[];
  do{const p=new URLSearchParams({spaces:'appDataFolder',fields:'nextPageToken,files(id,name,mimeType,version)',pageSize:'1000'});if(next)p.set('pageToken',next);
    const res=await this.request(API+'?'+p);const data=await res.json();files.push(...(data.files||[]));next=data.nextPageToken;
  }while(next);
  this.files=files;return files;
 }
 async read(){
  const files=await this.listFiles();const entry=files.find(f=>f.name===DATA_FILENAME);
  if(!entry){this.fileId=null;this.revision=0;this.remote=null;return null;}
  this.fileId=entry.id;
  const res=await this.request(API+'/'+encodeURIComponent(entry.id)+'?alt=media');
  let body;try{body=await res.json();}catch{throw Error('O arquivo do Drive não contém JSON válido. Nenhuma alteração foi enviada.');}
  if(body.format!=='atlas-drive-v1'||!Number.isSafeInteger(body.revision)||body.revision<1||!validData(body.data))throw Error('Formato de backup remoto desconhecido. Nenhuma alteração foi enviada.');
  this.revision=body.revision;this.remote=body.data;return {id:entry.id,revision:body.revision,data:body.data};
 }
 async createFile(name,blob){
  const boundary='atlas-'+crypto.randomUUID();
  const meta={name,parents:['appDataFolder'],mimeType:blob.type||'application/octet-stream'};
  const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${meta.mimeType}\r\n\r\n`,blob,`\r\n--${boundary}--\r\n`],{type:'multipart/related; boundary='+boundary});
  const res=await this.request(UPLOAD+'?uploadType=multipart&fields=id,name,version',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
  const result=await res.json();if(!result.id)throw Error('O Google Drive não retornou um identificador de arquivo.');
  this.files=null;return result;
 }
 async updateFile(id,blob){
  const res=await this.request(UPLOAD+'/'+encodeURIComponent(id)+'?uploadType=media&fields=id,name,version',{method:'PATCH',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});
  return res.json();
 }
 async uploadAttachments(db,readLocalBlob){
  const known=this.files||await this.listFiles();const byName=new Map(known.map(f=>[f.name,f]));
  let missing=0,uploaded=0;
  const ids=[...new Map(db.archive.filter(a=>a.attachment?.id).map(a=>[a.attachment.id,a.attachment])).values()];
  for(const a of ids){const name=ASSET_PREFIX+a.id;if(byName.has(name))continue;
   const blob=await readLocalBlob(a.id);if(!blob){missing++;continue;}
   const file=await this.createFile(name,blob);byName.set(name,file);uploaded++;
  }
  return {missing,uploaded};
 }
 async downloadAttachment(id){
  const files=this.files||await this.listFiles();const asset=files.find(f=>f.name===ASSET_PREFIX+id);
  if(!asset)throw Error('Anexo ausente do Drive. Talvez ele ainda não tenha sido enviado pelo outro dispositivo.');
  const res=await this.request(API+'/'+encodeURIComponent(asset.id)+'?alt=media');return res.blob();
 }
 async write(snapshot,readLocalBlob){
  // Antes de alterar qualquer dado, leia a versão remota atual para evitar sobrescrita acidental.
  const expectedRevision=this.revision,expectedId=this.fileId;
  await this.read();
  if(this.revision!==expectedRevision||this.fileId!==expectedId)throw new DriveConflict();
  const attachments=await this.uploadAttachments(snapshot,readLocalBlob);
  const newRevision=expectedRevision+1;
  const payload={format:'atlas-drive-v1',revision:newRevision,updatedAt:new Date().toISOString(),data:snapshot};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
  if(this.fileId)await this.updateFile(this.fileId,blob);
  else {const created=await this.createFile(DATA_FILENAME,blob);this.fileId=created.id;}
  this.revision=newRevision;this.remote=snapshot;
  return {revision:newRevision,...attachments};
 }
}
function validData(db){return db&&Array.isArray(db.events)&&Array.isArray(db.routines)&&Array.isArray(db.archive)&&db.exceptions&&typeof db.exceptions==='object'&&!Array.isArray(db.exceptions)}

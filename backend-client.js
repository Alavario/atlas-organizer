/** Atlas Organizer — sessão persistente com um Cloudflare Worker, sem cookies de terceiros.
 * O refresh token, Client Secret e o acesso Google Drive NUNCA são entregues ao navegador.
 * Este módulo guarda apenas um token de sessão revogável em IndexedDB (via callbacks).
 */
export class PersistentGateway {
 constructor(url,readSaved,writeSaved,deleteSaved,fetchImpl=(...args)=>globalThis.fetch(...args)){
  this.base=new URL(url).origin;
  if(new URL(url).pathname!=='/' && new URL(url).pathname!=='')throw Error('Informe somente o endereço raiz do Worker, sem caminhos.');
  if(!this.base.startsWith('https://')&&!this.base.startsWith('http://localhost:'))throw Error('O Worker precisa utilizar HTTPS.');
  this.readSaved=readSaved;this.writeSaved=writeSaved;this.deleteSaved=deleteSaved;this.fetchImpl=fetchImpl;
  this.session=null;
 }
 async api(path,{method='GET',body=null,headers={}}={}){
  if(!this.session?.token)throw Error('Sessão não autorizada. Conecte ao Google novamente.');
  const response=await this.fetchImpl(this.base+path,{method,headers:{Authorization:'Bearer '+this.session.token,...headers},body,cache:'no-store'});
  if(response.status===401){
   let data={};try{data=await response.clone().json()}catch{}
   if(data.code==='session_expired'){this.session=null;await this.deleteSaved();throw Error('Sessão Atlas expirada: reconecte sua conta Google.');}
   if(data.code==='google_reauth_required')throw Error('A autorização Google expirou ou foi revogada. Reconecte sua conta Google.');
  }
  return response;
 }
 async resume(){
  const saved=await this.readSaved();
  if(!saved?.token||saved.base!==this.base)return false;
  this.session=saved;
  const response=await this.api('/api/session');
  if(!response.ok){this.session=null;return false;}
  const current=await response.json();
  this.session={...saved,expiresAt:current.expiresAt,email:current.email};
  await this.writeSaved(this.session);
  return true;
 }
 async login(){
  const popup=window.open(this.base+'/auth/start','atlas-oauth-persistente','popup=yes,width=530,height=680,resizable=yes,scrollbars=yes');
  if(!popup)throw Error('O navegador bloqueou a janela de login. Permita pop-ups para o Atlas.');
  const result=await new Promise((resolve,reject)=>{
   let timer=null;
   const finish=(error,value)=>{window.removeEventListener('message',listener);clearTimeout(timer);error?reject(error):resolve(value);};
   const listener=event=>{
    if(event.origin!==this.base||event.source!==popup||event.data?.type!=='ATLAS_BACKEND_AUTH')return;
    if(event.data.error){finish(new Error(event.data.error));return;}
    if(!/^[A-Za-z0-9_-]{40,150}$/.test(event.data.sessionToken||''))return finish(new Error('Resposta de autenticação inválida.'));
    finish(null,{token:event.data.sessionToken,base:this.base,email:event.data.email,expiresAt:event.data.expiresAt});
   };
   window.addEventListener('message',listener);
   timer=setTimeout(()=>finish(new Error('A autorização demorou demais. Tente novamente.')),2*60*1000);
  });
  this.session=result;
  await this.writeSaved(result);
  return result;
 }
 async logout(){
  try{if(this.session?.token)await this.api('/api/logout',{method:'POST'});}finally{this.session=null;await this.deleteSaved();}
 }
 async driveFetch(url,opts={}){
  const headers={};const contentType=new Headers(opts.headers||{}).get('Content-Type');if(contentType)headers['Content-Type']=contentType;
  const method=opts.method||'GET';
  return this.api('/api/drive-proxy?target='+encodeURIComponent(url),{method,headers,body:opts.body||null});
 }
}

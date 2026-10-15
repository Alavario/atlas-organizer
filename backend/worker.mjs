/**
 * Atlas Organizer — OAuth persistence gateway (Cloudflare Workers + D1).
 * Serves only authentication and an allowlisted Google Drive appDataFolder proxy.
 * The atlas data and attachments remain in the user's Google Drive.
 * No Google OAuth token, refresh token, or client secret is sent to GitHub Pages.
 * Browser stores only a revocable, hashed-on-server session capability in IndexedDB.
 * See README for security assumptions and deployment instructions.
 */
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_PROFILE = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL = 10 * 60 * 1000;
const MAX_BODY = 22 * 1024 * 1024;
const te = new TextEncoder();
const td = new TextDecoder();
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function encode64(bytes) { let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function decode64(s){const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function randomToken(size=32){return encode64(crypto.getRandomValues(new Uint8Array(size)));}
async function hashToken(s){const h=await crypto.subtle.digest('SHA-256',te.encode(s));return encode64(new Uint8Array(h));}
async function aesKey(env){const bytes=decode64(env.TOKEN_ENCRYPTION_KEY||'');if(bytes.length!==32)throw Error('TOKEN_ENCRYPTION_KEY deve ter 32 bytes em Base64.');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
async function encryptSecret(secret,env){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await aesKey(env),te.encode(secret));return encode64(iv)+'.'+encode64(new Uint8Array(encrypted));}
async function decryptSecret(blob,env){const parts=blob.split('.');if(parts.length!==2)throw Error('Credencial inválida');const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(parts[0])},await aesKey(env),decode64(parts[1]));return td.decode(bytes);}
function origin(env){return new URL(env.APP_ORIGIN).origin;}
function responseHeaders(extra={}){return {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...extra};}
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:responseHeaders({'Content-Type':'application/json; charset=utf-8',...headers})});}
function fail(message,status=400,code='bad_request'){return json({error:message,code},status);}
function authorizedCors(req,env){return req.headers.get('Origin')===origin(env);}
function corsHeaders(env){return {'Access-Control-Allow-Origin':origin(env),'Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'};}
async function checkConfig(env){for(const name of ['DB','APP_ORIGIN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','TOKEN_ENCRYPTION_KEY','ALLOWED_EMAIL'])if(!env[name])throw Error('Configuração ausente: '+name);origin(env);await aesKey(env);}
const callbackUrl=(req)=>new URL('/auth/callback',req.url).toString();
async function authStart(req,env){
 // OAuth flow deliberately initiated via a new window; a Google OAuth state binds the response.
 const state=randomToken();const verifier=randomToken(48);const challenge=await hashToken(verifier);
 // Rotina leve de limpeza para que tentativas antigas não cresçam indefinidamente.
 await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(Date.now()).run();
 await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
 await env.DB.prepare('INSERT INTO oauth_states (state, verifier, expires_at) VALUES (?, ?, ?)').bind(state,verifier,Date.now()+OAUTH_STATE_TTL).run();
 const u=new URL(GOOGLE_AUTH);const params={client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callbackUrl(req),response_type:'code',scope:GOOGLE_SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'};
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 return Response.redirect(u.toString(),302);
}
function callbackPage(env,result){
 const safe=JSON.stringify(result).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const target=JSON.stringify(origin(env));const nonce=randomToken(18);
 const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Atlas Organizer · conexão Google</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p id="status">Concluindo autorização…</p><script nonce="${nonce}">const payload=${safe};if(window.opener){window.opener.postMessage({type:'ATLAS_BACKEND_AUTH',...payload},${target});document.getElementById('status').textContent=payload.error?'Não foi possível concluir a autorização. Feche esta janela.':'Conta vinculada. Você pode fechar esta janela.';if(!payload.error)setTimeout(()=>window.close(),250);}else{document.getElementById('status').textContent='Abra o Atlas e tente novamente (janela original não encontrada).';}</script></body></html>`;
 return new Response(html,{status:200,headers:responseHeaders({'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'`})});
}
async function exchangeGoogle(form){const res=await fetch(GOOGLE_TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form)});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error_description||data.error||'Google recusou a autorização.');return data;}
async function authCallback(req,env){
 const q=new URL(req.url).searchParams;const state=q.get('state')||'';
 if(!/^[A-Za-z0-9_-]{35,150}$/.test(state))return callbackPage(env,{error:'Estado OAuth inválido.'});
 // Delete-before-use: a stolen/replayed state cannot complete the flow twice.
 const row=await env.DB.prepare('DELETE FROM oauth_states WHERE state=? AND expires_at>? RETURNING verifier').bind(state,Date.now()).first();
 if(!row)return callbackPage(env,{error:'Sessão de autorização expirada. Volte ao Atlas e tente novamente.'});
 if(q.get('error'))return callbackPage(env,{error:'Autorização cancelada no Google.'});
 if(!q.get('code'))return callbackPage(env,{error:'O Google não retornou o código de autorização.'});
 try{
  const token=await exchangeGoogle({code:q.get('code'),client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:callbackUrl(req),grant_type:'authorization_code',code_verifier:row.verifier});
  if(!token.access_token)throw Error('O Google não retornou token de acesso.');
  const profileRes=await fetch(GOOGLE_PROFILE,{headers:{Authorization:'Bearer '+token.access_token}});
  if(!profileRes.ok)throw Error('Não foi possível confirmar a identidade Google.');
  const profile=await profileRes.json();
  if(!profile.sub||profile.email_verified!==true||profile.email.toLowerCase()!==env.ALLOWED_EMAIL.toLowerCase())throw Error('Esta conta Google não está autorizada a utilizar o Atlas.');
  const existing=await env.DB.prepare('SELECT refresh_enc FROM accounts WHERE sub=?').bind(profile.sub).first();
  if(!token.refresh_token&&!existing?.refresh_enc)throw Error('O Google não forneceu token de renovação. Revogue o acesso anterior e autorize novamente.');
  const refreshEnc=token.refresh_token?await encryptSecret(token.refresh_token,env):existing.refresh_enc;
  const accessEnc=await encryptSecret(token.access_token,env);
  await env.DB.prepare(`INSERT INTO accounts(sub,email,refresh_enc,access_enc,access_expires,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(sub) DO UPDATE SET email=excluded.email,refresh_enc=excluded.refresh_enc,access_enc=excluded.access_enc,access_expires=excluded.access_expires,updated_at=excluded.updated_at`).bind(profile.sub,profile.email,refreshEnc,accessEnc,Date.now()+Math.max(60,token.expires_in||3600)*1000,Date.now()).run();
  const bearer=randomToken(48),sessionHash=await hashToken(bearer),expiry=Date.now()+SESSION_TTL;
  await env.DB.prepare('INSERT INTO sessions(session_hash,sub,expires_at,last_seen) VALUES(?,?,?,?)').bind(sessionHash,profile.sub,expiry,Date.now()).run();
  return callbackPage(env,{sessionToken:bearer,expiresAt:expiry,email:profile.email});
 }catch(err){return callbackPage(env,{error:err.message||'Falha na conexão Google.'});}
}
async function sessionFor(req,env){
 const raw=(req.headers.get('Authorization')||'').match(/^Bearer ([A-Za-z0-9_-]{40,150})$/)?.[1];
 if(!raw)return null;
 const sessionHash=await hashToken(raw),now=Date.now();
 const row=await env.DB.prepare('SELECT s.sub,s.expires_at,s.last_seen,a.email FROM sessions s JOIN accounts a ON a.sub=s.sub WHERE s.session_hash=? AND s.expires_at>?').bind(sessionHash,now).first();
 if(!row)return null;
 if(row.expires_at-now<7*24*3600*1000){
   const expiry=now+SESSION_TTL;
   await env.DB.prepare('UPDATE sessions SET expires_at=?,last_seen=? WHERE session_hash=?').bind(expiry,now,sessionHash).run();
   row.expires_at=expiry;
 }
 return {...row,sessionHash};
}
async function googleAccessToken(env,sub,refresh=false){
 const account=await env.DB.prepare('SELECT access_enc,refresh_enc,access_expires FROM accounts WHERE sub=?').bind(sub).first();
 if(!account?.refresh_enc)throw Error('GOOGLE_REAUTH_REQUIRED');
 if(!refresh && account.access_enc && account.access_expires-Date.now()>90000)return decryptSecret(account.access_enc,env);
 const current=await decryptSecret(account.refresh_enc,env);
 let reply;
 try{reply=await exchangeGoogle({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:current});}
 catch(err){if(/invalid_grant|expired|revoked/i.test(err.message)){throw Error('GOOGLE_REAUTH_REQUIRED');}throw err;}
 if(!reply.access_token)throw Error('GOOGLE_REAUTH_REQUIRED');
 const newAccess=await encryptSecret(reply.access_token,env);
 const newRefresh=reply.refresh_token?await encryptSecret(reply.refresh_token,env):account.refresh_enc;
 await env.DB.prepare('UPDATE accounts SET access_enc=?,refresh_enc=?,access_expires=?,updated_at=? WHERE sub=?').bind(newAccess,newRefresh,Date.now()+Math.max(60,reply.expires_in||3600)*1000,Date.now(),sub).run();
 return reply.access_token;
}
export function allowedDriveTarget(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.googleapis.com'&&!u.port&&!u.username&&!u.password&&/^\/(?:upload\/)?drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(u.pathname)&&!u.hash;}
 catch{return false;}
}
async function driveProxy(req,env,sub){
 const target=new URL(req.url).searchParams.get('target')||'';
 if(!allowedDriveTarget(target))return fail('Endereço da API Google Drive não permitido.',400);
 if(!['GET','POST','PATCH','DELETE'].includes(req.method))return fail('Método não permitido.',405);
 const len=Number(req.headers.get('Content-Length')||0);if(len>MAX_BODY)return fail('Anexo excede o limite de 22 MiB para esta operação.',413);
 let body;
 if(req.method!=='GET'&&req.method!=='DELETE'){
  body=await req.arrayBuffer();if(body.byteLength>MAX_BODY)return fail('Arquivo excede o limite de 22 MiB.',413);
 }
 const ct=req.headers.get('Content-Type');
 const headers={};if(ct)headers['Content-Type']=ct;
 try{
  let access=await googleAccessToken(env,sub);
  let res=await fetch(target,{method:req.method,headers:{...headers,Authorization:'Bearer '+access},body,redirect:'manual'});
  if(res.status===401){access=await googleAccessToken(env,sub,true);res=await fetch(target,{method:req.method,headers:{...headers,Authorization:'Bearer '+access},body,redirect:'manual'});}
  const safeHeaders=responseHeaders({'Content-Type':res.headers.get('Content-Type')||'application/octet-stream'});
  return new Response(res.body,{status:res.status,headers:safeHeaders});
 }catch(err){if(err.message==='GOOGLE_REAUTH_REQUIRED')return fail('O Google revogou ou expirou o consentimento. Autorize novamente no Atlas.',401,'google_reauth_required');return fail('Falha temporária na API Google. Tente novamente.',502,'google_error');}
}
export default {
 async fetch(req,env){
  try{
   const u=new URL(req.url);const path=u.pathname;
   if(path==='/health' && req.method==='GET')return json({ok:true,service:'atlas-auth-gateway',version:'2.1.0'});
   if(!env?.DB||!env.APP_ORIGIN)return fail('Backend ainda não configurado. Consulte o README.',503,'not_configured');
   const isCors=authorizedCors(req,env);
   if(req.method==='OPTIONS')return isCors?new Response(null,{status:204,headers:responseHeaders(corsHeaders(env))}):fail('Origem não autorizada.',403);
   if(path==='/auth/start'&&req.method==='GET'){await checkConfig(env);return authStart(req,env);}
   if(path==='/auth/callback'&&req.method==='GET'){await checkConfig(env);return authCallback(req,env);}
   if(!path.startsWith('/api/'))return fail('Recurso não encontrado.',404);
   if(!isCors)return fail('Origem não autorizada.',403);
   const securedHeaders=corsHeaders(env);
   if(!env.ALLOWED_EMAIL)return json({error:'ALLOWED_EMAIL ausente.'},503,securedHeaders);
   const session=await sessionFor(req,env);
   if(!session)return json({error:'Sessão expirada ou inexistente.',code:'session_expired'},401,securedHeaders);
   let result;
   if(path==='/api/session'&&req.method==='GET'){
    try{await googleAccessToken(env,session.sub);result=json({connected:true,email:session.email,expiresAt:session.expires_at});}
    catch(err){result=err.message==='GOOGLE_REAUTH_REQUIRED'?fail('A autorização Google expirou. Faça login novamente.',401,'google_reauth_required'):fail('Google temporariamente indisponível.',503,'google_unavailable');}
   }
   else if(path==='/api/logout'&&req.method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE session_hash=?').bind(session.sessionHash).run();result=json({ok:true});}
   else if(path==='/api/drive-proxy'){result=await driveProxy(req,env,session.sub);}
   else result=fail('Endpoint não encontrado.',404);
   const h=new Headers(result.headers);for(const [k,v] of Object.entries(securedHeaders))h.set(k,v);
   return new Response(result.body,{status:result.status,headers:h});
  }catch(err){
   // Do not leak Google credentials, authorization codes, DB errors or request bodies in responses.
   return fail('Erro no backend do Atlas. Confira a configuração e tente novamente.',500,'internal_error');
  }
 }
};

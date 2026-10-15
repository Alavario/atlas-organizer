import assert from 'node:assert/strict';
import test from 'node:test';
import app,{allowedDriveTarget} from '../backend/worker.mjs';
const states=new Map(),sessions=new Map(),accounts=new Map();
const makeDB=()=>({prepare(sql){let args=[];return {
 bind(...v){args=v;return this},
 async run(){
  if(sql.startsWith('DELETE FROM oauth_states WHERE expires_at')){for(const [k,v] of states)if(v.expires_at<args[0])states.delete(k);}
  else if(sql.startsWith('DELETE FROM sessions WHERE expires_at')){for(const [k,v] of sessions)if(v.expires_at<args[0])sessions.delete(k);}
  else if(sql.startsWith('INSERT INTO oauth_states'))states.set(args[0],{verifier:args[1],expires_at:args[2]});
  else if(sql.startsWith('INSERT INTO accounts'))accounts.set(args[0],{sub:args[0],email:args[1],refresh_enc:args[2],access_enc:args[3],access_expires:args[4]});
  else if(sql.startsWith('INSERT INTO sessions'))sessions.set(args[0],{session_hash:args[0],sub:args[1],expires_at:args[2],last_seen:args[3]});
  else if(sql.startsWith('UPDATE accounts')){const a=accounts.get(args[4]);Object.assign(a,{access_enc:args[0],refresh_enc:args[1],access_expires:args[2]});}
  else if(sql.startsWith('UPDATE sessions')){const a=sessions.get(args[2]);Object.assign(a,{expires_at:args[0],last_seen:args[1]});}
  else if(sql.startsWith('DELETE FROM sessions'))sessions.delete(args[0]);
  return {success:true};
 },
 async first(){
  if(sql.startsWith('DELETE FROM oauth_states')){const r=states.get(args[0]);states.delete(args[0]);return r?.expires_at>args[1]?{verifier:r.verifier}:null;}
  if(sql.startsWith('SELECT refresh_enc FROM accounts'))return accounts.get(args[0])||null;
  if(sql.startsWith('SELECT s.sub,s.expires_at')){const s=sessions.get(args[0]);if(!s||s.expires_at<=args[1])return null;return {...s,email:accounts.get(s.sub)?.email||''};}
  if(sql.startsWith('SELECT access_enc,refresh_enc'))return accounts.get(args[0])||null;
  throw Error('Unexpected query: '+sql);
 }
}}});
const encryptionKey=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const env={DB:makeDB(),APP_ORIGIN:'https://alavario.github.io',ALLOWED_EMAIL:'atlas-owner@example.com',GOOGLE_CLIENT_ID:'fake-google.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'server-secret',TOKEN_ENCRYPTION_KEY:encryptionKey};
const from='https://atlas-api.example.workers.dev';
const headers={Origin:env.APP_ORIGIN};
function request(path,more={}){return new Request(from+path,{headers:{...headers,...(more.headers||{})},method:more.method||'GET',body:more.body||undefined});}
let apiCalls=0,refreshCalls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,opts={})=>{
 const u=new URL(url);
 if(u.hostname==='oauth2.googleapis.com'){
  const args=new URLSearchParams(opts.body);
  if(args.get('grant_type')==='refresh_token'){refreshCalls++;return Response.json({access_token:'fresh-google-token',expires_in:3600});}
  assert.equal(args.get('client_secret'),'server-secret');
  assert.ok(args.get('code_verifier')?.length>30);
  return Response.json({access_token:'first-google-token',refresh_token:'very-sensitive-google-refresh-token',expires_in:3600});
 }
 if(u.hostname==='openidconnect.googleapis.com')return Response.json({sub:'id-123',email:'atlas-owner@example.com',email_verified:true});
 if(u.hostname==='www.googleapis.com'){
  apiCalls++;assert.match(opts.headers.Authorization,/^Bearer (first-google-token|fresh-google-token)$/);
  return Response.json({files:[{id:'f1',name:'atlas-organizer-data-v2.json'}]});
 }
 throw Error('Unmocked URL '+url);
};
try{
 test('Proxy allowlist excludes external domains and privileged endpoints',()=>{
  assert.ok(allowedDriveTarget('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder'));
  assert.ok(allowedDriveTarget('https://www.googleapis.com/upload/drive/v3/files/a123?uploadType=media'));
  for(const x of ['https://evil.com/drive/v3/files','http://www.googleapis.com/drive/v3/files','https://www.googleapis.com/calendar/v3/events','https://www.googleapis.com/drive/v3/permissions','https://www.googleapis.com.evil.com/drive/v3/files'])assert.equal(allowedDriveTarget(x),false);
 });
 test('OAuth, encrypted refresh, auto resume, proxy, and logout',async()=>{
  assert.equal((await app.fetch(request('/health'),env)).status,200);
  assert.equal((await app.fetch(request('/api/session'),env)).status,401);
  assert.equal((await app.fetch(new Request(from+'/api/session',{headers:{Origin:'https://evil.example'}}),env)).status,403);
  const allowed=await app.fetch(request('/api/session',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET'}}),env);
  assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),env.APP_ORIGIN);
  const start=await app.fetch(request('/auth/start'),env);
  assert.equal(start.status,302);
  const google=new URL(start.headers.get('Location'));
  const state=google.searchParams.get('state');assert.ok(state);
  assert.equal(google.searchParams.get('access_type'),'offline');
  assert.equal(google.searchParams.get('code_challenge_method'),'S256');
  const callback=await app.fetch(request('/auth/callback?state='+encodeURIComponent(state)+'&code=success'),env);
  assert.equal(callback.status,200);const html=await callback.text();
  const token=JSON.parse(html.match(/const payload=(\{.*?\});if\(window\.opener\)/s)[1]);
  assert.match(token.sessionToken,/^[\w-]{60,}$/);
  assert.notEqual(accounts.get('id-123').refresh_enc,'very-sensitive-google-refresh-token');
  assert.ok(!JSON.stringify([...sessions.values()]).includes(token.sessionToken));
  const replay=await app.fetch(request('/auth/callback?state='+state+'&code=success'),env);assert.match(await replay.text(),/expirada/i);
  const bearer={Authorization:'Bearer '+token.sessionToken};
  const status=await app.fetch(request('/api/session',{headers:bearer}),env);assert.equal(status.status,200);assert.equal((await status.json()).connected,true);
  const deny=await app.fetch(request('/api/drive-proxy?target='+encodeURIComponent('https://evil.example/file'),{headers:bearer}),env);assert.equal(deny.status,400);
  const target=encodeURIComponent('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder');
  const proxy=await app.fetch(request('/api/drive-proxy?target='+target,{headers:bearer}),env);
  assert.equal(proxy.status,200);assert.equal((await proxy.json()).files.length,1);assert.equal(apiCalls,1);
  accounts.get('id-123').access_expires=0;
  const repeat=await app.fetch(request('/api/drive-proxy?target='+target,{headers:bearer}),env);
  assert.equal(repeat.status,200);assert.equal(refreshCalls,1);
  const logout=await app.fetch(request('/api/logout',{method:'POST',headers:bearer}),env);assert.equal(logout.status,200);
  assert.equal((await app.fetch(request('/api/session',{headers:bearer}),env)).status,401);
 });
}finally{process.on('exit',()=>{globalThis.fetch=originalFetch;});}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PersistentGateway} from '../site/backend-client.js';
const base='https://atlas-api.example.workers.dev';
let persisted={base,token:'a'.repeat(60),email:'user@example.com'};
let calls=[];
const mockFetch=async(url,opts)=>{
 calls.push({url,opts});
 if(url===base+'/api/session')return Response.json({connected:true,email:'user@example.com',expiresAt:Date.now()+100000});
 if(url.startsWith(base+'/api/drive-proxy?target='))return Response.json({files:[{id:'f1'}]});
 if(url===base+'/api/logout')return Response.json({ok:true});
 throw Error('Unexpected '+url);
};
const client=new PersistentGateway(base,async()=>persisted,async x=>persisted=x,async()=>{persisted=null},mockFetch);
test('resume previous opaque browser session without Google popup',async()=>{
 assert.equal(await client.resume(),true);
 assert.equal(client.session.email,'user@example.com');
 assert.equal(calls[0].opts.headers.Authorization,'Bearer '+'a'.repeat(60));
});
test('Google API request goes only through backend with Atlas token',async()=>{
 const remoteUrl='https://www.googleapis.com/drive/v3/files?spaces=appDataFolder';
 const result=await client.driveFetch(remoteUrl,{method:'GET',headers:{Authorization:'Bearer google-not-sent'}});
 assert.equal(result.status,200);
 const call=calls.at(-1);assert.equal(call.opts.headers.Authorization,'Bearer '+'a'.repeat(60));
 assert.equal(new URL(call.url).searchParams.get('target'),remoteUrl);
 assert.ok(!JSON.stringify(call.opts).includes('google-not-sent'));
});
test('logout revokes backend session and drops IndexedDB reference',async()=>{
 await client.logout();assert.equal(persisted,null);assert.equal(client.session,null);
 assert.equal(calls.at(-1).url,base+'/api/logout');
});

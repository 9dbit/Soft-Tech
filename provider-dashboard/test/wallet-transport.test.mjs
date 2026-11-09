import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {fork,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

let dir,cert,server,origins,serverError='';
const ask=async message=>{const response=once(server,'message');server.send(message);return (await response)[0];};
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'wallet-transport-tls-'));cert=join(dir,'fixture.pem');const key=join(dir,'fixture.key');
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{encoding:'utf8'});
 assert.equal(result.status,0,'Ephemeral synthetic certificate generation failed');
 server=fork(new URL('./helpers/wallet-tls-server.mjs',import.meta.url),[key,cert],{stdio:['ignore','ignore','pipe','ipc']});server.stderr.on('data',chunk=>serverError+=chunk);
 ({origins}=(await once(server,'message'))[0]);
});
after(async()=>{if(server?.connected){const exit=once(server,'exit');server.send('close');await exit;}if(dir)rmSync(dir,{recursive:true,force:true});assert.equal(serverError,'');});
async function run(mode,{trust=true}={}){
 const child=fork(new URL('./helpers/wallet-tls-client.mjs',import.meta.url),[mode,JSON.stringify(origins)],{env:{...process.env,NODE_EXTRA_CA_CERTS:trust?cert:''},stdio:['ignore','pipe','pipe','ipc']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const [exit]=await once(child,'exit');assert.equal(exit,0,stderr);return JSON.parse(stdout.trim());
}
test('verified TLS rejects unknown CA and hostname mismatch before sending HTTP', {timeout:15000},async()=>{
 const initial=await ask('counts');await run('untrusted',{trust:false});assert.equal((await ask('counts')).requests,initial.requests);
 await run('trust');assert.equal((await ask('counts')).requests-initial.requests,1);
});
test('fresh DNS validation precedes reuse and changed pinned addresses use distinct sockets', {timeout:15000},async()=>{
 const initial=await ask('counts');await run('dns');const final=await ask('counts');assert.equal(final.requests-initial.requests,4);assert.equal(final.by_server[0]-initial.by_server[0],2);assert.equal(final.by_server[1]-initial.by_server[1],2);
});
test('pooled HMAC headers stay request scoped across operators, origins and v2 audiences', {timeout:15000},async()=>{
 const initial=await ask('counts');await run('credentials');const final=await ask('counts');assert.equal(final.requests-initial.requests,11);assert.equal(final.invalid_signatures-initial.invalid_signatures,1);assert.equal(final.repeated_nonces,0);
});
test('financial receipt checks, response bound and no redirect or automatic retry remain enforced', {timeout:15000},async()=>{
 const initial=await ask('counts');await run('receipts');const final=await ask('counts');assert.equal(final.requests-initial.requests,12);assert.equal(final.by_server[2],initial.by_server[2],'Redirect must never forward wallet credentials');
});
test('one deadline covers late DNS, queued sockets, headers and continuously dripping body', {timeout:15000},async()=>{
 const initial=await ask('counts');await run('deadline');const final=await ask('counts');assert.equal(final.requests-initial.requests,4,'Expired DNS/queued calls never send; no timeout retry');
});
test('admission and origin/address caches are bounded, with idle eviction and busy rejection', {timeout:15000},async()=>{
 const initial=await ask('counts');await run('bounds');const final=await ask('counts');assert.equal(final.requests-initial.requests,4);
});
test('real TLS committed disconnect stays unknown until Core restart recovers status exactly once', {timeout:15000},async()=>{
 const initial=await ask('counts');await run('core-recovery');const final=await ask('counts');assert.equal(final.debits-initial.debits,1);assert.equal(final.credits-initial.credits,1);assert.equal(final.status-initial.status,1);assert.equal(final.applications-initial.applications,2);
});
test('500 parallel cold and warm real TLS callbacks share a bounded pool and retain 1000 DNS checks', {timeout:30000},async()=>{
 const initial=await ask('counts'),proof=await run('profile'),final=await ask('counts');assert.equal(final.requests-initial.requests,1000);assert.ok(final.connections-initial.connections<=128);assert.equal(final.repeated_nonces,0);
 if(process.env.WALLET_TRANSPORT_FIXTURE_REPORT)writeFileSync(process.env.WALLET_TRANSPORT_FIXTURE_REPORT,JSON.stringify(proof,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({classification:proof.classification,phases:proof.phases,connections:proof.transport.connections,reused:proof.transport.reused,event_loop_max_ms:proof.event_loop_max_ms}));
});

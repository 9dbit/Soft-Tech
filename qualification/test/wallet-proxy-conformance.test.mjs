import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWalletServer} from '../../reference-wallet/server.mjs';
import {runWalletConformance,verifyAmbiguousDebitRecovery} from '../wallet-conformance.mjs';
import {adminCall} from '../client.mjs';
async function listen(server,port=0){await new Promise(r=>server.listen(port,'127.0.0.1',r));return server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
test('actual socket drops through an HTTP reverse proxy become502 and still prove before/after commit and exactly-once recovery',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'wallet-proxy-')),env={WALLET_ENVIRONMENT:'preproduction',WALLET_DEPLOYMENT_ID:'proxy-fixture-wallet',WALLET_CORE_AUDIENCE:'proxy-fixture-core',WALLET_MASTER_KEY:'proxy-fixture-master-'.repeat(4),WALLET_ADMIN_TOKEN:'proxy-fixture-admin-'.repeat(4),WALLET_DB_PATH:path.join(dir,'wallet.sqlite'),WALLET_TEST_CONTROL_ENABLED:'true'};let service=createWalletServer({env});const targetPort=await listen(service.server);
 const proxy=http.createServer((req,res)=>{const upstream=http.request({host:'127.0.0.1',port:targetPort,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{if(!res.destroyed&&!res.headersSent){res.writeHead(502,{'content-type':'application/json'});res.end('{"error":"fixture upstream connection closed"}');}});res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);});const proxyPort=await listen(proxy);
 const config={environment:'preproduction',core_audience:env.WALLET_CORE_AUDIENCE,wallet_url:'http://127.0.0.1:'+proxyPort,wallet_admin_token:env.WALLET_ADMIN_TOKEN,operator:{id:'op-proxy-fixture',wallet_secret:'proxy-fixture-secret-'.repeat(4),protocol_version:2}};
 try{await adminCall(config,'/admin/operators',{operator_id:config.operator.id,secret:config.operator.wallet_secret,currency:'VCOIN',scale:2,protocol_version:2});const r=await runWalletConformance(config,{runId:'unit-proxy-conformance',restart:async()=>{await close(service.server);service=createWalletServer({env});await listen(service.server,targetPort);}});assert.equal(r.status,'PASS',JSON.stringify(r.cases.filter(c=>c.status!=='PASS')));assert.equal(r.cases.length,17);for(const [kind,expectedStatus]of [['before_disconnect','not_found'],['after_disconnect','applied']]){const c=r.cases.find(c=>c.name===kind+'_recovery');assert.equal(c.transport_observation.http_status,502);assert.equal(c.injected_fault.remaining,0);assert.equal(c.status_before_retry,expectedStatus);assert.equal(c.duplicate_receipt_verified,true);assert.equal(BigInt(c.balance_before_minor)-BigInt(c.balance_after_recovery_minor),50n);}
 }finally{await close(proxy);await close(service.server);rmSync(dir,{recursive:true,force:true});}
});
function fake({responseStatus=502,remaining=0,wrongCommit=false,doubleCharge=false}={}){
 let armed=false,applied=false,debits=0;const receipt={status:'applied',transaction_id:'fixture:debit',amount_minor:'50',balance_minor:'950',currency:'VCOIN',scale:2};
 return {call:async(_c,action)=>{if(action==='balance')return {ok:true,data:{balance_minor:doubleCharge&&debits>=3?'900':applied?'950':'1000'}};if(action==='status')return {ok:true,data:applied?receipt:{status:'not_found'}};if(action==='debit'){debits++;if(debits===1){applied=wrongCommit;return {ok:responseStatus<400,status:responseStatus,data:{}};}applied=true;return {ok:true,status:200,data:receipt};}},admin:async(_c,url)=>{if(url==='/admin/faults'){armed=true;return {ok:true,data:{id:'fixture-fault'}};}return {ok:true,data:{faults:armed?[{id:'fixture-fault',kind:'before_disconnect',action:'debit',remaining}]:[]}};}};
}
test('arbitrary gateway errors, successful responses and wrong commit state cannot satisfy the injected-disconnect case',async()=>{
 const c={operator:{id:'op-fixture'}},p={player_ref:'fixture-player',transaction_id:'fixture:debit',amount_minor:'50'};
 for(const [options,expected]of [[{remaining:1},/EXACT_INJECTED_FAULT_NOT_CONSUMED/],[{responseStatus:200},/Expected ambiguous transport failure/],[{responseStatus:503},/Expected ambiguous transport failure/],[{wrongCommit:true},/Wrong outcome after transport failure/],[{doubleCharge:true},/RECOVERY_DOUBLE_CHARGE/]])await assert.rejects(()=>verifyAmbiguousDebitRecovery(c,{payload:p,kind:'before_disconnect',expectApplied:false,...fake(options)}),expected);
});

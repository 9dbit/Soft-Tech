import {Core} from '../../lib/core.mjs';
import {AdmissionWallet} from './admission-wallet.mjs';

const {action,params,walletPath,point}=JSON.parse(process.env.ADMISSION_CRASH_INPUT);
const wallet=new AdmissionWallet(walletPath);
const core=new Core({transport:async(op,_secret,called,payload)=>{
 const receipt=wallet.execute(op,called,payload);
 if(point==='wallet_applied'&&called===action)process.kill(process.pid,'SIGKILL');
 return receipt;
}});
if(point==='admission_committed'){
 const db=core.db;
 core.journal.db={exec(sql){
  const result=db.exec(sql);
  // Kill after the real FULL-WAL COMMIT but before DurableWrites releases the
  // promise. A distinct Core reader in the parent will verify persistence.
  if(sql==='COMMIT'&&core.get("SELECT id FROM wallet_ops WHERE action=? AND attempts=1 AND status='pending'",action))process.kill(process.pid,'SIGKILL');
  return result;
 }};
}
const key={game:'uno-luck'};
if(action==='debit')await core.reserve(key,params);
else if(action==='credit')await core.settle(key,params);
else if(action==='reversal')await core.voidRound(key,params);
else throw Error('INVALID_CRASH_ACTION');
throw Error('EXPECTED_CRASH_BOUNDARY_NOT_REACHED');

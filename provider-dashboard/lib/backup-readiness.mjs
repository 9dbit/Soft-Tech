/** Public, nonsecret backup proof. A healthy database is not restore evidence. */
export function backupReadiness(state,{env=process.env,now=Date.now()}={}){
 const source_commit=env.RAILWAY_GIT_COMMIT_SHA||'local';
 const last=state?.last;
 const at=typeof last?.at==='string'?Date.parse(last.at):NaN;
 const report={ok:false,backup_verified:false,verified_at:Number.isFinite(at)?last.at:null,source_commit};
 const blocked=reason=>({...report,reason});
 if(state?.enabled!==true)return blocked('BACKUP_DISABLED');
 if(!last)return blocked('BACKUP_PENDING');
 if(last.ok!==true)return blocked('BACKUP_FAILED');
 if(last.remoteRestore!=='verified')return blocked('REMOTE_RESTORE_UNVERIFIED');
 if(last.source_commit!==source_commit)return blocked('BACKUP_BUILD_MISMATCH');
 if(!Number.isFinite(at)||at>now)return blocked('BACKUP_TIMESTAMP_INVALID');
 const interval=Number(env.OFFSITE_BACKUP_INTERVAL_HOURS||24);
 if(!Number.isFinite(interval)||interval<6||interval>168)return blocked('BACKUP_INTERVAL_INVALID');
 // One hour of grace permits an in-progress scheduled snapshot, not an old release's proof.
 if(now-at>(interval+1)*3600000)return blocked('BACKUP_STALE');
 if(typeof last.sha256!=='string'||!/^[a-f0-9]{64}$/.test(last.sha256)||!Number.isSafeInteger(last.bytes)||last.bytes<=0)return blocked('BACKUP_PROOF_INVALID');
 return {...report,ok:true,backup_verified:true,reason:null};
}

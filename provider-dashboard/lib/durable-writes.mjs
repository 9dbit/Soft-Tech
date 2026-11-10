import {Fault} from './security.mjs';
import {corePhases} from './core-phases.mjs';

/** Group independent synchronous writes into one FULL-WAL commit. A caller is
 * released only after COMMIT succeeds; each operation has its own savepoint.
 * No network request, Promise, or user response may run inside the transaction. */
export class DurableWrites {
 constructor(db,{maxBatch=64,maxPending=1024,delayMs=2,phases=corePhases}={}){
  this.db=db;this.maxBatch=maxBatch;this.maxPending=maxPending;this.delayMs=delayMs;
  this.pending=[];this.timer=null;this.closed=false;this.phases=phases;
  this.metrics={operations:0,commits:0,failed_commits:0,rejected_operations:0,max_batch:0,max_pending:0,commit_ms_total:0,commit_ms_max:0};
 }
 run(fn,kind='journal'){
  if(this.closed)return Promise.reject(new Fault(503,'JOURNAL_CLOSED'));
  if(this.pending.length>=this.maxPending)return Promise.reject(new Fault(503,'JOURNAL_BACKPRESSURE'));
  const observation=this.phases.journalQueued(kind);
  return new Promise((resolve,reject)=>{this.pending.push({fn,resolve,reject,observation});this.metrics.max_pending=Math.max(this.metrics.max_pending,this.pending.length);this.schedule();});
 }
 schedule(){if(!this.timer&&this.pending.length)this.timer=setTimeout(()=>{this.timer=null;this.flush();},this.delayMs);}
 flush(){
  if(this.closed||!this.pending.length)return;
  const batch=this.pending.splice(0,this.maxBatch),outcomes=[];
  const observation=this.phases.batchEntered(batch.map(item=>item.observation));let failed=true;
  try{
   const begin=this.phases.batchStart(observation,'begin');try{this.db.exec('BEGIN IMMEDIATE');}finally{this.phases.batchEnd(begin);}
   const body=this.phases.batchStart(observation,'body');
   try{for(const item of batch){
    this.db.exec('SAVEPOINT durable_operation');const operation=this.phases.operationStart(item.observation);
    try{const value=this.phases.run(item.observation?.lease,item.fn);if(value?.then)throw Error('Asynchronous durable operation forbidden');this.db.exec('RELEASE durable_operation');outcomes.push({item,value});}
    catch(error){this.db.exec('ROLLBACK TO durable_operation');this.db.exec('RELEASE durable_operation');outcomes.push({item,error});}
    finally{this.phases.end(operation);}
   }}finally{this.phases.batchEnd(body);}
   const commit=this.phases.batchStart(observation,'commit');let elapsed;
   try{const start=performance.now();this.db.exec('COMMIT');elapsed=performance.now()-start;}finally{this.phases.batchEnd(commit);}
   this.metrics.operations+=batch.length;this.metrics.commits++;this.metrics.max_batch=Math.max(this.metrics.max_batch,batch.length);
   this.metrics.commit_ms_total+=elapsed;this.metrics.commit_ms_max=Math.max(this.metrics.commit_ms_max,elapsed);
   const resolution=this.phases.batchStart(observation,'resolution');
   try{for(const {item,value,error}of outcomes){this.phases.journalSettled(item.observation,{failed:!!error});if(error){this.metrics.rejected_operations++;item.reject(error);}else item.resolve(value);}}
   finally{this.phases.batchEnd(resolution);}failed=false;
  }catch(error){const rollback=this.phases.batchStart(observation,'rollback');try{this.db.exec('ROLLBACK');}catch{}finally{this.phases.batchEnd(rollback);}this.metrics.failed_commits++;for(const item of batch){this.phases.journalSettled(item.observation,{failed:true,committed:false});item.reject(error);}}
  finally{this.phases.batchFinished(observation,failed);}
  this.schedule();
 }
 status(){return {...this.metrics,pending:this.pending.length,policy:'FULL WAL; replies only after durable commit',max_batch_limit:this.maxBatch};}
 close(){this.closed=true;clearTimeout(this.timer);this.timer=null;for(const item of this.pending.splice(0)){this.phases.journalSettled(item.observation,{failed:true,committed:false,closed:true});item.reject(new Fault(503,'JOURNAL_CLOSED'));}}
}

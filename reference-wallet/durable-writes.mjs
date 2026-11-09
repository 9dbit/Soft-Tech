import {types} from 'node:util';

/** One writer, bounded synchronous operations, FULL-WAL commit before any ack.
 * Callbacks cannot perform I/O or return asynchronous work. Each has an isolated
 * savepoint; an outer commit failure rejects every operation in that batch. */
export class DurableWrites {
 constructor(db,{maxBatch=64,maxPending=1024,delayMs=2,fault=code=>Object.assign(new Error(code),{status:503,code})}={}){
  if(!Number.isInteger(maxBatch)||maxBatch<1||maxBatch>64||!Number.isInteger(maxPending)||maxPending<maxBatch||maxPending>1024||!Number.isInteger(delayMs)||delayMs<0||delayMs>1000)throw Error('Invalid durable queue bounds');
  this.db=db;this.maxBatch=maxBatch;this.maxPending=maxPending;this.delayMs=delayMs;this.fault=fault;
  this.pending=[];this.timer=null;this.closed=false;this.inOperation=false;
  this.metrics={operations:0,commits:0,failed_commits:0,rejected_operations:0,max_batch:0,max_pending:0,commit_ms_total:0,commit_ms_max:0};
 }
 run(fn){
  // Reject nesting before it can enqueue work that outlives a rolled-back caller.
  if(this.inOperation)throw Error('Nested durable queue operation forbidden');
  if(typeof fn!=='function'||types.isAsyncFunction(fn)||types.isGeneratorFunction(fn))return Promise.reject(Error('Synchronous durable callback required'));
  if(this.closed)return Promise.reject(this.fault('JOURNAL_CLOSED'));
  if(this.pending.length>=this.maxPending)return Promise.reject(this.fault('JOURNAL_BACKPRESSURE'));
  return new Promise((resolve,reject)=>{this.pending.push({fn,resolve,reject});this.metrics.max_pending=Math.max(this.metrics.max_pending,this.pending.length);this.schedule();});
 }
 schedule(){if(!this.timer&&this.pending.length&&!this.closed)this.timer=setTimeout(()=>{this.timer=null;this.flush();},this.delayMs);}
 flush(){
  if(this.closed||!this.pending.length)return;
  if(this.timer){clearTimeout(this.timer);this.timer=null;}
  const batch=this.pending.splice(0,this.maxBatch),outcomes=[];
  try{
   this.db.exec('BEGIN IMMEDIATE');
   for(const item of batch){
    this.db.exec('SAVEPOINT wallet_durable_operation');
    try{
     let value;this.inOperation=true;
     try{value=item.fn();if(value?.then)throw Error('Asynchronous durable operation forbidden');}finally{this.inOperation=false;}
     this.db.exec('RELEASE wallet_durable_operation');outcomes.push({item,ok:true,value});
    }catch(error){this.db.exec('ROLLBACK TO wallet_durable_operation');this.db.exec('RELEASE wallet_durable_operation');outcomes.push({item,ok:false,error});}
   }
   const start=performance.now();this.db.exec('COMMIT');const elapsed=performance.now()-start;
   this.metrics.operations+=batch.length;this.metrics.commits++;this.metrics.max_batch=Math.max(this.metrics.max_batch,batch.length);
   this.metrics.commit_ms_total+=elapsed;this.metrics.commit_ms_max=Math.max(this.metrics.commit_ms_max,elapsed);
   for(const outcome of outcomes){if(outcome.ok)outcome.item.resolve(outcome.value);else{this.metrics.rejected_operations++;outcome.item.reject(outcome.error);}}
  }catch(error){try{this.db.exec('ROLLBACK');}catch{}this.metrics.failed_commits++;for(const item of batch)item.reject(error);}
  this.inOperation=false;this.schedule();
 }
 status(){return {...this.metrics,pending:this.pending.length,policy:'FULL WAL; replies only after durable commit',max_batch_limit:this.maxBatch,max_pending_limit:this.maxPending,delay_ms:this.delayMs};}
 close(){this.closed=true;clearTimeout(this.timer);this.timer=null;for(const item of this.pending.splice(0))item.reject(this.fault('JOURNAL_CLOSED'));}
}

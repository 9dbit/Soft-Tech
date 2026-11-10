import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';

// Fixed labels and fixed-size counters only. Never put request data in this registry.
export const CORE_PHASE_SCHEMA=1;
export const CORE_CAPTURE_LIMIT=1024;
export const CORE_SPAN_LIMIT=4096;
export const CORE_COUNTER_MAX=Number.MAX_SAFE_INTEGER;
export const CORE_PHASE_BUCKETS=Object.freeze([250,500,1000,2000,4000,8000,16000,32000,64000,128000,256000,512000,1000000,2000000,4000000,8000000,16000000,30000000,60000000,null]);
export const CORE_ACTIONS=Object.freeze(['engine_redeem','engine_status','engine_reserve','engine_settle','engine_void','engine_other','operator']);
export const CORE_PHASES=Object.freeze([
 'arrival_to_body_complete','body_read','auth_total',
 'auth_queue','auth_batch_begin','auth_entry_to_operation','auth_operation_body','auth_batch_body','auth_batch_commit','auth_commit_to_resolve','auth_resolve_to_resume',
 'journal_queue','journal_batch_begin','journal_entry_to_operation','journal_operation_body','journal_batch_body','journal_batch_commit','journal_commit_to_resolve',
 'engine_action','wallet_balance','wallet_debit','wallet_credit','wallet_reversal','wallet_status',
 'transaction_begin','transaction_body','transaction_commit','transaction_rollback',
 'handler_total','response_write','response_to_finish','request_total'
]);
export const CORE_PHASE_COUNTERS=Object.freeze(['body_failures','auth_failures','journal_operations','journal_operation_failures','journal_batch_failures','journal_closed','transaction_failures','invalid_clock','dropped_spans']);
const BATCH_PHASES=Object.freeze(['begin','body','commit','rollback','resolution']);
const ACTION_INDEX=new Map(CORE_ACTIONS.map((name,index)=>[name,index]));
const PHASE_INDEX=new Map(CORE_PHASES.map((name,index)=>[name,index]));
const COUNTER_INDEX=new Map(CORE_PHASE_COUNTERS.map((name,index)=>[name,index]));
const cell=()=>new Float64Array(5+CORE_PHASE_BUCKETS.length);
const validNumber=value=>Number.isSafeInteger(value)&&value>=0;

function actionFor(method,rawPath){
 if(typeof rawPath!=='string')return null;
 const query=rawPath.indexOf('?'),path=query<0?rawPath:rawPath.slice(0,query);
 if(path.startsWith('/api/v4/agency-game/')){
  const action=path.slice('/api/v4/agency-game/'.length);
  return ['redeem','status','reserve','settle','void'].includes(action)?'engine_'+action:'engine_other';
 }
 return path.startsWith('/v1/')?'operator':null;
}

/** All public observer methods fail closed for telemetry, without replacing a
 * business result or exception. AsyncLocalStorage contains only [slot,generation].
 * A lease survives response close until the original handler has also finished. */
export class CorePhases {
 constructor({now=()=>Math.floor(performance.now()*1000),captureLimit=CORE_CAPTURE_LIMIT}={}){
  if(!Number.isInteger(captureLimit)||captureLimit<1||captureLimit>CORE_CAPTURE_LIMIT)throw Error('Invalid telemetry capacity');
  this.now=now;this.captureLimit=captureLimit;this.registryId=randomUUID();this.storage=new AsyncLocalStorage();
  this.generations=new Float64Array(captureLimit);this.free=Array.from({length:captureLimit},(_,i)=>captureLimit-1-i);
  this.slots=Array.from({length:captureLimit},()=>({live:false,action:0,started:null,handlerDone:false,responseDone:false,errors:false,aborted:false,responseStarted:null,authSequence:0,authResolved:null,spanCount:0,
   sums:new Float64Array(CORE_PHASES.length),invocations:new Float64Array(CORE_PHASES.length),maxima:new Float64Array(CORE_PHASES.length),counters:new Float64Array(CORE_PHASE_COUNTERS.length)}));
  this.operations=CORE_ACTIONS.map(()=>({completed:0,errors:0,aborted:0,counters:new Float64Array(CORE_PHASE_COUNTERS.length),phases:CORE_PHASES.map(cell)}));
  this.active=0;this.completed=0;this.dropped=0;this.invalidClock=0;this.droppedSpans=0;this.late=0;this.saturated=false;this.telemetryError=false;
  this.batch={active:0,completed:0,failed:0,queued_items:0,settled_items:0,unattributed_items:0,phases:BATCH_PHASES.map(cell),queue:cell()};
  this.loop={running:false,interval_ms:100,invalid_clock:0,samples:cell()};this.loopTimer=null;
 }
 guard(fn,fallback=null){try{return fn();}catch{this.telemetryError=true;return fallback;}}
 add(target,key,value=1){const next=target[key]+value;if(!validNumber(next)||next>=CORE_COUNTER_MAX){target[key]=CORE_COUNTER_MAX;this.saturated=true;}else target[key]=next;}
 time(slot=null){let value;try{value=this.now();}catch{this.telemetryError=true;this.clockInvalid(slot);return null;}if(!validNumber(value)){this.clockInvalid(slot);return null;}return value;}
 clockInvalid(slot=null){this.add(this,'invalidClock');if(slot)this.add(slot.counters,COUNTER_INDEX.get('invalid_clock'));}
 duration(start,end,slot=null){if(start===null||end===null||!validNumber(start)||!validNumber(end)||end<start){this.clockInvalid(slot);return null;}return end-start;}
 slot(lease,late=false){
  if(!Array.isArray(lease)||lease.length!==2)return null;
  const [index,generation]=lease;
  if(Number.isInteger(index)&&index>=0&&index<this.captureLimit&&this.slots[index].live&&this.generations[index]===generation)return this.slots[index];
  if(late)this.add(this,'late');return null;
 }
 current(){return this.guard(()=>{const lease=this.storage.getStore();if(this.slot(lease))return lease;if(lease!==null&&lease!==undefined)this.add(this,'late');return null;});}
 begin(action){return this.guard(()=>{
  const index=ACTION_INDEX.get(action);if(index===undefined)return null;
  const selected=this.free.pop();if(selected===undefined){this.add(this,'dropped');return null;}
  if(this.generations[selected]>=CORE_COUNTER_MAX-1){this.saturated=true;this.add(this,'dropped');return null;}
  this.generations[selected]++;const slot=this.slots[selected];
  slot.live=true;slot.action=index;slot.handlerDone=false;slot.responseDone=false;slot.errors=false;slot.aborted=false;
  slot.responseStarted=null;slot.authSequence=0;slot.authResolved=null;slot.spanCount=0;
  slot.sums.fill(0);slot.invocations.fill(0);slot.maxima.fill(0);slot.counters.fill(0);
  slot.started=this.time(slot);this.add(this,'active');
  return Object.freeze([selected,this.generations[selected]]);
 });}
 beginHttp(method,path){return this.guard(()=>this.begin(actionFor(method,path)));}
 // Clear context for unattributed items as well: a shared timer belongs to no
 // particular batch item. The original callable runs exactly once.
 run(lease,fn){
  let entered=false,returned=false,value;
  try{return this.storage.run(this.slot(lease)?lease:null,()=>{entered=true;value=fn();returned=true;return value;});}
  catch(error){if(entered&&!returned)throw error;this.telemetryError=true;if(returned)return value;return fn();}
 }
 record(lease,label,start,end){return this.guard(()=>{
  const slot=this.slot(lease,true),index=PHASE_INDEX.get(label);if(!slot||index===undefined)return;
  const value=this.duration(start,end,slot);if(value===null)return;
  if(slot.spanCount>=CORE_SPAN_LIMIT){this.add(this,'droppedSpans');this.add(slot.counters,COUNTER_INDEX.get('dropped_spans'));return;}
  slot.spanCount++;this.add(slot.sums,index,value);this.add(slot.invocations,index);slot.maxima[index]=Math.max(slot.maxima[index],value);
 });}
 start(label,lease=this.current()){return this.guard(()=>{
  const slot=this.slot(lease);if(!slot||!PHASE_INDEX.has(label))return null;
  return {lease,label,start:this.time(slot),done:false};
 });}
 end(span){return this.guard(()=>{if(!span||span.done)return;span.done=true;const slot=this.slot(span.lease,true);if(slot)this.record(span.lease,span.label,span.start,this.time(slot));});}
 increment(label,lease=this.current()){return this.guard(()=>{const slot=this.slot(lease),index=COUNTER_INDEX.get(label);if(slot&&index!==undefined)this.add(slot.counters,index);});}
 bodyComplete(lease=this.current()){return this.guard(()=>{const slot=this.slot(lease);if(slot)this.record(lease,'arrival_to_body_complete',slot.started,this.time(slot));});}
 authStart(){return this.guard(()=>{const lease=this.current(),slot=this.slot(lease);if(!slot)return null;slot.authSequence++;slot.authResolved=null;return {...this.start('auth_total',lease),sequence:slot.authSequence};});}
 authResume(span){return this.guard(()=>{
  if(!span||span.done)return;const slot=this.slot(span.lease,true);if(!slot)return;
  const now=this.time(slot);if(slot.authSequence===span.sequence&&slot.authResolved!==null)this.record(span.lease,'auth_resolve_to_resume',slot.authResolved,now);
  this.record(span.lease,'auth_total',span.start,now);span.done=true;
 });}
 requestError(lease=this.current()){return this.guard(()=>{const slot=this.slot(lease);if(slot)slot.errors=true;});}
 responseStart(){return this.guard(()=>{const lease=this.current(),slot=this.slot(lease);if(!slot)return null;slot.responseStarted=this.time(slot);return this.start('response_write',lease);});}
 attachResponse(res,lease){return this.guard(()=>{
  if(!this.slot(lease))return;
  let done=false;
  const finish=()=>{if(done)return;done=true;this.responseDone(lease,false,res.statusCode);};
  const close=()=>{if(done)return;done=true;this.responseDone(lease,true,res.statusCode);};
  res.once('finish',finish);res.once('close',close);
 });}
 responseDone(lease,aborted=false,status=200){return this.guard(()=>{
  const slot=this.slot(lease,true);if(!slot||slot.responseDone)return;
  const now=this.time(slot);slot.responseDone=true;slot.aborted=aborted===true;if(Number.isInteger(status)&&status>=400)slot.errors=true;
  this.record(lease,'request_total',slot.started,now);
  if(slot.responseStarted!==null)this.record(lease,'response_to_finish',slot.responseStarted,now);
  this.retire(lease);
 });}
 handlerDone(lease){return this.guard(()=>{
  const slot=this.slot(lease,true);if(!slot||slot.handlerDone)return;
  this.record(lease,'handler_total',slot.started,this.time(slot));slot.handlerDone=true;this.retire(lease);
 });}
 addCell(target,sum,invocations=1,maxInvocation=sum){
  this.add(target,0);this.add(target,1,invocations);this.add(target,2,sum);target[3]=Math.max(target[3],sum);target[4]=Math.max(target[4],maxInvocation);
  const bucket=CORE_PHASE_BUCKETS.findIndex(upper=>upper===null||sum<=upper);this.add(target,5+bucket);
 }
 retire(lease){
  const slot=this.slot(lease);if(!slot||!slot.handlerDone||!slot.responseDone)return;
  try{
   const operation=this.operations[slot.action];this.add(operation,'completed');if(slot.errors)this.add(operation,'errors');if(slot.aborted)this.add(operation,'aborted');
   for(let i=0;i<CORE_PHASE_COUNTERS.length;i++)this.add(operation.counters,i,slot.counters[i]);
   for(let i=0;i<CORE_PHASES.length;i++)if(slot.invocations[i])this.addCell(operation.phases[i],slot.sums[i],slot.invocations[i],slot.maxima[i]);
   this.add(this,'completed');
  }finally{slot.live=false;this.active--;this.free.push(lease[0]);}
 }
 journalQueued(kind='journal'){return this.guard(()=>{
  const lease=this.current(),slot=this.slot(lease);this.add(this.batch,'queued_items');if(!slot)this.add(this.batch,'unattributed_items');
  if(slot)this.increment('journal_operations',lease);
  return {lease,kind:kind==='auth'?'auth':'journal',enqueued:this.time(slot),entered:null,commitEnd:null,settled:false,authSequence:slot?.authSequence??0};
 });}
 batchEntered(items){return this.guard(()=>{
  const now=this.time();this.add(this.batch,'active');
  for(const item of items){if(!item)continue;item.entered=now;const slot=this.slot(item.lease);const elapsed=this.duration(item.enqueued,now,slot);if(elapsed!==null)this.addCell(this.batch.queue,elapsed);if(slot)this.record(item.lease,item.kind+'_queue',item.enqueued,now);}
  return {items,done:false};
 });}
 batchStart(batch,label){return this.guard(()=>batch&&BATCH_PHASES.includes(label)?{batch,label,start:this.time(),done:false}:null);}
 batchEnd(span){return this.guard(()=>{
  if(!span||span.done)return;span.done=true;const now=this.time(),elapsed=this.duration(span.start,now);if(elapsed!==null)this.addCell(this.batch.phases[BATCH_PHASES.indexOf(span.label)],elapsed);
  if(['begin','body','commit'].includes(span.label))for(const item of span.batch.items){if(!item)continue;if(span.label==='commit')item.commitEnd=now;this.record(item.lease,item.kind+'_batch_'+span.label,span.start,now);}
 });}
 operationStart(item){return this.guard(()=>{
  if(!item)return null;const now=this.time(this.slot(item.lease));if(item.entered!==null)this.record(item.lease,item.kind+'_entry_to_operation',item.entered,now);
  return {lease:item.lease,label:item.kind+'_operation_body',start:now,done:false};
 });}
 journalSettled(item,{failed=false,committed=true,closed=false}={}){return this.guard(()=>{
  if(!item||item.settled)return;item.settled=true;const slot=this.slot(item.lease),now=this.time(slot);this.add(this.batch,'settled_items');
  if(!slot)return;
  if(failed)this.increment('journal_operation_failures',item.lease);if(!committed&&!closed)this.increment('journal_batch_failures',item.lease);if(closed)this.increment('journal_closed',item.lease);
  if(item.commitEnd!==null)this.record(item.lease,item.kind+'_commit_to_resolve',item.commitEnd,now);
  if(item.kind==='auth'&&slot.authSequence===item.authSequence)slot.authResolved=now;
 });}
 batchFinished(batch,failed=false){return this.guard(()=>{if(!batch||batch.done)return;batch.done=true;this.batch.active--;this.add(this.batch,'completed');if(failed)this.add(this.batch,'failed');});}
 // Observe the original promise; return it unchanged. No retry, result copying,
 // new await boundary or financial cancellation is introduced.
 walletCall(action,fn){
  const span=this.start('wallet_'+action);let promise;
  try{promise=fn();}catch(error){this.end(span);throw error;}
  this.guard(()=>{if(!span)return;const done=()=>{this.end(span);};if(promise instanceof Promise)Promise.prototype.then.call(promise,done,done);else done();});
  return promise;
 }
 startLoop(){return this.guard(()=>{
  if(this.loop.running)return;this.loop.running=true;
  const schedule=()=>{
   const started=this.guard(()=>this.time());
   this.loopTimer=setTimeout(()=>{
    this.guard(()=>{
     if(!this.loop.running)return;
     const elapsed=this.duration(started,this.time());
     if(elapsed===null)this.add(this.loop,'invalid_clock');else this.addCell(this.loop.samples,Math.max(0,elapsed-this.loop.interval_ms*1000));
    });
    if(this.loop.running)this.guard(schedule);
   },this.loop.interval_ms);this.loopTimer.unref?.();
  };schedule();
 });}
 stopLoop(){return this.guard(()=>{this.loop.running=false;clearTimeout(this.loopTimer);this.loopTimer=null;});}
 serializeCell(value){return {operations:value[0],invocations:value[1],total_us:value[2],max_operation_us:value[3],max_invocation_us:value[4],buckets:Array.from(value.subarray(5))};}
 snapshot(){return this.guard(()=>{
  const operations={};
  for(let i=0;i<CORE_ACTIONS.length;i++){
   const entry=this.operations[i];if(!entry.completed)continue;
   const phases={};for(let j=0;j<CORE_PHASES.length;j++)if(entry.phases[j][0])phases[CORE_PHASES[j]]=this.serializeCell(entry.phases[j]);
   operations[CORE_ACTIONS[i]]={completed:entry.completed,errors:entry.errors,aborted:entry.aborted,counters:Object.fromEntries(CORE_PHASE_COUNTERS.map((key,j)=>[key,entry.counters[j]])),phases};
  }
  const batchPhases={};for(let i=0;i<BATCH_PHASES.length;i++)if(this.batch.phases[i][0])batchPhases[BATCH_PHASES[i]]=this.serializeCell(this.batch.phases[i]);
  return {schema:CORE_PHASE_SCHEMA,available:true,registry_id:this.registryId,reset_count:0,unit:'microseconds',histogram:'per_request_phase_sum',capture_limit:this.captureLimit,span_limit_per_capture:CORE_SPAN_LIMIT,bucket_upper_us:CORE_PHASE_BUCKETS,
   active_captures:this.active,completed_operations:this.completed,dropped_captures:this.dropped,dropped_spans:this.droppedSpans,invalid_clock:this.invalidClock,late_observations:this.late,telemetry_error:this.telemetryError,saturated:this.saturated,operations,
   journal_batches:{active_batches:this.batch.active,completed_batches:this.batch.completed,failed_batches:this.batch.failed,queued_items:this.batch.queued_items,settled_items:this.batch.settled_items,unattributed_items:this.batch.unattributed_items,histogram:'one_observation_per_batch_phase',phases:batchPhases,queue_per_item:this.serializeCell(this.batch.queue)},
   event_loop:{interval_ms:this.loop.interval_ms,running:this.loop.running,invalid_clock:this.loop.invalid_clock,histogram:'timer_callback_delay_after_nominal_interval',samples:this.serializeCell(this.loop.samples)}};
  },{schema:CORE_PHASE_SCHEMA,available:false,registry_id:this.registryId,telemetry_error:true});}
}

export const corePhases=new CorePhases();

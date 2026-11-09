/* Opt-in acceptance run against real, isolated provider runtimes. No mocks or RNG overrides.
   Results are persisted; credentials and launch tokens never enter reports/logs. */
import {randomUUID} from 'node:crypto';
import {signer} from '../lib/security.mjs';
import {catalog} from '../lib/catalog.mjs';
import {waitForReadiness} from './readiness.mjs';
function assert(ok,message){if(!ok)throw Error(message);}
function assertEqual(a,b,message){assert(a===b,message);}
export async function runAcceptance(core,id){
 if(!/^[A-Za-z0-9_.-]{3,100}$/.test(id))throw Error('Invalid acceptance run ID');
 if(core.get('SELECT id FROM selftests WHERE id=?',id))return;
 const started=core.clock(),report={id,environment:'sandbox',engine_source:'real deployed runtime',cases:[],isolation:[],notes:['Virtual credits only','No original game services changed','Seamless callback contract is separately tested with fault injection']};
 core.run('INSERT INTO selftests VALUES(?,?,?,?,?)',id,'running',JSON.stringify(report),started,started);
 const save=status=>core.run('UPDATE selftests SET status=?,result_json=?,updated_at=? WHERE id=?',status,JSON.stringify(report),core.clock(),id);
 try{
  report.readiness=await waitForReadiness(core,id);save('running');
  const profiles=[];
  for(const suffix of ['A','B'])profiles.push(core.createOperator({name:'Acceptance Operator '+suffix+' / '+id,games:catalog.map(g=>g.id),currency:'VCOIN',scale:2,initial_minor:'10000000',return_origins:[core.env.CORE_PUBLIC_ORIGIN]},'system:acceptance',{internal:true}));
  const local='http://127.0.0.1:'+(core.env.PORT||8080);
  const api=async(profile,path,body=null)=>{const raw=body?JSON.stringify(body):'',method=body?'POST':'GET',s=signer(profile.credential.secret,'softtech.v1',method,path,raw);const r=await fetch(local+path,{method,headers:{'Content-Type':'application/json','X-SoftTech-Key':profile.credential.key_id,'X-SoftTech-Timestamp':s.timestamp,'X-SoftTech-Nonce':s.nonce,'X-SoftTech-Signature':s.signature,'Idempotency-Key':randomUUID()},...(body?{body:raw}:{}),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};};
  for(const profile of profiles){
   const listing=await api(profile,'/v1/games');assertEqual(listing.status,200,'Operator game catalogue unavailable');assertEqual(listing.data.games.length,3,'Operator catalogue mismatch');
   for(const g of core.games()){
    const caseResult={operator_id:profile.operator.id,game_id:g.id,status:'running',started_at:core.clock()};report.cases.push(caseResult);save('running');
    const launchResponse=await api(profile,'/v1/game-launches',{game_id:g.id,player_ref:'acceptance-same-player',currency:'VCOIN',return_url:core.env.CORE_PUBLIC_ORIGIN});assertEqual(launchResponse.status,200,'Launch API failed');
    const launch=launchResponse.data,token=new URLSearchParams(new URL(launch.launch_url).hash.slice(1)).get('softtech_launch');let cookie='';
    const h=g.id==='uno-luck'?{'X-UNO-Client':'spin-ui'}:g.id==='mahjong-wild'?{'X-ML-Request':'local-demo'}:{'X-Skygate-Client':'agency-ui'};
    async function native(path,body=null){const r=await fetch(g.origin+path,{method:body?'POST':'GET',headers:{...h,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(40000),redirect:'error'});const set=r.headers.getSetCookie?.()||[];if(set.length)cookie=set.map(x=>x.split(';')[0]).join('; ');let d;try{d=await r.json();}catch{throw Error('Native engine returned non-JSON');}if(!r.ok)throw Error('Engine '+g.id+' '+path+' returned '+r.status+': '+String(d.error||d.detail||'request failed').slice(0,180));return d;}
    await native('/api/agency/launch',{token});let final,repeat;
    if(g.id==='uno-luck'){
     const state=await native('/api/agency/state'),stake=state.rules.stake_options[0];let round_id=null;
     for(let phase=1;phase<=3;phase++){const p={request_id:randomUUID(),stake,expected_phase:phase,round_id:phase>1?round_id:null};final=await native('/api/agency/pick',p);round_id=final.round.id;if(phase===3)repeat=await native('/api/agency/pick',p);}
     assert(final.round.complete&&repeat.round.complete,'UNO round not complete');assertEqual(final.round.id,repeat.round.id,'UNO idempotent replay changed outcome');
    }else if(g.id==='mahjong-wild'){
     const state=await native('/api/state'),p={ticket_id:state.ticket.id,idempotency_key:randomUUID(),bet:state.bet_options[0]};
     final=await native('/api/spin',p);repeat=await native('/api/spin',p);assertEqual(final.ticket_id,repeat.ticket_id,'Mahjong duplicate changed ticket');
    }else{
     const state=await native('/api/agency/state'),p={request_id:randomUUID(),bet:'2',ante:false,buy_bonus:false,release_id:state.release_id};
     final=await native('/api/agency/spin',p);repeat=await native('/api/agency/spin',p);assertEqual(final.id,repeat.id,'Skygate duplicate changed round');
    }
    const rounds=core.all('SELECT * FROM rounds WHERE session_id=?',launch.session_id);assertEqual(rounds.length,1,'Expected exactly one provider round for acceptance session');const round=rounds[0];assertEqual(round.status,'settled','Engine did not settle provider round');
    const entries=core.all('SELECT * FROM ledger WHERE round_id=?',round.id);assertEqual(entries.filter(x=>x.kind==='debit').length,1,'Duplicate debit detected');assertEqual(entries.filter(x=>x.kind==='credit').length,1,'Duplicate credit detected');
    const other=profiles.find(x=>x.operator.id!==profile.operator.id),forbidden=await api(other,'/v1/rounds/'+round.id);assertEqual(forbidden.status,404,'Cross-operator round exposed');
    const own=await api(profile,'/v1/rounds/'+round.id);assertEqual(own.status,200,'Own round query denied');
    Object.assign(caseResult,{status:'passed',session_id:launch.session_id,round_id:round.id,stake_minor:round.stake_minor,payout_minor:round.payout_minor,currency:round.currency,scale:round.scale,duplicate_request_verified:true,cross_operator_isolation:true,finished_at:core.clock()});save('running');
   }
   const check=core.reconciliation(profile.operator.id,'system:acceptance');assertEqual(check.status,'matched','Acceptance operator journal did not reconcile');report.isolation.push({operator_id:profile.operator.id,rounds:check.rounds_checked,status:check.status});
  }
  await core.refreshHealth();report.finished_at=core.clock();report.original_services_untouched=true;save('passed');core.audit('system:acceptance','acceptance.passed',id,{cases:report.cases.length});console.log('provider.acceptance.passed',id,report.cases.length);
 }catch(e){report.error=String(e.message).slice(0,500);report.finished_at=core.clock();save('failed');core.audit('system:acceptance','acceptance.failed',id,{error:report.error});console.error('provider.acceptance.failed',id,report.error);}
}

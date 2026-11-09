/* Verifies material and human attestations; never activates a deployment.
   Trust registry must come from a separately managed, verified identity source. */
import {createPublicKey,verify,createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {args,persist} from './client.mjs';
export const GATE_REQUIREMENTS=Object.freeze({
 backup_uno:{role:'engineering_reviewer',max_age_hours:25},backup_mahjong:{role:'engineering_reviewer',max_age_hours:25},backup_skygate:{role:'engineering_reviewer',max_age_hours:25},
 restore_drill:{role:'engineering_reviewer',max_age_hours:168},backup_retention_rotation:{role:'engineering_reviewer',max_age_hours:168},backup_alert_delivery:{role:'engineering_reviewer',max_age_hours:168},
 environment_isolation:{role:'engineering_reviewer',max_age_hours:168},admin_mfa:{role:'security_reviewer',human:true,max_age_hours:168},api_security:{role:'security_reviewer',human:true,max_age_hours:168},
 wallet_reference:{role:'engineering_reviewer',max_age_hours:168},wallet_external_operator:{role:'operator_certifier',human:true,independent:true,max_age_hours:168},ledger_reconciliation:{role:'engineering_reviewer',max_age_hours:25},
 load_500:{role:'engineering_reviewer',max_age_hours:168},load_1000:{role:'engineering_reviewer',max_age_hours:168},soak:{role:'engineering_reviewer',max_age_hours:168},network_restart:{role:'engineering_reviewer',max_age_hours:168},
 math_rng_review:{role:'math_reviewer',human:true,independent:true,max_age_hours:720},rollback_drill:{role:'engineering_reviewer',max_age_hours:168},security_review:{role:'security_reviewer',human:true,independent:true,max_age_hours:720},legal_signoff:{role:'legal_approver',human:true,independent:true,max_age_hours:720}
});
export function canonicalJSON(value){if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Non-finite number');return JSON.stringify(value);}if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';throw Error('Unsupported canonical JSON value');}
export const attestationBytes=payload=>Buffer.from('softtech.release.attestation.v1\n'+canonicalJSON(payload),'utf8');
function date(s){return typeof s==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s)?Date.parse(s):NaN;}
function same(a,b){return canonicalJSON(a)===canonicalJSON(b);}
function material(file,root){if(typeof file.path!=='string'||path.isAbsolute(file.path)||file.path.split(/[\\/]/).some(p=>p==='..'||p==='')||!/^[a-f0-9]{64}$/.test(file.sha256||'')||!Number.isSafeInteger(file.size_bytes)||file.size_bytes<1||file.size_bytes>50*1024*1024)throw Error('INVALID_MATERIAL');const actual=realpathSync(path.resolve(root,file.path));if(!actual.startsWith(root+path.sep))throw Error('MATERIAL_OUTSIDE_ROOT');const stat=statSync(actual);if(!stat.isFile()||stat.size!==file.size_bytes)throw Error('MATERIAL_SIZE_MISMATCH');const data=readFileSync(actual);if(createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error('MATERIAL_DIGEST_MISMATCH');return actual;}
export function verifyEvidenceBundle(bundle,{registry,evidenceRoot,expectedTarget,now=Date.now()}={}){
 const result={schema_version:1,ready:false,verified_at:new Date(now).toISOString(),target:expectedTarget||null,required_gates:Object.keys(GATE_REQUIREMENTS).length,gates:{},approval_errors:[],errors:[],does_not_activate_production:true};
 if(!registry||registry.schema_version!==1||!Array.isArray(registry.keys)||registry.keys.length===0){result.errors.push('NO_TRUSTED_REVIEWER_KEYS');return result;}
 if(!expectedTarget||expectedTarget.environment!=='production'||typeof expectedTarget.deployment_id!=='string'||!expectedTarget.source_commits||['core','uno','mahjong','skygate','wallet'].some(k=>!/^[a-f0-9]{40}$/.test(expectedTarget.source_commits[k]||''))){result.errors.push('INVALID_EXPECTED_TARGET');return result;}
 if(bundle?.schema_version!==1||!same(bundle.target,expectedTarget)||!Array.isArray(bundle.attestations)){result.errors.push('BUNDLE_TARGET_OR_SCHEMA_MISMATCH');return result;}
 let root;try{root=realpathSync(evidenceRoot);}catch{result.errors.push('EVIDENCE_ROOT_NOT_FOUND');return result;}
 const keys=new Map(),identityConflict=new Set();for(const key of registry.keys){if(keys.has(key.key_id))identityConflict.add(key.key_id);keys.set(key.key_id,key);}
 const accepted=new Map();const verifyOne=(entry,required)=>{
  if(!entry||typeof entry.key_id!=='string'||typeof entry.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(entry.signature))throw Error('MALFORMED_SIGNATURE');
  const key=keys.get(entry.key_id);if(!key||key.revoked===true||identityConflict.has(entry.key_id))throw Error('UNTRUSTED_KEY');
  if(typeof key.person_id!=='string'||key.person_id.length<3||!Array.isArray(key.roles)||!key.roles.includes(required.role))throw Error('REVIEWER_ROLE_DENIED');
  if(required.human&&key.identity_type!=='human')throw Error('HUMAN_REVIEW_REQUIRED');if(required.independent&&key.independent!==true)throw Error('INDEPENDENT_REVIEW_REQUIRED');
  if(!Number.isFinite(date(key.verified_at))||date(key.verified_at)>now||!Number.isFinite(date(key.expires_at))||date(key.expires_at)<=now)throw Error('REVIEWER_IDENTITY_NOT_CURRENT');
  const pub=createPublicKey(key.public_key_pem);if(pub.asymmetricKeyType!=='ed25519')throw Error('ED25519_REQUIRED');if(!verify(null,attestationBytes(entry.payload),pub,Buffer.from(entry.signature,'base64url')))throw Error('INVALID_SIGNATURE');
  const p=entry.payload;if(p.schema_version!==1||p.status!=='PASS'||!same(p.target,expectedTarget))throw Error('ATTESTATION_TARGET_OR_STATUS');
  const timestamp=date(p.verified_at),expires=date(p.expires_at);if(!Number.isFinite(timestamp)||timestamp>now||now-timestamp>required.max_age_hours*3600000||!Number.isFinite(expires)||expires<=now||expires<timestamp)throw Error('ATTESTATION_EXPIRED_OR_FUTURE');
  if(!Array.isArray(p.materials)||p.materials.length<1||p.materials.length>100)throw Error('MATERIAL_REQUIRED');const files=p.materials.map(f=>material(f,root));
  return {person_id:key.person_id,key_id:key.key_id,role:required.role,identity_type:key.identity_type,independent:key.independent===true,files,payload:p};
 };
 for(const [gate,required]of Object.entries(GATE_REQUIREMENTS)){
  const entries=bundle.attestations.filter(x=>x.payload?.gate===gate);const failures=[];
  for(const entry of entries){try{const verified=verifyOne(entry,required);
   if(gate==='wallet_external_operator'&&(verified.payload.classification!=='external_operator_conformance'||!verified.payload.external_operator_id||String(verified.payload.external_operator_id).startsWith('op_qualification_')))throw Error('REAL_EXTERNAL_OPERATOR_REQUIRED');
   if(['load_500','load_1000','soak'].includes(gate)&&verified.payload.classification!=='real_native_session_http_load')throw Error('REAL_NATIVE_LOAD_REQUIRED');
   accepted.set(gate,verified);break;
  }catch(e){failures.push(String(e.message).slice(0,120));}}
  const verified=accepted.get(gate);result.gates[gate]=verified?{status:'PASS',reviewer_person_id:verified.person_id,key_id:verified.key_id,verified_at:verified.payload.verified_at,materials:verified.files.length}:{status:'BLOCKED',errors:failures.length?failures:['MISSING_SIGNED_ATTESTATION']};
 }
 const evidenceSetHash=createHash('sha256').update(canonicalJSON(bundle.attestations)).digest('hex');const release=bundle.release_approvals||{},people={},approvalPayloads={};for(const [action,role]of [['request','release_requester'],['approve','release_approver']]){try{const proof=verifyOne(release[action],{role,human:true,max_age_hours:24});if(proof.payload.gate!=='go_live_'+action)throw Error('APPROVAL_ACTION_MISMATCH');if(proof.payload.evidence_set_sha256!==evidenceSetHash||typeof proof.payload.release_id!=='string'||proof.payload.release_id.length<8)throw Error('APPROVAL_EVIDENCE_SET_MISMATCH');people[action]=proof.person_id;approvalPayloads[action]=proof.payload;}catch(e){result.approval_errors.push(action+':'+String(e.message).slice(0,120));}}
 if(approvalPayloads.request&&approvalPayloads.approve&&(approvalPayloads.request.release_id!==approvalPayloads.approve.release_id||approvalPayloads.approve.requester_person_id!==people.request))result.approval_errors.push('RELEASE_REQUEST_BINDING_MISMATCH');
 if(people.request&&people.approve&&people.request===people.approve)result.approval_errors.push('REQUESTER_AND_APPROVER_MUST_DIFFER');
 const engineering=new Set([...accepted.values()].filter(v=>v.role==='engineering_reviewer').map(v=>v.person_id));for(const [gate,v]of accepted)if(GATE_REQUIREMENTS[gate].independent&&(engineering.has(v.person_id)||v.person_id===people.request))result.gates[gate]={status:'BLOCKED',errors:['INDEPENDENT_REVIEWER_IS_IMPLEMENTER_OR_REQUESTER']};
 result.approvals={requester_person_id:people.request||null,approver_person_id:people.approve||null};result.ready=Object.values(result.gates).every(g=>g.status==='PASS')&&result.approval_errors.length===0&&result.errors.length===0;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const a=args();const result=verifyEvidenceBundle(JSON.parse(readFileSync(a.bundle,'utf8')),{registry:JSON.parse(readFileSync(a.registry,'utf8')),evidenceRoot:a['evidence-root'],expectedTarget:JSON.parse(readFileSync(a.target,'utf8'))});if(a.report)persist(a.report,result);console.log(JSON.stringify(result,null,2));process.exitCode=result.ready?0:1;}catch(e){console.error('Evidence verification failed: '+e.message);process.exitCode=2;}}

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {GATE_REQUIREMENTS,attestationBytes,canonicalJSON} from '../../qualification/evidence-gate.mjs';

const script=new URL('../scripts/release-evidence-gate.mjs',import.meta.url).pathname;
const direct=new URL('../../qualification/evidence-gate.mjs',import.meta.url).pathname;
const run=(argv,entry=script)=>spawnSync(process.execPath,[entry,...argv],{encoding:'utf8'});
const sha=value=>createHash('sha256').update(value).digest('hex');
// Temporary cryptographic fixtures prove the wrapper reaches the real verifier.
// They are never registry identities, human signoffs, or operational evidence.
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'softtech-signed-cli-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const now=Date.now(),verified_at=new Date(now-1000).toISOString(),expires_at=new Date(now+3600000).toISOString();
 const target={environment:'production',deployment_id:'fixture-not-a-real-production-deployment',source_commits:Object.fromEntries(['core','uno','mahjong','skygate','wallet'].map(name=>[name,'a'.repeat(40)]))};
 const data='SYNTHETIC TEST MATERIAL ONLY\n',material={path:'material.txt',sha256:sha(data),size_bytes:Buffer.byteLength(data)};writeFileSync(join(root,material.path),data,{mode:0o600});
 const roles=[...new Set(Object.values(GATE_REQUIREMENTS).map(value=>value.role)),'release_requester','release_approver'],pairs=new Map();
 const registry={schema_version:1,keys:roles.map(role=>{
  const pair=generateKeyPairSync('ed25519');pairs.set(role,pair.privateKey);
  return {key_id:'fixture-key-'+role,person_id:'fixture-person-'+role,roles:[role],identity_type:'human',independent:['security_reviewer','operator_certifier','math_reviewer','legal_approver'].includes(role),verified_at,expires_at,public_key_pem:pair.publicKey.export({type:'spki',format:'pem'})};
 })};
 const signed=(role,payload)=>({key_id:'fixture-key-'+role,payload,signature:sign(null,attestationBytes(payload),pairs.get(role)).toString('base64url')});
 const base={schema_version:1,status:'PASS',target,verified_at,expires_at,materials:[material]};
 const attestations=Object.entries(GATE_REQUIREMENTS).map(([gate,requirement])=>signed(requirement.role,{...base,gate,
  ...(gate==='wallet_external_operator'?{classification:'external_operator_conformance',external_operator_id:'fixture-external-company'}:{}),
  ...(['load_500','load_1000','soak'].includes(gate)?{classification:'real_native_session_http_load'}:{})}));
 const evidence_set_sha256=sha(canonicalJSON(attestations)),release_id='fixture-release-not-runtime';
 const bundle={schema_version:1,target,attestations,release_approvals:{
  request:signed('release_requester',{...base,gate:'go_live_request',release_id,evidence_set_sha256}),
  approve:signed('release_approver',{...base,gate:'go_live_approve',release_id,evidence_set_sha256,requester_person_id:'fixture-person-release_requester'})}};
 const files={bundle:join(root,'bundle.json'),registry:join(root,'registry.json'),target:join(root,'target.json'),report:join(root,'result.json')};
 const f={root,target,bundle,registry,signed,files};
 f.save=()=>{for(const name of ['bundle','registry','target'])writeFileSync(files[name],JSON.stringify(f[name]),{mode:0o600});};
 f.argv=['--bundle',files.bundle,'--registry',files.registry,'--target',files.target,'--evidence-root',root,'--report',files.report];f.save();return f;
}

test('all 14 legacy PASS records with valid-looking URLs are explicitly rejected',t=>{
 const f=fixture(t),keys=['backup_uno','backup_mahjong','backup_skygate','restore_drill','backup_monitoring','environment_isolation','admin_mfa','api_security','wallet_simulator','ledger_reconciliation','load_1000','rollback_drill','security_review','legal_signoff'];
 const legacy={gates:Object.fromEntries(keys.map(key=>[key,{status:'PASS',evidence_url:'https://example.test/fixture',verified_at:new Date().toISOString(),reviewer:'fixture-reviewer'}]))};
 const file=join(f.root,'legacy.json');writeFileSync(file,JSON.stringify(legacy));const before=sha(readFileSync(file)),result=run([file]),report=JSON.parse(result.stdout);
 assert.equal(result.status,2);assert.equal(report.ready,false);assert.equal(report.required_gates,20);assert.deepEqual(report.errors,['LEGACY_UNSIGNED_EVIDENCE_REJECTED']);assert.equal(report.does_not_activate_production,true);assert.equal(sha(readFileSync(file)),before);
});

test('the compatibility CLI delegates a complete synthetic signed 20-gate bundle to the authoritative verifier',t=>{
 const f=fixture(t),wrapped=run(f.argv),authoritative=run(f.argv,direct);assert.equal(wrapped.status,0,wrapped.stderr);assert.equal(authoritative.status,0,authoritative.stderr);
 const a=JSON.parse(wrapped.stdout),b=JSON.parse(authoritative.stdout);assert.equal(a.ready,true);assert.equal(a.required_gates,20);assert.deepEqual(a.gates,b.gates);assert.deepEqual(a.approvals,b.approvals);assert.equal(a.does_not_activate_production,true);
});

test('an empty trust registry remains blocked and the delegated report preserves the actual error',t=>{
 const f=fixture(t);f.registry.keys=[];f.save();const result=run(f.argv),report=JSON.parse(result.stdout);
 assert.equal(result.status,1);assert.equal(report.ready,false);assert.deepEqual(report.errors,['NO_TRUSTED_REVIEWER_KEYS']);assert.deepEqual(JSON.parse(readFileSync(f.files.report,'utf8')),report);
});

test('missing new 20-gate evidence cannot fall back to the obsolete formatter',t=>{
 const f=fixture(t);f.bundle.attestations=f.bundle.attestations.filter(entry=>entry.payload.gate!=='load_500');f.save();const result=run(f.argv),report=JSON.parse(result.stdout);
 assert.equal(result.status,1);assert.equal(report.ready,false);assert.equal(Object.keys(report.gates).length,20);assert.deepEqual(report.gates.load_500.errors,['MISSING_SIGNED_ATTESTATION']);
});

test('signed future review and altered material fail through the compatibility entry point',t=>{
 const f=fixture(t),entry=f.bundle.attestations[0];f.bundle.attestations[0]=f.signed('engineering_reviewer',{...entry.payload,verified_at:'2999-01-01T00:00:00Z'});f.save();let result=run(f.argv),report=JSON.parse(result.stdout);
 assert.equal(result.status,1);assert.ok(report.gates.backup_uno.errors.includes('ATTESTATION_EXPIRED_OR_FUTURE'));
 writeFileSync(join(f.root,'material.txt'),'TAMPERED');result=run(f.argv);report=JSON.parse(result.stdout);assert.equal(result.status,1);assert.equal(report.gates.environment_isolation.status,'BLOCKED');
});

test('two keys belonging to one person cannot approve a release through the compatibility CLI',t=>{
 const f=fixture(t);f.registry.keys.find(key=>key.roles.includes('release_approver')).person_id='fixture-person-release_requester';f.save();const result=run(f.argv),report=JSON.parse(result.stdout);
 assert.equal(result.status,1);assert.equal(report.ready,false);assert.ok(report.approval_errors.includes('REQUESTER_AND_APPROVER_MUST_DIFFER'));
});

test('missing arguments and malformed modern input fail closed without a legacy fallback',t=>{
 const noArgs=run([]);assert.equal(noArgs.status,2);assert.deepEqual(JSON.parse(noArgs.stdout).errors,['SIGNED_EVIDENCE_ARGUMENTS_REQUIRED']);
 const f=fixture(t);writeFileSync(f.files.bundle,'{not valid json');const invalid=run(f.argv);assert.equal(invalid.status,2);assert.match(invalid.stderr,/Evidence verification failed/);
});

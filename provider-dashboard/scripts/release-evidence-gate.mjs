#!/usr/bin/env node
// Compatibility entry point only. The authoritative signed verifier owns all
// gate, identity, signature, material, freshness and separation-of-duty rules.
// Neither this script nor that verifier activates production.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GATE_REQUIREMENTS} from '../../qualification/evidence-gate.mjs';

const argv=process.argv.slice(2),authoritative=fileURLToPath(new URL('../../qualification/evidence-gate.mjs',import.meta.url));
if(!argv.length||!argv[0].startsWith('--')){
 console.log(JSON.stringify({ready:false,required_gates:Object.keys(GATE_REQUIREMENTS).length,
  errors:[argv.length?'LEGACY_UNSIGNED_EVIDENCE_REJECTED':'SIGNED_EVIDENCE_ARGUMENTS_REQUIRED'],
  message:'The obsolete 14-gate PASS/URL/reviewer format cannot approve a release. Use --bundle --registry --target --evidence-root and optional --report with the signed 20-gate verifier.',
  authoritative_verifier:'qualification/evidence-gate.mjs',does_not_activate_production:true},null,2));
 process.exitCode=2;
}else{
 const result=spawnSync(process.execPath,[authoritative,...argv],{stdio:'inherit'});
 if(result.error){console.error('Signed evidence verifier could not start: '+result.error.message);process.exitCode=2;}
 else process.exitCode=result.status??2;
}

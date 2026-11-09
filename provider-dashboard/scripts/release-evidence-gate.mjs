#!/usr/bin/env node
// Fail-closed evidence gate. Does not unlock any environment or write secrets.
import {readFileSync} from 'node:fs';
const required=[
 'backup_uno','backup_mahjong','backup_skygate','restore_drill',
 'backup_monitoring','environment_isolation','admin_mfa','api_security',
 'wallet_simulator','ledger_reconciliation','load_1000','rollback_drill',
 'security_review','legal_signoff'
];
const file=process.argv[2];
if(!file){console.error('Usage: node release-evidence-gate.mjs <evidence.json>');process.exit(2);}
let doc;
try{doc=JSON.parse(readFileSync(file,'utf8'))}catch{console.error('Invalid evidence JSON');process.exit(2)}
const gates=doc?.gates;
if(!gates||typeof gates!=='object'||Array.isArray(gates)){console.error('Missing gates object');process.exit(2)}
const missing=[];
for(const key of required){
 const v=gates[key];
 const valid=v?.status==='PASS' && typeof v.evidence_url==='string' && /^https:\/\//.test(v.evidence_url)
  && typeof v.verified_at==='string' && !Number.isNaN(Date.parse(v.verified_at))
  && Date.parse(v.verified_at)<=Date.now()
  && typeof v.reviewer==='string' && v.reviewer.trim().length>=3;
 if(!valid)missing.push(key);
}
console.log(JSON.stringify({ready:missing.length===0,required:required.length,missing},null,2));
process.exit(missing.length?1:0);

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('../scripts/release-evidence-gate.mjs',import.meta.url).pathname;
function run(value){
 const dir=mkdtempSync(join(tmpdir(),'softtech-gate-'));
 try{
  const path=join(dir,'evidence.json');
  writeFileSync(path,JSON.stringify(value));
  return spawnSync(process.execPath,[script,path],{encoding:'utf8'});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('missing evidence fails closed',()=>{const r=run({gates:{}});assert.equal(r.status,1);assert.match(r.stdout,/backup_uno/);});
test('PASS without evidence URL is rejected',()=>{const r=run({gates:{backup_uno:{status:'PASS',verified_at:new Date().toISOString(),reviewer:'auditor'}}});assert.equal(r.status,1);});
test('future evidence is rejected',()=>{const r=run({gates:{backup_uno:{status:'PASS',evidence_url:'https://example.org/evidence',verified_at:'2999-01-01T00:00:00Z',reviewer:'auditor'}}});assert.equal(r.status,1);});
test('invalid JSON shape is rejected',()=>{assert.equal(run({gates:[]}).status,2);});

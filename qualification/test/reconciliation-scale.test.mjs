import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RECONCILIATION_QUERIES as queries} from '../native-load.mjs';

test('200000 matched receipts use indexed orphan lookups and preserve all financial mismatch checks',{timeout:30000},()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'reconciliation-scale-')),file=path.join(dir,'proof.sqlite'),db=new DatabaseSync(file),n=200000;
 try{db.exec(queries.schema);db.exec('PRAGMA cache_size=-8192; PRAGMA temp_store=FILE');const provider=db.prepare('INSERT INTO provider VALUES(?,?,?,?,?,?,?)'),wallet=db.prepare('INSERT INTO wallet VALUES(?,?,?,?,?)');
  db.exec('BEGIN');for(let i=0;i<n;i++){const round='round-'+Math.floor(i/2),kind=i%2?'credit':'debit',id=round+':'+kind;provider.run('ledger-'+i,round,kind,'100','VCOIN',2,id);wallet.run(id,'applied','100','VCOIN',2);}db.exec('COMMIT');
  const plan=db.prepare('EXPLAIN QUERY PLAN '+queries.orphans).all().map(x=>x.detail);assert.ok(plan.some(x=>/SEARCH p USING INDEX provider_expected_wallet_id \(expected_wallet_id=\?\)/.test(x)),JSON.stringify(plan));assert.ok(!plan.some(x=>/^SCAN p\b/.test(x)),JSON.stringify(plan));
  const start=performance.now();assert.deepEqual(db.prepare(queries.orphans).all(),[]);const orphanMs=performance.now()-start;assert.deepEqual(db.prepare(queries.mismatches).all(),[]);assert.deepEqual(db.prepare(queries.cardinality).all(),[]);
  // A non-unique index preserves detection of duplicate debit/credit records.
  provider.run('duplicate-ledger','round-12','debit','100','VCOIN',2,'round-12:debit');
  db.prepare("UPDATE wallet SET amount_minor='99' WHERE id='round-20:credit'").run();
  db.prepare("UPDATE wallet SET currency='OTHER' WHERE id='round-21:debit'").run();
  db.prepare("UPDATE wallet SET scale=3 WHERE id='round-22:credit'").run();
  db.prepare("UPDATE wallet SET status='rejected' WHERE id='round-23:debit'").run();
  db.prepare("DELETE FROM wallet WHERE id='round-24:credit'").run();
  db.prepare("DELETE FROM provider WHERE id='ledger-61'").run();
  wallet.run('orphan:credit','applied','100','VCOIN',2);wallet.run('not-applied:credit','rejected','100','VCOIN',2);
  const orphans=db.prepare(queries.orphans).all().map(x=>x.id).sort();assert.deepEqual(orphans,['orphan:credit','round-30:credit']);
  assert.deepEqual(db.prepare(queries.mismatches).all().map(x=>x.round_id).sort(),['round-20','round-21','round-22','round-23','round-24']);
  assert.deepEqual(db.prepare(queries.cardinality).all().map(x=>x.round_id).sort(),['round-12','round-30']);
  assert.equal(db.prepare("SELECT count(*) n FROM provider WHERE expected_wallet_id='round-12:debit'").get().n,2);
  console.log(JSON.stringify({classification:'synthetic_local_reconciliation_scale',native_rounds:n/2,receipts:n,orphan_lookup_ms:Math.round(orphanMs*100)/100,query_plan:plan,database_bytes:statSync(file).size,rss_bytes:process.memoryUsage().rss}));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

import {DatabaseSync} from 'node:sqlite';

// Independent durable wallet fixture. Core and a killed child process never
// share its transaction, and a transaction ID can change the balance only once.
export class AdmissionWallet {
 constructor(path,initial='1000'){
  this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY,action TEXT,transaction_id TEXT);CREATE TABLE IF NOT EXISTS receipts(transaction_id TEXT PRIMARY KEY,receipt TEXT);CREATE TABLE IF NOT EXISTS balance(id INTEGER PRIMARY KEY,amount TEXT)');
  this.db.prepare('INSERT OR IGNORE INTO balance VALUES(1,?)').run(initial);
 }
 receipt(txid){const row=this.db.prepare('SELECT receipt FROM receipts WHERE transaction_id=?').get(txid);return row?JSON.parse(row.receipt):undefined;}
 calls(){return this.db.prepare('SELECT action,transaction_id FROM calls ORDER BY id').all().map(row=>({...row}));}
 balance(){return this.db.prepare('SELECT amount FROM balance WHERE id=1').get().amount;}
 execute(op,action,payload){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('INSERT INTO calls(action,transaction_id) VALUES(?,?)').run(action,payload.transaction_id);
   let receipt=this.receipt(payload.transaction_id);
   if(action==='status')receipt??={status:'not_found'};
   else if(!receipt){
    const amount=BigInt(payload.amount_minor),before=BigInt(this.balance());
    const rejected=action==='debit'&&amount>before;
    const after=rejected?before:before+(action==='debit'?-amount:amount);
    receipt={status:rejected?'rejected':'applied',transaction_id:payload.transaction_id,amount_minor:payload.amount_minor,currency:op.currency,scale:op.scale,balance_minor:String(after)};
    this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(payload.transaction_id,JSON.stringify(receipt));
    this.db.prepare('UPDATE balance SET amount=? WHERE id=1').run(String(after));
   }
   this.db.exec('COMMIT');return receipt;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 close(){this.db.close();}
}

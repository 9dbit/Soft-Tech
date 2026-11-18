// Finance demo only. No real operator, payment, tax, banking or wallet connector.
const safeInt=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max+1):'';
export function ensureFinance(workspace,now) {
  if(!workspace.finance||typeof workspace.finance!=='object')workspace.finance={profiles:[],invoices:[],payments:[],sequence:0};
  const f=workspace.finance;
  if(!Array.isArray(f.profiles))f.profiles=[];
  if(!Array.isArray(f.invoices))f.invoices=[];
  if(!Array.isArray(f.payments))f.payments=[];
  if(!safeInt(f.sequence,0,1000000))f.sequence=f.invoices.length;
  for(const op of workspace.operators||[])if(!f.profiles.some(p=>p.operator_id===op.id)){
    f.profiles.push({operator_id:op.id,bill_to:'',billing_email:'',billing_address:'',currency:'IDR',
      setup_fee:0,monthly_fee:0,usage_fee:0,tax_bps:0,due_days:14,revision:1,updated_at:now,updated_by:'system'});
  }
  return f;
}
export function validateProfile(input) {
  const keys=['operator_id','bill_to','billing_email','billing_address','currency','setup_fee','monthly_fee','usage_fee','tax_bps','due_days','revision'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))throw Error('INVALID_PROFILE_FIELDS');
  const bill_to=clean(input.bill_to,120),email=clean(input.billing_email,160),address=clean(input.billing_address,280);
  if(!bill_to||bill_to.length>120||!email||email.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
     address.length>280||/[\u0000-\u001f\u007f]/.test(bill_to+email+address)||input.currency!=='IDR'||
     !safeInt(input.setup_fee,0,1000000000)||!safeInt(input.monthly_fee,0,1000000000)||
     !safeInt(input.usage_fee,0,1000000000)||!safeInt(input.tax_bps,0,2000)||
     !safeInt(input.due_days,1,90)||!safeInt(input.revision,1,1000000))throw Error('INVALID_PROFILE');
  return {bill_to,billing_email:email,billing_address:address,currency:'IDR',setup_fee:input.setup_fee,
    monthly_fee:input.monthly_fee,usage_fee:input.usage_fee,tax_bps:input.tax_bps,due_days:input.due_days};
}
export function previewInvoice(workspace,operatorId,month,now) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('INVALID_BILLING_MONTH');
  const start=Date.parse(month+'-01T00:00:00Z');
  if(!Number.isFinite(start)||start>Date.UTC(2100,0,1))throw Error('INVALID_BILLING_MONTH');
  const next=new Date(start);next.setUTCMonth(next.getUTCMonth()+1);
  const end=next.getTime();
  if(start>now)throw Error('FUTURE_BILLING_PERIOD');
  const f=ensureFinance(workspace,now);
  const profile=f.profiles.find(x=>x.operator_id===operatorId);
  if(!profile||!profile.bill_to||!profile.billing_email)throw Error('BILLING_PROFILE_INCOMPLETE');
  const count=(workspace.sessions||[]).filter(x=>x.operator_id===operatorId&&x.status==='completed'&&x.created_at>=start&&x.created_at<end).length;
  // Integer IDR sample amounts, no float aggregation, no real tax assessment.
  const lines=[
    {description:'Sample monthly platform fee',quantity:1,unit_amount:profile.monthly_fee,amount:profile.monthly_fee},
    {description:'Sample completed sessions',quantity:count,unit_amount:profile.usage_fee,amount:count*profile.usage_fee}
  ];
  const subtotal=lines.reduce((n,x)=>n+x.amount,0);
  const tax=Math.floor((subtotal*profile.tax_bps+5000)/10000);
  const total=subtotal+tax;
  if(!Number.isSafeInteger(total)||total>100000000000)throw Error('INVOICE_TOTAL_LIMIT');
  return {operator_id:operatorId,billing_month:month,period_start:start,period_end:end,lines,
    subtotal,tax_bps:profile.tax_bps,tax_amount:tax,total,currency:'IDR',
    bill_to:profile.bill_to,billing_email:profile.billing_email,billing_address:profile.billing_address,
    due_days:profile.due_days,profile_revision:profile.revision,simulation:true};
}
export function financeSummary(finance,now) {
  const invoices=finance.invoices||[];
  const issued=invoices.filter(i=>i.status==='issued');
  const paid=invoices.filter(i=>i.status==='paid');
  return {draft:invoices.filter(i=>i.status==='draft').length,issued:issued.length,paid:paid.length,
    overdue:issued.filter(i=>i.due_at<now).length,
    outstanding_idr:issued.reduce((n,i)=>n+i.total,0),
    paid_idr:paid.reduce((n,i)=>n+i.total,0),simulation:true};
}

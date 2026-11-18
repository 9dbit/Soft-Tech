/**
 * Read-only integration gate for the public passwordless development preview.
 * This app MUST NOT accept Genesis wallet credentials, signed statements, user
 * uploads or trusted usage feeds. Real evidence is reviewed in protected
 * Genesis/provider backends, never in a browser development session.
 */
export function sourceReadiness() {
  return Object.freeze({
    name:'Genesis preproduction',
    state:'not_connected',
    data_classification:'sample_only',
    provider_protocol:'softtech.v2',
    credential_status:'not_configured_in_development',
    ledger_evidence:'unverified',
    invoice_eligibility:'demo_only',
    production_enabled:false,
    can_import_external_usage:false,
    can_issue_commercial_invoice:false,
    checks:[
      {id:'tenant_binding',label:'Pin Genesis tenant and exact provider operator',passed:false},
      {id:'credential_binding',label:'Configure server-only sandbox credentials on protected services',passed:false},
      {id:'signed_statement',label:'Compare signed complete provider journal and Genesis wallet evidence',passed:false},
      {id:'period_coverage',label:'Confirm invoice month coverage and settlement cutoff',passed:false},
      {id:'commercial_contract',label:'Approve operator billing contract and applicable tax treatment',passed:false}
    ]
  });
}
export function forbidUnverifiedImport() {
  const error=new Error('EXTERNAL_USAGE_NOT_CONNECTED');
  error.status=409;
  throw error;
}

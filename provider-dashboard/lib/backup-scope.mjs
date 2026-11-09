export function canonicalBackupIdentity(value){
 if(!value||!['sandbox','preproduction','production'].includes(value.environment)||!/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(value.deployment_id)||value.identity_version!==1||!Number.isSafeInteger(value.created_at)||value.created_at<0)throw Error('Invalid backup deployment identity');
 return {deployment_id:value.deployment_id,environment:value.environment,identity_version:value.identity_version,created_at:value.created_at};
}
export function providerBackupPrefix(identity){const value=canonicalBackupIdentity(identity);return 'provider-core/'+value.environment+'/'+value.deployment_id+'/';}

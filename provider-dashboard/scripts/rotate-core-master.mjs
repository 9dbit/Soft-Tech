import {rotateCoreMasterKey,prepareCoreRollback} from '../lib/core-key-rotation.mjs';
import {backupKeysFromEnv} from '../lib/backup-keys.mjs';
import {secretFromEnv} from '../lib/recovery-io.mjs';

const args=process.argv.slice(2),offline=args.includes('--offline'),[mode,source,destination,rollbackDestination]=args.filter(x=>x!=='--offline');
try{
 if(!offline||!['rotate','rollback'].includes(mode)||!source||!destination||mode==='rotate'&&!rollbackDestination||mode==='rollback'&&rollbackDestination)throw Error('Usage: node scripts/rotate-core-master.mjs rotate SOURCE FRESH_OUTPUT ROLLBACK_STBK --offline | rollback ROLLBACK_STBK FRESH_OUTPUT --offline');
 const env=process.env,ring=await backupKeysFromEnv(env),oldMaster=await secretFromEnv(env,'CORE_OLD_MASTER_SECRET',{minimum:32});
 const options={source,destination,offline,deploymentId:env.CORE_DEPLOYMENT_ID,environment:env.CORE_ENVIRONMENT,...ring};
 const result=mode==='rotate'?await rotateCoreMasterKey({...options,rollbackDestination,oldMaster,newMaster:await secretFromEnv(env,'CORE_NEW_MASTER_SECRET',{minimum:32})}):await prepareCoreRollback({...options,master:oldMaster});
 console.log(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=1;}

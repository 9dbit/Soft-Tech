import {prepareCoreStartup} from '../lib/core-startup-rotation.mjs';

try{
 const startup=await prepareCoreStartup();
 for(const key of ['CORE_OLD_MASTER_SECRET','CORE_OLD_MASTER_SECRET_FILE','CORE_NEW_MASTER_SECRET','CORE_NEW_MASTER_SECRET_FILE','PANEL_SESSION_SECRET_FILE'])delete process.env[key];
 Object.assign(process.env,startup.env);
 if(startup.report.enabled)console.log('provider.master_rotation_startup',JSON.stringify(startup.report));
 await import('../server.mjs');
}catch(error){
 console.error('provider.startup_refused',error.message);
 process.exitCode=1;
}

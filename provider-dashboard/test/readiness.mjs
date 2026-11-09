/* Deployment readiness is not only process health. Engine callbacks traverse
   the public domain, which must route to the newly started core before tests.
   No credentials, launch tokens or transactions are sent by this probe. */
const sleepDefault=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function probeDefault(url){
 const response=await fetch(url,{redirect:'error',cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(5000)});
 if(!response.ok)return null;
 return response.json();
}
export async function waitForReadiness(core,runId,{probe=probeDefault,sleep=sleepDefault,attempts=36,delay=5000}={}){
 const origin=new URL(core.env.CORE_PUBLIC_ORIGIN);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('Acceptance requires a configured HTTPS provider origin');
 const url=new URL('/health',origin);url.searchParams.set('acceptance_probe',runId);
 let enginesReady=false,publicReady=false;
 for(let attempt=1;attempt<=attempts;attempt++){
  const [games,health]=await Promise.all([
   Promise.resolve().then(()=>core.refreshHealth()).catch(()=>[]),
   Promise.resolve().then(()=>probe(url.href)).catch(()=>null)
  ]);
  enginesReady=games.length===3&&games.every(g=>g.health==='ok');
  publicReady=!!health&&health.ok===true&&health.app==='soft-tech-provider-core'&&health.acceptance?.id===runId&&health.acceptance?.status==='running';
  if(enginesReady&&publicReady)return {attempts:attempt,engines_ready:true,public_core_ready:true};
  if(attempt<attempts)await sleep(delay);
 }
 throw Error(!publicReady?'Public core route did not reach the current acceptance run':!enginesReady?'Not all provider engines report ready':'Provider readiness failed');
}

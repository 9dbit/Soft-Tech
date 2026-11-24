import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateRuntimeRegistry,gameEmbedUrl,gameLaunchUrl,viewerCsp } from '../config/runtime-policy.mjs';

const registry=JSON.parse(readFileSync(new URL('../config/game-runtimes.json',import.meta.url),'utf8'));
const legend=registry.runtimes.find(game=>game.id==='legend-ball-x1000');

test('LegendBallX canonical domain is exact, uniquely reserved and never legacy',()=>{
  validateRuntimeRegistry(registry);
  assert(legend);
  assert.equal(legend.canonicalOrigin,'https://legendballx.xd-play.com');
  assert.notEqual(legend.canonicalOrigin,'https://legend-ball.xd-play.com');
  assert.equal(legend.stagingOrigin,'https://staging-legend-ball.xd-play.com');
  assert.equal(registry.runtimes.filter(x=>x.id===legend.id).length,1);
});
test('release gate stays closed until explicit qualifying evidence',()=>{
  if(legend.publicLaunch!=='enabled'){
    assert.equal(legend.publicLaunch,'staging_only');
    assert.equal(legend.domainReady,false);
    assert.equal(legend.deploymentOrigin,null);
    assert.equal(legend.entryPath,null);
    assert.equal(gameLaunchUrl(legend),null);
    assert.equal(gameEmbedUrl(legend),null);
    assert.match(viewerCsp(legend),/frame-src 'none'/);
  }else{
    assert.equal(legend.domainReady,true,'only verified custom domain may embed');
    assert.equal(legend.entryPath,'/play/');
    assert.match(legend.deploymentOrigin,/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/);
    assert.equal(gameLaunchUrl(legend),'https://legendballx.xd-play.com/play/');
    assert.equal(gameEmbedUrl(legend),'https://legendballx.xd-play.com/play/');
    assert.match(viewerCsp(legend),/frame-src https:\/\/legendballx\.xd-play\.com/);
  }
});
test('other XDPLAY games retain existing registration and launch status',()=>{
  const expected={
    'skygate-5000':['https://skygate.xd-play.com','enabled'],
    'mahjong-wild':['https://mahjongwild.xd-play.com','enabled'],
    'uno-luck':['https://uno.xd-play.com','enabled'],
    'gachamon':['https://gachamon.xd-play.com','staging_only']
  };
  assert.equal(registry.runtimes.length,Object.keys(expected).length+1);
  for(const [id,[origin,status]] of Object.entries(expected)){
    const game=registry.runtimes.find(x=>x.id===id);
    assert(game,'missing '+id);
    assert.equal(game.canonicalOrigin,origin);
    assert.equal(game.publicLaunch,status);
  }
});
test('DNS record plan contains actual Railway hostname without touching existing game routes',()=>{
  const zone=readFileSync(new URL('../dns/xdplay-game-domains.zone',import.meta.url),'utf8');
  assert.match(zone,/^legendballx 300 IN CNAME rtchmvzp\.up\.railway\.app\.$/m);
  assert.match(zone,/^_railway-verify\.legendballx 300 IN TXT "railway-verify=934da057b69de43039ac52b4c60636f2f4890a8b9f91e8de36ac76ccb423bf64"$/m);
  assert.match(zone,/^mahjongwild 300 IN CNAME du1rwnos\.up\.railway\.app\.$/m);
});

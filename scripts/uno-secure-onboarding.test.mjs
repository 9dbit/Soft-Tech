import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(path,'utf8');

test('UNO is discoverable but has no external public game launch',()=>{
  const catalogue=read('src/data/games.ts');
  const entry=catalogue.split('\n').find(x=>x.includes('id:"uno-luck"'));
  assert(entry,'UNO must remain in the XDPLAY catalog');
  assert.match(entry,/launchState:"security_review"/);
  assert.match(entry,/url:"https:\/\/xd-play\.com\/games\/uno-luck"/);
  assert.doesNotMatch(entry,/\.onrender\.com|up\.railway\.app|wallet|agent/);
  assert.match(catalogue,/canLaunchGame/);
});
test('every UI entry point has an explicit disabled-launch branch',()=>{
  const portal=read('src/components/portal.tsx');
  const mobile=read('src/components/v52-mobile-hero.tsx');
  const v4=read('src/components/v4-playground.tsx');
  assert(portal.split('canLaunchGame(game)').length>=4,'all portal launch links must gate');
  assert.match(mobile,/canLaunchGame\(game\)/);
  assert.match(v4,/canLaunchGame\(game\)/);
  assert.match(portal,/disabled aria-label="UNO LUCK security review pending"/);
  assert.match(portal,/No deposits, payments, withdrawals or redeemable credits/);
});
test('vanity host only points to non-launching canonical review page',()=>{
  const config=read('next.config.mjs');
  assert.match(config,/uno\.xd-play\.com/);
  assert.match(config,/destination: 'https:\/\/xd-play\.com\/games\/uno-luck'/);
  assert.match(config,/value: 'www\.xd-play\.com'/);
  for(const key of ['Strict-Transport-Security','Content-Security-Policy','X-Frame-Options','X-Content-Type-Options']){
    assert(config.includes(key), key+' must be configured');
  }
  assert.match(config,/value:\s*'max-age=86400'/,'avoid HSTS includeSubDomains until every game host is qualified');
});
test('public release status refuses purchases and gaming admission',()=>{
  const status=read('src/app/api/games/uno-luck/status/route.ts');
  for(const field of ['launch_enabled: false','purchases_enabled: false','redemption_enabled: false','"no-store"']){
    assert(status.includes(field),field);
  }
  const page=read('src/app/[...route]/page.tsx');
  assert.match(page,/index:false,follow:false/);
  assert.doesNotMatch(read('src/app/sitemap.ts'),/games\/uno-luck/);
});

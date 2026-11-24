import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  activeRuntimeOrigin, gameDetailPath, gameEmbedUrl, gameLaunchUrl, gamePlayPath,
  validateRuntimeRegistry, viewerCsp
} from '../config/runtime-policy.mjs';

const registry = JSON.parse(readFileSync(new URL('../config/game-runtimes.json', import.meta.url), 'utf8'));
const expected = {
  'skygate-5000': ['https://skygate.xd-play.com', null, 'enabled', 'https://skygate-web-production.up.railway.app'],
  'mahjong-wild': ['https://mahjongwild.xd-play.com', 'https://staging-mahjong.xd-play.com', 'enabled', 'https://mahjong-legend-web-production.up.railway.app'],
  'uno-luck': ['https://uno.xd-play.com', 'https://staging-uno.xd-play.com', 'enabled', 'https://uno-demo-web-production.up.railway.app'],
  'legend-ball-x1000': ['https://legendballx.xd-play.com', 'https://staging-legend-ball.xd-play.com', 'enabled', 'https://legendballx-demo-web-production.up.railway.app'],
  gachamon: ['https://gachamon.xd-play.com', 'https://staging-gachamon.xd-play.com', 'staging_only', null]
};
const fresh = () => structuredClone(registry);
const frameSources = csp => csp.split(';').map(part => part.trim()).find(part => part.startsWith('frame-src ')).split(/\s+/).slice(1);

test('release registry explicitly maps five games to nine separate production/staging origins', () => {
  assert.equal(validateRuntimeRegistry(registry), registry);
  assert.deepEqual(registry.runtimes.map(game => game.id).sort(), Object.keys(expected).sort());
  const origins = registry.runtimes.flatMap(game => [game.canonicalOrigin, game.stagingOrigin]).filter(Boolean);
  assert.equal(origins.length, 9);
  assert.equal(new Set(origins).size, 9, 'every assigned hostname must be isolated');
  for (const game of registry.runtimes) {
    assert.deepEqual([game.canonicalOrigin, game.stagingOrigin, game.publicLaunch, game.deploymentOrigin], expected[game.id]);
    assert.equal(game.domainReady, game.publicLaunch === 'enabled', 'only verified admitted demos are activated');
    assert.equal(gamePlayPath(game), `/games/${game.id}/play`);
    assert.equal(gameDetailPath(game), `/games/${game.id}`);
  }
});

test('only qualified demos can produce launch URLs', () => {
  const enabled = registry.runtimes.filter(game => gameLaunchUrl(game));
  assert.deepEqual(enabled.map(game => game.id).sort(), ['legend-ball-x1000', 'mahjong-wild', 'skygate-5000', 'uno-luck']);
  for (const game of registry.runtimes.filter(game => game.publicLaunch !== 'enabled')) {
    assert.equal(activeRuntimeOrigin(game), null);
    assert.equal(gameLaunchUrl(game), null);
    assert.equal(gameEmbedUrl(game), null);
    assert.equal(gameEmbedUrl({ ...game, domainReady: true }), null, 'readiness alone cannot enable an unreleased game');
    assert.deepEqual(frameSources(viewerCsp(game)), ["'none'"]);
    assert(!viewerCsp(game).includes(game.canonicalOrigin));
    assert(!viewerCsp(game).includes(game.stagingOrigin));
  }
});

for (const game of registry.runtimes.filter(game => game.publicLaunch === 'enabled')) {
  test(`${game.id}: unverified domains allow only top-level fallback launch and no iframe`, () => {
    const pending = { ...game, domainReady: false };
    assert.equal(activeRuntimeOrigin(pending), expected[game.id][3]);
    assert.equal(gameLaunchUrl(pending), expected[game.id][3] + '/play/');
    assert.equal(gameEmbedUrl(pending), null, 'cross-site fallback must not be embedded');
    assert.deepEqual(frameSources(viewerCsp(pending)), ["'none'"]);
    assert(!viewerCsp(pending).includes(game.deploymentOrigin));
    assert(!viewerCsp(pending).includes(game.canonicalOrigin));
    assert(!viewerCsp(pending).includes('*'));
  });
  test(`${game.id}: verified domain replaces the fallback, without permitting both origins`, () => {
    const changed = fresh();
    const ready = changed.runtimes.find(item => item.id === game.id);
    ready.domainReady = true;
    validateRuntimeRegistry(changed);
    assert.equal(gameLaunchUrl(ready), game.canonicalOrigin + '/play/');
    assert.equal(gameEmbedUrl(ready), game.canonicalOrigin + '/play/');
    assert.deepEqual(frameSources(viewerCsp(ready)), [game.canonicalOrigin]);
    assert(!viewerCsp(ready).includes(game.deploymentOrigin));
  });
}

const invalid = [
  ['unsupported schema', r => { r.version = 2; }],
  ['untrusted portal origin', r => { r.portalOrigin = 'https://attacker.example'; }],
  ['missing runtimes', r => { r.runtimes = null; }],
  ['duplicate game ID', r => { r.runtimes[1].id = r.runtimes[0].id; }],
  ['missing game ID', r => { delete r.runtimes[0].id; }],
  ['null game ID', r => { r.runtimes[0].id = null; }],
  ['numeric game ID', r => { r.runtimes[0].id = 123; }],
  ['path-like game ID', r => { r.runtimes[0].id = '../mahjong-wild'; }],
  ['duplicate canonical origin', r => { r.runtimes[1].canonicalOrigin = r.runtimes[0].canonicalOrigin; }],
  ['duplicate staging origin', r => { r.runtimes[2].stagingOrigin = r.runtimes[1].stagingOrigin; }],
  ['staging origin equals canonical origin', r => { r.runtimes[1].stagingOrigin = r.runtimes[1].canonicalOrigin; }],
  ['staging namespace used as production', r => { r.runtimes[0].canonicalOrigin = 'https://staging-new-game.xd-play.com'; }],
  ['duplicate enabled fallback origin', r => { r.runtimes[1].deploymentOrigin = r.runtimes[0].deploymentOrigin; }],
  ['HTTP canonical origin', r => { r.runtimes[0].canonicalOrigin = 'http://skygate.xd-play.com'; }],
  ['foreign canonical origin', r => { r.runtimes[0].canonicalOrigin = 'https://attacker.example'; }],
  ['canonical suffix attack', r => { r.runtimes[0].canonicalOrigin = 'https://skygate.xd-play.com.attacker.example'; }],
  ['canonical origin with credentials', r => { r.runtimes[0].canonicalOrigin = 'https://user:password@skygate.xd-play.com'; }],
  ['canonical origin with port', r => { r.runtimes[0].canonicalOrigin = 'https://skygate.xd-play.com:8443'; }],
  ['canonical origin with path', r => { r.runtimes[0].canonicalOrigin += '/play/'; }],
  ['canonical origin with query', r => { r.runtimes[0].canonicalOrigin += '?next=https://attacker.example'; }],
  ['canonical origin with fragment', r => { r.runtimes[0].canonicalOrigin += '#token'; }],
  ['staging outside dedicated namespace', r => { r.runtimes[1].stagingOrigin = 'https://qa-mahjong.xd-play.com'; }],
  ['staging origin with path', r => { r.runtimes[1].stagingOrigin += '/play/'; }],
  ['unknown launch state', r => { r.runtimes[0].publicLaunch = 'ready'; }],
  ['non-boolean domain readiness', r => { r.runtimes[0].domainReady = 'false'; }],
  ['missing enabled deployment origin', r => { r.runtimes[0].deploymentOrigin = null; }],
  ['HTTP fallback', r => { r.runtimes[0].deploymentOrigin = 'http://skygate-web-production.up.railway.app'; }],
  ['foreign fallback', r => { r.runtimes[0].deploymentOrigin = 'https://attacker.example'; }],
  ['fallback suffix attack', r => { r.runtimes[0].deploymentOrigin = 'https://game.up.railway.app.attacker.example'; }],
  ['fallback with credentials', r => { r.runtimes[0].deploymentOrigin = 'https://user:password@game.up.railway.app'; }],
  ['fallback with nonstandard port', r => { r.runtimes[0].deploymentOrigin += ':8443'; }],
  ['fallback with path', r => { r.runtimes[0].deploymentOrigin += '/play/'; }],
  ['fallback with query', r => { r.runtimes[0].deploymentOrigin += '?token=example'; }],
  ['fallback with fragment', r => { r.runtimes[0].deploymentOrigin += '#token'; }],
  ['unapproved entry path', r => { r.runtimes[0].entryPath = '/studio/'; }],
  ['protocol-relative entry path', r => { r.runtimes[0].entryPath = '//attacker.example/'; }],
  ['entry path carrying token', r => { r.runtimes[0].entryPath = '/play/?token=example'; }],
  ['blocked game with deployment target', r => { r.runtimes.find(game => game.id === 'gachamon').deploymentOrigin = 'https://uno-luck-web-staging.up.railway.app'; }],
  ['blocked game with entry path', r => { r.runtimes.find(game => game.id === 'gachamon').entryPath = '/play/'; }],
  ['blocked game marked domain ready', r => { r.runtimes[4].domainReady = true; }]
];
for (const [name, mutate] of invalid) {
  test(`invalid release configuration rejects ${name}`, () => {
    const changed = fresh();
    mutate(changed);
    assert.throws(() => validateRuntimeRegistry(changed), Error);
  });
}

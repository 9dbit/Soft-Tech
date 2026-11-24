import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import ts from 'typescript';
import { validatePublicCatalog } from '../config/catalog-policy.mjs';

// Exercise the actual TypeScript catalog without requiring a browser or a
// Node-specific TypeScript loader in production.
const source = readFileSync(new URL('../src/data/games.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { games, gameCount, gameCountLabel, gameCountCopy, canLaunchGame } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const registry = JSON.parse(readFileSync(new URL('../config/game-runtimes.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(games);

test('every enabled runtime has a discoverable catalog/detail entry and canonical launcher', () => {
  assert.equal(validatePublicCatalog(games, registry), games);
  assert.deepEqual(games.map(game => game.id).sort(), registry.runtimes.filter(game => game.publicLaunch === 'enabled').map(game => game.id).sort());
  assert.equal(games.length, 4);
  assert(games.every(canLaunchGame));
  assert(!games.some(game => game.id === 'gachamon'));
});

test('desktop, mobile and translated game counts derive from the actual catalog', () => {
  assert.equal(gameCount, games.length);
  assert.equal(gameCountLabel, String(games.length).padStart(2, '0'));
  assert.deepEqual(gameCountCopy, { EN: 'Four', ID: 'Empat' });
});

test('catalog artwork is shipped locally and the Legend Ball cover uses the original compact brand PNG', () => {
  for (const game of games) {
    for (const asset of [game.cover, game.detailImage]) {
      assert(statSync(new URL('../public' + asset, import.meta.url)).size > 1000, `${game.id}: ${asset}`);
    }
  }
  const legend = games.find(game => game.id === 'legend-ball-x1000');
  const image = readFileSync(new URL('../public' + legend.cover, import.meta.url));
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 512);
  assert.equal(image.readUInt32BE(20), 512);
  assert(image.length < 500_000, 'reuse the compact original artwork without image transformations');
});

test('removing an enabled game recreates the catalog regression and is rejected', () => {
  assert.throws(() => validatePublicCatalog(games.filter(game => game.id !== 'legend-ball-x1000'), registry), /missing its catalog\/detail page: legend-ball-x1000/);
});

test('duplicate or unregistered catalog games fail closed', () => {
  assert.throws(() => validatePublicCatalog([...copy(), games[0]], registry), /Duplicate catalog game/);
  assert.throws(() => validatePublicCatalog([...copy(), { ...games[0], id: 'unknown-game' }], registry), /no registered runtime/);
});

test('unreleased games cannot acquire public play links through the catalog', () => {
  const staged = { ...games[0], id: 'gachamon', url: '/games/gachamon/play' };
  assert.throws(() => validatePublicCatalog([...copy(), staged], registry), /must remain launch-blocked/);
  const reviewed = { ...staged, launchState: 'security_review' };
  assert.doesNotThrow(() => validatePublicCatalog([...copy(), reviewed], registry));
  assert.equal(canLaunchGame(reviewed), false);
});

test('catalog cannot replace canonical launch URLs with external or query-bearing destinations', () => {
  for (const url of ['https://example.com/play', '/games/legend-ball-x1000/play?token=secret', '/games/skygate-5000/play']) {
    const changed = copy();
    changed.find(game => game.id === 'legend-ball-x1000').url = url;
    assert.throws(() => validatePublicCatalog(changed, registry), /Non-canonical catalog launcher/);
  }
});

test('missing metadata and remote or traversing artwork paths fail the catalog gate', () => {
  for (const [field, value] of [['description', ''], ['cover', 'https://example.com/art.png'], ['detailImage', '/assets/../private.png']]) {
    const changed = copy();
    changed[0][field] = value;
    assert.throws(() => validatePublicCatalog(changed, registry));
  }
});

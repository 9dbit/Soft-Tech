/** Keep public discovery and canonical launch routes aligned with admission. */
export function validatePublicCatalog(catalog, registry) {
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('Public game catalog is required');
  const runtimes = new Map(registry.runtimes.map(game => [game.id, game]));
  const ids = new Set();
  for (const game of catalog) {
    if (ids.has(game.id)) throw new Error(`Duplicate catalog game: ${game.id}`);
    ids.add(game.id);
    const runtime = runtimes.get(game.id);
    if (!runtime) throw new Error(`Catalog game has no registered runtime: ${game.id}`);
    if (game.url !== `/games/${game.id}/play`) throw new Error(`Non-canonical catalog launcher: ${game.id}`);
    if (runtime.publicLaunch !== 'enabled' && game.launchState !== 'security_review') {
      throw new Error(`Unreleased catalog game must remain launch-blocked: ${game.id}`);
    }
    for (const field of ['name', 'genre', 'description', 'idDescription', 'cover', 'detailImage']) {
      if (typeof game[field] !== 'string' || !game[field].trim()) throw new Error(`Missing catalog ${field}: ${game.id}`);
    }
    for (const field of ['cover', 'detailImage']) {
      if (!/^\/assets\/[a-z0-9/-]+\.(?:png|jpe?g|webp)$/.test(game[field])) throw new Error(`Invalid catalog artwork: ${game.id}`);
    }
  }
  for (const game of registry.runtimes) {
    if (game.publicLaunch === 'enabled' && !ids.has(game.id)) {
      throw new Error(`Enabled runtime is missing its catalog/detail page: ${game.id}`);
    }
  }
  return catalog;
}

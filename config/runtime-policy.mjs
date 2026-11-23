// This registry is release configuration. Never derive an origin from a request.
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const canonicalPattern = /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.xd-play\.com$/;
const stagingPattern = /^https:\/\/staging-[a-z0-9]+(?:-[a-z0-9]+)*\.xd-play\.com$/;

function originOnly(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.port && !url.username && !url.password;
  } catch { return false; }
}

export function validateRuntimeRegistry(registry) {
  if (registry.version !== 1 || registry.portalOrigin !== "https://xd-play.com" || !Array.isArray(registry.runtimes)) {
    throw new Error("Invalid XDPLAY runtime registry");
  }
  const ids = new Set(), origins = new Set();
  for (const game of registry.runtimes) {
    if (typeof game.id !== "string" || !slugPattern.test(game.id) || ids.has(game.id)) throw new Error("Duplicate or invalid game ID");
    ids.add(game.id);
    if (!canonicalPattern.test(game.canonicalOrigin) || stagingPattern.test(game.canonicalOrigin) || !originOnly(game.canonicalOrigin) || origins.has(game.canonicalOrigin)) {
      throw new Error("Each game must have a unique canonical runtime origin");
    }
    origins.add(game.canonicalOrigin);
    if (game.stagingOrigin !== null && (!stagingPattern.test(game.stagingOrigin) || !originOnly(game.stagingOrigin) || origins.has(game.stagingOrigin))) {
      throw new Error("Staging must have a separate, explicit hostname");
    }
    if (game.stagingOrigin) origins.add(game.stagingOrigin);
    if (typeof game.domainReady !== "boolean" || !["enabled", "security_review", "staging_only"].includes(game.publicLaunch)) {
      throw new Error("Invalid domain or release state");
    }
    if (game.publicLaunch === "enabled") {
      if (!originOnly(game.deploymentOrigin) || !new URL(game.deploymentOrigin).hostname.endsWith(".up.railway.app") || origins.has(game.deploymentOrigin) || game.entryPath !== "/play/") {
        throw new Error("Public demos require an approved standalone origin and embed entry point");
      }
      origins.add(game.deploymentOrigin);
    } else if (game.deploymentOrigin !== null || game.entryPath !== null || game.domainReady) {
      throw new Error("Unreleased games must have no public launch destination");
    }
  }
  return registry;
}

export const gamePlayPath = game => `/games/${game.id}/play`;
export const gameDetailPath = game => `/games/${game.id}`;
export function activeRuntimeOrigin(game) {
  if (game.publicLaunch !== "enabled") return null;
  return game.domainReady ? game.canonicalOrigin : game.deploymentOrigin;
}
export function gameLaunchUrl(game) {
  const origin = activeRuntimeOrigin(game);
  return origin ? origin + game.entryPath : null;
}
export function gameEmbedUrl(game) {
  // Railway fallback origins are cross-site. Top-level launch preserves
  // host-only SameSite=Lax sessions without weakening the game's cookies.
  return game.domainReady ? gameLaunchUrl(game) : null;
}

export function viewerCsp(game) {
  const embed = gameEmbedUrl(game);
  const origin = embed ? new URL(embed).origin : null;
  return [
    "default-src 'self'", "base-uri 'self'", "form-action 'none'",
    "object-src 'none'", "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:", "connect-src 'self'",
    `frame-src ${origin || "'none'"}`
  ].join("; ");
}

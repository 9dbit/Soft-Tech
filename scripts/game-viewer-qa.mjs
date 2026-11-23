import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Exercise a real local Next server. Game documents are fixtures in the browser;
// these checks never create gameplay sessions or call production wallet APIs.
const base = new URL(process.env.QA_BASE_URL || 'http://127.0.0.1:3000');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && base.protocol === 'http:', 'QA target must be a local HTTP server');
const args = new Set(process.argv.slice(2));
assert([...args].every(arg => ['--http-only', '--browser-only'].includes(arg)), 'supported arguments: --http-only or --browser-only');
assert(!(args.has('--http-only') && args.has('--browser-only')), 'choose one QA mode');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifactDir = path.join(root, 'qa-artifacts/game-domain-standard');
mkdirSync(artifactDir, { recursive: true });
const registry = JSON.parse(readFileSync(path.join(root, 'config/game-runtimes.json'), 'utf8'));
const active = registry.runtimes.filter(game => game.publicLaunch === 'enabled');
const blocked = registry.runtimes.filter(game => game.publicLaunch !== 'enabled');
const source = game => (game.domainReady ? game.canonicalOrigin : game.deploymentOrigin) + game.entryPath;
const query = '?next=https%3A%2F%2Fattacker.example%2F&token=QA_DO_NOT_FORWARD_20261124&url=https%3A%2F%2Fattacker.example%2F&gamelang=id&cur=IDR';
const report = { startedAt: new Date().toISOString(), base: base.origin, fixtureMode: true, productionCalls: 0,
  launchModes: Object.fromEntries(active.map(game => [game.id, game.domainReady ? 'embedded' : 'direct'])), checks: [], screenshots: [] };
const failures = [];
const describeError = error => [error.message, error.cause?.code, error.cause?.message].filter(Boolean).join(': ');
async function check(name, fn) {
  try {
    const details = await fn();
    report.checks.push({ name, status: 'PASS', ...details });
    console.log('PASS', name);
  } catch (error) {
    failures.push(name);
    report.checks.push({ name, status: 'FAIL', error: describeError(error) });
    console.error('FAIL', name, describeError(error));
  }
}
const fetchLocal = (pathname, options = {}) => fetch(new URL(pathname, base), { redirect: 'manual', signal: AbortSignal.timeout(15000), ...options });
// Node fetch normalizes the Host header to its URL. Use the HTTP client for
// explicit virtual-host routing tests, keeping the socket target on localhost.
const fetchLocalWithHost = (pathname, method, host) => new Promise((resolve, reject) => {
  const request = httpRequest(new URL(pathname, base), { method, headers: { host } }, response => {
    const chunks = [];
    let size = 0;
    response.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) return request.destroy(new Error('Unexpectedly large local QA response'));
      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
    });
  });
  request.setTimeout(15000, () => request.destroy(new Error('Local virtual-host request timed out')));
  request.on('error', reject);
  request.end();
});
function directiveMap(csp) {
  const result = new Map();
  for (const clause of csp.split(';').map(value => value.trim()).filter(Boolean)) {
    const [name, ...values] = clause.split(/\s+/);
    assert(!result.has(name), `duplicate CSP directive ${name}`);
    result.set(name, values);
  }
  return result;
}
function assertViewerHeaders(headers, game) {
  const csp = directiveMap(headers.get('content-security-policy') || '');
  const expectedFrame = game.publicLaunch === 'enabled' && game.domainReady ? game.canonicalOrigin : "'none'";
  assert.deepEqual(csp.get('frame-src'), [expectedFrame], 'only a verified canonical runtime may be embedded');
  for (const [name, values] of Object.entries({
    'default-src': ["'self'"], 'connect-src': ["'self'"], 'frame-ancestors': ["'none'"],
    'object-src': ["'none'"], 'form-action': ["'none'"], 'base-uri': ["'self'"]
  })) assert.deepEqual(csp.get(name), values, name);
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(headers.get('strict-transport-security'), 'max-age=31536000');
  assert.match(headers.get('permissions-policy') || '', /payment=\(\)/);
  assert.match(headers.get('cache-control') || '', /(?:^|[,\s])no-store(?:$|[,\s])/);
  assert.doesNotMatch(headers.get('cache-control') || '', /(?:^|[,\s])public(?:$|[,\s])/);
  assert.equal(headers.get('access-control-allow-origin'), null);
  return expectedFrame;
}
const iframeTags = html => html.match(/<iframe\b[^>]*>/gi) || [];
const anchorTags = html => html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
const attr = (html, name) => new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(html)?.[1] ?? null;

async function httpChecks() {
  for (const game of registry.runtimes) {
    await check(`HTTP viewer ${game.id}`, async () => {
      const response = await fetchLocal(`/games/${game.id}/play${query}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/html/);
      const origin = assertViewerHeaders(response.headers, game);
      const html = await response.text();
      const frames = iframeTags(html);
      if (game.publicLaunch === 'enabled' && game.domainReady) {
        assert.equal(frames.length, 1);
        assert.match(html, /<main\b[^>]*data-launch-mode="embedded"/i);
        assert.equal(attr(frames[0], 'src'), source(game));
        assert.equal(attr(frames[0], 'referrerPolicy'), 'no-referrer');
        assert.equal(attr(frames[0], 'sandbox'), 'allow-scripts allow-same-origin allow-modals allow-downloads');
      } else if (game.publicLaunch === 'enabled') {
        assert.equal(frames.length, 0, 'unverified fallback must launch top-level');
        assert.match(html, /<main\b[^>]*data-launch-mode="direct"/i);
        const links = anchorTags(html);
        const launchLinks = links.filter(tag => /Open demo/.test(tag.replace(/<[^>]*>/g, '')));
        assert.equal(launchLinks.length, 1);
        assert.equal(attr(launchLinks[0], 'href'), source(game), 'caller query must not enter the launch URL');
        assert.equal(attr(launchLinks[0], 'target'), null, 'fallback must navigate in the same tab');
        assert.equal(attr(launchLinks[0], 'referrerPolicy'), 'no-referrer');
        assert.match(attr(launchLinks[0], 'rel') || '', /noreferrer/);
        assert.deepEqual(links.map(tag => attr(tag, 'href')).filter(href => href && /^(?:https?:)?\/\//.test(href)), [source(game)]);
      } else {
        assert.equal(frames.length, 0, 'unreleased games must have no iframe');
        assert.match(html, /Demo unavailable/);
        const externalLinks = (html.match(/<a\b[^>]*>/gi) || []).map(tag => attr(tag, 'href')).filter(href => href && /^(?:https?:)?\/\//.test(href));
        assert.deepEqual(externalLinks, [], 'unreleased viewer must expose no active external launch link');
        assert.doesNotMatch(html, /<iframe|\b(?:src|href)="https:\/\/[^"\s]*(?:railway|staging-)/i);
      }
      return { origin, launchMode: game.publicLaunch !== 'enabled' ? 'blocked' : game.domainReady ? 'embedded' : 'direct', iframeCount: frames.length };
    });
    await check(`HTTP compatibility alias ${game.id} ignores caller query`, async () => {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetchLocal(`/play/${game.id}${query}`, { method });
        assert.equal(response.status, 307);
        assert.equal(response.headers.get('location'), `https://xd-play.com/games/${game.id}/play`);
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        if (method === 'HEAD') assert.equal(await response.text(), '');
      }
    });
    await check(`HTTP compatibility alias ${game.id} refuses mutations`, async () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await fetchLocal(`/play/${game.id}${query}`, { method, headers: { 'content-type': 'application/json' }, body: '{"next":"https://attacker.example","token":"QA_DO_NOT_FORWARD_20261124"}' });
        assert.equal(response.status, 405, method);
        assert.equal(response.headers.get('location'), null, `${method} must not redirect a body`);
      }
      const options = await fetchLocal(`/play/${game.id}${query}`, { method: 'OPTIONS' });
      assert.equal(options.status, 204);
      assert.equal(options.headers.get('location'), null);
      assert.equal(options.headers.get('access-control-allow-origin'), null);
      assert.equal(options.headers.get('access-control-allow-credentials'), null);
      assert.equal(await options.text(), '');
      const allow = (options.headers.get('allow') || '').split(',').map(value => value.trim()).filter(Boolean);
      assert(allow.includes('GET') && allow.includes('HEAD'));
      assert(allow.every(method => ['GET', 'HEAD', 'OPTIONS'].includes(method)));
    });
  }
  await check('HTTP unknown game paths fail closed', async () => {
    for (const pathname of ['/games/unknown-game/play', '/games/uno-runner/play', '/play/unknown-game']) {
      const response = await fetchLocal(pathname + query);
      assert.equal(response.status, 404, pathname);
      assert.equal(response.headers.get('location'), null);
      assert.equal(iframeTags(await response.text()).length, 0);
    }
  });
  await check('HTTP UNO vanity quarantine covers shared viewers, aliases and API paths', async () => {
    for (const pathname of ['/', '/games/mahjong-wild/play', '/play/skygate-5000', '/api/health']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetchLocalWithHost(pathname + query, method, 'uno.xd-play.com');
        assert.equal(response.status, 307, `${method} ${pathname}`);
        assert.equal(response.headers.get('location'), 'https://xd-play.com/games/uno-luck');
        assert.equal(iframeTags(await response.text()).length, 0);
      }
      const refused = await fetchLocalWithHost(pathname + query, 'POST', 'uno.xd-play.com');
      assert.equal(refused.status, 404, pathname);
      assert.equal(refused.headers.get('location'), null);
    }
  });
}

function fixture(game) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${game.name} QA fixture</title><link rel="icon" href="data:,"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#08202b;color:#f2d793;font:18px system-ui}main{min-height:100%;display:grid;align-content:center;justify-items:center;gap:20px;background:radial-gradient(circle at 50% 40%,#174e53,#06121e)}h1,p{margin:0;text-align:center}h1{font-size:clamp(22px,4vw,48px)}button{padding:14px 20px;border:2px solid #d4b667;border-radius:12px;background:#153948;color:white;font:inherit}output{min-height:28px}</style></head><body><main data-runtime-fixture="${game.id}"><h1>${game.name}</h1><p>Isolated runtime acceptance fixture</p><button id="test-input">Test runtime input</button><output id="input-result">0</output></main><script>let count=0;document.getElementById('test-input').addEventListener('click',()=>{document.getElementById('input-result').textContent=String(++count)});</script></body></html>`;
}

async function browserChecks() {
  const require = createRequire(import.meta.url);
  let playwright;
  try { playwright = require('playwright'); }
  catch (localError) {
    if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw localError;
    playwright = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES] }));
  }
  const executablePath = process.env.QA_CHROMIUM_EXECUTABLE;
  const browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  report.browser = { engine: 'chromium', version: browser.version(), executable: executablePath || playwright.chromium.executablePath() };
  const saveScreenshot = async (page, name) => {
    const screenshotPath = path.join(artifactDir, name + '.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.screenshots.push(screenshotPath);
    return screenshotPath;
  };
  const assertControlBounds = async (controls, viewport) => {
    for (const control of controls) {
      const bounds = await control.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'navigation controls must fit the viewport');
    }
  };
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 393, height: 852 }]) {
      for (const game of active) {
        const launchMode = game.domainReady ? 'embedded' : 'direct';
        await check(`Browser ${game.id} ${viewport.name} ${launchMode}: navigation, input and isolation`, async () => {
          const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce', isMobile: viewport.name === 'mobile', hasTouch: viewport.name === 'mobile' });
          const fixtureRequests = [], fixtureNavigations = [], unexpectedExternal = [];
          const cookieName = '__Host-xdplay-qa';
          const cookieValue = `qa-fixture-${game.id}`;
          try {
            await context.route('**/*', route => {
              const request = route.request();
              const requested = request.url();
              if (new URL(requested).origin === base.origin) return route.continue();
              if (requested === source(game)) {
                fixtureRequests.push(requested);
                fixtureNavigations.push({ navigation: request.isNavigationRequest(), topLevel: request.frame().parentFrame() === null, method: request.method(), referer: request.headers().referer ?? null });
                return route.fulfill({ status: 200, contentType: 'text/html', headers: {
                  'Cache-Control': 'no-store',
                  'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; frame-ancestors ${base.origin}`,
                  ...(!game.domainReady ? { 'Set-Cookie': `${cookieName}=${cookieValue}; Path=/; Secure; HttpOnly; SameSite=Lax` } : {})
                }, body: fixture(game) });
              }
              // Font requests are fulfilled locally; all other external calls
              // are denied. No live runtime or wallet API receives a request.
              if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(requested).hostname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
              unexpectedExternal.push(requested);
              return route.abort('blockedbyclient');
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            const viewerUrl = new URL(`/games/${game.id}/play${query}`, base).href;
            const response = await page.goto(viewerUrl, { waitUntil: 'networkidle', timeout: 30000 });
            assert.equal(response.status(), 200);
            assertViewerHeaders(new Headers(await response.allHeaders()), game);
            assert.equal(await page.locator('main').getAttribute('data-launch-mode'), launchMode);
            assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'viewer must not overflow horizontally');
            const back = page.getByRole('link', { name: `Back to ${game.label} on XDPLAY`, exact: true });
            assert.equal(await back.getAttribute('href'), `/games/${game.id}`);
            if (!game.domainReady) {
              assert.equal(await page.locator('iframe').count(), 0, 'cross-site fallback must never be embedded');
              const launch = page.getByRole('link', { name: 'Open demo', exact: true });
              assert.equal(await launch.getAttribute('href'), source(game), 'caller query must not enter the runtime URL');
              assert.equal(await launch.getAttribute('target'), null, 'direct launch must use the same tab');
              assert.equal(await launch.getAttribute('referrerpolicy'), 'no-referrer');
              assert.match(await launch.getAttribute('rel'), /noreferrer/);
              assert.deepEqual(await page.locator('a[href^="http"], a[href^="//"]').evaluateAll(links => links.map(link => link.getAttribute('href'))), [source(game)]);
              await assertControlBounds([back, launch], viewport);
              assert.deepEqual(fixtureRequests, [], 'no runtime request is allowed before the user clicks');
              assert.deepEqual(await context.cookies(source(game)), [], 'no runtime cookie may exist before direct launch');
              assert.deepEqual(unexpectedExternal, []);
              const screenshot = await saveScreenshot(page, `${game.id}-${viewport.name}-direct`);
              await Promise.all([
                page.waitForURL(source(game), { waitUntil: 'domcontentloaded', timeout: 15000 }),
                launch.click()
              ]);
              assert.equal(page.url(), source(game), 'top-level navigation must discard every caller query');
              assert.equal(await page.evaluate(() => window.top === window.self), true);
              assert.equal(context.pages().length, 1, 'direct launch must not open another tab');
              await page.locator(`[data-runtime-fixture="${game.id}"]`).waitFor({ state: 'visible', timeout: 15000 });
              const cookies = await context.cookies(source(game));
              const accepted = cookies.find(cookie => cookie.name === cookieName);
              assert(accepted, 'top-level HTTPS fixture must accept the fake Lax session cookie');
              assert.deepEqual({ value: accepted.value, domain: accepted.domain, path: accepted.path, secure: accepted.secure, httpOnly: accepted.httpOnly, sameSite: accepted.sameSite }, {
                value: cookieValue, domain: new URL(source(game)).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax'
              });
              await page.getByRole('button', { name: 'Test runtime input', exact: true }).click();
              assert.equal(await page.locator('#input-result').textContent(), '1');
              assert.deepEqual(fixtureRequests, [source(game)]);
              assert.deepEqual(fixtureNavigations, [{ navigation: true, topLevel: true, method: 'GET', referer: null }]);
              assert.deepEqual(unexpectedExternal, []);
              assert.deepEqual(errors, []);
              const runtimeScreenshot = await saveScreenshot(page, `${game.id}-${viewport.name}-direct-runtime`);
              return { launchMode, origin: new URL(source(game)).origin, viewport, topLevelNavigation: true, fakeLaxCookieAccepted: true, runtimeInput: true, screenshot, runtimeScreenshot };
            }
            assert.equal(await page.locator('iframe').count(), 1);
            const frame = page.locator('#game-frame');
            assert.equal(await frame.getAttribute('src'), source(game));
            assert.equal(await frame.getAttribute('referrerpolicy'), 'no-referrer');
            assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-modals allow-downloads');
            assert.equal(await frame.getAttribute('allow'), 'autoplay; fullscreen');
            assert.notEqual(await frame.getAttribute('allowfullscreen'), null);
            assert.match(await frame.getAttribute('title'), /virtual-credit game/);
            const child = page.frameLocator('#game-frame');
            await child.locator(`[data-runtime-fixture="${game.id}"]`).waitFor({ state: 'visible', timeout: 15000 });
            const dimensions = await frame.boundingBox();
            assert(dimensions && Math.abs(dimensions.x) <= 1 && Math.abs(dimensions.y) <= 1);
            assert(Math.abs(dimensions.width - viewport.width) <= 1 && Math.abs(dimensions.height - viewport.height) <= 1, 'game frame must fill the visual viewport');
            const notice = page.locator('#game-virtual-credit-notice');
            assert.match(await notice.innerText(), /virtual-credit demo/);
            const noticeBounds = await notice.boundingBox();
            assert(noticeBounds && noticeBounds.width <= 1 && noticeBounds.height <= 1, 'a11y notice must not obscure gameplay');
            const separate = page.getByRole('link', { name: /Open separately/ });
            assert.equal(await separate.getAttribute('href'), source(game));
            assert.equal(await separate.getAttribute('target'), '_blank');
            assert.match(await separate.getAttribute('rel'), /noopener/);
            assert.match(await separate.getAttribute('rel'), /noreferrer/);
            await assertControlBounds([back, separate], viewport);
            const isolation = await child.locator('body').evaluate(() => {
              let parentReadable = false;
              try { parentReadable = Boolean(window.parent.document.body); } catch {}
              return { parentReadable, fullscreenEnabled: document.fullscreenEnabled };
            });
            assert.equal(isolation.parentReadable, false, 'runtime must not read portal DOM');
            assert.equal(isolation.fullscreenEnabled, true, 'fullscreen must be delegated to runtime');
            assert.equal(await frame.evaluate(element => element.contentDocument === null), true, 'portal must not read runtime DOM');
            await child.getByRole('button', { name: 'Test runtime input', exact: true }).click();
            assert.equal(await child.locator('#input-result').textContent(), '1');
            assert.deepEqual(fixtureRequests, [source(game)]);
            assert.deepEqual(fixtureNavigations, [{ navigation: true, topLevel: false, method: 'GET', referer: null }]);
            assert.deepEqual(unexpectedExternal, [], 'only the configured game destination may be requested');
            assert.deepEqual(errors, []);
            const screenshot = await saveScreenshot(page, `${game.id}-${viewport.name}-embedded`);
            await back.click();
            await page.waitForURL(new URL(`/games/${game.id}`, base).href, { timeout: 15000 });
            return { launchMode, origin: new URL(source(game)).origin, viewport, dimensions, isolation, runtimeInput: true, screenshot };
          } finally { await context.close(); }
        });
      }
    }
    for (const game of blocked) {
      await check(`Browser blocked ${game.id} exposes no runtime`, async () => {
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
        const runtimeRequests = [];
        try {
          await context.route('**/*', route => {
            const requested = new URL(route.request().url());
            if (requested.origin === base.origin) return route.continue();
            if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(requested.hostname)) runtimeRequests.push(requested.href);
            return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
          });
          const page = await context.newPage();
          await page.goto(new URL(`/games/${game.id}/play${query}`, base).href, { waitUntil: 'networkidle', timeout: 30000 });
          assert.equal(await page.locator('iframe').count(), 0);
          assert(await page.getByRole('heading', { name: 'Demo unavailable', exact: true }).isVisible());
          assert.equal(await page.locator('a[href^="http"], a[href^="//"]').count(), 0);
          assert.deepEqual(runtimeRequests, []);
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); }
}

try {
  assert.deepEqual(active.map(game => game.id).sort(), ['mahjong-wild', 'skygate-5000']);
  assert.equal(blocked.length, 3);
  const health = await fetchLocal('/api/health');
  assert.equal(health.status, 200, 'local production server must be ready before acceptance checks');
  if (!args.has('--browser-only')) await httpChecks();
  if (!args.has('--http-only')) await check('Browser acceptance suite', browserChecks);
} catch (error) {
  failures.push('QA setup');
  report.checks.push({ name: 'QA setup', status: 'FAIL', error: describeError(error) });
  console.error(error);
} finally {
  report.completedAt = new Date().toISOString();
  report.result = failures.length ? 'FAIL' : 'PASS';
  report.failures = failures;
  writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`Game viewer acceptance ${report.result}: ${report.checks.length} checks; ${failures.length} failures. Report: ${path.join(artifactDir, 'report.json')}`);
if (failures.length) process.exitCode = 1;

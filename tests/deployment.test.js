import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';

const publicRoot = new URL('../public/', import.meta.url);
const scopes = ['https://example.com/', 'https://example.com/marginalia/'];

async function assertAsset(url, scope) {
  assert.ok(url.href.startsWith(scope), `${url.href} escapes deployment scope ${scope}`);
  const relative = url.href.slice(scope.length).split(/[?#]/)[0] || 'index.html';
  assert.ok((await stat(new URL(relative, publicRoot))).isFile(), `${relative} must exist in public/`);
}

test('HTML assets resolve to existing files at root and GitHub Pages project paths', async () => {
  const html = await readFile(new URL('index.html', publicRoot), 'utf8');
  const refs = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(refs.length >= 5, 'test must inspect stylesheet, manifest, icons and application script');
  for (const scope of scopes) for (const ref of refs) {
    const url = new URL(ref, scope);
    if (url.origin === new URL(scope).origin) await assertAsset(url, scope);
  }
});

test('manifest identity, launch URL, scope and icons remain inside either deployment path', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', publicRoot), 'utf8'));
  for (const scope of scopes) {
    const manifestURL = new URL('manifest.webmanifest', scope);
    for (const key of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[key], manifestURL).href, scope, `${key} must use the deployed directory`);
    for (const icon of manifest.icons) await assertAsset(new URL(icon.src, manifestURL), scope);
  }
});

async function worker(scope) {
  const handlers = new Map(), precached = [], deleted = [], matches = [];
  let currentCache;
  const offlineShell = { shell: true };
  const cache = {
    addAll: async urls => precached.push(...urls),
    match: async request => { matches.push(request); return request === scope ? offlineShell : undefined; },
    put: async () => {},
  };
  const prefix = `marginalia-${new URL(scope).pathname}-`;
  const previousCache = `${prefix}previous-release`;
  const unrelated = ['another-app-v1', 'marginalia-/different-project/-v2'];
  const context = {
    URL, Response,
    self: { registration: { scope }, addEventListener: (name, fn) => handlers.set(name, fn), skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { open: async name => { currentCache ??= name; return cache; }, keys: async () => [...unrelated, previousCache, currentCache].filter(Boolean), delete: async key => { deleted.push(key); return true; } },
    fetch: async () => { throw new Error('Offline'); },
  };
  vm.runInNewContext(await readFile(new URL('sw.js', publicRoot), 'utf8'), context);
  const dispatch = async (name, properties = {}) => {
    const waits = [];
    let response;
    handlers.get(name)({ ...properties, waitUntil: task => waits.push(task), respondWith: task => { response = task; } });
    await Promise.all(waits);
    return response ? await response : undefined;
  };
  return { dispatch, precached, deleted, matches, offlineShell, unrelated, prefix, previousCache, get currentCache() { return currentCache; } };
}

test('service worker precaches project-scoped assets and preserves unrelated caches', async () => {
  for (const scope of scopes) {
    const state = await worker(scope);
    await state.dispatch('install');
    assert.ok(state.currentCache.startsWith(state.prefix), 'installed cache must belong to this deployment scope');
    assert.ok(state.precached.length >= 10);
    assert.ok(state.precached.includes(scope), 'offline shell must include the deployment root');
    for (const asset of state.precached) await assertAsset(new URL(asset), scope);
    await state.dispatch('activate');
    assert.deepEqual(state.deleted, [state.previousCache]);
    assert.ok(!state.deleted.includes(state.currentCache), 'activation must preserve the cache populated during installation');
    assert.ok(state.unrelated.every(key => !state.deleted.includes(key)));
  }
});

test('offline navigation falls back to the deployed root and ignores out-of-scope requests', async () => {
  for (const scope of scopes) {
    const state = await worker(scope);
    const request = { url: new URL('reading-session', scope).href, method: 'GET', mode: 'navigate' };
    assert.equal(await state.dispatch('fetch', { request }), state.offlineShell);
    assert.equal(state.matches.at(-1), scope);
    const before = state.matches.length;
    assert.equal(await state.dispatch('fetch', { request: { url: 'https://other.example/asset.js', method: 'GET' } }), undefined);
    assert.equal(await state.dispatch('fetch', { request: { url: new URL('save', scope).href, method: 'POST' } }), undefined);
    assert.equal(state.matches.length, before);
    if (new URL(scope).pathname !== '/') {
      assert.equal(await state.dispatch('fetch', { request: { url: 'https://example.com/outside-project/', method: 'GET', mode: 'navigate' } }), undefined);
    }
  }
});

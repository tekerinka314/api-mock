import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createMockServer } from '../server.mjs';

async function start(t, configPath) {
  const server = createMockServer({ configPath });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let isListening = true;
  async function close() {
    if (isListening) await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    isListening = false;
  }
  t.after(close);
  return {
    request: (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options),
    close,
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frontend-api-mock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'config.json');
  return { configPath, ...await start(t, configPath) };
}

async function getConfig(app) {
  const response = await app.request('/api/config');
  assert.equal(response.status, 200);
  return response.json();
}

function putConfig(app, config) {
  return app.request('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

test('каталог отримує список товарів від GET /mock/products', async (t) => {
  const app = await fixture(t);
  const response = await app.request('/mock/products');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const products = await response.json();
  assert.equal(products.length, 3);
  assert.equal(typeof products[0].name, 'string');
});

test('перемикання одного активного варіанта дає порожній список і помилку', async (t) => {
  const app = await fixture(t);
  const config = await getConfig(app);
  config.routes[0].active = 1;
  assert.equal((await putConfig(app, config)).status, 200);
  const empty = await app.request('/mock/products');
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), []);

  config.routes[0].active = 2;
  assert.equal((await putConfig(app, config)).status, 200);
  const failed = await app.request('/mock/products');
  assert.equal(failed.status, 500);
  assert.equal(typeof (await failed.json()).message, 'string');
});

test('затримка 1000 мс читається з конфігурації й відображається в журналі', async (t) => {
  const app = await fixture(t);
  const config = await getConfig(app);
  config.routes[0].active = 3;
  assert.equal(config.routes[0].variants[3].delayMs, 1000);
  assert.equal((await putConfig(app, config)).status, 200);

  const started = performance.now();
  const response = await app.request('/mock/products');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 3);
  assert.ok(performance.now() - started >= 980);
  const [entry] = await (await app.request('/api/log')).json();
  assert.deepEqual([entry.method, entry.path, entry.status], ['GET', '/mock/products', 200]);
  assert.ok(entry.durationMs >= 980);
});

test('помилковий JSON залишає збережену відповідь у пам’яті й на диску', async (t) => {
  const app = await fixture(t);
  const config = await getConfig(app);
  config.routes[0].variants[0].body = '[{"name":"Запасний товар"}]';
  assert.equal((await putConfig(app, config)).status, 200);
  const saved = await readFile(app.configPath, 'utf8');

  const malformed = structuredClone(config);
  malformed.routes[0].variants[0].body = '{"name":';
  const failure = await putConfig(app, malformed);
  assert.equal(failure.status, 400);
  assert.match((await failure.json()).message, /JSON/);
  assert.equal(await readFile(app.configPath, 'utf8'), saved);
  assert.deepEqual(await getConfig(app), config);
  assert.deepEqual(await (await app.request('/mock/products')).json(), [{ name: 'Запасний товар' }]);

  const invalidRequest = await app.request('/api/config', { method: 'PUT', body: '{' });
  assert.equal(invalidRequest.status, 400);
  assert.equal(await readFile(app.configPath, 'utf8'), saved);
  const restarted = await start(t, app.configPath);
  assert.deepEqual(await getConfig(restarted), config);
});

test('POST збігається за методом і шляхом, невідомі маршрути дають 404', async (t) => {
  const app = await fixture(t);
  const config = await getConfig(app);
  config.routes.push({
    method: 'POST',
    path: '/mock/orders',
    active: 0,
    variants: [{ name: 'Створено', status: 201, delayMs: 0, body: '{"ok":true}' }],
  });
  assert.equal((await putConfig(app, config)).status, 200);

  const posted = await app.request('/mock/orders?preview=1', {
    method: 'POST',
    body: '{"productId":1}',
  });
  assert.equal(posted.status, 201);
  assert.deepEqual(await posted.json(), { ok: true });
  for (const path of ['/mock/orders', '/mock/products/', '/mock/missing']) {
    const missing = await app.request(path);
    assert.equal(missing.status, 404);
    assert.equal(typeof (await missing.json()).message, 'string');
  }
  const logs = await (await app.request('/api/log')).json();
  assert.deepEqual(logs.map(({ method, path, status }) => [method, path, status]), [
    ['GET', '/mock/missing', 404],
    ['GET', '/mock/products/', 404],
    ['GET', '/mock/orders', 404],
    ['POST', '/mock/orders', 201],
  ]);
  assert.ok(logs.every(({ durationMs }) => durationMs >= 0));
});

test('сервер відхиляє дублікати маршрутів, недійсний активний варіант і статус без тіла', async (t) => {
  const app = await fixture(t);
  const config = await getConfig(app);
  for (const invalidate of [
    ({ routes }) => routes.push(structuredClone(routes[0])),
    ({ routes }) => { routes[0].active = 99; },
    ({ routes }) => { routes[0].variants[0].status = 204; },
  ]) {
    const candidate = structuredClone(config);
    invalidate(candidate);
    assert.equal((await putConfig(app, candidate)).status, 400);
  }
  assert.deepEqual(await getConfig(app), config);
});

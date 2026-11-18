import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConfigError, openStore } from './store.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/demo', ['demo.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/editor.js', ['editor.js', 'text/javascript']],
  ['/catalog.js', ['catalog.js', 'text/javascript']],
]);
const notFound = { message: 'Маршрут не знайдено.' };

function json(response, status, value) {
  sendJson(response, status, JSON.stringify(value));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  let body = '';
  let tooLarge = false;
  request.setEncoding('utf8');
  for await (const chunk of request) {
    if (tooLarge) continue;
    body += chunk;
    tooLarge = body.length > 1024 * 1024;
  }
  if (tooLarge) throw new ConfigError('Конфігурація перевищує допустимий розмір.');
  try {
    return JSON.parse(body);
  } catch {
    throw new ConfigError('Запит має містити коректний JSON.');
  }
}

export function createMockServer({
  configPath = process.env.MOCK_DATA ?? fileURLToPath(new URL('./var/config.json', import.meta.url)),
} = {}) {
  const store = openStore(configPath);
  const log = [];

  return createServer(async (request, response) => {
    const method = request.method;
    const path = request.url.split('?')[0];

    try {
      if (path.startsWith('/mock/')) {
        const start = performance.now();
        response.on('finish', () => {
          log.unshift({ method, path, status: response.statusCode, durationMs: Math.round(performance.now() - start) });
          if (log.length > 50) log.pop();
        });

        const variant = store.match(method, path);
        if (!variant) return json(response, 404, notFound);
        if (variant.delayMs) await setTimeout(variant.delayMs);
        return sendJson(response, variant.status, variant.body);
      }

      if (path === '/api/config') {
        if (method === 'GET') return json(response, 200, store.getConfig());
        if (method === 'PUT') {
          const config = await readJson(request);
          store.save(config);
          return json(response, 200, store.getConfig());
        }
      }

      if (method === 'GET' && path === '/api/log') return json(response, 200, log);
      const asset = assets.get(path);
      if (method === 'GET' && asset) {
        const [filename, type] = asset;
        const body = await readFile(new URL('./public/' + filename, import.meta.url));
        response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(body);
      }

      return json(response, 404, notFound);
    } catch (error) {
      if (error instanceof ConfigError) return json(response, 400, { message: error.message });
      console.error(error);
      return json(response, 500, { message: 'Внутрішня помилка локального сервера.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4311);
  createMockServer().listen(port, '127.0.0.1', function () {
    console.log('API-мок працює на http://127.0.0.1:' + this.address().port);
  });
}

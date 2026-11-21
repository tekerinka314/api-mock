import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const fixturePath = new URL('./config/default.json', import.meta.url);
const validPath = /^\/mock(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/;

export class ConfigError extends Error {}

function validate(config) {
  if (!Array.isArray(config?.routes) || config.routes.length === 0) {
    throw new ConfigError('Додайте хоча б один маршрут.');
  }

  const routes = new Set();
  for (const route of config.routes) {
    if (!['GET', 'POST'].includes(route?.method) || typeof route.path !== 'string' || !validPath.test(route.path)) {
      throw new ConfigError('Вкажіть метод GET або POST і шлях на зразок /mock/products.');
    }
    const key = route.method + ' ' + route.path;
    if (routes.has(key)) throw new ConfigError('Маршрут ' + key + ' уже існує.');
    routes.add(key);

    if (!Array.isArray(route.variants) || !Number.isInteger(route.active)
      || route.active < 0 || route.active >= route.variants.length) {
      throw new ConfigError('Виберіть один активний варіант для маршруту ' + key + '.');
    }

    for (const variant of route.variants) {
      if (typeof variant?.name !== 'string' || !variant.name.trim()) {
        throw new ConfigError('Введіть назву кожного варіанта.');
      }
      if (!Number.isInteger(variant.status) || variant.status < 200 || variant.status > 599
        || [204, 205, 304].includes(variant.status)) {
        throw new ConfigError('Вкажіть HTTP-статус 200–599, який дозволяє тіло відповіді.');
      }
      if (!Number.isInteger(variant.delayMs) || variant.delayMs < 0 || variant.delayMs > 10000) {
        throw new ConfigError('Вкажіть затримку від 0 до 10000 мс.');
      }
      try {
        if (typeof variant.body !== 'string') throw new TypeError();
        JSON.parse(variant.body);
      } catch {
        throw new ConfigError('Виправте JSON у варіанті «' + variant.name + '». Попередні налаштування збережено.');
      }
    }
  }
}

export function openStore(filePath) {
  let config;
  try {
    config = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = JSON.parse(readFileSync(fixturePath, 'utf8'));
  }
  validate(config);

  return {
    getConfig: () => config,
    save(candidate) {
      validate(candidate);
      mkdirSync(dirname(filePath), { recursive: true });
      const temporaryPath = filePath + '.tmp';
      writeFileSync(temporaryPath, JSON.stringify(candidate, null, 2) + '\n', 'utf8');
      renameSync(temporaryPath, filePath);
      config = candidate;
    },
    match(method, path) {
      const route = config.routes.find((item) => item.method === method && item.path === path);
      return route?.variants[route.active];
    },
  };
}

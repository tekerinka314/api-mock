import { loadProducts } from './catalog.js';

const byId = (id) => document.getElementById(id);
const form = byId('route-form');
const routeSelect = byId('route-select');
const variantList = byId('variant-list');
const activeInput = byId('variant-active');
const saveButton = byId('save-config');
const addRouteButton = byId('add-route');
const editorError = byId('editor-error');
const saveFeedback = byId('save-feedback');

let config;
let savedConfig;
let routeIndex = 0;
let variantIndex = 0;
const route = () => config.routes[routeIndex];
const variant = () => route().variants[variantIndex];

function clearEditorFeedback() {
  editorError.hidden = true;
  saveFeedback.textContent = '';
}

function showEditorError(message) {
  editorError.textContent = message;
  editorError.hidden = false;
  editorError.focus();
}

function renderRoutes() {
  routeSelect.replaceChildren(...config.routes.map((item, index) =>
    new Option(item.method + ' ' + (item.path || '(новий шлях)'), index)));
  routeSelect.value = routeIndex;
}

function renderVariants() {
  const savedRoute = savedConfig.routes[routeIndex];
  const sameRoute = savedRoute?.method === route().method && savedRoute?.path === route().path;
  const savedActive = sameRoute ? savedRoute.active : undefined;
  variantList.replaceChildren(...route().variants.map((item, index) => {
    const entry = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'variant-button';
    button.setAttribute('aria-pressed', index === variantIndex);
    const status = document.createElement('code');
    status.textContent = item.status ?? '…';
    const name = document.createElement('span');
    name.className = 'variant-name';
    name.textContent = item.name.trim() || 'Без назви';
    if (item.delayMs) name.append(' (' + item.delayMs + ' мс)');
    button.append(status, ' ', name);
    if (index === savedActive || index === route().active) {
      const state = document.createElement('span');
      state.className = 'variant-state';
      state.textContent = index === savedActive ? 'Активний' : 'Після збереження';
      button.append(' ', state);
    }

    button.addEventListener('click', () => {
      variantIndex = index;
      clearEditorFeedback();
      renderVariantFields();
      variantList.querySelectorAll('button')[index].focus();
    });
    entry.append(button);
    return entry;
  }));
}

function renderVariantFields() {
  byId('variant-name').value = variant().name;
  byId('variant-status').value = variant().status;
  byId('variant-delay').value = variant().delayMs;
  byId('variant-body').value = variant().body;
  activeInput.checked = route().active === variantIndex;
  renderVariants();
}

function renderRouteFields() {
  renderRoutes();
  byId('route-method').value = route().method;
  byId('route-path').value = route().path;
  renderVariantFields();
}

function newVariant() {
  return { name: 'Новий варіант', status: 200, delayMs: 0, body: '{}' };
}

function renderRouteSummary() {
  renderRoutes();
  renderVariants();
}

addRouteButton.disabled = true;

routeSelect.addEventListener('change', () => {
  routeIndex = Number(routeSelect.value);
  variantIndex = route().active;
  clearEditorFeedback();
  renderRouteFields();
});

addRouteButton.addEventListener('click', () => {
  config.routes.push({ method: 'GET', path: '', active: 0, variants: [newVariant()] });
  routeIndex = config.routes.length - 1;
  variantIndex = 0;
  clearEditorFeedback();
  renderRouteFields();
  byId('route-path').focus();
});

byId('add-variant').addEventListener('click', () => {
  route().variants.push(newVariant());
  variantIndex = route().variants.length - 1;
  clearEditorFeedback();
  renderVariantFields();
  byId('variant-name').focus();
});

const fields = [
  ['route-method', route, 'method', renderRouteSummary],
  ['route-path', route, 'path', renderRouteSummary],
  ['variant-name', variant, 'name', renderVariants],
  ['variant-status', variant, 'status', renderVariants],
  ['variant-delay', variant, 'delayMs', renderVariants],
  ['variant-body', variant, 'body'],
];

for (const [id, record, key, rerender] of fields) {
  byId(id).addEventListener('input', (event) => {
    const input = event.target;
    record()[key] = input.type === 'number' ? (input.value ? input.valueAsNumber : null) : input.value;
    clearEditorFeedback();
    rerender?.();
  });
}

activeInput.addEventListener('change', () => {
  route().active = variantIndex;
  renderVariants();
  clearEditorFeedback();
});

byId('discard-config').addEventListener('click', () => {
  config = structuredClone(savedConfig);
  routeIndex = Math.min(routeIndex, config.routes.length - 1);
  variantIndex = route().active;
  clearEditorFeedback();
  renderRouteFields();
  saveFeedback.textContent = 'Незбережені зміни скасовано.';
});

function setSaving(active) {
  for (const control of form.elements) control.disabled = active;
  addRouteButton.disabled = active;
  form.setAttribute('aria-busy', String(active));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saveButton.disabled) return;
  clearEditorFeedback();
  try {
    JSON.parse(variant().body);
  } catch {
    showEditorError('Виправте JSON у тілі відповіді. Попередні налаштування збережено.');
    byId('variant-body').focus();
    return;
  }

  setSaving(true);
  saveFeedback.textContent = 'Збереження…';
  try {
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const result = await response.json();
    if (!response.ok) {
      saveFeedback.textContent = '';
      showEditorError(result.message);
      return;
    }
    savedConfig = result;
    renderVariants();
    saveFeedback.textContent = 'Налаштування збережено.';
  } catch {
    saveFeedback.textContent = '';
    showEditorError('Не вдалося зберегти налаштування. Перевірте локальний сервер.');
  } finally {
    setSaving(false);
  }
});

async function refreshLog() {
  const table = byId('log-rows');
  const empty = byId('log-empty');
  try {
    const response = await fetch('/api/log');
    if (!response.ok) throw new Error();
    const entries = await response.json();
    const rows = entries.map(({ method, path, status, durationMs }) => {
      const row = document.createElement('tr');
      for (const text of [method, path, status, durationMs + ' мс']) {
        row.insertCell().textContent = text;
      }
      return row;
    });
    table.replaceChildren(...rows);
    empty.hidden = entries.length !== 0;
    empty.textContent = 'Записів ще немає.';
  } catch {
    empty.hidden = false;
    empty.textContent = 'Журнал недоступний.';
  }
}

byId('refresh-log').addEventListener('click', refreshLog);
document.addEventListener('catalog:loaded', refreshLog);

byId('copy-demo').addEventListener('click', async () => {
  const feedback = byId('copy-feedback');
  const url = new URL('/demo', location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    feedback.textContent = 'Адресу демокаталогу скопійовано.';
  } catch {
    feedback.textContent = 'Адреса демокаталогу: ' + url;
  }
  feedback.hidden = false;
});

async function startEditor() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error();
    savedConfig = await response.json();
    config = structuredClone(savedConfig);
    variantIndex = route().active;
    renderRouteFields();
    form.hidden = false;
    addRouteButton.disabled = false;
  } catch {
    showEditorError('Редактор не зміг завантажити налаштування.');
  }
}

startEditor();
loadProducts();

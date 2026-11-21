const refreshButton = document.querySelector('#refresh-products');
const catalogBody = document.querySelector('#catalog-body');

function element(tag, className, text) {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = text;
  return item;
}

function statusLine(text) {
  catalogBody.append(element('p', 'catalog-status', text));
}

function showMessage(title, detail, modifier = '') {
  const message = element('div', 'catalog-message ' + modifier, '');
  message.append(element('strong', '', title), element('p', '', detail));
  catalogBody.append(message);
}

function isProduct(product) {
  return product !== null && typeof product === 'object' && !Array.isArray(product)
    && (product.name == null || typeof product.name === 'string')
    && (product.category == null || typeof product.category === 'string')
    && (product.price == null || Number.isFinite(product.price));
}

function showProducts(products) {
  const list = element('ul', 'products', '');
  const priceFormat = new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency: 'UAH',
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  for (const product of products) {
    const row = element('li', 'product', '');
    const detail = element('div', 'product-detail', '');
    detail.append(element('strong', '', product.name?.trim() || 'Товар'));
    if (product.category) detail.append(element('small', '', product.category));
    row.append(detail);
    if (typeof product.price === 'number') row.append(element('span', 'product-price', priceFormat.format(product.price)));
    list.append(row);
  }
  catalogBody.append(list);
}

export async function loadProducts() {
  refreshButton.disabled = true;
  catalogBody.replaceChildren();
  showMessage('Завантаження…', 'Очікуємо відповідь від мока.', 'loading');
  try {
    const response = await fetch('/mock/products');
    const body = await response.json();
    catalogBody.replaceChildren();
    if (!response.ok) {
      statusLine('HTTP ' + response.status);
      const message = typeof body?.message === 'string' && body.message.trim();
      showMessage('Помилка завантаження', message || 'Запит до мока завершився помилкою.', 'catalog-error');
    } else if (!Array.isArray(body) || !body.every(isProduct)) {
      statusLine('HTTP ' + response.status);
      showMessage('Неочікуваний формат', 'Каталог очікує масив об’єктів товарів із текстовою назвою й категорією та числовою ціною.', 'catalog-error');
    } else if (body.length === 0) {
      statusLine('HTTP ' + response.status);
      showMessage('Каталог порожній', 'За цією відповіддю товарів немає.');
    } else {
      statusLine('HTTP ' + response.status + ' · Товарів: ' + body.length);
      showProducts(body);
    }
  } catch {
    catalogBody.replaceChildren();
    showMessage('Помилка завантаження', 'Перевірте, чи працює локальний сервер.', 'catalog-error');
  } finally {
    refreshButton.disabled = false;
    document.dispatchEvent(new Event('catalog:loaded'));
  }
}

refreshButton.addEventListener('click', loadProducts);
if (location.pathname === '/demo') loadProducts();

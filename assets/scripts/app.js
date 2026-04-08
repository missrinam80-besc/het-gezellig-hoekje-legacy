window.GEZELLIG_CONFIG = Object.assign({
  API_URL: 'https://script.google.com/macros/s/AKfycbwhrWNby9HVYPx-e01-eBPAOsRZbQfJtIgtcyHpPEP-q5Vo8eG28N4GB4OQSMwI6Ygq7A/exec',
  API_TOKEN: 'COFFEE_HOOK_0804',
  IMAGE_BASE: 'assets/images/raw',
  RECIPE_IMAGE_BASE: 'assets/images/recepies'
}, window.GEZELLIG_CONFIG || {});

const APP = {
  page: document.body.dataset.page || 'dashboard',
  data: null,
  ingredientsMap: new Map(),
  recipesMap: new Map(),
  imagesMap: new Map()
};

const PAGE_META = {
  dashboard: { title: 'Dashboard', intro: 'Overzicht van je shop, live geladen uit Google Sheets.' },
  ingredients: { title: 'Ingrediënten', intro: 'Beheer grondstoffen, prijsgegevens en afbeeldingen rechtstreeks vanuit Google Sheets.' },
  recipes: { title: 'Recepten', intro: 'Maak recepten, laat calorieën meerekenen en bepaal of ze zichtbaar zijn op de menukaart.' },
  boxes: { title: 'Boxen', intro: 'Stel boxen samen op basis van bestaande recepten en laat de prijs automatisch berekenen.' },
  stock: { title: 'Stock & Winkellijst', intro: 'Bereken tekorten en aankoopkosten op basis van je planning.' },
  menu: { title: 'Menukaarten', intro: 'Pas stijlopties aan en toon alleen de recepten die actief én zichtbaar zijn op de menukaart.' },
  images: { title: 'Afbeeldingen', intro: 'Upload, beheer en verwijder afbeeldingen voor ingrediënten, recepten, boxen en de menukaart.' },
  settings: { title: 'Shopinstellingen', intro: 'Beheer shopinstellingen en test de API-verbinding.' }
};

const DRINK_ALLOWED = new Set(['Dranken', 'Fruit', 'Groenten', 'Zuivel', 'Thee', 'Chocolademelk', 'Toppings']);

const TYPE_OPTIONS = [
  { value: 'raw', label: 'Grondstof' },
  { value: 'processed', label: 'Verwerkt' },
  { value: 'condiment', label: 'Kruiding' },
  { value: 'purchased_finished', label: 'Aangekocht' }
];

const PRODUCT_TYPE_OPTIONS = [
  { value: 'drink', label: 'Drankje' },
  { value: 'snack', label: 'Hapje' },
  { value: 'main', label: 'Hoofdgerecht' }
];

const ANIMATION_OPTIONS = [
  'coffee',
  'cup',
  'sandwich',
  'donut',
  'bagel',
  'dinner',
  'burger'
];

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[s]));
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

function money(v) {
  return `€${Number(v || 0).toFixed(2)}`;
}

function asBool(v) {
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'ja', 'yes', 'y'].includes(String(v || '').toLowerCase().trim());
}

function typeLabel(type) {
  const found = TYPE_OPTIONS.find(t => t.value === type);
  return found ? found.label : (type || '');
}

function productTypeLabel(type) {
  const found = PRODUCT_TYPE_OPTIONS.find(t => t.value === type);
  return found ? found.label : (type || '');
}

function setStatusBadge(ok = true) {
  const b = document.getElementById('storageBadge');
  if (b) b.textContent = ok ? 'Google Sheet live' : 'Niet geladen';

  const badge = document.getElementById('liveStatusBadge');
  const text = document.getElementById('liveStatusText');
  if (!badge || !text) return;

  badge.className = 'live-badge';
  if (ok) {
    badge.classList.add('live-ok');
    text.textContent = 'Live gekoppeld';
  } else {
    badge.classList.add('live-bad');
    text.textContent = 'Niet verbonden';
  }
}

function setLiveStatus(mode, label) {
  const badge = document.getElementById('liveStatusBadge');
  const text = document.getElementById('liveStatusText');
  if (!badge || !text) return;

  badge.className = 'live-badge';
  if (mode === 'ok') badge.classList.add('live-ok');
  else if (mode === 'warn') badge.classList.add('live-warn');
  else badge.classList.add('live-bad');

  text.textContent = label;
}

function assetPath(path) {
  if (!path) return '';
  if (/^https?:/i.test(path) || path.startsWith('data:') || path.startsWith('/')) return path;

  const inPagesFolder = APP.page !== 'dashboard';
  if (path.startsWith('../')) return path;
  if (inPagesFolder) return `../${path.replace(/^\.?\//, '')}`;
  return path.replace(/^\.?\//, '');
}

function itemImageUrl(item, recipeMode = false) {
  const val = item?.image || item?.fileName || item?.file_name || '';
  if (item?.dataUrl || item?.data_url) return item.dataUrl || item.data_url;
  if (!val) return '';

  if (/^https?:/i.test(val) || val.startsWith('data:') || val.startsWith('/')) return val;
  if (val.includes('/')) return assetPath(val);

  const base = recipeMode ? window.GEZELLIG_CONFIG.RECIPE_IMAGE_BASE : window.GEZELLIG_CONFIG.IMAGE_BASE;
  return assetPath(`${base}/${val}`);
}

function imageRecordValue(id) {
  return APP.imagesMap.get(id) || null;
}

function resolveImage(ref, recipeMode = false) {
  if (!ref) return '';

  const lib = imageRecordValue(ref);
  if (lib) return itemImageUrl(lib, recipeMode);

  if (/^https?:/i.test(ref) || ref.startsWith('data:') || ref.startsWith('/')) return ref;
  if (ref.includes('/')) return assetPath(ref);

  const base = recipeMode ? window.GEZELLIG_CONFIG.RECIPE_IMAGE_BASE : window.GEZELLIG_CONFIG.IMAGE_BASE;
  return assetPath(`${base}/${ref}`);
}

async function apiGet(action) {
  const url = window.GEZELLIG_CONFIG.API_URL;
  if (!url || url.includes('PASTE_HIER')) throw new Error('API_URL is nog niet ingevuld in assets/app.js');

  const res = await fetch(`${url}?action=${encodeURIComponent(action)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Onbekende API-fout');
  return json.data;
}

async function apiPost(action, data = {}) {
  const url = window.GEZELLIG_CONFIG.API_URL;
  const token = window.GEZELLIG_CONFIG.API_TOKEN;
  if (!url || url.includes('PASTE_HIER')) throw new Error('API_URL is nog niet ingevuld in assets/app.js');
  if (!token || token.includes('PASTE_HIER')) throw new Error('API_TOKEN is nog niet ingevuld in assets/app.js');

  const payload = { token, action, data };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) });

  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Onbekende API-fout');
  return json.data;
}

async function loadAllData() {
  APP.data = await apiGet('data.all');
  APP.ingredientsMap = new Map((APP.data.ingredients || []).map(i => [i.id, i]));
  APP.recipesMap = new Map((APP.data.recipes || []).map(r => [r.id, r]));
  APP.imagesMap = new Map((APP.data.images || []).map(i => [i.id, i]));
  fillHeader();
  setStatusBadge(true);
  setLiveStatus('ok', 'Live gekoppeld');
}

function ingredientById(id) {
  return APP.ingredientsMap.get(id);
}

function recipeById(id) {
  return APP.recipesMap.get(id);
}

function settingsMap() {
  const map = {};
  (APP.data.menuSettings || []).forEach(r => { map[r.key] = r.value; });
  return map;
}

function shopData() {
  return APP.data.shop || {};
}

function allCategories() {
  const s = settingsMap().menu_categories || "Koffie, Thee, Chocolademelk, Donuts, Cupcakes, Kleine Snoepjes, Broodjes, Tosti's";
  return s.split(',').map(v => v.trim()).filter(Boolean);
}

function priceForLine(ingredient, amount) {
  const base = Number(ingredient?.pricePerProcessedPiece || ingredient?.price_per_processed_piece || 0);
  const fallback = Number(ingredient?.price || 0);
  return (base || fallback) * Number(amount || 0);
}

function caloriesForLine(ingredient, amount) {
  return Number(ingredient?.caloriesPerProcessedPiece || ingredient?.calories_per_processed_piece || 0) * Number(amount || 0);
}

function calculateRecipeCost(recipe) {
  return (recipe.ingredients || []).reduce((s, l) => s + priceForLine(ingredientById(l.id), l.amount), 0);
}

function calculateRecipeCalories(recipe) {
  return (recipe.ingredients || []).reduce((s, l) => s + caloriesForLine(ingredientById(l.id), l.amount), 0);
}

function targetCalories(productType) {
  if (productType === 'main') return 1000;
  if (productType === 'snack') return 400;
  return 600;
}

function foodCostPct(recipe) {
  const sell = Number(recipe.sellPrice || recipe.sell_price || 0);
  return sell ? calculateRecipeCost(recipe) / sell * 100 : 0;
}

function recipeStatus(recipe) {
  const missing = [];
  for (const line of (recipe.ingredients || [])) {
    const ing = ingredientById(line.id);
    if (!ing) missing.push(`Ontbrekend ingrediënt: ${line.id}`);
    else if (ing.active === false) missing.push(`${ing.name} staat inactief`);
  }
  if (missing.length) return { label: 'Niet haalbaar', cls: 'status-bad', lines: missing };
  const pct = foodCostPct(recipe);
  if (!pct) return { label: 'Controle nodig', cls: 'status-warn', lines: ['Geen kostprijs beschikbaar'] };
  return pct > 65
    ? { label: 'Dunne marge', cls: 'status-warn', lines: [`Food cost ${pct.toFixed(1)}%`] }
    : { label: 'Haalbaar', cls: 'status-ok', lines: [`Food cost ${pct.toFixed(1)}%`] };
}

function computeBoxPrice(box) {
  if (asBool(box.manualPrice || box.manual_price)) {
    return Number(box.price || box.manualPriceValue || box.manual_price_value || 0);
  }
  const sum = (box.items || []).reduce((s, id) => s + Number(recipeById(id)?.sellPrice || 0), 0);
  const pct = Number(box.discountPct || box.discount_value || 0);
  return Math.max(0, Math.round(sum * (1 - pct / 100)));
}

function groupedRecipes() {
  return (APP.data.recipes || [])
    .filter(r => asBool(r.active) && asBool(r.visibleOnMenu ?? r.visible_on_menu))
    .reduce((acc, r) => {
      const k = r.category || 'Overig';
      (acc[k] ||= []).push(r);
      return acc;
    }, {});
}

function navHref(key) {
  const inPagesFolder = APP.page !== 'dashboard';
  if (key === 'dashboard') return inPagesFolder ? '../index.html' : 'index.html';
  return inPagesFolder ? `${key}.html` : `pages/${key}.html`;
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const items = ['dashboard', 'ingredients', 'recipes', 'boxes', 'stock', 'menu', 'images', 'settings'];
  nav.innerHTML = items.map(key =>
    `<a class="nav-link ${APP.page === key ? 'active' : ''}" href="${navHref(key)}">${esc(PAGE_META[key].title)}</a>`
  ).join('');
}

function fillHeader() {
  renderNav();

  const logo = document.getElementById('brandLogo');
  const brandName = document.getElementById('brandName');
  const brandSub = document.getElementById('brandSub');
  const pageTitle = document.getElementById('pageTitle');
  const sidebarTitle = document.getElementById('sidebarTitle');
  const sidebarIntro = document.getElementById('sidebarIntro');
  const shop = shopData();

  if (logo) logo.innerHTML = shop.logo ? `<img src="${esc(resolveImage(shop.logo, false))}" alt="Logo">` : 'GH';
  if (brandName) brandName.textContent = shop.name || "'t Gezellig Hoekje";
  if (brandSub) brandSub.textContent = `${shop.subtitle || 'Koffiebar & Gebak'} · live koppeling`;
  if (pageTitle) pageTitle.textContent = PAGE_META[APP.page]?.title || 'Dashboard';
  if (sidebarTitle) sidebarTitle.textContent = PAGE_META[APP.page]?.title || 'Laden...';
  if (sidebarIntro) sidebarIntro.textContent = PAGE_META[APP.page]?.intro || 'Even geduld.';
}

function setSidebar(html) {
  const el = document.getElementById('sidebarContent');
  if (el) el.innerHTML = html;
}

function setWorkspace(html) {
  const el = document.getElementById('workspace');
  if (el) el.innerHTML = html;
}

function thumb(ref, recipeMode = false) {
  const src = resolveImage(ref, recipeMode);
  return src ? `<img class="thumb" src="${esc(src)}" alt="">` : '';
}

function generateUniqueIngredientId(name) {
  const base = slugify(name);
  if (!base) return `ingredient_${Date.now()}`;
  let candidate = base;
  let index = 2;

  while (APP.ingredientsMap.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

function generateUniqueRecipeId(name) {
  const base = slugify(name);
  if (!base) return `recipe_${Date.now()}`;
  let candidate = base;
  let index = 2;

  while (APP.recipesMap.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

function ingredientTypeOptions(current = 'raw') {
  return TYPE_OPTIONS.map(opt =>
    `<option value="${esc(opt.value)}" ${current === opt.value ? 'selected' : ''}>${esc(opt.label)}</option>`
  ).join('');
}

function productTypeOptions(current = 'drink') {
  return PRODUCT_TYPE_OPTIONS.map(opt =>
    `<option value="${esc(opt.value)}" ${current === opt.value ? 'selected' : ''}>${esc(opt.label)}</option>`
  ).join('');
}

function animationOptions(current = 'coffee') {
  return ANIMATION_OPTIONS.map(opt =>
    `<option value="${esc(opt)}" ${current === opt ? 'selected' : ''}>${esc(opt)}</option>`
  ).join('');
}

function imageSelect(id, scope, current = '') {
  const opts = (APP.data.images || [])
    .filter(i => !scope || i.scope === scope || i.scope === 'global')
    .map(i => `<option value="${esc(i.id)}" ${current === i.id ? 'selected' : ''}>${esc(i.name)}</option>`)
    .join('');
  return `<select id="${id}" name="image"><option value="">Geen</option>${opts}</select>`;
}

function renderDashboard() {
  const ingredients = APP.data.ingredients || [];
  const recipes = APP.data.recipes || [];
  const boxes = (APP.data.boxes || []).filter(b => asBool(b.active));
  const lowStock = ingredients.filter(i => Number(i.stock || 0) < Number(i.minStock || 0));
  const menuVisible = recipes.filter(r => asBool(r.visibleOnMenu ?? r.visible_on_menu));
  const menuHidden = recipes.filter(r => !asBool(r.visibleOnMenu ?? r.visible_on_menu));
  const grouped = groupedRecipes();

  const currentMenuHtml = allCategories().map(category => {
    const items = grouped[category] || [];
    return `
      <div class="dashboard-menu-section">
        <h4>${esc(category)}</h4>
        ${items.length
          ? items.map(r => `
            <div class="dashboard-menu-entry">
              <span>${esc(r.name)}</span>
              <strong>${money(r.sellPrice || r.sell_price)}</strong>
            </div>
          `).join('')
          : `<div class="muted small">Geen items</div>`
        }
      </div>
    `;
  }).join('');

  setWorkspace(`
    <div class="dashboard-grid">
      <div class="cards dashboard-stats">
        <div class="metric"><small>Ingrediënten</small><strong>${ingredients.length}</strong><span>Totaal in databron</span></div>
        <div class="metric"><small>Recepten</small><strong>${recipes.length}</strong><span>Totaal in databron</span></div>
        <div class="metric"><small>Toegevoegd aan menu</small><strong>${menuVisible.length}</strong><span>Zichtbaar op menukaart</span></div>
        <div class="metric"><small>Niet op menu</small><strong>${menuHidden.length}</strong><span>Verborgen recepten</span></div>
        <div class="metric"><small>Promo boxen</small><strong>${boxes.length}</strong><span>Actieve boxen</span></div>
        <div class="metric"><small>Stock tekorten</small><strong>${lowStock.length}</strong><span>Onder minimumstock</span></div>
      </div>

      <div class="dashboard-bottom">
        <div class="panel">
          <div class="panel-head"><h2>Stockwaarschuwingen</h2></div>
          <div class="panel-body stack">
            ${lowStock.length
              ? lowStock.map(i => `<div class="warnline">${esc(i.name)} onder minimumstock (${i.stock}/${i.minStock})</div>`).join('')
              : `<div class="okline">Geen stockwaarschuwingen.</div>`
            }
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Huidige menukaart</h2></div>
          <div class="panel-body">
            <div class="dashboard-menu-grid">${currentMenuHtml}</div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function renderIngredients() {
  const rows = [...(APP.data.ingredients || [])].sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuw ingrediënt</h3></div>
      <div class="panel-body">
        <form id="ingredientForm" class="form-grid">
          <div class="full"><label>Naam</label><input name="name" id="ingredientNameInput" required></div>
          <div><label>Code</label><input name="id" id="ingredientCodeInput" readonly placeholder="Wordt automatisch gegenereerd"></div>
          <div><label>Type</label><select name="type">${ingredientTypeOptions('raw')}</select></div>
          <div><label>Categorie</label><input name="category"></div>
          <div><label>Leverancier</label><select name="supplier"><option>supermarkt</option><option>groothandel</option><option>intern</option></select></div>
          <div><label>Eenheid</label><input name="unit" value="stuk"></div>
          <div><label>Prijs</label><input type="number" min="0" step="0.01" name="price" value="0"></div>
          <div><label>Stock</label><input type="number" min="0" step="1" name="stock" value="0"></div>
          <div><label>Minimumstock</label><input type="number" min="0" step="1" name="minStock" value="0"></div>
          <div><label>Cal. per gesneden stuk</label><input type="number" min="0" step="0.01" name="caloriesPerProcessedPiece" value="0"></div>
          <div><label>Aantal sneden / artikel</label><input type="number" min="0" step="1" name="processedYield" value="0"></div>
          <div><label>Prijs per gesneden stuk</label><input type="number" min="0" step="0.01" name="pricePerProcessedPiece" value="0"></div>
          <div><label>Gewicht per stuk in gram</label><input type="number" min="0" step="0.01" name="weightPerPieceG" value="0"></div>
          <div><label>Prijs per calorie</label><input type="number" min="0" step="0.0001" name="pricePerCalorie" value="0"></div>
          <div><label>Afbeelding</label>${imageSelect('ingredientImage', 'ingredient')}</div>
          <div class="full"><label>Notitie</label><textarea name="note"></textarea></div>
          <div class="full row"><button class="btn" type="submit">Opslaan</button><button class="btn secondary" type="button" id="ingredientResetBtn">Reset</button></div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Ingrediëntenoverzicht</h2><div class="pill">${rows.length} items</div></div>
      <div class="panel-body table-wrap">
        <table>
          <thead>
            <tr>
              <th>Afbeelding</th>
              <th>Naam</th>
              <th>Type</th>
              <th>Categorie</th>
              <th>Leverancier</th>
              <th>Prijs</th>
              <th>Cal/stuk</th>
              <th>Sneden</th>
              <th>Prijs/snede</th>
              <th>Stock</th>
              <th>Min</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(item => `
              <tr>
                <td>${thumb(item.image, false)}</td>
                <td>${esc(item.name)}</td>
                <td>${esc(typeLabel(item.type))}</td>
                <td>${esc(item.category)}</td>
                <td>${esc(item.supplier)}</td>
                <td>${money(item.price)}</td>
                <td>${Number(item.caloriesPerProcessedPiece || 0) || ''}</td>
                <td>${Number(item.processedYield || 0) || ''}</td>
                <td>${Number(item.pricePerProcessedPiece || 0) ? money(item.pricePerProcessedPiece) : ''}</td>
                <td class="${Number(item.stock || 0) < Number(item.minStock || 0) ? 'status-bad' : ''}">${item.stock}</td>
                <td>${item.minStock}</td>
                <td>
                  <div class="actions">
                    <button class="btn secondary" data-edit="${item.id}">Bewerk</button>
                    <button class="btn danger" data-delete="${item.id}">Verwijder</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `);

  const form = document.getElementById('ingredientForm');
  const nameInput = document.getElementById('ingredientNameInput');
  const codeInput = document.getElementById('ingredientCodeInput');

  function refreshAutoCode() {
    if (form.dataset.editingId) return;
    codeInput.value = generateUniqueIngredientId(nameInput.value.trim());
  }

  nameInput.addEventListener('input', refreshAutoCode);
  refreshAutoCode();

  form.onsubmit = saveIngredientForm;
  document.getElementById('ingredientResetBtn').onclick = () => renderIngredients();
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => fillIngredientForm(btn.dataset.edit));
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => deleteIngredient(btn.dataset.delete));
}

function fillIngredientForm(id) {
  const item = ingredientById(id);
  if (!item) return;

  const form = document.getElementById('ingredientForm');
  ['name', 'id', 'category', 'supplier', 'unit', 'price', 'stock'].forEach(k => form.elements[k].value = item[k] ?? '');
  form.elements.type.innerHTML = ingredientTypeOptions(item.type || 'raw');
  form.elements.minStock.value = item.minStock ?? 0;
  form.elements.caloriesPerProcessedPiece.value = item.caloriesPerProcessedPiece ?? 0;
  form.elements.processedYield.value = item.processedYield ?? 0;
  form.elements.pricePerProcessedPiece.value = item.pricePerProcessedPiece ?? 0;
  form.elements.weightPerPieceG.value = item.weightPerPieceG ?? 0;
  form.elements.pricePerCalorie.value = item.pricePerCalorie ?? 0;
  form.elements.note.value = item.note ?? '';
  document.getElementById('ingredientImage').value = item.image || '';
  form.dataset.editingId = item.id;
}

async function saveIngredientForm(e) {
  e.preventDefault();
  const form = e.currentTarget;

  const generatedId = form.dataset.editingId || generateUniqueIngredientId(form.elements.name.value.trim());

  const data = {
    id: generatedId,
    name: form.elements.name.value.trim(),
    type: form.elements.type.value,
    category: form.elements.category.value.trim(),
    supplier: form.elements.supplier.value,
    unit: form.elements.unit.value.trim() || 'stuk',
    price: Number(form.elements.price.value || 0),
    stock: Number(form.elements.stock.value || 0),
    minStock: Number(form.elements.minStock.value || 0),
    caloriesPerProcessedPiece: Number(form.elements.caloriesPerProcessedPiece.value || 0),
    processedYield: Number(form.elements.processedYield.value || 0),
    pricePerProcessedPiece: Number(form.elements.pricePerProcessedPiece.value || 0),
    weightPerPieceG: Number(form.elements.weightPerPieceG.value || 0),
    pricePerCalorie: Number(form.elements.pricePerCalorie.value || 0),
    note: form.elements.note.value.trim(),
    image: document.getElementById('ingredientImage').value,
    active: true
  };

  await apiPost('ingredients.save', data);
  await loadAllData();
  renderIngredients();
}

async function deleteIngredient(id) {
  if (!confirm('Ingrediënt verwijderen?')) return;
  await apiPost('ingredients.delete', { id });
  await loadAllData();
  renderIngredients();
}

function recipeIngredientOptions(productType, current = '') {
  const isDrink = productType === 'drink';
  return (APP.data.ingredients || [])
    .filter(i => !isDrink || DRINK_ALLOWED.has(i.category) || i.type === 'condiment')
    .map(i => `<option value="${esc(i.id)}" ${current === i.id ? 'selected' : ''}>${esc(i.name)}</option>`)
    .join('');
}

function recipeLine(prefill = {}, productType = 'drink') {
  return `
    <div class="recipe-line">
      <div><select class="recipeIngSelect">${recipeIngredientOptions(productType, prefill.id)}</select></div>
      <div><input class="recipeIngAmount" type="number" min="1" step="1" value="${Number(prefill.amount || 1)}"></div>
      <div><button class="btn secondary removeRecipeLine" type="button" style="width:auto;">X</button></div>
    </div>
  `;
}

function bindRecipeLineEvents() {
  document.querySelectorAll('.removeRecipeLine').forEach(b => b.onclick = () => {
    b.closest('.recipe-line').remove();
    updateRecipeComputed();
  });
  document.querySelectorAll('.recipeIngSelect,.recipeIngAmount').forEach(el => el.oninput = updateRecipeComputed);
}

function addRecipeLine(prefill = {}) {
  const wrap = document.getElementById('recipeLines');
  if (!wrap) return;
  const productType = document.getElementById('recipeType')?.value || 'drink';
  wrap.insertAdjacentHTML('beforeend', recipeLine(prefill, productType));
  bindRecipeLineEvents();
  updateRecipeComputed();
}

function updateRecipeSelectOptions() {
  const type = document.getElementById('recipeType')?.value || 'drink';
  document.querySelectorAll('.recipeIngSelect').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = recipeIngredientOptions(type, current);
    if (![...sel.options].some(o => o.value === current)) sel.value = sel.options[0]?.value || '';
  });
  updateRecipeComputed();
}

function updateRecipeComputed() {
  const lines = [...document.querySelectorAll('#recipeLines .recipe-line')].map(row => ({
    id: row.querySelector('.recipeIngSelect').value,
    amount: Number(row.querySelector('.recipeIngAmount').value || 0)
  }));

  const temp = {
    ingredients: lines,
    sellPrice: Number(document.getElementById('recipePrice')?.value || 0),
    productType: document.getElementById('recipeType')?.value || 'drink'
  };

  const calc = calculateRecipeCalories(temp);
  const target = targetCalories(temp.productType);
  const cost = calculateRecipeCost(temp);

  const out = document.getElementById('recipeComputed');
  if (out) {
    out.innerHTML = `
      <div class="item-card">
        <strong>Calorievergelijking</strong>
        <div class="small muted">${calc.toFixed(0)} / ${target}</div>
      </div>
      <div class="item-card">
        <strong>Kostprijs</strong>
        <div class="small muted">${money(cost)}</div>
      </div>
    `;
  }
}

function renderRecipes() {
  const rows = [...(APP.data.recipes || [])].sort((a, b) =>
    (a.category || '').localeCompare(b.category || '', 'nl') || a.name.localeCompare(b.name, 'nl')
  );

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuw recept</h3></div>
      <div class="panel-body stack">
        <form id="recipeForm" class="stack">
          <div class="form-grid">
            <div class="full">
              <label>Naam</label>
              <input name="name" id="recipeNameInput" required>
            </div>

            <div>
              <label>Code</label>
              <input name="id" id="recipeCodeInput" readonly placeholder="Wordt automatisch gegenereerd">
            </div>

            <div>
              <label>Subtitel</label>
              <input name="sub">
            </div>

            <div>
              <label>Categorie</label>
              <input name="category" placeholder="bv. Koffie, Tosti's, Thee">
            </div>

            <div>
              <label>Type</label>
              <select id="recipeType" name="productType">${productTypeOptions('drink')}</select>
            </div>

            <div>
              <label>Station</label>
              <select name="station">
                <option value="drankje maken">Drankje maken</option>
                <option value="eten maken">Eten maken</option>
              </select>
            </div>

            <div>
              <label>Animatie</label>
              <select name="animation">${animationOptions('coffee')}</select>
            </div>

            <div>
              <label>Verkoopprijs</label>
              <input id="recipePrice" type="number" min="0" step="0.01" name="sellPrice" value="0">
            </div>

            <div>
              <label>Afbeelding</label>
              ${imageSelect('recipeImage', 'recipe')}
            </div>

            <div class="full row wrap">
              <label class="row" style="width:auto;">
                <input type="checkbox" name="visibleOnMenu" checked style="width:auto;">
                zichtbaar op menukaart
              </label>
              <label class="row" style="width:auto;">
                <input type="checkbox" name="active" checked style="width:auto;">
                actief
              </label>
            </div>
          </div>

          <div>
            <label>Ingrediënten</label>
            <div id="recipeLines" class="stack"></div>
            <div class="row" style="margin-top:8px;">
              <button class="btn secondary" type="button" id="addRecipeLineBtn">Ingrediëntregel toevoegen</button>
            </div>
            <div class="hint">
              Dranken tonen enkel drank-/fruit-/groente-/zuivel-/toppingingrediënten.
              Hapjes en hoofdgerechten tonen de volledige ingrediëntenlijst.
            </div>
          </div>

          <div id="recipeComputed" class="grid-2"></div>

          <div class="row">
            <button class="btn" type="submit">Opslaan</button>
            <button class="btn secondary" type="button" id="recipeResetBtn">Reset</button>
          </div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Receptenoverzicht</h2><div class="pill">${rows.length} recepten</div></div>
      <div class="panel-body stack">
        ${rows.length ? rows.map(r => {
          const st = recipeStatus(r);
          const calc = calculateRecipeCalories(r);
          const target = targetCalories(r.productType || r.product_type);
          return `
            <div class="item-card">
              <div class="row wrap" style="justify-content:space-between; align-items:flex-start;">
                <div class="row">
                  ${thumb(r.image, true)}
                  <div>
                    <h4>${esc(r.name)}</h4>
                    <div class="muted small">${esc(r.sub || r.subtitle || '')}</div>
                  </div>
                </div>
                <div class="actions">
                  <button class="btn secondary" data-recipe-edit="${r.id}">Bewerk</button>
                  <button class="btn danger" data-recipe-delete="${r.id}">Verwijder</button>
                </div>
              </div>
              <div class="item-meta">
                <span>${esc(r.category || '')}</span>
                <span>${esc(productTypeLabel(r.productType || r.product_type || ''))}</span>
                <span>${asBool(r.visibleOnMenu ?? r.visible_on_menu) ? 'Op kaart' : 'Verborgen'}</span>
                <span>${asBool(r.active) ? 'Actief' : 'Inactief'}</span>
                <span>${money(r.sellPrice || r.sell_price)}</span>
                <span>${money(calculateRecipeCost(r))}</span>
                <span>${calc.toFixed(0)} / ${target} cal</span>
                <span class="${st.cls}">${esc(st.label)}</span>
              </div>
              <div class="footer-note">
                Ingrediënten:
                ${(r.ingredients || []).map(l => `${esc(ingredientById(l.id)?.name || l.id)} × ${l.amount}`).join(', ')}
              </div>
            </div>
          `;
        }).join('') : `<div class="item-card muted">Nog geen recepten gevonden.</div>`}
      </div>
    </div>
  `);

  const form = document.getElementById('recipeForm');
  const nameInput = document.getElementById('recipeNameInput');
  const codeInput = document.getElementById('recipeCodeInput');

  function refreshRecipeCode() {
    if (form.dataset.editingId) return;
    codeInput.value = generateUniqueRecipeId(nameInput.value.trim());
  }

  nameInput.addEventListener('input', refreshRecipeCode);
  refreshRecipeCode();

  form.onsubmit = saveRecipeForm;
  document.getElementById('addRecipeLineBtn').onclick = () => addRecipeLine({});
  document.getElementById('recipeType').onchange = updateRecipeSelectOptions;
  document.getElementById('recipePrice').oninput = updateRecipeComputed;
  document.getElementById('recipeResetBtn').onclick = () => renderRecipes();

  addRecipeLine({});

  document.querySelectorAll('[data-recipe-edit]').forEach(btn => {
    btn.onclick = () => fillRecipeForm(btn.dataset.recipeEdit);
  });

  document.querySelectorAll('[data-recipe-delete]').forEach(btn => {
    btn.onclick = () => deleteRecipe(btn.dataset.recipeDelete);
  });
}

function fillRecipeForm(id) {
  const r = recipeById(id);
  if (!r) return;

  const form = document.getElementById('recipeForm');
  form.dataset.editingId = r.id;
  form.elements.name.value = r.name || '';
  form.elements.id.value = r.id || '';
  form.elements.sub.value = r.sub || r.subtitle || '';
  form.elements.category.value = r.category || '';
  form.elements.productType.value = r.productType || r.product_type || 'drink';
  form.elements.station.value = r.station || 'drankje maken';
  form.elements.animation.value = r.animation || 'coffee';
  form.elements.sellPrice.value = r.sellPrice || r.sell_price || 0;
  form.elements.visibleOnMenu.checked = asBool(r.visibleOnMenu ?? r.visible_on_menu);
  form.elements.active.checked = asBool(r.active);
  document.getElementById('recipeImage').value = r.image || '';

  document.getElementById('recipeLines').innerHTML = '';
  (r.ingredients || []).forEach(l => addRecipeLine(l));
  updateRecipeSelectOptions();
  updateRecipeComputed();
}

async function saveRecipeForm(e) {
  e.preventDefault();
  const form = e.currentTarget;

  const ingredients = [...document.querySelectorAll('#recipeLines .recipe-line')]
    .map(row => ({
      id: row.querySelector('.recipeIngSelect').value,
      amount: Number(row.querySelector('.recipeIngAmount').value || 0)
    }))
    .filter(l => l.id && l.amount > 0);

  const data = {
    id: form.dataset.editingId || generateUniqueRecipeId(form.elements.name.value.trim()),
    name: form.elements.name.value.trim(),
    sub: form.elements.sub.value.trim(),
    category: form.elements.category.value.trim(),
    productType: form.elements.productType.value,
    station: form.elements.station.value,
    animation: form.elements.animation.value,
    sellPrice: Number(form.elements.sellPrice.value || 0),
    calories: Number(calculateRecipeCalories({ ingredients }).toFixed(0)),
    visibleOnMenu: form.elements.visibleOnMenu.checked,
    active: form.elements.active.checked,
    image: document.getElementById('recipeImage').value,
    ingredients
  };

  await apiPost('recipes.save', data);
  await loadAllData();
  renderRecipes();
}

async function deleteRecipe(id) {
  if (!confirm('Recept verwijderen?')) return;
  await apiPost('recipes.delete', { id });
  await loadAllData();
  renderRecipes();
}

function renderBoxes() {
  setWorkspace(`<div class="panel"><div class="panel-body">Boxenpagina blijft ongewijzigd.</div></div>`);
}

function renderStock() {
  setWorkspace(`<div class="panel"><div class="panel-body">Stockpagina blijft ongewijzigd.</div></div>`);
}

function renderMenu() {
  setWorkspace(`<div class="panel"><div class="panel-body">Menupagina blijft ongewijzigd.</div></div>`);
}

function renderImages() {
  setWorkspace(`<div class="panel"><div class="panel-body">Afbeeldingenpagina blijft ongewijzigd.</div></div>`);
}

function renderSettings() {
  setWorkspace(`<div class="panel"><div class="panel-body">Instellingenpagina blijft ongewijzigd.</div></div>`);
}

async function renderPage() {
  fillHeader();

  if (APP.page === 'dashboard') renderDashboard();
  if (APP.page === 'ingredients') renderIngredients();
  if (APP.page === 'recipes') renderRecipes();
  if (APP.page === 'boxes') renderBoxes();
  if (APP.page === 'stock') renderStock();
  if (APP.page === 'menu') renderMenu();
  if (APP.page === 'images') renderImages();
  if (APP.page === 'settings') renderSettings();
}

async function init() {
  try {
    await loadAllData();
    await renderPage();
  } catch (err) {
    setStatusBadge(false);
    setLiveStatus('bad', 'Verbinding mislukt');
    setWorkspace(`
      <div class="panel">
        <div class="panel-head"><h2>API-fout</h2></div>
        <div class="panel-body">
          <p>De frontend kon geen live data laden.</p>
          <div class="badline">${esc(err.message)}</div>
        </div>
      </div>
    `);
  }
}

document.addEventListener('DOMContentLoaded', init);
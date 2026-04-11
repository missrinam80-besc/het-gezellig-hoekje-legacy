window.GEZELLIG_CONFIG = Object.assign({
  API_URL: 'https://script.google.com/macros/s/AKfycbwhrWNby9HVYPx-e01-eBPAOsRZbQfJtIgtcyHpPEP-q5Vo8eG28N4GB4OQSMwI6Ygq7A/exec',
  IMAGE_BASE: 'assets/images/raw',
  RECIPE_IMAGE_BASE: 'assets/images/recepies'
}, window.GEZELLIG_CONFIG || {});

const APP = {
  page: document.body.dataset.page || 'dashboard',
  data: null,
  ingredientsMap: new Map(),
  processedMap: new Map(),
  recipesMap: new Map(),
  imagesMap: new Map(),
  stockLogs: []
};

const PAGE_META = {
  dashboard: { title: 'Dashboard', intro: '' },
  ingredients: { title: 'Ingrediënten', intro: 'Beheer grondstoffen, prijsgegevens en afbeeldingen.' },
  processed: { title: 'Verwerkte producten', intro: 'Maak tussenproducten op basis van grondstoffen of andere verwerkte items.' },
  recipes: { title: 'Recepten', intro: 'Maak recepten, bereken calorieën, kostprijs en winst, en bepaal of ze zichtbaar zijn op de menukaart.' },
  boxes: { title: 'Boxen', intro: 'Stel boxen samen op basis van bestaande recepten en bereken automatisch verkoopprijs en winst.' },
  stock: { title: 'Stock & Winkellijst', intro: 'Werk met een vaste dagplanning, bereken inkopen en bekijk de verwachte winst.' },
  menu: { title: 'Menukaarten', intro: 'Stel je menukaart visueel samen en genereer een poster in 1920×1080.' },
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



const WRITE_TOKEN_KEY = 'gezellig_admin_token';

function getWriteToken() {
  try {
    return window.localStorage.getItem(WRITE_TOKEN_KEY) || '';
  } catch (err) {
    return '';
  }
}

function promptWriteToken(message = 'Voer de admin token in.') {
  const current = getWriteToken();
  const next = window.prompt(message, current);
  if (next === null) return current;
  const cleaned = String(next || '').trim();
  if (!cleaned) return current;
  try {
    window.localStorage.setItem(WRITE_TOKEN_KEY, cleaned);
  } catch (err) {
    console.warn('Kon token niet bewaren in localStorage.', err);
  }
  return cleaned;
}

function clearWriteToken() {
  try {
    window.localStorage.removeItem(WRITE_TOKEN_KEY);
  } catch (err) {
    console.warn('Kon token niet wissen uit localStorage.', err);
  }
}

function ensureWriteToken() {
  const token = getWriteToken() || promptWriteToken('Voer de admin token in om wijzigingen op te slaan.');
  if (!token) throw new Error('Geen admin token ingesteld. Stel eerst een token in op de pagina Shopinstellingen.');
  return token;
}

const PRODUCT_TYPE_OPTIONS = [
  { value: 'drink', label: 'Drankje' },
  { value: 'snack', label: 'Hapje' },
  { value: 'main', label: 'Hoofdgerecht' }
];

const ANIMATION_OPTIONS = ['coffee', 'cup', 'sandwich', 'donut', 'bagel', 'dinner', 'burger'];

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
  const token = ensureWriteToken();
  if (!url || url.includes('PASTE_HIER')) throw new Error('API_URL is nog niet ingevuld in assets/app.js');

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
  APP.processedMap = new Map((APP.data.processedProducts || []).map(i => [i.id, i]));
  APP.recipesMap = new Map((APP.data.recipes || []).map(r => [r.id, r]));
  APP.imagesMap = new Map((APP.data.images || []).map(i => [i.id, i]));
  APP.stockLogs = APP.data.stockLogs || [];
  fillHeader();
  setStatusBadge(true);
  setLiveStatus('ok', 'Live gekoppeld');
}

function ingredientById(id) {
  return APP.ingredientsMap.get(id);
}

function processedProductById(id) {
  return APP.processedMap.get(id);
}

function catalogItemById(id) {
  return ingredientById(id) || processedProductById(id) || null;
}

function itemDisplayName(id) {
  return catalogItemById(id)?.name || id;
}

function isProcessedId(id) {
  return APP.processedMap.has(id);
}

function safeNumber(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function collectReferences() {
  const refs = {
    ingredients: new Map(),
    processedProducts: new Map(),
    recipes: new Map(),
    images: new Map()
  };

  const pushRef = (map, id, label) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(label);
  };

  (APP.data.processedProducts || []).forEach(item => {
    pushRef(refs.ingredients, item.sourceItem1, `Verwerkt product: ${item.name}`);
    pushRef(refs.ingredients, item.sourceItem2, `Verwerkt product: ${item.name}`);
    pushRef(refs.processedProducts, item.sourceItem1, `Verwerkt product: ${item.name}`);
    pushRef(refs.processedProducts, item.sourceItem2, `Verwerkt product: ${item.name}`);
  });

  (APP.data.recipes || []).forEach(recipe => {
    (recipe.ingredients || []).forEach(line => {
      pushRef(refs.ingredients, line.id, `Recept: ${recipe.name}`);
      pushRef(refs.processedProducts, line.id, `Recept: ${recipe.name}`);
    });
  });

  (APP.data.boxes || []).forEach(box => {
    (box.items || []).forEach(id => pushRef(refs.recipes, id, `Box: ${box.name}`));
  });

  const imageSlots = [
    ...(APP.data.ingredients || []).map(i => ({ image: i.image, label: `Ingrediënt: ${i.name}` })),
    ...(APP.data.recipes || []).map(i => ({ image: i.image, label: `Recept: ${i.name}` })),
    ...(APP.data.boxes || []).map(i => ({ image: i.image, label: `Box: ${i.name}` })),
    ...(APP.data.menuSettings || [])
      .filter(row => ['menu_logo_image', 'menu_background_image'].includes(row.key))
      .map(row => ({ image: row.value, label: row.key === 'menu_logo_image' ? 'Shoplogo' : 'Menuachtergrond' }))
  ];
  imageSlots.forEach(slot => pushRef(refs.images, slot.image, slot.label));

  return refs;
}

function dependencySummary(kind, id) {
  const refs = collectReferences();
  return refs[kind]?.get(id) || [];
}

function ensureRemovable(kind, id, label) {
  const refs = dependencySummary(kind, id);
  if (!refs.length) return true;
  alert(`${label} kan niet verwijderd worden omdat dit nog in gebruik is:\n\n- ${refs.join('\n- ')}`);
  return false;
}

function showError(err, fallback = 'Er liep iets mis.') {
  alert(`${fallback}\n\n${err?.message || err || 'Onbekende fout'}`);
}


function unitMetrics(itemId, stack = new Set()) {
  const raw = ingredientById(itemId);
  if (raw) {
    return {
      cost: priceForLine(raw, 1),
      calories: caloriesForLine(raw, 1),
      rawNeeds: new Map([[itemId, 1]]),
      missing: []
    };
  }

  const processed = processedProductById(itemId);
  if (!processed) {
    return { cost: 0, calories: 0, rawNeeds: new Map(), missing: [`Ontbrekend item: ${itemId}`] };
  }

  if (stack.has(itemId)) {
    return { cost: 0, calories: 0, rawNeeds: new Map(), missing: [`Circulaire verwerking: ${itemId}`] };
  }

  const nextStack = new Set(stack);
  nextStack.add(itemId);

  const yieldAmount = Math.max(1, safeNumber(processed.yield));
  const sources = [
    { id: processed.sourceItem1 || processed.source_item_1, amount: processed.sourceAmount1 || processed.source_amount_1 },
    { id: processed.sourceItem2 || processed.source_item_2, amount: processed.sourceAmount2 || processed.source_amount_2 }
  ].filter(s => s.id && safeNumber(s.amount) > 0);

  if (!sources.length) {
    return { cost: 0, calories: 0, rawNeeds: new Map(), missing: [`Geen bron ingesteld voor ${processed.name || itemId}`] };
  }

  let cost = 0;
  let calories = 0;
  const rawNeeds = new Map();
  const missing = [];

  for (const source of sources) {
    const sourceMetrics = unitMetrics(source.id, nextStack);
    const multiplier = safeNumber(source.amount) / yieldAmount;
    cost += sourceMetrics.cost * multiplier;
    calories += sourceMetrics.calories * multiplier;
    sourceMetrics.rawNeeds.forEach((value, key) => rawNeeds.set(key, (rawNeeds.get(key) || 0) + value * multiplier));
    missing.push(...sourceMetrics.missing);
  }

  return { cost, calories, rawNeeds, missing };
}

function recipeRawNeeds(recipe, qty = 1) {
  const needs = new Map();
  const missing = [];
  (recipe.ingredients || []).forEach(line => {
    const metrics = unitMetrics(line.id);
    const multiplier = safeNumber(line.amount) * safeNumber(qty);
    metrics.rawNeeds.forEach((value, key) => needs.set(key, (needs.get(key) || 0) + value * multiplier));
    missing.push(...metrics.missing);
  });
  return { needs, missing };
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
  const s = settingsMap();
  return {
    name: s.brand_name || "'t Gezellig Hoekje",
    subtitle: s.subtitle || 'Koffiebar & Gebak',
    tagline: s.tagline || '',
    logo: s.menu_logo_image || ''
  };
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
  return (recipe.ingredients || []).reduce((sum, line) => sum + unitMetrics(line.id).cost * safeNumber(line.amount), 0);
}

function calculateRecipeCalories(recipe) {
  return (recipe.ingredients || []).reduce((sum, line) => sum + unitMetrics(line.id).calories * safeNumber(line.amount), 0);
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
    const item = catalogItemById(line.id);
    if (!item) {
      missing.push(`Ontbrekend item: ${line.id}`);
      continue;
    }
    if (item.active === false) missing.push(`${item.name} staat inactief`);
    missing.push(...unitMetrics(line.id).missing);
  }
  if (missing.length) return { label: 'Niet haalbaar', cls: 'status-bad', lines: [...new Set(missing)] };
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
  const sum = (box.items || []).reduce((s, id) => s + Number(recipeById(id)?.sellPrice || recipeById(id)?.sell_price || 0), 0);
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
  const items = ['dashboard', 'ingredients', 'processed', 'recipes', 'boxes', 'stock', 'menu', 'images', 'settings'];
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

  if (sidebarTitle) sidebarTitle.textContent = PAGE_META[APP.page]?.title || '';
  if (sidebarIntro) sidebarIntro.textContent = PAGE_META[APP.page]?.intro || '';
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
              ? lowStock.map(i => `
                <div class="warnline warnline-flex">
                  <span>${esc(i.name)} onder minimumstock (${i.stock}/${i.minStock})</span>
                  ${Number(i.stock || 0) < 5 ? '<span class="urgent-badge">DRINGEND</span>' : ''}
                </div>
              `).join('')
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

  try {
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
  } catch (err) {
    showError(err, 'Ingrediënt kon niet opgeslagen worden.');
  }
}

async function deleteIngredient(id) {
  if (!ensureRemovable('ingredients', id, 'Dit ingrediënt')) return;
  if (!confirm('Ingrediënt verwijderen?')) return;
  try {
    await apiPost('ingredients.delete', { id });
    await loadAllData();
    renderIngredients();
  } catch (err) {
    showError(err, 'Ingrediënt kon niet verwijderd worden.');
  }
}



function processedSourceOptions(current = '') {
  const rawOptions = (APP.data.ingredients || [])
    .filter(i => i.active !== false)
    .map(i => `<option value="${esc(i.id)}" ${current === i.id ? 'selected' : ''}>${esc(i.name)} · grondstof</option>`)
    .join('');
  const processedOptions = (APP.data.processedProducts || [])
    .filter(i => i.active !== false)
    .map(i => `<option value="${esc(i.id)}" ${current === i.id ? 'selected' : ''}>${esc(i.name)} · verwerkt</option>`)
    .join('');
  return `<option value="">Geen</option>${rawOptions ? `<optgroup label="Grondstoffen">${rawOptions}</optgroup>` : ''}${processedOptions ? `<optgroup label="Verwerkte producten">${processedOptions}</optgroup>` : ''}`;
}

function renderProcessedProducts() {
  const rows = [...(APP.data.processedProducts || [])].sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuw verwerkt product</h3></div>
      <div class="panel-body">
        <form id="processedForm" class="form-grid">
          <div class="full"><label>Naam</label><input name="name" id="processedNameInput" required></div>
          <div><label>Code</label><input name="id" id="processedCodeInput" readonly placeholder="Wordt automatisch gegenereerd"></div>
          <div><label>Proces type</label><input name="processType" placeholder="snijden, persen, mixen..."></div>
          <div><label>Bron 1</label><select id="processedSource1">${processedSourceOptions('')}</select></div>
          <div><label>Aantal bron 1</label><input type="number" min="0" step="0.01" name="sourceAmount1" value="1"></div>
          <div><label>Bron 2</label><select id="processedSource2">${processedSourceOptions('')}</select></div>
          <div><label>Aantal bron 2</label><input type="number" min="0" step="0.01" name="sourceAmount2" value="0"></div>
          <div><label>Yield</label><input type="number" min="1" step="0.01" name="yield" value="1"></div>
          <div><label>Eenheid</label><input name="unit" value="stuk"></div>
          <div class="full"><label>Notitie</label><textarea name="notes"></textarea></div>
          <div class="full row wrap">
            <label class="row" style="width:auto;"><input type="checkbox" name="active" checked style="width:auto;"> actief</label>
          </div>
          <div class="full row"><button class="btn" type="submit">Opslaan</button><button class="btn secondary" type="button" id="processedResetBtn">Reset</button></div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Verwerkte producten</h2><div class="pill">${rows.length} items</div></div>
      <div class="panel-body table-wrap">
        <table>
          <thead>
            <tr>
              <th>Naam</th>
              <th>Proces</th>
              <th>Bronnen</th>
              <th>Yield</th>
              <th>Eenheid</th>
              <th>Kost / eenheid</th>
              <th>Cal / eenheid</th>
              <th>Status</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(item => {
              const metrics = unitMetrics(item.id);
              const refs = dependencySummary('processedProducts', item.id);
              return `
                <tr>
                  <td>${esc(item.name)}</td>
                  <td>${esc(item.processType || '')}</td>
                  <td>
                    ${item.sourceItem1 ? `${esc(itemDisplayName(item.sourceItem1))} × ${safeNumber(item.sourceAmount1)}` : ''}
                    ${item.sourceItem2 ? `<br>${esc(itemDisplayName(item.sourceItem2))} × ${safeNumber(item.sourceAmount2)}` : ''}
                  </td>
                  <td>${safeNumber(item.yield)}</td>
                  <td>${esc(item.unit || '')}</td>
                  <td>${money(metrics.cost)}</td>
                  <td>${metrics.calories.toFixed(0)}</td>
                  <td class="${item.active === false ? 'status-bad' : 'status-ok'}">${item.active === false ? 'Inactief' : 'Actief'}${refs.length ? `<div class="small muted">${refs.length} koppelingen</div>` : ''}</td>
                  <td>
                    <div class="actions">
                      <button class="btn secondary" data-processed-edit="${item.id}">Bewerk</button>
                      <button class="btn danger" data-processed-delete="${item.id}">Verwijder</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `);

  const form = document.getElementById('processedForm');
  const nameInput = document.getElementById('processedNameInput');
  const codeInput = document.getElementById('processedCodeInput');
  const refreshAutoCode = () => {
    if (form.dataset.editingId) return;
    let candidate = slugify(nameInput.value.trim()) || `processed_${Date.now()}`;
    let i = 2;
    while (APP.processedMap.has(candidate)) {
      candidate = `${slugify(nameInput.value.trim()) || 'processed'}_${i}`;
      i += 1;
    }
    codeInput.value = candidate;
  };
  nameInput.addEventListener('input', refreshAutoCode);
  refreshAutoCode();

  form.onsubmit = saveProcessedForm;
  document.getElementById('processedResetBtn').onclick = () => renderProcessedProducts();
  document.querySelectorAll('[data-processed-edit]').forEach(btn => btn.onclick = () => fillProcessedForm(btn.dataset.processedEdit));
  document.querySelectorAll('[data-processed-delete]').forEach(btn => btn.onclick = () => deleteProcessedProduct(btn.dataset.processedDelete));
}

function fillProcessedForm(id) {
  const item = processedProductById(id);
  if (!item) return;
  const form = document.getElementById('processedForm');
  form.dataset.editingId = item.id;
  form.elements.name.value = item.name || '';
  form.elements.id.value = item.id || '';
  form.elements.processType.value = item.processType || '';
  form.elements.sourceAmount1.value = safeNumber(item.sourceAmount1);
  form.elements.sourceAmount2.value = safeNumber(item.sourceAmount2);
  form.elements.yield.value = safeNumber(item.yield || 1);
  form.elements.unit.value = item.unit || 'stuk';
  form.elements.notes.value = item.notes || '';
  form.elements.active.checked = item.active !== false;
  document.getElementById('processedSource1').innerHTML = processedSourceOptions(item.sourceItem1 || '');
  document.getElementById('processedSource2').innerHTML = processedSourceOptions(item.sourceItem2 || '');
}

async function saveProcessedForm(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const id = form.dataset.editingId || (document.getElementById('processedCodeInput').value || slugify(form.elements.name.value.trim()));
  const sourceItem1 = document.getElementById('processedSource1').value;
  const sourceItem2 = document.getElementById('processedSource2').value;
  if (!sourceItem1) return alert('Bron 1 is verplicht.');
  if (sourceItem1 === id || sourceItem2 === id) return alert('Een verwerkt product kan zichzelf niet als bron gebruiken.');

  try {
    await apiPost('processed_products.save', {
      id,
      name: form.elements.name.value.trim(),
      processType: form.elements.processType.value.trim(),
      sourceItem1,
      sourceAmount1: Number(form.elements.sourceAmount1.value || 0),
      sourceItem2,
      sourceAmount2: Number(form.elements.sourceAmount2.value || 0),
      yield: Number(form.elements.yield.value || 1),
      unit: form.elements.unit.value.trim() || 'stuk',
      notes: form.elements.notes.value.trim(),
      active: form.elements.active.checked
    });
    await loadAllData();
    renderProcessedProducts();
  } catch (err) {
    showError(err, 'Verwerkt product kon niet opgeslagen worden.');
  }
}

async function deleteProcessedProduct(id) {
  if (!ensureRemovable('processedProducts', id, 'Dit verwerkte product')) return;
  if (!confirm('Verwerkt product verwijderen?')) return;
  try {
    await apiPost('processed_products.delete', { id });
    await loadAllData();
    renderProcessedProducts();
  } catch (err) {
    showError(err, 'Verwerkt product kon niet verwijderd worden.');
  }
}

function recipeIngredientOptions(_productType, current = '') {
  const ingredientOptions = (APP.data.ingredients || [])
    .filter(i => i.active !== false)
    .map(i => `<option value="${esc(i.id)}" ${current === i.id ? 'selected' : ''}>${esc(i.name)}</option>`);

  const processedOptions = (APP.data.processedProducts || [])
    .filter(i => i.active !== false)
    .map(i => `<option value="${esc(i.id)}" ${current === i.id ? 'selected' : ''}>${esc(i.name)} · verwerkt</option>`);

  return [
    ingredientOptions.length ? `<optgroup label="Grondstoffen">${ingredientOptions.join('')}</optgroup>` : '',
    processedOptions.length ? `<optgroup label="Verwerkte producten">${processedOptions.join('')}</optgroup>` : ''
  ].join('');
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
  const profit = Number(temp.sellPrice || 0) - cost;

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
      <div class="item-card">
        <strong>Winst</strong>
        <div class="small ${profit >= 0 ? 'status-ok' : 'status-bad'}">${money(profit)}</div>
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
            <div class="full"><label>Naam</label><input name="name" id="recipeNameInput" required></div>
            <div><label>Code</label><input name="id" id="recipeCodeInput" readonly placeholder="Wordt automatisch gegenereerd"></div>
            <div><label>Subtitel</label><input name="sub"></div>
            <div><label>Categorie</label><input name="category"></div>
            <div><label>Type</label><select id="recipeType" name="productType">${productTypeOptions('drink')}</select></div>
            <div><label>Station</label><select name="station"><option value="drankje maken">Drankje maken</option><option value="eten maken">Eten maken</option></select></div>
            <div><label>Animatie</label><select name="animation">${animationOptions('coffee')}</select></div>
            <div><label>Verkoopprijs</label><input id="recipePrice" type="number" min="0" step="0.01" name="sellPrice" value="0"></div>
            <div><label>Afbeelding</label>${imageSelect('recipeImage', 'recipe')}</div>
            <div class="full row wrap">
              <label class="row" style="width:auto;"><input type="checkbox" name="visibleOnMenu" checked style="width:auto;"> zichtbaar op menukaart</label>
              <label class="row" style="width:auto;"><input type="checkbox" name="active" checked style="width:auto;"> actief</label>
            </div>
          </div>

          <div>
            <label>Ingrediënten</label>
            <div id="recipeLines" class="stack"></div>
            <div class="row" style="margin-top:8px;"><button class="btn secondary" type="button" id="addRecipeLineBtn">Ingrediëntregel toevoegen</button></div>
          </div>

          <div id="recipeComputed" class="grid-3"></div>

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
          const profit = recipeProfit(r);
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
                <span>${money(r.sellPrice || r.sell_price)}</span>
                <span>${money(calculateRecipeCost(r))}</span>
                <span class="${profit >= 0 ? 'status-ok' : 'status-bad'}">Winst ${money(profit)}</span>
                <span>${calc.toFixed(0)} / ${target} cal</span>
                <span class="${st.cls}">${esc(st.label)}</span>
              </div>
              <div class="footer-note">Ingrediënten: ${(r.ingredients || []).map(l => `${esc(itemDisplayName(l.id))} × ${l.amount}`).join(', ')}</div>
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

  document.querySelectorAll('[data-recipe-edit]').forEach(btn => btn.onclick = () => fillRecipeForm(btn.dataset.recipeEdit));
  document.querySelectorAll('[data-recipe-delete]').forEach(btn => btn.onclick = () => deleteRecipe(btn.dataset.recipeDelete));
}

function fillRecipeForm(id) {
  const recipe = recipeById(id);
  if (!recipe) return;

  const form = document.getElementById('recipeForm');
  form.elements.name.value = recipe.name || '';
  form.elements.id.value = recipe.id || '';
  form.elements.sub.value = recipe.sub || recipe.subtitle || '';
  form.elements.category.value = recipe.category || '';
  form.elements.productType.value = recipe.productType || recipe.product_type || 'drink';
  form.elements.station.value = recipe.station || 'drankje maken';
  form.elements.animation.value = recipe.animation || 'coffee';
  form.elements.sellPrice.value = safeNumber(recipe.sellPrice || recipe.sell_price);
  form.elements.visibleOnMenu.checked = asBool(recipe.visibleOnMenu ?? recipe.visible_on_menu);
  form.elements.active.checked = asBool(recipe.active);
  document.getElementById('recipeImage').value = recipe.image || '';
  form.dataset.editingId = recipe.id;

  const lines = document.getElementById('recipeLines');
  if (lines) lines.innerHTML = '';
  (recipe.ingredients || []).forEach(line => addRecipeLine(line));
  updateRecipeSelectOptions();
  updateRecipeComputed();
}

async function deleteRecipe(id) {
  if (!ensureRemovable('recipes', id, 'Dit recept')) return;
  if (!confirm('Recept verwijderen?')) return;
  try {
    await apiPost('recipes.delete', { id });
    await loadAllData();
    renderRecipes();
  } catch (err) {
    showError(err, 'Recept kon niet verwijderd worden.');
  }
}

function boxLine(prefill = '') {
  const options = (APP.data.recipes || [])
    .filter(r => asBool(r.active))
    .map(r => `<option value="${esc(r.id)}" ${prefill === r.id ? 'selected' : ''}>${esc(r.name)}</option>`)
    .join('');

  return `
    <div class="box-line">
      <div><select class="boxRecipeSelect">${options}</select></div>
      <div><button class="btn secondary removeBoxLine" type="button" style="width:auto;">X</button></div>
    </div>
  `;
}

function bindBoxLineEvents() {
  document.querySelectorAll('.removeBoxLine').forEach(b => b.onclick = () => {
    b.closest('.box-line').remove();
    updateBoxPriceHint();
  });

  document.querySelectorAll('.boxRecipeSelect').forEach(el => el.onchange = updateBoxPriceHint);
  const discount = document.getElementById('boxDiscount');
  const manual = document.getElementById('boxManualPrice');
  const price = document.getElementById('boxPrice');
  if (discount) discount.oninput = updateBoxPriceHint;
  if (manual) manual.onchange = updateBoxPriceHint;
  if (price) price.oninput = updateBoxPriceHint;
}

function addBoxLine(prefill = '') {
  const wrap = document.getElementById('boxLines');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', boxLine(prefill));
  bindBoxLineEvents();
  updateBoxPriceHint();
}

function updateBoxPriceHint() {
  const ids = [...document.querySelectorAll('.boxRecipeSelect')].map(el => el.value).filter(Boolean);
  const sum = ids.reduce((s, id) => s + Number(recipeById(id)?.sellPrice || recipeById(id)?.sell_price || 0), 0);
  const discount = Number(document.getElementById('boxDiscount')?.value || 0);
  const auto = Math.max(0, Math.round(sum * (1 - discount / 100)));
  const manual = document.getElementById('boxManualPrice')?.checked;
  const hint = document.getElementById('boxPriceHint');

  if (hint) {
    hint.textContent = manual
      ? `Som recepten: ${money(sum)} · Automatisch voorstel: ${money(auto)} · Handmatige prijs actief.`
      : `Som recepten: ${money(sum)} · Automatische boxprijs: ${money(auto)}.`;
  }
}

function renderBoxes() {
  const rows = [...(APP.data.boxes || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nl'));

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuwe box</h3></div>
      <div class="panel-body stack">
        <form id="boxForm" class="stack">
          <div class="form-grid">
            <div class="full"><label>Naam</label><input name="name" required></div>
            <div><label>Thema</label><input name="theme"></div>
            <div><label>Korting %</label><input id="boxDiscount" type="number" min="0" max="100" step="1" name="discountPct" value="8"></div>
            <div class="full"><label>Promo tekst</label><input name="promo"></div>
            <div><label>Afbeelding</label>${imageSelect('boxImage', 'box')}</div>
          </div>

          <div>
            <label>Items in box</label>
            <div id="boxLines" class="stack"></div>
            <div class="row" style="margin-top:8px;"><button class="btn secondary" type="button" id="addBoxLineBtn">Item toevoegen</button></div>
          </div>

          <div class="item-card">
            <label class="row" style="gap:8px; width:auto;"><input id="boxManualPrice" type="checkbox" name="manualPrice" style="width:auto;"> Handmatige boxprijs gebruiken</label>
            <label>Handmatige prijs</label>
            <input id="boxPrice" type="number" min="0" step="0.01" name="price" value="0">
            <div class="hint" id="boxPriceHint"></div>
          </div>

          <div class="row">
            <button class="btn" type="submit">Opslaan</button>
            <button class="btn secondary" type="button" id="boxResetBtn">Reset</button>
          </div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Boxenoverzicht</h2><div class="pill">${rows.length} boxen</div></div>
      <div class="panel-body stack">
        ${rows.length ? rows.map(b => {
          const price = Number(b.price || computeBoxPrice(b) || 0);
          const profit = boxProfit({ ...b, price });
          return `
            <div class="item-card">
              <div class="row wrap" style="justify-content:space-between; align-items:flex-start;">
                <div class="row">
                  ${thumb(b.image, false)}
                  <div>
                    <h4>${esc(b.name)}</h4>
                    <div class="muted small">${esc(b.theme || '')}</div>
                  </div>
                </div>
                <div class="actions">
                  <button class="btn secondary" data-box-edit="${b.id}">Bewerk</button>
                  <button class="btn danger" data-box-delete="${b.id}">Verwijder</button>
                </div>
              </div>
              <div class="item-meta">
                <span>Items ${(b.items || []).length}</span>
                <span>Prijs ${money(price)}</span>
                <span>Kost ${money(boxCost(b))}</span>
                <span class="${profit >= 0 ? 'status-ok' : 'status-bad'}">Winst ${money(profit)}</span>
              </div>
              <div class="footer-note">${(b.items || []).map(id => esc(recipeById(id)?.name || id)).join(' · ')}</div>
            </div>
          `;
        }).join('') : `<div class="item-card muted">Nog geen boxen gevonden.</div>`}
      </div>
    </div>
  `);

  const form = document.getElementById('boxForm');
  form.onsubmit = saveBoxForm;
  document.getElementById('addBoxLineBtn').onclick = () => addBoxLine('');
  document.getElementById('boxResetBtn').onclick = () => renderBoxes();

  addBoxLine('');
  bindBoxLineEvents();

  document.querySelectorAll('[data-box-edit]').forEach(btn => btn.onclick = () => fillBoxForm(btn.dataset.boxEdit));
  document.querySelectorAll('[data-box-delete]').forEach(btn => btn.onclick = () => deleteBox(btn.dataset.boxDelete));
}

function fillBoxForm(id) {
  const b = (APP.data.boxes || []).find(x => x.id === id);
  if (!b) return;

  const form = document.getElementById('boxForm');
  form.dataset.editingId = b.id;
  form.elements.name.value = b.name || '';
  form.elements.theme.value = b.theme || '';
  form.elements.discountPct.value = b.discountPct || b.discount_value || 0;
  form.elements.promo.value = b.promo || b.promo_text || '';
  form.elements.manualPrice.checked = asBool(b.manualPrice || b.manual_price);
  form.elements.price.value = b.price || b.manualPriceValue || b.manual_price_value || 0;
  document.getElementById('boxImage').value = b.image || '';

  document.getElementById('boxLines').innerHTML = '';
  (b.items || []).forEach(id => addBoxLine(id));
  updateBoxPriceHint();
}

async function saveBoxForm(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const manual = form.elements.manualPrice.checked;

  try {
    const data = {
      id: form.dataset.editingId || slugify(form.elements.name.value.trim()),
      name: form.elements.name.value.trim(),
      theme: form.elements.theme.value.trim(),
      promo: form.elements.promo.value.trim(),
      discountPct: Number(form.elements.discountPct.value || 0),
      manualPrice: manual,
      manualPriceValue: manual ? Number(form.elements.price.value || 0) : 0,
      price: manual ? Number(form.elements.price.value || 0) : 0,
      active: true,
      image: document.getElementById('boxImage').value,
      items: [...document.querySelectorAll('.boxRecipeSelect')].map(el => el.value).filter(Boolean)
    };

    if (!manual) {
      data.price = computeBoxPrice(data);
      data.manualPriceValue = 0;
    }

    await apiPost('boxes.save', data);
    await loadAllData();
    renderBoxes();
  } catch (err) {
    showError(err, 'Box kon niet opgeslagen worden.');
  }
}

async function deleteBox(id) {
  if (!confirm('Box verwijderen?')) return;
  try {
    await apiPost('boxes.delete', { id });
    await loadAllData();
    renderBoxes();
  } catch (err) {
    showError(err, 'Box kon niet verwijderd worden.');
  }
}


function renderPlanList() {
  const wrap = document.getElementById('planList');
  if (!wrap) return;
  const plan = APP.data.plan || [];

  wrap.innerHTML = !plan.length
    ? '<div class="item-card muted small">Nog geen recepten toegevoegd aan de planning.</div>'
    : plan.map((row, idx) => `
      <div class="item-card row" style="justify-content:space-between;">
        <div>
          <strong>${esc(recipeById(row.recipeId)?.name || row.recipeId)}</strong>
          <div class="muted small">${row.amount} stuks</div>
        </div>
        <button class="btn secondary" style="width:auto;" data-plan-remove="${idx}">Verwijder</button>
      </div>
    `).join('');

  wrap.querySelectorAll('[data-plan-remove]').forEach(b => {
    b.onclick = () => removePlanIndex(Number(b.dataset.planRemove));
  });
}

function computePlanRows() {
  const plan = APP.data.plan || [];
  const needMap = new Map();
  let expectedRevenue = 0;
  let expectedProfit = 0;
  const missing = [];

  plan.forEach(entry => {
    const recipe = recipeById(entry.recipeId);
    if (!recipe) return;

    const qty = safeNumber(entry.amount);
    expectedRevenue += safeNumber(recipe.sellPrice || recipe.sell_price) * qty;
    expectedProfit += recipeProfit(recipe) * qty;

    const exploded = recipeRawNeeds(recipe, qty);
    exploded.needs.forEach((value, key) => needMap.set(key, (needMap.get(key) || 0) + value));
    missing.push(...exploded.missing);
  });

  const rows = [...needMap.entries()].map(([id, need]) => {
    const ing = ingredientById(id) || { name: id, supplier: 'onbekend', stock: 0 };
    const stock = safeNumber(ing.stock);
    const buy = Math.max(0, need - stock);
    const unitCost = unitMetrics(id).cost;

    return {
      id,
      name: ing.name,
      supplier: ing.supplier || 'onbekend',
      need,
      stock,
      buy,
      subtotal: buy * unitCost
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  return {
    rows,
    expectedRevenue,
    expectedProfit,
    totalBuy: rows.reduce((s, r) => s + r.subtotal, 0),
    missing: [...new Set(missing)]
  };
}

function renderPlanningList() {
  const plan = APP.data.plan || [];
  const el = document.getElementById('planningList');
  if (!el) return;

  el.innerHTML = !plan.length
    ? '<div class="item-card muted small">Nog geen gerechten toegevoegd aan de dagplanning.</div>'
    : plan.map((row, idx) => {
        const recipe = recipeById(row.recipeId);
        const price = Number(recipe?.sellPrice || recipe?.sell_price || 0);
        const profit = recipe ? recipeProfit(recipe) * Number(row.amount || 0) : 0;

        return `
          <div class="item-card">
            <div class="row wrap" style="justify-content:space-between;">
              <div>
                <strong>${esc(recipe?.name || row.recipeId)}</strong>
                <div class="muted small">Prijs/stuk ${money(price)}</div>
              </div>
              <button class="btn danger" style="width:auto;" data-plan-remove="${idx}">Verwijder</button>
            </div>
            <label>Aantal</label>
            <input type="number" min="1" step="1" value="${Number(row.amount || 1)}" data-plan-qty="${idx}">
            <div class="muted small">Verwachte winst: ${money(profit)}</div>
          </div>
        `;
      }).join('');

  el.querySelectorAll('[data-plan-remove]').forEach(btn => btn.onclick = () => removePlanIndex(Number(btn.dataset.planRemove)));
  el.querySelectorAll('[data-plan-qty]').forEach(inp => inp.onchange = () => updatePlanQty(Number(inp.dataset.planQty), Number(inp.value || 1)));
}

function buildClipboardText(summary) {
  const supplierMap = {};
  summary.rows.filter(r => r.buy > 0).forEach(r => {
    (supplierMap[r.supplier] ||= []).push(`- ${r.name}: **${r.buy}** — ${money(r.subtotal)}`);
  });

  return [
    '# Winkellijst',
    '',
    ...summary.rows.filter(r => r.buy > 0).map(r => `- ${r.name}: **${r.buy}** (${r.supplier}) — ${money(r.subtotal)}`),
    '',
    '## Aankoop per locatie',
    ...Object.entries(supplierMap).flatMap(([k, v]) => [`### ${k}`, ...v, '']),
    `**Totale aankoopkost:** ${money(summary.totalBuy)}`,
    `**Te verwachten omzet:** ${money(summary.expectedRevenue)}`,
    `**Te verwachten winst:** ${money(summary.expectedProfit)}`
  ].join('\n');
}

async function copyStockSummary() {
  const summary = computePlanRows();
  const text = buildClipboardText(summary);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    const btn = document.getElementById('copyStockBtn');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Gekopieerd';
      setTimeout(() => btn.textContent = old, 1500);
    }
  } catch (err) {
    showError(err, 'Markdown kon niet gekopieerd worden.');
  }
}

function renderStock() {
  const summary = computePlanRows();

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Dagplanning</h3></div>
      <div class="panel-body stack">
        <div>
          <label>Recept</label>
          <select id="stockRecipe">
            ${(APP.data.recipes || []).filter(r => asBool(r.active)).map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Aantal</label>
          <input id="stockAmount" type="number" min="1" step="1" value="1">
        </div>
        <div class="row">
          <button class="btn" id="addPlanBtn">Toevoegen</button>
          <button class="btn secondary" id="clearPlanBtn">Leegmaken</button>
        </div>
        <div class="hint">Werk hier je vaste dagplanning bij. De winkellijst houdt automatisch rekening met de huidige stock.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Stockmutaties</h3></div>
      <div class="panel-body stack">
        <div class="row">
          <button class="btn secondary" id="applyPurchasesBtn" type="button">Aankopen boeken</button>
          <button class="btn secondary" id="consumePlanBtn" type="button">Planning verbruiken</button>
        </div>
        <div class="hint">Boek hiermee de winkellijst in je stock of trek de gebruikte grondstoffen af na productie/verkoop.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Manuele stockcorrectie</h3></div>
      <div class="panel-body">
        <form id="stockAdjustForm" class="stack">
          <div>
            <label>Ingrediënt</label>
            <select name="itemId">${(APP.data.ingredients || []).map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select>
          </div>
          <div>
            <label>Delta</label>
            <input type="number" step="1" name="delta" value="0">
          </div>
          <div>
            <label>Notitie</label>
            <input name="note" placeholder="bv. inventaris, breuk, levering">
          </div>
          <button class="btn" type="submit">Correctie opslaan</button>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="stock-three-cols">
      <div class="panel">
        <div class="panel-head"><h2>Planning in opbouw</h2></div>
        <div class="panel-body stack" id="planningList"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>Winkellijst</h2>
          <button class="btn secondary" style="width:auto;" id="copyStockBtn">Kopieer Markdown</button>
        </div>
        <div class="panel-body table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ingrediënt</th>
                <th>Leverancier</th>
                <th>Nodig</th>
                <th>Stock</th>
                <th>Te kopen</th>
                <th>Subtotaal</th>
              </tr>
            </thead>
            <tbody>
              ${summary.rows.length
                ? summary.rows.map(r => `
                  <tr>
                    <td>${esc(r.name)}</td>
                    <td>${esc(r.supplier)}</td>
                    <td>${r.need}</td>
                    <td>${r.stock}</td>
                    <td class="${r.buy > 0 ? 'status-bad' : 'status-ok'}">${r.buy}</td>
                    <td>${money(r.subtotal)}</td>
                  </tr>
                `).join('')
                : '<tr><td colspan="6" class="muted">Nog geen plan toegevoegd.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Samenvatting</h2></div>
        <div class="panel-body stack small">
          <div class="item-card">
            <h4>Totale aankoopkost</h4>
            <div class="status-warn">${money(summary.totalBuy)}</div>
          </div>
          <div class="item-card">
            <h4>Aankooplocaties</h4>
            <div class="muted">${[...new Set(summary.rows.filter(r => r.buy > 0).map(r => r.supplier))].join(', ') || 'Geen aankopen nodig'}</div>
          </div>
          <div class="item-card">
            <h4>Te verwachten omzet</h4>
            <div class="muted">${money(summary.expectedRevenue)}</div>
          </div>
          <div class="item-card">
            <h4>Te verwachten winst</h4>
            <div class="status-ok">${money(summary.expectedProfit)}</div>
          </div>
          <div class="item-card">
            <h4>Verwerking</h4>
            <div class="muted">${summary.missing?.length ? esc(summary.missing.join(' · ')) : 'Verwerkte producten zijn meegerekend in kost en stock.'}</div>
          </div>
          <div class="item-card">
            <h4>Laatste stocklogs</h4>
            <div class="muted small">${(APP.stockLogs || []).slice(0, 6).map(log => `${esc(log.timestamp || '')} · ${esc(log.action || '')} · ${esc(itemDisplayName(log.itemId || log.item_id))} · ${safeNumber(log.delta) > 0 ? '+' : ''}${safeNumber(log.delta)}`).join('<br>') || 'Nog geen logs.'}</div>
          </div>
        </div>
      </div>
    </div>
  `);

  document.getElementById('addPlanBtn').onclick = savePlan;
  document.getElementById('clearPlanBtn').onclick = clearPlan;
  document.getElementById('copyStockBtn').onclick = copyStockSummary;
  const applyPurchasesBtn = document.getElementById('applyPurchasesBtn');
  const consumePlanBtn = document.getElementById('consumePlanBtn');
  const stockAdjustForm = document.getElementById('stockAdjustForm');
  if (applyPurchasesBtn) applyPurchasesBtn.onclick = applyPurchaseAdjustments;
  if (consumePlanBtn) consumePlanBtn.onclick = applyConsumptionAdjustments;
  if (stockAdjustForm) stockAdjustForm.onsubmit = saveStockAdjustment;
  renderPlanningList();
}

async function savePlan() {
  const plan = [...(APP.data.plan || [])];
  const recipeId = document.getElementById('stockRecipe').value;
  const amount = Number(document.getElementById('stockAmount').value || 1);

  const existing = plan.find(p => p.recipeId === recipeId);
  if (existing) existing.amount += amount;
  else plan.push({ recipeId, amount });

  await apiPost('plan.save', plan);
  await loadAllData();
  renderStock();
}

async function clearPlan() {
  if (!confirm('Dagplanning leegmaken?')) return;
  await apiPost('plan.save', []);
  await loadAllData();
  renderStock();
}

async function removePlanIndex(idx) {
  const plan = [...(APP.data.plan || [])];
  plan.splice(idx, 1);
  await apiPost('plan.save', plan);
  await loadAllData();
  renderStock();
}

async function updatePlanQty(idx, amount) {
  const plan = [...(APP.data.plan || [])];
  if (!plan[idx]) return;
  plan[idx].amount = Math.max(1, Number(amount || 1));
  await apiPost('plan.save', plan);
  await loadAllData();
  renderStock();
}

async function applyStockAdjustments(adjustments, action, note) {
  if (!adjustments.length) return alert('Er zijn geen stockmutaties om te boeken.');
  try {
    await apiPost('stock.adjust', { action, note, adjustments });
    await loadAllData();
    renderStock();
  } catch (err) {
    showError(err, 'Stockmutatie kon niet opgeslagen worden.');
  }
}

async function applyPurchaseAdjustments() {
  const summary = computePlanRows();
  const adjustments = summary.rows.filter(r => r.buy > 0).map(r => ({ itemId: r.id, delta: r.buy, note: 'Aankoop vanuit planning' }));
  if (!adjustments.length) return alert('Er zijn geen aankopen nodig.');
  if (!confirm('Alle aankopen uit de huidige winkellijst in stock boeken?')) return;
  await applyStockAdjustments(adjustments, 'purchase', 'Aankoop vanuit winkellijst');
}

async function applyConsumptionAdjustments() {
  const summary = computePlanRows();
  const adjustments = summary.rows.filter(r => r.need > 0).map(r => ({ itemId: r.id, delta: -r.need, note: 'Verbruik vanuit planning' }));
  if (!adjustments.length) return alert('Er is geen verbruik om te boeken.');
  if (!confirm('Alle grondstoffen uit de huidige planning van de stock aftrekken?')) return;
  await applyStockAdjustments(adjustments, 'consume', 'Verbruik vanuit planning');
}

async function saveStockAdjustment(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const delta = Number(form.elements.delta.value || 0);
  if (!delta) return alert('Delta mag niet 0 zijn.');
  await applyStockAdjustments([{ itemId: form.elements.itemId.value, delta, note: form.elements.note.value.trim() || 'Manuele correctie' }], 'manual_adjust', form.elements.note.value.trim() || 'Manuele correctie');
}

function applyMenuStyles() {
  const s = settingsMap();
  document.documentElement.style.setProperty('--menu-canvas-bg', s.canvas_bg_color || '#1b1715');

  const panelColor = s.panel_color || '#241d19';
  const opacity = Math.max(0, Math.min(100, Number(s.panel_opacity || 94))) / 100;
  document.documentElement.style.setProperty('--menu-panel', hexToRgba(panelColor, opacity));
  document.documentElement.style.setProperty('--menu-chalk', s.chalk_color || '#f7f1e8');
  document.documentElement.style.setProperty('--menu-accent', s.accent_color || '#f0b04c');
  document.documentElement.style.setProperty('--menu-accent-2', s.accent2_color || '#8c5c36');
  document.documentElement.style.setProperty('--menu-muted', s.muted_color || '#d9c9b8');
  document.documentElement.style.setProperty('--menu-category-image-opacity', String(Math.max(0, Math.min(100, Number(s.category_image_opacity || 50))) / 100));
}

function hexToRgba(hex, alpha) {
  const cleaned = String(hex || '#000').replace('#', '');
  const expanded = cleaned.length === 3 ? cleaned.split('').map(c => c + c).join('') : cleaned;
  const bigint = parseInt(expanded, 16) || 0;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderMenu() {
  applyMenuStyles();
  const s = settingsMap();
  const grouped = groupedRecipes();
  const shop = shopData();

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Layout & stijl</h3></div>
      <div class="panel-body stack">
        <form id="menuStyleForm" class="form-grid">
          <div class="full"><label>Footer links</label><input name="footer_left" value="${esc(s.footer_left || '')}"></div>
          <div class="full"><label>Footer rechts</label><input name="footer_right" value="${esc(s.footer_right || '')}"></div>
          <div><label>Canvas kleur</label><input type="color" name="canvas_bg_color" value="${esc(s.canvas_bg_color || '#1b1715')}"></div>
          <div><label>Paneelkleur</label><input type="color" name="panel_color" value="${esc(s.panel_color || '#241d19')}"></div>
          <div><label>Paneeldekking</label><input type="number" min="0" max="100" name="panel_opacity" value="${esc(s.panel_opacity || '94')}"></div>
          <div><label>Tekstkleur</label><input type="color" name="chalk_color" value="${esc(s.chalk_color || '#f7f1e8')}"></div>
          <div><label>Accent</label><input type="color" name="accent_color" value="${esc(s.accent_color || '#f0b04c')}"></div>
          <div><label>Accent 2</label><input type="color" name="accent2_color" value="${esc(s.accent2_color || '#8c5c36')}"></div>
          <div><label>Subtekstkleur</label><input type="color" name="muted_color" value="${esc(s.muted_color || '#d9c9b8')}"></div>
          <div><label>Opacity categoriebeeld</label><input type="number" min="0" max="100" name="category_image_opacity" value="${esc(s.category_image_opacity || '50')}"></div>
          <div><label>Achtergrondafbeelding</label>${imageSelect('menuBackgroundImage', 'menu', s.menu_background_image || '')}</div>
          <div><label>Logo menukaart</label>${imageSelect('menuLogoImage', 'logo', s.menu_logo_image || shop.logo || '')}</div>
          <div class="full row">
            <button class="btn" type="submit">Stijl opslaan</button>
            <button class="btn secondary" type="button" id="menuRefreshBtn">Herlaad preview</button>
          </div>
        </form>
      </div>
    </div>
  `);

  const bg = resolveImage(s.menu_background_image || '', false);
  const menuLogo = resolveImage(s.menu_logo_image || shop.logo || '', false);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head">
        <h2>Preview</h2>
        <div class="row">
          <button class="btn secondary" type="button" id="menuDownloadBtn">Download PNG</button>
        </div>
      </div>
      <div class="panel-body">
        <div id="menuPoster" class="menu-board ${bg ? 'has-bg' : ''}" style="${bg ? `--menu-bg-image:url('${bg}')` : ''}">
      <div class="menu-head">
        <div class="menu-logo">${menuLogo ? `<img src="${esc(menuLogo)}" alt="Logo">` : 'GH'}</div>
        <div>
          <div class="menu-brand">${esc(shop.name || "'t Gezellig Hoekje")}</div>
          <div class="menu-sub">${esc(shop.subtitle || 'Koffiebar & Gebak')}</div>
          <div class="menu-tag">${esc(shop.tagline || '')}</div>
        </div>
      </div>

      <div class="menu-grid">
        <div class="menu-card">
          <h3>Menukaart</h3>
          <div class="menu-sections">
            ${allCategories().map(cat => {
              const items = grouped[cat] || [];
              const catImg = (APP.data.images || []).find(i => i.scope === 'category' && i.name === cat);
              return `
                <div class="menu-section">
                  ${catImg ? `<img class="section-image" src="${esc(resolveImage(catImg.id, false))}" alt="">` : ''}
                  <h4>${esc(cat)}</h4>
                  ${items.map(r => `
                    <div class="menu-entry">
                      <div>
                        <b>${esc(r.name)}</b>
                        <small>${esc(r.sub || r.subtitle || '')}</small>
                      </div>
                      <strong>${money(r.sellPrice || r.sell_price)}</strong>
                    </div>
                  `).join('') || '<div class="muted small">Nog geen items.</div>'}
                </div>
              `;
            }).join('')}
          </div>
          <div class="footer-note">${esc(s.footer_left || '')} · ${esc(s.footer_right || '')}</div>
        </div>

        <div class="box-card">
          <h3>Boxmenu&apos;s</h3>
          <div class="boxes">
            ${(APP.data.boxes || []).filter(b => asBool(b.active)).map(b => `
              <div class="item-card">
                <div class="row">
                  ${thumb(b.image, false)}
                  <div>
                    <h4>${esc(b.name)}</h4>
                    <div class="muted small">${esc(b.theme || '')}</div>
                  </div>
                </div>
                <ul>${(b.items || []).map(id => `<li>${esc(recipeById(id)?.name || id)}</li>`).join('')}</ul>
                <div class="promo">Promo ${money(b.price || computeBoxPrice(b))}</div>
              </div>
            `).join('')}
          </div>
        </div>
        </div>
      </div>
    </div>
  `);

  document.getElementById('menuStyleForm').onsubmit = saveMenuStyleForm;
  document.getElementById('menuRefreshBtn').onclick = async () => {
    await loadAllData();
    renderMenu();
  };
  const menuDownloadBtn = document.getElementById('menuDownloadBtn');
  if (menuDownloadBtn) menuDownloadBtn.onclick = downloadMenuPng;
}

async function downloadMenuPng() {
  if (typeof html2canvas !== 'function') throw new Error('html2canvas is niet geladen.');
  const poster = document.getElementById('menuPoster');
  if (!poster) throw new Error('Geen poster gevonden om te exporteren.');

  const button = document.getElementById('menuDownloadBtn');
  const previous = button ? button.textContent : '';

  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'PNG wordt gemaakt…';
    }

    const canvas = await html2canvas(poster, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      width: 1920,
      height: 1080,
      windowWidth: 1920,
      windowHeight: 1080
    });

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 1920;
    exportCanvas.height = 1080;
    const ctx = exportCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 1920, 1080);

    const link = document.createElement('a');
    const safeName = slugify(shopData().name || 'menu');
    link.href = exportCanvas.toDataURL('image/png');
    link.download = `${safeName}_menukaart.png`;
    link.click();
  } catch (err) {
    showError(err, 'De PNG-download is mislukt.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previous || 'Download PNG';
    }
  }
}

async function saveMenuStyleForm(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const map = settingsMap();

  const updates = {
    footer_left: f.elements.footer_left.value,
    footer_right: f.elements.footer_right.value,
    canvas_bg_color: f.elements.canvas_bg_color.value,
    panel_color: f.elements.panel_color.value,
    panel_opacity: f.elements.panel_opacity.value,
    chalk_color: f.elements.chalk_color.value,
    accent_color: f.elements.accent_color.value,
    accent2_color: f.elements.accent2_color.value,
    muted_color: f.elements.muted_color.value,
    category_image_opacity: f.elements.category_image_opacity.value,
    menu_background_image: document.getElementById('menuBackgroundImage').value,
    menu_logo_image: document.getElementById('menuLogoImage').value
  };

  const merged = { ...map, ...updates };
  const rows = Object.entries(merged).map(([key, value]) => ({ key, value }));

  await apiPost('menuSettings.save', rows);
  await loadAllData();
  renderMenu();
}

function fillImageForm(id) {
  const img = imageRecordValue(id);
  if (!img) return;

  const f = document.getElementById('imageForm');
  f.dataset.editingId = img.id;
  f.elements.name.value = img.name || '';
  f.elements.id.value = img.id || '';
  f.elements.id.disabled = true;
  f.elements.scope.value = img.scope || 'global';
  f.elements.file_name.value = img.fileName || img.file_name || '';
  f.elements.data_url.value = img.dataUrl || img.data_url || '';
  f.elements.notes.value = img.notes || '';
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function renderImages() {
  const rows = [...(APP.data.images || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nl'));

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuwe afbeelding</h3></div>
      <div class="panel-body">
        <form id="imageForm" class="stack">
          <div class="form-grid">
            <div class="full"><label>Naam</label><input name="name" required></div>
            <div><label>Code</label><input name="id" required></div>
            <div>
              <label>Scope</label>
              <select name="scope">
                <option value="ingredient">ingredient</option>
                <option value="recipe">recipe</option>
                <option value="box">box</option>
                <option value="menu">menu</option>
                <option value="logo">logo</option>
                <option value="category">category</option>
                <option value="global">global</option>
              </select>
            </div>
            <div><label>Bestandsnaam / pad</label><input name="file_name" placeholder="voorbeeld.png"></div>
            <div class="full"><label>Upload bestand</label><input type="file" id="imageUpload" accept="image/*"></div>
            <div class="full"><label>Of plak data-url / absolute url</label><textarea name="data_url" placeholder="data:image/png;base64,... of https://..."></textarea></div>
            <div class="full"><label>Notitie</label><textarea name="notes"></textarea></div>
          </div>
          <div class="row">
            <button class="btn" type="submit">Opslaan</button>
            <button class="btn secondary" type="button" id="imageResetBtn">Reset</button>
          </div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Afbeeldingenbibliotheek</h2><div class="pill">${rows.length} items</div></div>
      <div class="panel-body stack">
        ${rows.length ? rows.map(img => `
          <div class="item-card">
            <div class="row wrap" style="justify-content:space-between; align-items:flex-start;">
              <div class="row">
                ${thumb(img.id, false)}
                <div>
                  <h4>${esc(img.name)}</h4>
                  <div class="muted small">${esc(img.scope || '')}</div>
                  <div class="muted small">${esc(img.fileName || img.file_name || '')}</div>
                </div>
              </div>
              <div class="actions">
                <button class="btn secondary" data-image-edit="${img.id}">Bewerk</button>
                <button class="btn danger" data-image-delete="${img.id}">Verwijder</button>
              </div>
            </div>
          </div>
        `).join('') : `<div class="item-card muted">Nog geen afbeeldingen gevonden.</div>`}
      </div>
    </div>
  `);

  document.getElementById('imageForm').onsubmit = saveImageForm;
  document.getElementById('imageResetBtn').onclick = () => renderImages();

  document.querySelectorAll('[data-image-edit]').forEach(btn => {
    btn.onclick = () => fillImageForm(btn.dataset.imageEdit);
  });

  document.querySelectorAll('[data-image-delete]').forEach(btn => {
    btn.onclick = () => deleteImage(btn.dataset.imageDelete);
  });
}

async function saveImageForm(e) {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    let dataUrl = f.elements.data_url.value.trim();

    const file = document.getElementById('imageUpload').files?.[0];
    if (file) dataUrl = await readFileAsDataUrl(file);

    const data = {
      id: f.dataset.editingId || f.elements.id.value.trim(),
      name: f.elements.name.value.trim(),
      scope: f.elements.scope.value,
      fileName: f.elements.file_name.value.trim(),
      dataUrl,
      active: true,
      notes: f.elements.notes.value.trim()
    };

    await apiPost('images.save', data);
    await loadAllData();
    renderImages();
  } catch (err) {
    showError(err, 'Afbeelding kon niet opgeslagen worden.');
  }
}

async function deleteImage(id) {
  if (!ensureRemovable('images', id, 'Deze afbeelding')) return;
  if (!confirm('Afbeelding verwijderen?')) return;
  try {
    await apiPost('images.delete', { id });
    await loadAllData();
    renderImages();
  } catch (err) {
    showError(err, 'Afbeelding kon niet verwijderd worden.');
  }
}

function renderSettings() {
  const shop = shopData();

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Shopinstellingen</h3></div>
      <div class="panel-body">
        <form id="shopForm" class="stack">
          <label>Naam</label>
          <input name="name" value="${esc(shop.name || '')}">

          <label>Ondertitel</label>
          <input name="subtitle" value="${esc(shop.subtitle || '')}">

          <label>Slogan</label>
          <input name="tagline" value="${esc(shop.tagline || '')}">

          <label>Logo</label>
          ${imageSelect('shopLogo', 'logo', shop.logo || '')}

          <label>Menucategorieën</label>
          <textarea name="menuCategories" placeholder="Koffie, Thee, ...">${esc((settingsMap().menu_categories || '').trim())}</textarea>

          <div class="row">
            <button class="btn" type="submit">Opslaan</button>
          </div>
        </form>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Sheets bootstrap</h3></div>
      <div class="panel-body stack">
        <div class="hint">Gebruik dit alleen wanneer je de spreadsheetstructuur opnieuw wilt initialiseren.</div>
        <button class="btn secondary" id="bootstrapSheetsBtn" type="button">Controleer / herstel sheets</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>API-verbinding</h3></div>
      <div class="panel-body stack">
        <button class="btn secondary" id="testApiBtn">Verbinding testen</button>
        <div id="apiResult" class="hint">Klik op de knop om de verbinding te testen.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Admin token</h3></div>
      <div class="panel-body stack">
        <div class="hint">Lezen werkt zonder token. Voor opslaan of verwijderen is een admin token nodig.</div>
        <div class="row">
          <button class="btn secondary" id="setTokenBtn" type="button">Token instellen of wijzigen</button>
          <button class="btn ghost" id="clearTokenBtn" type="button">Token wissen</button>
        </div>
        <div id="tokenState" class="hint"></div>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>API info</h2></div>
      <div class="panel-body stack">
        <div class="item-card">
          <strong>Apps Script URL</strong>
          <div class="small muted">${esc(window.GEZELLIG_CONFIG.API_URL)}</div>
        </div>
      </div>
    </div>
  `);

  document.getElementById('shopForm').onsubmit = saveShopForm;
  document.getElementById('testApiBtn').onclick = testApi;
  const setTokenBtn = document.getElementById('setTokenBtn');
  const clearTokenBtn = document.getElementById('clearTokenBtn');
  if (setTokenBtn) setTokenBtn.onclick = () => { promptWriteToken('Voer de admin token in.'); updateTokenState(); };
  if (clearTokenBtn) clearTokenBtn.onclick = () => { clearWriteToken(); updateTokenState(); };
  const bootstrapBtn = document.getElementById('bootstrapSheetsBtn');
  if (bootstrapBtn) bootstrapBtn.onclick = bootstrapSheets;
  updateTokenState();
}

function updateTokenState() {
  const out = document.getElementById('tokenState');
  if (!out) return;
  out.textContent = getWriteToken() ? 'Admin token is ingesteld op dit toestel.' : 'Er is momenteel geen admin token ingesteld.';
}

async function saveShopForm(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const map = settingsMap();

  const merged = {
    ...map,
    brand_name: f.elements.name.value.trim(),
    subtitle: f.elements.subtitle.value.trim(),
    tagline: f.elements.tagline.value.trim(),
    menu_logo_image: document.getElementById('shopLogo').value,
    menu_categories: f.elements.menuCategories.value.trim()
  };

  const rows = Object.entries(merged).map(([key, value]) => ({ key, value }));
  await apiPost('menuSettings.save', rows);
  await loadAllData();
  renderSettings();
}

async function bootstrapSheets() {
  if (!confirm('De sheetstructuur controleren / herstellen?')) return;
  try {
    await apiPost('bootstrap.sheets', {});
    await loadAllData();
    alert('Sheets zijn gecontroleerd / hersteld.');
  } catch (err) {
    showError(err, 'Bootstrap van sheets is mislukt.');
  }
}

async function testApi() {
  const out = document.getElementById('apiResult');
  const url = `${window.GEZELLIG_CONFIG.API_URL}?action=health`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Onbekende API-fout');
    const data = json.data || {};
    out.className = 'okline';
    out.textContent = `Verbinding ok. Spreadsheet: ${data.spreadsheet || 'OK'}. Tijdstip: ${data.timestamp || ''}`;
    setLiveStatus('ok', 'Live gekoppeld');
  } catch (err) {
    out.className = 'badline';
    out.textContent = `Verbinding mislukt: ${err.message}. Controleer of de Apps Script deployment opnieuw gepubliceerd is en of de API_URL naar de nieuwste deployment wijst.`;
    setLiveStatus('bad', 'Verbinding mislukt');
  }
}

async function renderPage() {
  fillHeader();

  if (APP.page === 'dashboard') renderDashboard();
  if (APP.page === 'ingredients') renderIngredients();
  if (APP.page === 'processed') renderProcessedProducts();
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

function recipeProfit(recipe) {
  return Number(recipe.sellPrice || recipe.sell_price || 0) - calculateRecipeCost(recipe);
}

function boxCost(box) {
  return (box.items || []).reduce((s, id) => s + calculateRecipeCost(recipeById(id) || { ingredients: [] }), 0);
}

function boxProfit(box) {
  return Number(box.price || computeBoxPrice(box) || 0) - boxCost(box);
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
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

const DRINK_ALLOWED = new Set(['Dranken','Fruit','Groenten','Zuivel','Thee','Chocolademelk','Toppings']);

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, s => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
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

function itemImageUrl(item, recipeMode = false) {
  const val = item?.image || item?.fileName || item?.file_name || '';
  if (item?.dataUrl || item?.data_url) return item.dataUrl || item.data_url;
  if (!val) return '';
  if (/^https?:/i.test(val) || val.startsWith('/') || val.startsWith('data:') || val.includes('/')) return val;
  const base = recipeMode ? window.GEZELLIG_CONFIG.RECIPE_IMAGE_BASE : window.GEZELLIG_CONFIG.IMAGE_BASE;
  return `${base}/${val}`;
}

function imageRecordValue(id) {
  return APP.imagesMap.get(id) || null;
}

function resolveImage(ref, recipeMode = false) {
  if (!ref) return '';
  const lib = imageRecordValue(ref);
  if (lib) return itemImageUrl(lib, recipeMode);
  if (/^https?:/i.test(ref) || ref.startsWith('/') || ref.startsWith('data:') || ref.includes('/')) return ref;
  const base = recipeMode ? window.GEZELLIG_CONFIG.RECIPE_IMAGE_BASE : window.GEZELLIG_CONFIG.IMAGE_BASE;
  return `${base}/${ref}`;
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
  const shop = shopData();

  if (logo) logo.innerHTML = shop.logo ? `<img src="${esc(resolveImage(shop.logo, false))}" alt="Logo">` : 'GH';
  if (brandName) brandName.textContent = shop.name || "'t Gezellig Hoekje";
  if (brandSub) brandSub.textContent = `${shop.subtitle || 'Koffiebar & Gebak'} · live koppeling`;
  if (pageTitle) pageTitle.textContent = PAGE_META[APP.page]?.title || 'Dashboard';
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

function computePlanRows() {
  const plan = APP.data.plan || [];
  const needMap = new Map();

  plan.forEach(entry => {
    const recipe = recipeById(entry.recipeId);
    if (!recipe) return;
    (recipe.ingredients || []).forEach(line => {
      needMap.set(line.id, (needMap.get(line.id) || 0) + Number(line.amount || 0) * Number(entry.amount || 0));
    });
  });

  return [...needMap.entries()].map(([id, need]) => {
    const ing = ingredientById(id) || { name: id, supplier: 'onbekend', stock: 0, price: 0 };
    const stock = Number(ing.stock || 0);
    const buy = Math.max(0, need - stock);
    return {
      id,
      name: ing.name,
      supplier: ing.supplier,
      need,
      stock,
      buy,
      subtotal: buy * Number(ing.price || 0)
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
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
        <div class="metric">
          <small>Ingrediënten</small>
          <strong>${ingredients.length}</strong>
          <span>Totaal in databron</span>
        </div>

        <div class="metric">
          <small>Recepten</small>
          <strong>${recipes.length}</strong>
          <span>Totaal in databron</span>
        </div>

        <div class="metric">
          <small>Toegevoegd aan menu</small>
          <strong>${menuVisible.length}</strong>
          <span>Zichtbaar op menukaart</span>
        </div>

        <div class="metric">
          <small>Niet op menu</small>
          <strong>${menuHidden.length}</strong>
          <span>Verborgen recepten</span>
        </div>

        <div class="metric">
          <small>Promo boxen</small>
          <strong>${boxes.length}</strong>
          <span>Actieve boxen</span>
        </div>

        <div class="metric">
          <small>Stock tekorten</small>
          <strong>${lowStock.length}</strong>
          <span>Onder minimumstock</span>
        </div>
      </div>

      <div class="dashboard-bottom">
        <div class="panel">
          <div class="panel-head">
            <h2>Stockwaarschuwingen</h2>
          </div>
          <div class="panel-body stack">
            ${lowStock.length
              ? lowStock.map(i => `
                <div class="warnline">${esc(i.name)} onder minimumstock (${i.stock}/${i.minStock})</div>
              `).join('')
              : `<div class="okline">Geen stockwaarschuwingen.</div>`
            }
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h2>Huidige menukaart</h2>
          </div>
          <div class="panel-body">
            <div class="dashboard-menu-grid">
              ${currentMenuHtml}
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function imageSelect(id, scope, current = '') {
  const opts = (APP.data.images || [])
    .filter(i => !scope || i.scope === scope || i.scope === 'global')
    .map(i => `<option value="${esc(i.id)}" ${current === i.id ? 'selected' : ''}>${esc(i.name)}</option>`)
    .join('');
  return `<select id="${id}" name="image"><option value="">Geen</option>${opts}</select>`;
}

function renderIngredients() {
  const rows = [...(APP.data.ingredients || [])].sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuw ingrediënt</h3></div>
      <div class="panel-body">
        <form id="ingredientForm" class="form-grid">
          <div class="full"><label>Naam</label><input name="name" required></div>
          <div><label>Code</label><input name="id" required></div>
          <div><label>Type</label><select name="type"><option>raw</option><option>processed</option><option>purchased_finished</option><option>condiment</option></select></div>
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
        <div id="ingredientFormStatus" class="small muted"></div>
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
                <td>${esc(item.type)}</td>
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

  document.getElementById('ingredientForm').onsubmit = saveIngredientForm;
  document.getElementById('ingredientResetBtn').onclick = () => document.getElementById('ingredientForm').reset();
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => fillIngredientForm(btn.dataset.edit));
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => deleteIngredient(btn.dataset.delete));
}

function fillIngredientForm(id) {
  const item = ingredientById(id);
  if (!item) return;

  const form = document.getElementById('ingredientForm');
  ['name', 'id', 'type', 'category', 'supplier', 'unit', 'price', 'stock'].forEach(k => form.elements[k].value = item[k] ?? '');
  form.elements.minStock.value = item.minStock ?? 0;
  form.elements.caloriesPerProcessedPiece.value = item.caloriesPerProcessedPiece ?? 0;
  form.elements.processedYield.value = item.processedYield ?? 0;
  form.elements.pricePerProcessedPiece.value = item.pricePerProcessedPiece ?? 0;
  form.elements.weightPerPieceG.value = item.weightPerPieceG ?? 0;
  form.elements.pricePerCalorie.value = item.pricePerCalorie ?? 0;
  form.elements.note.value = item.note ?? '';
  document.getElementById('ingredientImage').value = item.image || '';
  form.dataset.editingId = item.id;
  form.elements.id.disabled = true;
}

async function saveIngredientForm(e) {
  e.preventDefault();
  const form = e.currentTarget;

  const data = {
    id: form.dataset.editingId || form.elements.id.value.trim(),
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
  renderPage();
}

async function deleteIngredient(id) {
  if (!confirm('Ingrediënt verwijderen?')) return;
  await apiPost('ingredients.delete', { id });
  await loadAllData();
  renderPage();
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

function addRecipeLine(prefill) {
  const wrap = document.getElementById('recipeLines');
  wrap.insertAdjacentHTML('beforeend', recipeLine(prefill, document.getElementById('recipeType').value));
  bindRecipeLineEvents();
  updateRecipeComputed();
}

function bindRecipeLineEvents() {
  document.querySelectorAll('.removeRecipeLine').forEach(b => b.onclick = () => {
    b.closest('.recipe-line').remove();
    updateRecipeComputed();
  });
  document.querySelectorAll('.recipeIngSelect,.recipeIngAmount').forEach(el => el.oninput = updateRecipeComputed);
}

function updateRecipeSelectOptions() {
  const type = document.getElementById('recipeType').value;
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
    sellPrice: Number(document.getElementById('recipePrice').value || 0),
    productType: document.getElementById('recipeType').value
  };

  const calc = calculateRecipeCalories(temp);
  const target = targetCalories(temp.productType);
  const cost = calculateRecipeCost(temp);

  const out = document.getElementById('recipeComputed');
  if (out) {
    out.innerHTML = `
      <div class="item-card">
        <strong>Calorievergelijking</strong>
        <div class="small muted">${calc.toFixed(0)}/${target}</div>
      </div>
      <div class="item-card">
        <strong>Kostprijs</strong>
        <div class="small muted">${money(cost)}</div>
      </div>
    `;
  }
}

function fillRecipeForm(id) {
  const r = recipeById(id);
  if (!r) return;

  const form = document.getElementById('recipeForm');
  form.dataset.editingId = r.id;
  form.elements.name.value = r.name || '';
  form.elements.sub.value = r.sub || r.subtitle || '';
  form.elements.category.value = r.category || '';
  form.elements.productType.value = r.productType || r.product_type || 'drink';
  form.elements.station.value = r.station || '';
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

function renderRecipes() {
  const rows = [...(APP.data.recipes || [])].sort((a, b) =>
    (a.category || '').localeCompare(b.category || 'nl') || a.name.localeCompare(b.name, 'nl')
  );

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuw recept</h3></div>
      <div class="panel-body stack">
        <form id="recipeForm" class="stack">
          <div class="form-grid">
            <div class="full"><label>Naam</label><input name="name" required></div>
            <div><label>Subtitel</label><input name="sub"></div>
            <div><label>Categorie</label><input name="category"></div>
            <div><label>Type</label><select id="recipeType" name="productType"><option value="drink">drankje</option><option value="snack">hapje</option><option value="main">hoofdgerecht</option></select></div>
            <div><label>Station</label><select name="station"><option>drankje maken</option><option>eten maken</option></select></div>
            <div><label>Animatie</label><select name="animation"><option>coffee</option><option>cup</option><option>sandwich</option><option>donut</option><option>bagel</option><option>dinner</option><option>burger</option></select></div>
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
            <div class="hint">Dranken laten alleen drank-/fruit-/groente-/zuivel-/toppingingrediënten zien. Hapjes en hoofdgerechten tonen de volledige lijst.</div>
          </div>
          <div id="recipeComputed" class="grid-2"></div>
          <div class="row"><button class="btn" type="submit">Opslaan</button><button class="btn secondary" type="button" id="recipeResetBtn">Reset</button></div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Receptenoverzicht</h2><div class="pill">${rows.length} recepten</div></div>
      <div class="panel-body stack">
        ${rows.map(r => {
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
                  <button class="btn secondary" data-edit="${r.id}">Bewerk</button>
                  <button class="btn danger" data-delete="${r.id}">Verwijder</button>
                </div>
              </div>
              <div class="item-meta">
                <span>${esc(r.category || '')}</span>
                <span>${esc(r.productType || r.product_type || '')}</span>
                <span>${asBool(r.visibleOnMenu ?? r.visible_on_menu) ? 'Op kaart' : 'Verborgen'}</span>
                <span>${asBool(r.active) ? 'Actief' : 'Inactief'}</span>
                <span>${money(r.sellPrice || r.sell_price)}</span>
                <span>${money(calculateRecipeCost(r))}</span>
                <span>${calc.toFixed(0)}/${target} cal</span>
                <span class="${st.cls}">${esc(st.label)}</span>
              </div>
              <div class="footer-note">Ingrediënten: ${(r.ingredients || []).map(l => `${esc(ingredientById(l.id)?.name || l.id)} × ${l.amount}`).join(', ')}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `);

  document.getElementById('recipeForm').onsubmit = saveRecipeForm;
  document.getElementById('addRecipeLineBtn').onclick = () => addRecipeLine({});
  document.getElementById('recipeType').onchange = updateRecipeSelectOptions;
  document.getElementById('recipePrice').oninput = updateRecipeComputed;
  document.getElementById('recipeResetBtn').onclick = () => renderRecipes();
  addRecipeLine({});
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => fillRecipeForm(btn.dataset.edit));
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => deleteRecipe(btn.dataset.delete));
}

async function saveRecipeForm(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const id = form.dataset.editingId || slugify(form.elements.name.value.trim());

  const data = {
    id,
    name: form.elements.name.value.trim(),
    sub: form.elements.sub.value.trim(),
    category: form.elements.category.value.trim(),
    productType: form.elements.productType.value,
    station: form.elements.station.value,
    animation: form.elements.animation.value,
    sellPrice: Number(form.elements.sellPrice.value || 0),
    calories: Number(calculateRecipeCalories({
      ingredients: [...document.querySelectorAll('#recipeLines .recipe-line')].map(row => ({
        id: row.querySelector('.recipeIngSelect').value,
        amount: Number(row.querySelector('.recipeIngAmount').value || 0)
      }))
    }).toFixed(0)),
    visibleOnMenu: form.elements.visibleOnMenu.checked,
    active: form.elements.active.checked,
    image: document.getElementById('recipeImage').value,
    ingredients: [...document.querySelectorAll('#recipeLines .recipe-line')].map(row => ({
      id: row.querySelector('.recipeIngSelect').value,
      amount: Number(row.querySelector('.recipeIngAmount').value || 0)
    })).filter(l => l.id && l.amount > 0)
  };

  await apiPost('recipes.save', data);
  await loadAllData();
  renderPage();
}

async function deleteRecipe(id) {
  if (!confirm('Recept verwijderen?')) return;
  await apiPost('recipes.delete', { id });
  await loadAllData();
  renderPage();
}

function boxLine(prefill = '') {
  return `
    <div class="box-line">
      <div>
        <select class="boxRecipeSelect">
          ${(APP.data.recipes || []).map(r => `<option value="${esc(r.id)}" ${prefill === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select>
      </div>
      <div><button class="btn secondary removeBoxLine" type="button" style="width:auto;">X</button></div>
    </div>
  `;
}

function addBoxLine(prefill) {
  document.getElementById('boxLines').insertAdjacentHTML('beforeend', boxLine(prefill));
  bindBoxLineEvents();
  updateBoxPriceHint();
}

function bindBoxLineEvents() {
  document.querySelectorAll('.removeBoxLine').forEach(b => b.onclick = () => {
    b.closest('.box-line').remove();
    updateBoxPriceHint();
  });
  document.querySelectorAll('.boxRecipeSelect,#boxDiscount,#boxManualPrice,#boxPrice').forEach(el => el.oninput = updateBoxPriceHint);
}

function updateBoxPriceHint() {
  const ids = [...document.querySelectorAll('.boxRecipeSelect')].map(el => el.value).filter(Boolean);
  const sum = ids.reduce((s, id) => s + Number(recipeById(id)?.sellPrice || 0), 0);
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

function fillBoxForm(id) {
  const b = (APP.data.boxes || []).find(x => x.id === id);
  if (!b) return;

  const f = document.getElementById('boxForm');
  f.dataset.editingId = b.id;
  f.elements.name.value = b.name || '';
  f.elements.theme.value = b.theme || '';
  f.elements.discountPct.value = b.discountPct || b.discount_value || 0;
  f.elements.promo.value = b.promo || b.promo_text || '';
  f.elements.manualPrice.checked = asBool(b.manualPrice || b.manual_price);
  f.elements.price.value = (b.price || b.manualPriceValue || b.manual_price_value || 0);
  document.getElementById('boxImage').value = b.image || '';

  document.getElementById('boxLines').innerHTML = '';
  (b.items || []).forEach(id => addBoxLine(id));
  updateBoxPriceHint();
}

function renderBoxes() {
  const rows = APP.data.boxes || [];

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

          <div class="row"><button class="btn" type="submit">Opslaan</button><button class="btn secondary" type="button" id="boxResetBtn">Reset</button></div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Boxenoverzicht</h2><div class="pill">${rows.length} boxen</div></div>
      <div class="panel-body stack">
        ${rows.map(b => {
          const sum = (b.items || []).reduce((s, id) => s + Number(recipeById(id)?.sellPrice || 0), 0);
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
                  <button class="btn secondary" data-edit="${b.id}">Bewerk</button>
                  <button class="btn danger" data-delete="${b.id}">Verwijder</button>
                </div>
              </div>
              <div class="item-meta">
                <span>Items ${(b.items || []).length}</span>
                <span>Som ${money(sum)}</span>
                <span>Korting ${Number(b.discountPct || b.discount_value || 0)}%</span>
                <span>${asBool(b.manualPrice || b.manual_price) ? 'Handmatige prijs' : 'Automatische prijs'}</span>
                <span>${money(b.price || computeBoxPrice(b))}</span>
              </div>
              <div class="footer-note">${(b.items || []).map(id => esc(recipeById(id)?.name || id)).join(' · ')}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `);

  document.getElementById('boxForm').onsubmit = saveBoxForm;
  document.getElementById('addBoxLineBtn').onclick = () => addBoxLine('');
  document.getElementById('boxResetBtn').onclick = () => renderBoxes();
  addBoxLine('');
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => fillBoxForm(btn.dataset.edit));
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => deleteBox(btn.dataset.delete));
  bindBoxLineEvents();
}

async function saveBoxForm(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.dataset.editingId || slugify(f.elements.name.value.trim());
  const manual = f.elements.manualPrice.checked;

  const data = {
    id,
    name: f.elements.name.value.trim(),
    theme: f.elements.theme.value.trim(),
    promo: f.elements.promo.value.trim(),
    discountPct: Number(f.elements.discountPct.value || 0),
    manualPrice: manual,
    manualPriceValue: manual ? Number(f.elements.price.value || 0) : 0,
    price: manual ? Number(f.elements.price.value || 0) : 0,
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
  renderPage();
}

async function deleteBox(id) {
  if (!confirm('Box verwijderen?')) return;
  await apiPost('boxes.delete', { id });
  await loadAllData();
  renderPage();
}

function renderStock() {
  const rows = computePlanRows();
  const total = rows.reduce((s, r) => s + r.subtotal, 0);

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Planning</h3></div>
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
        <div id="planList"></div>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h2>Winkellijst</h2></div>
        <div class="panel-body table-wrap">
          <table>
            <thead>
              <tr><th>Ingrediënt</th><th>Leverancier</th><th>Nodig</th><th>Stock</th><th>Te kopen</th><th>Subtotaal</th></tr>
            </thead>
            <tbody>
              ${rows.length
                ? rows.map(r => `
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
          <div class="item-card"><h4>Totale aankoopkost</h4><div class="status-warn">${money(total)}</div></div>
          <div class="item-card"><h4>Supermarkt</h4><div class="muted">${money(rows.filter(r => r.supplier === 'supermarkt').reduce((s, r) => s + r.subtotal, 0))}</div></div>
          <div class="item-card"><h4>Groothandel</h4><div class="muted">${money(rows.filter(r => r.supplier === 'groothandel').reduce((s, r) => s + r.subtotal, 0))}</div></div>
        </div>
      </div>
    </div>
  `);

  document.getElementById('addPlanBtn').onclick = savePlan;
  document.getElementById('clearPlanBtn').onclick = clearPlan;
  renderPlanList();
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
        <button class="btn secondary" style="width:auto;" data-remove="${idx}">Verwijder</button>
      </div>
    `).join('');

  wrap.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => removePlanIndex(Number(b.dataset.remove)));
}

async function savePlan() {
  const plan = [...(APP.data.plan || [])];
  plan.push({
    recipeId: document.getElementById('stockRecipe').value,
    amount: Number(document.getElementById('stockAmount').value || 1)
  });
  await apiPost('plan.save', plan);
  await loadAllData();
  renderPage();
}

async function clearPlan() {
  if (!confirm('Planning leegmaken?')) return;
  await apiPost('plan.save', []);
  await loadAllData();
  renderPage();
}

async function removePlanIndex(idx) {
  const plan = [...(APP.data.plan || [])];
  plan.splice(idx, 1);
  await apiPost('plan.save', plan);
  await loadAllData();
  renderPage();
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
          <div class="full row"><button class="btn" type="submit">Stijl opslaan</button><button class="btn secondary" type="button" id="menuRefreshBtn">Herlaad preview</button></div>
        </form>
      </div>
    </div>
  `);

  const bg = resolveImage(s.menu_background_image || '', false);
  const menuLogo = resolveImage(s.menu_logo_image || shop.logo || '', false);

  setWorkspace(`
    <div class="menu-board ${bg ? 'has-bg' : ''}" style="${bg ? `--menu-bg-image:url('${bg}')` : ''}">
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
          <h3>Boxmenu's</h3>
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
  `);

  document.getElementById('menuStyleForm').onsubmit = saveMenuStyleForm;
  document.getElementById('menuRefreshBtn').onclick = async () => {
    await loadAllData();
    renderPage();
  };
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
  renderPage();
}

function renderImages() {
  const rows = APP.data.images || [];

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Nieuwe afbeelding</h3></div>
      <div class="panel-body">
        <form id="imageForm" class="stack">
          <div class="form-grid">
            <div class="full"><label>Naam</label><input name="name" required></div>
            <div><label>Code</label><input name="id" required></div>
            <div><label>Scope</label><select name="scope"><option value="ingredient">ingredient</option><option value="recipe">recipe</option><option value="box">box</option><option value="menu">menu</option><option value="logo">logo</option><option value="category">category</option><option value="global">global</option></select></div>
            <div><label>Bestandsnaam / pad</label><input name="file_name" placeholder="voorbeeld.png"></div>
            <div class="full"><label>Upload bestand</label><input type="file" id="imageUpload" accept="image/*"></div>
            <div class="full"><label>Of plak data-url / absolute url</label><textarea name="data_url" placeholder="data:image/png;base64,... of https://..."></textarea></div>
            <div class="full"><label>Notitie</label><textarea name="notes"></textarea></div>
          </div>
          <div class="row"><button class="btn" type="submit">Opslaan</button><button class="btn secondary" type="button" id="imageResetBtn">Reset</button></div>
        </form>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>Afbeeldingenbibliotheek</h2><div class="pill">${rows.length} items</div></div>
      <div class="panel-body stack">
        ${rows.map(img => `
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
                <button class="btn secondary" data-edit="${img.id}">Bewerk</button>
                <button class="btn danger" data-delete="${img.id}">Verwijder</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `);

  document.getElementById('imageForm').onsubmit = saveImageForm;
  document.getElementById('imageResetBtn').onclick = () => renderImages();
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => fillImageForm(btn.dataset.edit));
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => deleteImage(btn.dataset.delete));
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

async function saveImageForm(e) {
  e.preventDefault();
  const f = e.currentTarget;
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
  renderPage();
}

async function deleteImage(id) {
  if (!confirm('Afbeelding verwijderen?')) return;
  await apiPost('images.delete', { id });
  await loadAllData();
  renderPage();
}

function renderSettings() {
  const shop = shopData();

  setSidebar(`
    <div class="panel">
      <div class="panel-head"><h3>Shopinstellingen</h3></div>
      <div class="panel-body">
        <form id="shopForm" class="stack">
          <label>Naam</label><input name="name" value="${esc(shop.name || '')}">
          <label>Ondertitel</label><input name="subtitle" value="${esc(shop.subtitle || '')}">
          <label>Slogan</label><input name="tagline" value="${esc(shop.tagline || '')}">
          <label>Logo</label>${imageSelect('shopLogo', 'logo', shop.logo || '')}
          <div class="row"><button class="btn" type="submit">Opslaan</button></div>
        </form>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>API-verbinding</h3></div>
      <div class="panel-body stack">
        <button class="btn secondary" id="testApiBtn">Verbinding testen</button>
        <div id="apiResult" class="hint">Klik op de knop om de verbinding te testen.</div>
      </div>
    </div>
  `);

  setWorkspace(`
    <div class="panel">
      <div class="panel-head"><h2>API info</h2></div>
      <div class="panel-body stack">
        <div class="item-card"><strong>Apps Script URL</strong><div class="small muted">${esc(window.GEZELLIG_CONFIG.API_URL)}</div></div>
        <div class="item-card"><strong>Spreadsheet naam</strong><div class="small muted">${esc(APP.data.spreadsheetName || '')}</div></div>
      </div>
    </div>
  `);

  document.getElementById('shopForm').onsubmit = saveShopForm;
  document.getElementById('testApiBtn').onclick = testApi;
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
    menu_logo_image: document.getElementById('shopLogo').value
  };

  const rows = Object.entries(merged).map(([key, value]) => ({ key, value }));

  await apiPost('menuSettings.save', rows);
  await loadAllData();
  renderPage();
}

async function testApi() {
  const out = document.getElementById('apiResult');
  try {
    const data = await apiGet('health');
    out.className = 'okline';
    out.textContent = `Verbinding ok. Spreadsheet: ${data.spreadsheet}. Tijdstip: ${data.timestamp}`;
    setLiveStatus('ok', 'Live gekoppeld');
  } catch (err) {
    out.className = 'badline';
    out.textContent = `Verbinding mislukt: ${err.message}`;
    setLiveStatus('bad', 'Verbinding mislukt');
  }
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
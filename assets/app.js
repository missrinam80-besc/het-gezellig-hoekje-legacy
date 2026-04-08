window.GEZELLIG_CONFIG = Object.assign({
  API_URL: 'https://script.google.com/macros/s/AKfycbwhrWNby9HVYPx-e01-eBPAOsRZbQfJtIgtcyHpPEP-q5Vo8eG28N4GB4OQSMwI6Ygq7A/exec',
  API_TOKEN: 'COFFEE_HOOK_0804',
  IMAGE_BASE: '/afbeeldingen',
  RECIPE_IMAGE_BASE: '/afbeeldingen/recepten'
}, window.GEZELLIG_CONFIG || {});

const APP = {
  page: document.body.dataset.page || 'dashboard',
  data: null,
  ingredientsMap: new Map(),
  recipesMap: new Map()
};

const PAGE_META = {
  dashboard: { title: 'Dashboard', intro: 'Overzicht van je shop, live geladen uit Google Sheets.' },
  ingredients: { title: 'Ingrediënten', intro: 'Beheer grondstoffen, verwerkte producten en prijsgegevens rechtstreeks vanuit de sheet.' },
  recipes: { title: 'Recepten', intro: 'Maak en bewerk recepten met live ingrediënten uit Google Sheets.' },
  boxes: { title: 'Boxen', intro: 'Stel boxen samen op basis van bestaande recepten en laat de prijs automatisch berekenen.' },
  stock: { title: 'Stock & Winkellijst', intro: 'Bereken tekorten en aankoopkosten op basis van je planning.' },
  menu: { title: 'Menukaarten', intro: 'Live preview van de kaart en boxen, gevoed door de sheet.' },
  settings: { title: 'Shopinstellingen', intro: 'Beheer shopinstellingen en test de verbinding met de API.' }
};

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, s => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[s]));
}
function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}
function formatMoney(v) { return `€${Number(v || 0).toFixed(2)}`; }
function asBool(v) {
  if (typeof v === 'boolean') return v;
  return ['true','1','ja','yes','y'].includes(String(v || '').toLowerCase().trim());
}
function setStatusBadge() {
  const badge = document.getElementById('storageBadge');
  if (badge) badge.textContent = APP.data ? 'Google Sheet live' : 'Niet geladen';
}

async function apiGet(action) {
  const url = window.GEZELLIG_CONFIG.API_URL;
  if (!url || url.includes('PASTE_HIER')) throw new Error('API_URL is nog niet ingevuld in assets/app.js');
  const res = await fetch(`${url}?action=${encodeURIComponent(action)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Onbekende API-fout');
  return data.data;
}

async function apiPost(action, data = {}, extra = {}) {
  const url = window.GEZELLIG_CONFIG.API_URL;
  const token = window.GEZELLIG_CONFIG.API_TOKEN;
  if (!url || url.includes('PASTE_HIER')) throw new Error('API_URL is nog niet ingevuld in assets/app.js');
  if (!token || token.includes('PASTE_HIER')) throw new Error('API_TOKEN is nog niet ingevuld in assets/app.js');
  const payload = { token, action, data, ...extra };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) });
  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Onbekende API-fout');
  return json.data;
}

async function loadAllData() {
  const data = await apiGet('data.all');
  APP.data = data;
  APP.ingredientsMap = new Map((data.ingredients || []).map(i => [i.id, i]));
  APP.recipesMap = new Map((data.recipes || []).map(r => [r.id, r]));
  setStatusBadge();
  return data;
}

function ingredientById(id) { return APP.ingredientsMap.get(id); }
function recipeById(id) { return APP.recipesMap.get(id); }
function priceForLine(ingredient, amount) {
  const base = Number(ingredient?.pricePerProcessedPiece || ingredient?.price_per_processed_piece || 0);
  const fallback = Number(ingredient?.price || 0);
  return (base || fallback) * Number(amount || 0);
}
function calculateRecipeCost(recipe) {
  return (recipe.ingredients || []).reduce((sum, line) => sum + priceForLine(ingredientById(line.id), line.amount), 0);
}
function foodCostPct(recipe) {
  const sell = Number(recipe.sellPrice || recipe.sell_price || 0);
  return sell ? (calculateRecipeCost(recipe) / sell) * 100 : 0;
}
function recipeStatus(recipe) {
  const missing = [];
  for (const line of (recipe.ingredients || [])) {
    const ing = ingredientById(line.id);
    if (!ing) missing.push(`Ontbrekend ingrediënt: ${line.id}`);
    else if (ing.active === false) missing.push(`${ing.name} staat inactief`);
  }
  if (missing.length) return { label:'Niet haalbaar', cls:'status-bad', lines: missing };
  const pct = foodCostPct(recipe);
  if (!pct) return { label:'Controle nodig', cls:'status-warn', lines:['Geen kostprijs beschikbaar'] };
  if (pct > 65) return { label:'Dunne marge', cls:'status-warn', lines:[`Food cost ${pct.toFixed(1)}%`] };
  return { label:'Haalbaar', cls:'status-ok', lines:[`Food cost ${pct.toFixed(1)}%`] };
}
function computeBoxPrice(box) {
  const sum = (box.items || []).reduce((acc, id) => acc + Number(recipeById(id)?.sellPrice || 0), 0);
  const pct = Number(box.discountPct || box.discount_value || 0);
  return Math.max(0, Math.round(sum * (1 - pct / 100)));
}
function groupedRecipes() {
  return (APP.data.recipes || []).filter(r => r.active !== false).reduce((acc, recipe) => {
    const key = recipe.category || 'Overig';
    (acc[key] ||= []).push(recipe);
    return acc;
  }, {});
}
function buildNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const items = ['dashboard','ingredients','recipes','boxes','stock','menu','settings'];
  nav.innerHTML = items.map(key => {
    const href = key === 'dashboard' ? 'index.html' : `${key}.html`;
    return `<a class="nav-link ${APP.page===key?'active':''}" href="${href}">${escapeHtml(PAGE_META[key].title)}</a>`;
  }).join('');
}
function fillHeader() {
  buildNav();
  const meta = PAGE_META[APP.page] || PAGE_META.dashboard;
  const t = document.getElementById('sidebarTitle');
  const i = document.getElementById('sidebarIntro');
  if (t) t.textContent = meta.title;
  if (i) i.textContent = meta.intro;
  const logo = document.getElementById('brandLogo');
  const brandName = document.getElementById('brandName');
  const brandSub = document.getElementById('brandSub');
  if (APP.data) {
    if (logo) logo.innerHTML = APP.data.shop?.logo ? `<img src="${escapeHtml(APP.data.shop.logo)}" alt="Logo">` : 'GH';
    if (brandName) brandName.textContent = APP.data.shop?.name || "'t Gezellig Hoekje";
    if (brandSub) brandSub.textContent = `${APP.data.shop?.subtitle || 'Koffiebar & Gebak'} · live koppeling`;
  }
}
function setWorkspace(html) {
  document.getElementById('workspace').innerHTML = html;
}
function setSidebar(html) {
  document.getElementById('sidebarContent').innerHTML = html;
}
function imagePath(value, recipeMode = false) {
  if (!value) return '';
  if (/^https?:/i.test(value) || value.startsWith('/') || value.startsWith('data:')) return value;
  const base = recipeMode ? window.GEZELLIG_CONFIG.RECIPE_IMAGE_BASE : window.GEZELLIG_CONFIG.IMAGE_BASE;
  return `${base}/${value}`;
}

function renderDashboard() {
  const ingredients = APP.data.ingredients || [];
  const recipes = APP.data.recipes || [];
  const boxes = APP.data.boxes || [];
  const lowStock = ingredients.filter(i => Number(i.stock || 0) < Number(i.minStock || 0));
  const notReady = recipes.filter(r => recipeStatus(r).label !== 'Haalbaar');
  setSidebar(`
    <div class="panel"><div class="panel-head"><h3>Live status</h3></div><div class="panel-body stack">
      <div class="okline">De pagina gebruikt alleen data uit Google Sheets.</div>
      <div class="item-card small muted">Geen lokale demodata meer actief. Alles wat je ziet komt uit <code>data.all</code>.</div>
    </div></div>
  `);
  setWorkspace(`
    <div class="cards">
      <div class="metric"><small>Ingrediënten</small><strong>${ingredients.length}</strong><span>Live uit de sheet</span></div>
      <div class="metric"><small>Recepten</small><strong>${recipes.length}</strong><span>Live uit de sheet</span></div>
      <div class="metric"><small>Boxen</small><strong>${boxes.length}</strong><span>Live uit de sheet</span></div>
      <div class="metric"><small>Tekorten</small><strong>${lowStock.length}</strong><span>Onder minimumstock</span></div>
    </div>
    <div class="grid-2" style="margin-top:14px;">
      <div class="panel"><div class="panel-head"><h2>Stockwaarschuwingen</h2></div><div class="panel-body stack">
        ${lowStock.length ? lowStock.map(item => `<div class="warnline">${escapeHtml(item.name)} onder minimumstock (${item.stock}/${item.minStock})</div>`).join('') : '<div class="okline">Geen stockwaarschuwingen.</div>'}
      </div></div>
      <div class="panel"><div class="panel-head"><h2>Receptcontrole</h2></div><div class="panel-body stack">
        ${notReady.length ? notReady.map(recipe => {
          const stat = recipeStatus(recipe);
          return `<div class="warnline"><strong>${escapeHtml(recipe.name)}</strong><br>${escapeHtml(stat.lines.join(' · '))}</div>`;
        }).join('') : '<div class="okline">Alle recepten zijn haalbaar.</div>'}
      </div></div>
    </div>
  `);
}

function renderIngredients() {
  const rows = [...(APP.data.ingredients || [])].sort((a,b) => a.name.localeCompare(b.name,'nl'));
  setSidebar(`
    <div class="panel"><div class="panel-head"><h3>Nieuw ingrediënt</h3></div><div class="panel-body">
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
        <div class="full"><label>Notitie</label><textarea name="note"></textarea></div>
        <div class="full row"><button class="btn" type="submit">Opslaan</button><button class="btn secondary" type="button" id="ingredientResetBtn">Reset</button></div>
      </form>
      <div id="ingredientFormStatus" class="small muted"></div>
    </div></div>
  `);
  setWorkspace(`
    <div class="panel"><div class="panel-head"><h2>Ingrediëntenoverzicht</h2><div class="pill">${rows.length} items</div></div>
    <div class="panel-body table-wrap"><table>
      <thead><tr><th>Naam</th><th>Type</th><th>Categorie</th><th>Leverancier</th><th>Prijs</th><th>Cal/stuk</th><th>Sneden</th><th>Prijs/snede</th><th>Gram/stuk</th><th>Prijs/cal</th><th>Stock</th><th>Min</th><th>Acties</th></tr></thead>
      <tbody>
        ${rows.map(item => `
          <tr>
            <td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.supplier)}</td>
            <td>${formatMoney(item.price)}</td><td>${item.caloriesPerProcessedPiece || ''}</td><td>${item.processedYield || ''}</td>
            <td>${item.pricePerProcessedPiece ? formatMoney(item.pricePerProcessedPiece) : ''}</td><td>${item.weightPerPieceG || ''}</td><td>${item.pricePerCalorie || ''}</td>
            <td class="${Number(item.stock||0) < Number(item.minStock||0) ? 'status-bad' : ''}">${item.stock}</td><td>${item.minStock}</td>
            <td><div class="actions"><button class="btn secondary" data-edit="${item.id}">Bewerk</button><button class="btn danger" data-delete="${item.id}">Verwijder</button></div></td>
          </tr>`).join('')}
      </tbody></table></div></div>
  `);
  const form = document.getElementById('ingredientForm');
  const status = document.getElementById('ingredientFormStatus');
  let editingId = null;
  function resetForm() { form.reset(); form.unit.value = 'stuk'; form.supplier.value='supermarkt'; editingId=null; form.id.disabled=false; status.textContent=''; }
  document.getElementById('ingredientResetBtn').onclick = resetForm;
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.id = editingId || payload.id;
    ['price','stock','minStock','caloriesPerProcessedPiece','processedYield','pricePerProcessedPiece','weightPerPieceG','pricePerCalorie'].forEach(k => payload[k] = Number(payload[k] || 0));
    payload.active = true;
    try {
      await apiPost('ingredients.save', payload);
      status.textContent = 'Ingrediënt opgeslagen.';
      await reloadAndRender();
      resetForm();
    } catch (err) { status.textContent = err.message; }
  };
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => {
    const item = ingredientById(btn.dataset.edit);
    editingId = item.id;
    Object.entries({
      id:item.id,name:item.name,type:item.type,category:item.category,supplier:item.supplier,unit:item.unit,price:item.price,stock:item.stock,minStock:item.minStock,
      caloriesPerProcessedPiece:item.caloriesPerProcessedPiece||0,processedYield:item.processedYield||0,pricePerProcessedPiece:item.pricePerProcessedPiece||0,
      weightPerPieceG:item.weightPerPieceG||0,pricePerCalorie:item.pricePerCalorie||0,note:item.note||''
    }).forEach(([k,v]) => { if (form.elements[k]) form.elements[k].value = v; });
    form.id.disabled = true;
    status.textContent = `Bewerken: ${item.name}`;
  });
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Ingrediënt verwijderen?')) return;
    try { await apiPost('ingredients.delete', {}, { id: btn.dataset.delete }); await reloadAndRender(); }
    catch (err) { alert(err.message); }
  });
}

function renderRecipes() {
  const rows = [...(APP.data.recipes || [])].sort((a,b) => a.category.localeCompare(b.category,'nl') || a.name.localeCompare(b.name,'nl'));
  const ingredientOptions = (APP.data.ingredients || []).map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('');
  setSidebar(`
    <div class="panel"><div class="panel-head"><h3>Nieuw recept</h3></div><div class="panel-body stack">
      <form id="recipeForm" class="form-grid">
        <div class="full"><label>Naam</label><input name="name" required></div>
        <div><label>Subtitel</label><input name="sub"></div>
        <div><label>Categorie</label><input name="category"></div>
        <div><label>Type</label><select name="productType"><option value="main">hoofdgerecht</option><option value="snack">hapje</option><option value="drink">drankje</option></select></div>
        <div><label>Station</label><select name="station"><option>drankje maken</option><option>eten maken</option></select></div>
        <div><label>Animatie</label><select name="animation"><option>coffee</option><option>cup</option><option>sandwich</option><option>donut</option><option>bagel</option><option>dinner</option><option>burger</option></select></div>
        <div><label>Calorieën</label><input type="number" min="0" step="100" name="calories" value="600"></div>
        <div><label>Verkoopprijs</label><input type="number" min="0" step="0.01" name="sellPrice" value="0"></div>
        <div class="full"><label>Afbeelding</label><input name="image" placeholder="bv. cappuccino.png"></div>
      </form>
      <div>
        <label>Ingrediënten</label>
        <div id="recipeLines" class="stack"></div>
        <div class="row"><button class="btn secondary" id="addRecipeLineBtn" type="button">Ingrediëntregel toevoegen</button></div>
      </div>
      <div class="row"><button class="btn" id="saveRecipeBtn" type="button">Opslaan</button><button class="btn secondary" id="recipeResetBtn" type="button">Reset</button></div>
      <div id="recipeStatus" class="small muted"></div>
    </div></div>
  `);
  setWorkspace(`
    <div class="panel"><div class="panel-head"><h2>Receptenoverzicht</h2><div class="pill">${rows.length} recepten</div></div><div class="panel-body stack">
      ${rows.map(recipe => {
        const stat = recipeStatus(recipe);
        const cost = calculateRecipeCost(recipe);
        return `<div class="item-card"><div class="row wrap" style="justify-content:space-between;align-items:flex-start;"><div><h4>${escapeHtml(recipe.name)}</h4><div class="muted small">${escapeHtml(recipe.sub || '')}</div></div><div class="actions"><button class="btn secondary" data-edit="${recipe.id}">Bewerk</button><button class="btn danger" data-delete="${recipe.id}">Verwijder</button></div></div><div class="item-meta"><span>${escapeHtml(recipe.category)}</span><span>${escapeHtml(recipe.productType)}</span><span>${escapeHtml(recipe.station)}</span><span>${escapeHtml(recipe.animation)}</span><span>${recipe.calories} cal</span><span>Kost ${formatMoney(cost)}</span><span>Prijs ${formatMoney(recipe.sellPrice)}</span><span class="${stat.cls}">${escapeHtml(stat.label)}</span></div>${recipe.image ? `<div class="footer-note">Afbeelding: ${escapeHtml(recipe.image)}</div>` : ''}<div class="footer-note">Ingrediënten: ${(recipe.ingredients || []).map(line => `${escapeHtml(ingredientById(line.id)?.name || line.id)} × ${line.amount}`).join(', ')}</div></div>`;
      }).join('')}
    </div></div>
  `);
  const form = document.getElementById('recipeForm');
  const linesWrap = document.getElementById('recipeLines');
  const status = document.getElementById('recipeStatus');
  let editingId = null;
  function createLine(prefill = {}) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<select class="grow ingredient-id">${ingredientOptions}</select><input class="ingredient-amount" type="number" min="1" step="1" value="${prefill.amount || 1}" style="max-width:110px"><button class="btn secondary" type="button" style="width:auto">X</button>`;
    row.querySelector('select').value = prefill.id || (APP.data.ingredients[0]?.id || '');
    row.querySelector('button').onclick = () => row.remove();
    linesWrap.appendChild(row);
  }
  function resetForm() {
    form.reset(); form.calories.value = 600; editingId = null; linesWrap.innerHTML=''; createLine(); status.textContent='';
  }
  document.getElementById('addRecipeLineBtn').onclick = () => createLine();
  document.getElementById('recipeResetBtn').onclick = resetForm;
  document.getElementById('saveRecipeBtn').onclick = async () => {
    const fd = new FormData(form); const payload = Object.fromEntries(fd.entries());
    payload.id = editingId || slugify(payload.name);
    payload.calories = Number(payload.calories || 0); payload.sellPrice = Number(payload.sellPrice || 0); payload.active = true;
    payload.ingredients = [...linesWrap.children].map(row => ({ id: row.querySelector('.ingredient-id').value, amount: Number(row.querySelector('.ingredient-amount').value || 1) }));
    try { await apiPost('recipes.save', payload); status.textContent='Recept opgeslagen.'; await reloadAndRender(); resetForm(); }
    catch (err) { status.textContent = err.message; }
  };
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => {
    const item = recipeById(btn.dataset.edit); editingId = item.id;
    Object.entries({ name:item.name, sub:item.sub, category:item.category, productType:item.productType, station:item.station, animation:item.animation, calories:item.calories, sellPrice:item.sellPrice, image:item.image||'' }).forEach(([k,v]) => { if (form.elements[k]) form.elements[k].value = v; });
    linesWrap.innerHTML=''; (item.ingredients || []).forEach(createLine); status.textContent = `Bewerken: ${item.name}`;
  });
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Recept verwijderen?')) return;
    try { await apiPost('recipes.delete', {}, { id: btn.dataset.delete }); await reloadAndRender(); }
    catch (err) { alert(err.message); }
  });
  resetForm();
}

function renderBoxes() {
  const rows = APP.data.boxes || [];
  const recipeOptions = (APP.data.recipes || []).map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  setSidebar(`
    <div class="panel"><div class="panel-head"><h3>Nieuwe box</h3></div><div class="panel-body stack">
      <form id="boxForm" class="form-grid">
        <div class="full"><label>Naam</label><input name="name" required></div>
        <div><label>Thema</label><input name="theme"></div>
        <div><label>Korting %</label><input type="number" min="0" max="100" step="1" name="discountPct" value="8"></div>
        <div class="full"><label>Promo tekst</label><input name="promoText"></div>
        <div class="full"><label>Afbeelding</label><input name="image" placeholder="bv. spoedshift-box.png"></div>
      </form>
      <div><label>Items in box</label><div id="boxLines" class="stack"></div><div class="row"><button class="btn secondary" id="addBoxLineBtn" type="button">Item toevoegen</button></div></div>
      <div class="row"><button class="btn" id="saveBoxBtn" type="button">Opslaan</button><button class="btn secondary" id="boxResetBtn" type="button">Reset</button></div>
      <div id="boxStatus" class="small muted"></div>
      <div id="boxPriceHint" class="hint"></div>
    </div></div>
  `);
  setWorkspace(`
    <div class="panel"><div class="panel-head"><h2>Boxenoverzicht</h2><div class="pill">${rows.length} boxen</div></div><div class="panel-body stack">
      ${rows.map(box => {
        const sum = (box.items || []).reduce((s,id) => s + Number(recipeById(id)?.sellPrice || 0), 0);
        const price = computeBoxPrice(box);
        return `<div class="item-card"><div class="row wrap" style="justify-content:space-between;align-items:flex-start;"><div><h4>${escapeHtml(box.name)}</h4><div class="muted small">${escapeHtml(box.theme || '')}</div></div><div class="actions"><button class="btn secondary" data-edit="${box.id}">Bewerk</button><button class="btn danger" data-delete="${box.id}">Verwijder</button></div></div><div class="item-meta"><span>Items ${(box.items||[]).length}</span><span>Som recepten ${formatMoney(sum)}</span><span>Korting ${Number(box.discountPct||0)}%</span><span>Boxprijs ${formatMoney(price)}</span></div><div class="footer-note">${(box.items||[]).map(id => escapeHtml(recipeById(id)?.name || id)).join(' · ')}</div><div class="footer-note">${escapeHtml(box.promoText || '')}</div></div>`;
      }).join('')}
    </div></div>
  `);
  const form = document.getElementById('boxForm'); const linesWrap = document.getElementById('boxLines'); const status = document.getElementById('boxStatus'); const hint = document.getElementById('boxPriceHint');
  let editingId = null;
  function createLine(value) { const row=document.createElement('div'); row.className='row'; row.innerHTML=`<select class="grow box-recipe">${recipeOptions}</select><button class="btn secondary" type="button" style="width:auto">X</button>`; row.querySelector('select').value=value || (APP.data.recipes[0]?.id || ''); row.querySelector('button').onclick=()=>{row.remove(); updateHint();}; row.querySelector('select').onchange=updateHint; linesWrap.appendChild(row); updateHint(); }
  function updateHint(){ const ids=[...linesWrap.querySelectorAll('select')].map(s=>s.value).filter(Boolean); const sum=ids.reduce((a,id)=>a+Number(recipeById(id)?.sellPrice||0),0); const pct=Number(form.discountPct.value||0); hint.textContent=`Som recepten: ${formatMoney(sum)} · Automatische boxprijs: ${formatMoney(Math.max(0, Math.round(sum*(1-pct/100))))}.`; }
  function resetForm(){ form.reset(); form.discountPct.value=8; editingId=null; linesWrap.innerHTML=''; createLine(); status.textContent=''; updateHint(); }
  document.getElementById('addBoxLineBtn').onclick=()=>createLine(); document.getElementById('boxResetBtn').onclick=resetForm; form.discountPct.oninput=updateHint;
  document.getElementById('saveBoxBtn').onclick=async()=>{ const fd=new FormData(form); const payload=Object.fromEntries(fd.entries()); payload.id=editingId || slugify(payload.name); payload.items=[...linesWrap.querySelectorAll('select')].map(s=>s.value).filter(Boolean); payload.discountPct=Number(payload.discountPct||0); payload.manualPrice=false; payload.active=true; try{ await apiPost('boxes.save', payload); status.textContent='Box opgeslagen.'; await reloadAndRender(); resetForm(); } catch(err){ status.textContent=err.message; } };
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => { const item=rows.find(b=>b.id===btn.dataset.edit); editingId=item.id; Object.entries({name:item.name,theme:item.theme,promoText:item.promoText||'',discountPct:item.discountPct||0,image:item.image||''}).forEach(([k,v])=>{ if(form.elements[k]) form.elements[k].value=v;}); linesWrap.innerHTML=''; (item.items||[]).forEach(createLine); status.textContent=`Bewerken: ${item.name}`; updateHint(); });
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async()=>{ if(!confirm('Box verwijderen?')) return; try{ await apiPost('boxes.delete', {}, { id: btn.dataset.delete }); await reloadAndRender(); } catch(err){ alert(err.message);} });
  resetForm();
}

function renderStock() {
  const plan = APP.data.plan || [];
  const computed = new Map();
  plan.forEach(entry => {
    const recipe = recipeById(entry.recipeId);
    if (!recipe) return;
    (recipe.ingredients || []).forEach(line => {
      computed.set(line.id, (computed.get(line.id) || 0) + Number(line.amount || 0) * Number(entry.amount || 0));
    });
  });
  const rows = [...computed.entries()].map(([id, need]) => {
    const ingredient = ingredientById(id) || { name:id, supplier:'onbekend', stock:0, price:0 };
    const stock = Number(ingredient.stock || 0);
    const buy = Math.max(0, need - stock);
    const unitPrice = Number(ingredient.pricePerProcessedPiece || ingredient.price || 0);
    return { name: ingredient.name, supplier: ingredient.supplier, need, stock, buy, subtotal: buy * unitPrice };
  }).sort((a,b)=>a.name.localeCompare(b.name,'nl'));
  setSidebar(`
    <div class="panel"><div class="panel-head"><h3>Planning</h3></div><div class="panel-body stack">
      <form id="planForm" class="stack"><div><label>Recept</label><select name="recipeId">${(APP.data.recipes||[]).map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select></div><div><label>Aantal</label><input type="number" name="amount" min="1" step="1" value="1"></div><div class="row"><button class="btn" type="submit">Toevoegen</button><button class="btn secondary" type="button" id="clearPlanBtn">Leegmaken</button></div></form><div id="planList">${plan.length ? plan.map((row,idx)=>`<div class="item-card row" style="justify-content:space-between;"><div><strong>${escapeHtml(recipeById(row.recipeId)?.name || row.recipeId)}</strong><div class="muted small">${row.amount} stuks</div></div><button class="btn secondary" style="width:auto" data-remove="${idx}">Verwijder</button></div>`).join('') : '<div class="item-card muted small">Nog geen planregels.</div>'}</div>
    </div></div>
  `);
  const total = rows.reduce((s,r)=>s+r.subtotal,0);
  setWorkspace(`
    <div class="grid-2"><div class="panel"><div class="panel-head"><h2>Winkellijst</h2></div><div class="panel-body table-wrap"><table><thead><tr><th>Ingrediënt</th><th>Leverancier</th><th>Nodig</th><th>Stock</th><th>Te kopen</th><th>Subtotaal</th></tr></thead><tbody>${rows.length ? rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.supplier)}</td><td>${r.need}</td><td>${r.stock}</td><td class="${r.buy>0?'status-bad':'status-ok'}">${r.buy}</td><td>${formatMoney(r.subtotal)}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">Nog geen planning.</td></tr>'}</tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h2>Samenvatting</h2></div><div class="panel-body stack small"><div class="item-card"><h4>Totale aankoopkost</h4><div class="status-warn">${formatMoney(total)}</div></div><div class="item-card"><h4>Supermarkt</h4><div class="muted">${formatMoney(rows.filter(r=>r.supplier==='supermarkt').reduce((s,r)=>s+r.subtotal,0))}</div></div><div class="item-card"><h4>Groothandel</h4><div class="muted">${formatMoney(rows.filter(r=>r.supplier==='groothandel').reduce((s,r)=>s+r.subtotal,0))}</div></div></div></div></div>
  `);
  document.getElementById('planForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nextPlan = [...(APP.data.plan || []), { recipeId: fd.get('recipeId'), amount: Number(fd.get('amount') || 1) }];
    const nextState = JSON.parse(JSON.stringify(APP.data)); nextState.plan = nextPlan;
    try { await apiPost('import.all', nextState); await reloadAndRender(); } catch (err) { alert(err.message); }
  };
  document.getElementById('clearPlanBtn').onclick = async () => {
    if (!confirm('Planning leegmaken?')) return;
    const nextState = JSON.parse(JSON.stringify(APP.data)); nextState.plan = [];
    try { await apiPost('import.all', nextState); await reloadAndRender(); } catch (err) { alert(err.message); }
  };
  document.querySelectorAll('[data-remove]').forEach(btn => btn.onclick = async () => {
    const nextState = JSON.parse(JSON.stringify(APP.data)); nextState.plan.splice(Number(btn.dataset.remove),1);
    try { await apiPost('import.all', nextState); await reloadAndRender(); } catch (err) { alert(err.message); }
  });
}

function renderMenu() {
  const grouped = groupedRecipes();
  const categories = APP.data.settings?.menuCategories || [];
  const logoHtml = APP.data.shop?.logo ? `<img src="${escapeHtml(APP.data.shop.logo)}" alt="Logo">` : 'GH';
  setSidebar(`
    <div class="panel"><div class="panel-head"><h3>Afbeeldingspaden</h3></div><div class="panel-body stack small muted">
      <div>Algemene afbeeldingen: <code>${escapeHtml(window.GEZELLIG_CONFIG.IMAGE_BASE)}</code></div>
      <div>Receptafbeeldingen: <code>${escapeHtml(window.GEZELLIG_CONFIG.RECIPE_IMAGE_BASE)}</code></div>
      <div>Gebruik in de sheet best alleen bestandsnamen of volledige paden.</div>
    </div></div>
  `);
  setWorkspace(`
    <div class="menu-board"><div class="menu-head"><div class="menu-logo">${logoHtml}</div><div><div class="menu-brand">${escapeHtml(APP.data.shop?.name || "'t Gezellig Hoekje")}</div><div class="menu-sub">${escapeHtml(APP.data.shop?.subtitle || 'Koffiebar & Gebak')}</div><div class="menu-tag">${escapeHtml(APP.data.shop?.tagline || '')}</div></div></div>
    <div class="menu-grid"><div class="menu-card"><h3>Menukaart</h3><div class="menu-sections">${categories.map(category => { const recipes = grouped[category] || []; return `<div class="menu-section"><h4>${escapeHtml(category)}</h4>${recipes.map(recipe => `<div class="menu-entry"><div><b>${escapeHtml(recipe.name)}</b><small>${escapeHtml(recipe.sub || '')}</small></div><strong>${formatMoney(recipe.sellPrice)}</strong></div>${recipe.image ? `<img class="recipe-image-preview" src="${escapeHtml(imagePath(recipe.image, true))}" alt="${escapeHtml(recipe.name)}">` : ''}`).join('') || '<div class="muted small">Nog geen items.</div>'}</div>`; }).join('')}</div></div>
    <div class="box-card"><h3>Boxmenu's</h3><div class="boxes">${(APP.data.boxes || []).filter(b => b.active !== false).map(box => `<div class="item-card"><h4>${escapeHtml(box.name)}</h4><div class="muted small">${escapeHtml(box.theme || '')}</div><ul>${(box.items || []).map(id => `<li>${escapeHtml(recipeById(id)?.name || id)}</li>`).join('')}</ul><div class="promo">Promo ${formatMoney(computeBoxPrice(box))}</div><div class="footer-note">${escapeHtml(box.promoText || '')}</div></div>`).join('')}</div></div></div></div>
  `);
}

function renderSettings() {
  const menuSettingsRows = [
    ['brand_name', APP.data.shop?.name || "'t Gezellig Hoekje"],
    ['subtitle', APP.data.shop?.subtitle || 'Koffiebar & Gebak'],
    ['tagline', APP.data.shop?.tagline || ''],
    ['logo', APP.data.shop?.logo || ''],
    ['menu_categories', (APP.data.settings?.menuCategories || []).join(', ')],
    ['footer_left', APP.data.settings?.footerLeft || ''],
    ['footer_right', APP.data.settings?.footerRight || '']
  ];
  setSidebar(`
    <div class="panel"><div class="panel-head"><h3>API-test</h3></div><div class="panel-body stack">
      <div class="item-card small muted">API URL en token staan vast in <code>assets/app.js</code>.</div>
      <button class="btn secondary" id="testApiBtn">Verbinding testen</button>
      <div id="apiTestResult" class="hint">Nog niet getest.</div>
    </div></div>
  `);
  setWorkspace(`
    <div class="grid-2"><div class="panel"><div class="panel-head"><h2>Shopinstellingen</h2></div><div class="panel-body">
      <form id="settingsForm" class="form-grid">
        <div class="full"><label>Naam zaak</label><input name="brand_name" value="${escapeHtml(menuSettingsRows[0][1])}"></div>
        <div class="full"><label>Ondertitel</label><input name="subtitle" value="${escapeHtml(menuSettingsRows[1][1])}"></div>
        <div class="full"><label>Slogan</label><input name="tagline" value="${escapeHtml(menuSettingsRows[2][1])}"></div>
        <div class="full"><label>Logo pad</label><input name="logo" value="${escapeHtml(menuSettingsRows[3][1])}" placeholder="/afbeeldingen/logo.png"></div>
        <div class="full"><label>Menucategorieën</label><input name="menu_categories" value="${escapeHtml(menuSettingsRows[4][1])}"></div>
        <div><label>Footer links</label><input name="footer_left" value="${escapeHtml(menuSettingsRows[5][1])}"></div>
        <div><label>Footer rechts</label><input name="footer_right" value="${escapeHtml(menuSettingsRows[6][1])}"></div>
        <div class="full row"><button class="btn" type="submit">Opslaan naar sheet</button></div>
      </form><div id="settingsStatus" class="small muted"></div>
    </div></div>
    <div class="panel"><div class="panel-head"><h2>Live preview</h2></div><div class="panel-body stack">${APP.data.shop?.logo ? `<img class="logo-preview" src="${escapeHtml(APP.data.shop.logo)}" alt="Logo">` : '<div class="item-card muted small">Geen logopad ingesteld.</div>'}<div class="item-card"><h4>${escapeHtml(APP.data.shop?.name || '')}</h4><div class="muted">${escapeHtml(APP.data.shop?.subtitle || '')}</div><div class="footer-note">${escapeHtml(APP.data.shop?.tagline || '')}</div></div></div></div></div>
  `);
  document.getElementById('testApiBtn').onclick = async () => {
    const out = document.getElementById('apiTestResult');
    try {
      const result = await apiGet('health');
      out.className = 'okline';
      out.textContent = `Succes: ${result.status} · ${result.timestamp}`;
    } catch (err) {
      out.className = 'badline';
      out.textContent = `Fout: ${err.message}`;
    }
  };
  document.getElementById('settingsForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rows = [...fd.entries()].map(([key, value]) => ({ key, value }));
    try { await apiPost('menuSettings.save', rows); document.getElementById('settingsStatus').textContent='Instellingen opgeslagen.'; await reloadAndRender(); }
    catch (err) { document.getElementById('settingsStatus').textContent = err.message; }
  };
}

async function reloadAndRender() {
  await loadAllData();
  fillHeader();
  const renderer = {
    dashboard: renderDashboard,
    ingredients: renderIngredients,
    recipes: renderRecipes,
    boxes: renderBoxes,
    stock: renderStock,
    menu: renderMenu,
    settings: renderSettings
  }[APP.page] || renderDashboard;
  renderer();
}

async function boot() {
  try {
    document.getElementById('workspace').innerHTML = '<div class="loading">Data wordt geladen uit Google Sheets…</div>';
    await loadAllData();
    fillHeader();
    await reloadAndRender();
  } catch (err) {
    fillHeader();
    setSidebar(`<div class="panel"><div class="panel-head"><h3>Fout</h3></div><div class="panel-body"><div class="error-box">${escapeHtml(err.message)}</div></div></div>`);
    setWorkspace(`<div class="error-box">De live koppeling kon niet geladen worden. Controleer <code>assets/app.js</code> en je Apps Script deployment.<br><br>${escapeHtml(err.message)}</div>`);
  }
}

document.addEventListener('DOMContentLoaded', boot);

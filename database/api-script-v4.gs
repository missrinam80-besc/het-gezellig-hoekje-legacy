/**
 * 't Gezellig Hoekje — Google Sheets API v4
 * Vast in script instelbaar:
 * - FIXED_SPREADSHEET_ID
 * - FIXED_API_TOKEN
 */
const FIXED_SPREADSHEET_ID = '1XOUu-frFePM2I7MVX_3e3uGYGg_X1fq0J9Sc3pT7-p4';
const FIXED_API_TOKEN = 'COFFEE_HOOK_0804';

const SHEETS = {
  ingredients: ['id','name','type','category','supplier','unit','price','stock','min_stock','active','image','calories_per_processed_piece','processed_yield','price_per_processed_piece','weight_per_piece_g','price_per_calorie','notes'],
  processed_products: ['id','name','process_type','source_item_1','source_amount_1','source_item_2','source_amount_2','yield','unit','active','notes'],
  recipes: ['id','name','subtitle','category','product_type','station','animation','calories','sell_price','visible_on_menu','active','description','image','status'],
  recipe_ingredients: ['recipe_id','ingredient_id','amount','sort_order'],
  boxes: ['id','name','theme','promo_text','discount_type','discount_value','manual_price','manual_price_value','active','image'],
  box_items: ['box_id','recipe_id','sort_order'],
  menu_settings: ['key','value'],
  stock_logs: ['timestamp','action','item_id','delta','old_value','new_value','note','user'],
  images: ['id','name','scope','file_name','data_url','active','notes']
};

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || '').trim();
    switch (action) {
      case 'health':
        return jsonResponse({ ok: true, data: { status: 'ok', timestamp: new Date().toISOString(), spreadsheet: getSpreadsheet_().getName() } });
      case 'data.all':
        return jsonResponse({ ok: true, data: exportAllAsState_() });
      case 'images.list':
        return jsonResponse({ ok: true, data: listRows_('images').map(mapImageRow_) });
      case 'ingredients.list':
        return jsonResponse({ ok: true, data: listRows_('ingredients').map(mapIngredientRow_) });
      case 'recipes.list':
        return jsonResponse({ ok: true, data: listRecipesExpanded_() });
      case 'boxes.list':
        return jsonResponse({ ok: true, data: listBoxesExpanded_() });
      default:
        return jsonResponse({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const payload = parsePostPayload_(e);
    requireToken_(payload.token);
    switch (payload.action) {
      case 'ingredients.save':
        return jsonResponse({ ok: true, data: saveIngredient_(payload.data) });
      case 'ingredients.delete':
        deleteRowById_('ingredients', payload.data.id || payload.id);
        return jsonResponse({ ok: true });
      case 'recipes.save':
        return jsonResponse({ ok: true, data: saveRecipeExpanded_(payload.data) });
      case 'recipes.delete':
        deleteRecipeExpanded_(payload.data.id || payload.id);
        return jsonResponse({ ok: true });
      case 'boxes.save':
        return jsonResponse({ ok: true, data: saveBoxExpanded_(payload.data) });
      case 'boxes.delete':
        deleteBoxExpanded_(payload.data.id || payload.id);
        return jsonResponse({ ok: true });
      case 'images.save':
        return jsonResponse({ ok: true, data: saveImage_(payload.data) });
      case 'images.delete':
        deleteRowById_('images', payload.data.id || payload.id);
        return jsonResponse({ ok: true });
      case 'menuSettings.save':
        replaceAllRows_('menu_settings', payload.data || []);
        return jsonResponse({ ok: true });
      case 'plan.save':
        return jsonResponse({ ok: true, data: savePlan_(payload.data || []) });
      case 'bootstrap.sheets':
        ensureSheets_();
        return jsonResponse({ ok: true });
      default:
        return jsonResponse({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonResponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function parsePostPayload_(e) {
  if (e && e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  const raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '{}';
  if (!raw) return {};
  if (raw.indexOf('payload=') === 0) return JSON.parse(decodeURIComponent(raw.substring(8).replace(/\+/g, ' ')));
  return JSON.parse(raw);
}
function getConfigValue_(key, fixedValue) {
  if (fixedValue && String(fixedValue).trim() && String(fixedValue).indexOf('PASTE_HIER') !== 0) return String(fixedValue).trim();
  return PropertiesService.getScriptProperties().getProperty(key);
}
function requireToken_(token) {
  const expected = getConfigValue_('API_TOKEN', FIXED_API_TOKEN);
  if (!expected) throw new Error('Missing API token');
  if (String(token || '') !== String(expected)) throw new Error('Unauthorized');
}
function getSpreadsheet_() {
  const id = getConfigValue_('SPREADSHEET_ID', FIXED_SPREADSHEET_ID);
  if (!id) throw new Error('Missing spreadsheet id');
  return SpreadsheetApp.openById(id);
}
function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}
function ensureSheets_() {
  const ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function(name){
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    const currentHeaders = sh.getLastColumn() ? sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0] : [];
    if (JSON.stringify(headers) !== JSON.stringify(currentHeaders)) {
      sh.clearContents();
      sh.getRange(1,1,1,headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
  });
}
function rowToObject_(headers, row) { const obj = {}; headers.forEach(function(h, i){ obj[h] = row[i]; }); return obj; }
function listRows_(sheetName) {
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function(r){ return r.some(function(v){ return v !== ''; }); }).map(function(r){ return rowToObject_(headers, r); });
}
function saveRowById_(sheetName, data) {
  if (!data || !data.id) throw new Error('Missing data.id');
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');
  const rowValues = headers.map(function(h){ return data[h] !== undefined ? data[h] : ''; });
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(data.id)) {
      sh.getRange(r + 1, 1, 1, headers.length).setValues([rowValues]);
      return data;
    }
  }
  sh.appendRow(rowValues);
  return data;
}
function deleteRowById_(sheetName, id) {
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][idCol]) === String(id)) sh.deleteRow(r + 1);
  }
}
function replaceAllRows_(sheetName, rows) {
  const sh = getSheet_(sheetName);
  const headers = SHEETS[sheetName];
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  if (!rows || !rows.length) return;
  const matrix = rows.map(function(row){ return headers.map(function(h){ return row[h] !== undefined ? row[h] : ''; }); });
  sh.getRange(2,1,matrix.length,headers.length).setValues(matrix);
}
function deleteRowsByMatch_(sheetName, fieldName, fieldValue) {
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idx = headers.indexOf(fieldName);
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][idx]) === String(fieldValue)) sh.deleteRow(r + 1);
  }
}
function normalizeBool_(v) {
  if (typeof v === 'boolean') return v;
  return ['true','1','ja','yes','y'].indexOf(String(v || '').toLowerCase().trim()) !== -1;
}

function mapIngredientRow_(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    supplier: row.supplier,
    unit: row.unit,
    price: Number(row.price || 0),
    stock: Number(row.stock || 0),
    minStock: Number(row.min_stock || 0),
    caloriesPerProcessedPiece: Number(row.calories_per_processed_piece || 0),
    processedYield: Number(row.processed_yield || 0),
    pricePerProcessedPiece: Number(row.price_per_processed_piece || 0),
    weightPerPieceG: Number(row.weight_per_piece_g || 0),
    pricePerCalorie: Number(row.price_per_calorie || 0),
    active: normalizeBool_(row.active),
    image: row.image || '',
    note: row.notes || ''
  };
}
function saveIngredient_(item) {
  if (!item || !item.id || !item.name) throw new Error('Ingredient requires id and name');
  const row = {
    id: item.id,
    name: item.name || '',
    type: item.type || '',
    category: item.category || '',
    supplier: item.supplier || '',
    unit: item.unit || '',
    price: Number(item.price || 0),
    stock: Number(item.stock || 0),
    min_stock: Number(item.minStock || item.min_stock || 0),
    active: item.active !== false,
    image: item.image || '',
    calories_per_processed_piece: Number(item.caloriesPerProcessedPiece || item.calories_per_processed_piece || 0),
    processed_yield: Number(item.processedYield || item.processed_yield || 0),
    price_per_processed_piece: Number(item.pricePerProcessedPiece || item.price_per_processed_piece || 0),
    weight_per_piece_g: Number(item.weightPerPieceG || item.weight_per_piece_g || 0),
    price_per_calorie: Number(item.pricePerCalorie || item.price_per_calorie || 0),
    notes: item.note || item.notes || ''
  };
  saveRowById_('ingredients', row);
  return mapIngredientRow_(row);
}

function listRecipesExpanded_() {
  const recipes = listRows_('recipes');
  const recipeIngredients = listRows_('recipe_ingredients');
  return recipes.map(function(recipe){
    return {
      id: recipe.id,
      name: recipe.name,
      sub: recipe.subtitle || '',
      category: recipe.category || '',
      productType: recipe.product_type || '',
      station: recipe.station || '',
      animation: recipe.animation || '',
      calories: Number(recipe.calories || 0),
      sellPrice: Number(recipe.sell_price || 0),
      visibleOnMenu: normalizeBool_(recipe.visible_on_menu),
      active: normalizeBool_(recipe.active),
      description: recipe.description || '',
      image: recipe.image || '',
      status: recipe.status || '',
      ingredients: recipeIngredients.filter(function(line){ return String(line.recipe_id) === String(recipe.id); }).sort(function(a,b){ return Number(a.sort_order || 0) - Number(b.sort_order || 0); }).map(function(line){ return { id: line.ingredient_id, amount: Number(line.amount || 0) }; })
    };
  });
}
function saveRecipeExpanded_(recipe) {
  if (!recipe || !recipe.id || !recipe.name) throw new Error('Recipe requires id and name');
  saveRowById_('recipes', {
    id: recipe.id,
    name: recipe.name,
    subtitle: recipe.sub || recipe.subtitle || '',
    category: recipe.category || '',
    product_type: recipe.productType || recipe.product_type || '',
    station: recipe.station || '',
    animation: recipe.animation || '',
    calories: Number(recipe.calories || 0),
    sell_price: Number(recipe.sellPrice || recipe.sell_price || 0),
    visible_on_menu: recipe.visibleOnMenu !== false,
    active: recipe.active !== false,
    description: recipe.description || '',
    image: recipe.image || '',
    status: recipe.status || 'draft'
  });
  deleteRowsByMatch_('recipe_ingredients', 'recipe_id', recipe.id);
  const sh = getSheet_('recipe_ingredients');
  (recipe.ingredients || []).forEach(function(line, index){ sh.appendRow([recipe.id, line.id || line.ingredient_id || '', Number(line.amount || 0), index + 1]); });
  return recipe;
}
function deleteRecipeExpanded_(id) {
  deleteRowById_('recipes', id);
  deleteRowsByMatch_('recipe_ingredients', 'recipe_id', id);
  deleteRowsByMatch_('box_items', 'recipe_id', id);
}

function listBoxesExpanded_() {
  const boxes = listRows_('boxes');
  const items = listRows_('box_items');
  return boxes.map(function(box){
    return {
      id: box.id,
      name: box.name,
      theme: box.theme || '',
      promo: box.promo_text || '',
      discountPct: Number(box.discount_value || 0),
      manualPrice: normalizeBool_(box.manual_price),
      manualPriceValue: Number(box.manual_price_value || 0),
      active: normalizeBool_(box.active),
      image: box.image || '',
      price: 0,
      items: items.filter(function(line){ return String(line.box_id) === String(box.id); }).sort(function(a,b){ return Number(a.sort_order || 0) - Number(b.sort_order || 0); }).map(function(line){ return line.recipe_id; })
    };
  }).map(function(box){ box.price = box.manualPrice ? Number(box.manualPriceValue || 0) : computeBoxPriceServer_(box); return box; });
}
function computeBoxPriceServer_(box) {
  const recipes = listRecipesExpanded_();
  const map = {};
  recipes.forEach(function(r){ map[r.id] = r; });
  const total = (box.items || []).reduce(function(sum, id){ return sum + Number((map[id] || {}).sellPrice || 0); }, 0);
  const pct = Number(box.discountPct || 0);
  return Math.max(0, Math.round(total * (1 - pct / 100)));
}
function saveBoxExpanded_(box) {
  if (!box || !box.id || !box.name) throw new Error('Box requires id and name');
  saveRowById_('boxes', {
    id: box.id,
    name: box.name,
    theme: box.theme || '',
    promo_text: box.promo || box.promo_text || '',
    discount_type: 'percent',
    discount_value: Number(box.discountPct || box.discount_value || 0),
    manual_price: box.manualPrice === true,
    manual_price_value: Number(box.manualPriceValue || box.manual_price_value || box.price || 0),
    active: box.active !== false,
    image: box.image || ''
  });
  deleteRowsByMatch_('box_items', 'box_id', box.id);
  const sh = getSheet_('box_items');
  (box.items || []).forEach(function(recipeId, index){ sh.appendRow([box.id, recipeId, index + 1]); });
  return box;
}
function deleteBoxExpanded_(id) {
  deleteRowById_('boxes', id);
  deleteRowsByMatch_('box_items', 'box_id', id);
}

function mapImageRow_(row) {
  return { id: row.id, name: row.name, scope: row.scope || 'global', fileName: row.file_name || '', dataUrl: row.data_url || '', active: normalizeBool_(row.active), notes: row.notes || '' };
}
function saveImage_(img) {
  if (!img || !img.id || !img.name) throw new Error('Image requires id and name');
  const row = { id: img.id, name: img.name, scope: img.scope || 'global', file_name: img.fileName || img.file_name || '', data_url: img.dataUrl || img.data_url || '', active: img.active !== false, notes: img.notes || '' };
  saveRowById_('images', row);
  return mapImageRow_(row);
}

function savePlan_(plan) {
  const settings = listRows_('menu_settings').filter(function(r){ return String(r.key) !== 'plan_json'; });
  settings.push({ key: 'plan_json', value: JSON.stringify(plan || []) });
  replaceAllRows_('menu_settings', settings);
  return plan;
}

function exportAllAsState_() {
  const settingsRows = listRows_('menu_settings');
  const settingsMap = {};
  settingsRows.forEach(function(r){ settingsMap[r.key] = r.value; });
  return {
    spreadsheetName: getSpreadsheet_().getName(),
    shop: {
      name: settingsMap.brand_name || "'t Gezellig Hoekje",
      subtitle: settingsMap.subtitle || 'Koffiebar & Gebak',
      tagline: settingsMap.tagline || 'Warm welkom op het gezelligste plekje van de stad!',
      logo: settingsMap.menu_logo_image || ''
    },
    menuSettings: settingsRows,
    ingredients: listRows_('ingredients').map(mapIngredientRow_),
    recipes: listRecipesExpanded_(),
    boxes: listBoxesExpanded_(),
    images: listRows_('images').map(mapImageRow_),
    plan: parsePlan_(settingsMap.plan_json)
  };
}
function parsePlan_(value) {
  try { return value ? JSON.parse(value) : []; } catch (err) { return []; }
}

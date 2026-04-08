/**
 * 't Gezellig Hoekje — Google Sheets API voor de tool
 *
 * Vereist Script Properties:
 * - SPREADSHEET_ID
 * - API_TOKEN
 *
 * Deploy als Web App:
 * Execute as: Me
 * Access: anyone with the link (of beperkter indien gewenst)
 */

const SHEETS = {
  ingredients: ["id","name","type","category","supplier","unit","price","stock","min_stock","calories_per_processed_piece","processed_yield","price_per_processed_piece","weight_per_piece_g","price_per_calorie","active","image","notes"],
  processed_products: ["id","name","process_type","source_item_1","source_amount_1","source_item_2","source_amount_2","yield","unit","active","notes"],
  recipes: ["id","name","subtitle","category","product_type","station","animation","calories","sell_price","visible_on_menu","active","description","image","status"],
  recipe_ingredients: ["recipe_id","ingredient_id","amount","sort_order"],
  boxes: ["id","name","theme","promo_text","discount_type","discount_value","manual_price","active","image"],
  box_items: ["box_id","recipe_id","sort_order"],
  menu_settings: ["key","value"],
  stock_logs: ["timestamp","action","item_id","delta","old_value","new_value","note","user"]
};

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || '').trim();

    switch (action) {
      case 'health':
        return jsonResponse({ ok: true, data: { status: 'ok', timestamp: new Date().toISOString() } });

      case 'ingredients.list':
        return jsonResponse({ ok: true, data: listRows_('ingredients') });

      case 'processed.list':
        return jsonResponse({ ok: true, data: listRows_('processed_products') });

      case 'recipes.list':
        return jsonResponse({ ok: true, data: listRecipesExpanded_() });

      case 'boxes.list':
        return jsonResponse({ ok: true, data: listBoxesExpanded_() });

      case 'menuSettings.get':
        return jsonResponse({ ok: true, data: listRows_('menu_settings') });

      case 'data.all':
        return jsonResponse({ ok: true, data: exportAllAsState_() });

      case 'dashboard.summary':
        return jsonResponse({ ok: true, data: buildDashboardSummary_() });

      case 'template.headers':
        return jsonResponse({ ok: true, data: SHEETS });

      default:
        return jsonResponse({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const payload = parseJsonPost_(e);
    requireToken_(payload.token);

    switch (payload.action) {
      case 'ingredients.save':
        return jsonResponse({ ok: true, data: saveIngredient_(payload.data) });

      case 'ingredients.delete':
        deleteRowById_('ingredients', payload.id);
        return jsonResponse({ ok: true });

      case 'processed.save':
        return jsonResponse({ ok: true, data: saveRowById_('processed_products', payload.data) });

      case 'processed.delete':
        deleteRowById_('processed_products', payload.id);
        return jsonResponse({ ok: true });

      case 'recipes.save':
        return jsonResponse({ ok: true, data: saveRecipeExpanded_(payload.data) });

      case 'recipes.delete':
        deleteRecipeExpanded_(payload.id);
        return jsonResponse({ ok: true });

      case 'boxes.save':
        return jsonResponse({ ok: true, data: saveBoxExpanded_(payload.data) });

      case 'boxes.delete':
        deleteBoxExpanded_(payload.id);
        return jsonResponse({ ok: true });

      case 'menuSettings.save':
        replaceAllRows_('menu_settings', payload.data || []);
        return jsonResponse({ ok: true });

      case 'stock.adjust':
        return jsonResponse({ ok: true, data: adjustStock_(payload.data) });

      case 'import.all':
        importState_(payload.data || {});
        return jsonResponse({ ok: true, data: exportAllAsState_() });

      case 'reset.demo':
        importState_(getDemoState_());
        return jsonResponse({ ok: true, data: exportAllAsState_() });

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

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseJsonPost_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(raw);
}

function requireToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) throw new Error('Missing API_TOKEN in Script Properties');
  if (token !== expected) throw new Error('Unauthorized');
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Missing SPREADSHEET_ID in Script Properties');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function ensureSheets_() {
  const ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    const currentHeaders = sh.getLastColumn() ? sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0] : [];
    const mismatch = JSON.stringify(headers) !== JSON.stringify(currentHeaders);
    if (mismatch) {
      sh.clearContents();
      sh.getRange(1,1,1,headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
  });
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => obj[h] = row[i]);
  return obj;
}

function listRows_(sheetName) {
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(r => r.some(v => v !== '')).map(r => rowToObject_(headers, r));
}

function saveRowById_(sheetName, data) {
  if (!data || !data.id) throw new Error('Missing data.id');
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');
  if (idCol === -1) throw new Error('No id column on ' + sheetName);

  const rowValues = headers.map(h => (data[h] !== undefined ? data[h] : ''));
  for (let r = 1; r < values.length; r++) {
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
  if (idCol === -1) throw new Error('No id column on ' + sheetName);
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][idCol]) === String(id)) {
      sh.deleteRow(r + 1);
    }
  }
}

function replaceAllRows_(sheetName, rows) {
  const sh = getSheet_(sheetName);
  const headers = SHEETS[sheetName];
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  if (!rows.length) return;
  const matrix = rows.map(row => headers.map(h => row[h] !== undefined ? row[h] : ''));
  sh.getRange(2,1,matrix.length,headers.length).setValues(matrix);
}

function deleteRowsByMatch_(sheetName, fieldName, fieldValue) {
  const sh = getSheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idx = headers.indexOf(fieldName);
  if (idx === -1) throw new Error('Missing field ' + fieldName + ' on ' + sheetName);
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][idx]) === String(fieldValue)) {
      sh.deleteRow(r + 1);
    }
  }
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
    calories_per_processed_piece: Number(item.caloriesPerProcessedPiece || item.calories_per_processed_piece || 0),
    processed_yield: Number(item.processedYield || item.processed_yield || 0),
    price_per_processed_piece: Number(item.pricePerProcessedPiece || item.price_per_processed_piece || 0),
    weight_per_piece_g: Number(item.weightPerPieceG || item.weight_per_piece_g || 0),
    price_per_calorie: Number(item.pricePerCalorie || item.price_per_calorie || 0),
    active: item.active !== false,
    image: item.image || '',
    notes: item.note || item.notes || ''
  };
  saveRowById_('ingredients', row);
  return row;
}

function saveRecipeExpanded_(recipe) {
  if (!recipe || !recipe.id || !recipe.name) throw new Error('Recipe requires id and name');
  const row = {
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
    description: recipe.note || recipe.description || '',
    image: recipe.image || '',
    status: recipe.status || ''
  };
  saveRowById_('recipes', row);

  deleteRowsByMatch_('recipe_ingredients', 'recipe_id', recipe.id);
  const lines = (recipe.ingredients || []).map((line, index) => ({
    recipe_id: recipe.id,
    ingredient_id: line.id || line.ingredient_id || '',
    amount: Number(line.amount || 0),
    sort_order: index + 1
  }));
  const sh = getSheet_('recipe_ingredients');
  lines.forEach(obj => {
    sh.appendRow(SHEETS.recipe_ingredients.map(h => obj[h] !== undefined ? obj[h] : ''));
  });
  return recipe;
}

function deleteRecipeExpanded_(recipeId) {
  deleteRowById_('recipes', recipeId);
  deleteRowsByMatch_('recipe_ingredients', 'recipe_id', recipeId);
}

function listRecipesExpanded_() {
  const recipes = listRows_('recipes');
  const recipeIngredients = listRows_('recipe_ingredients');
  return recipes.map(recipe => {
    const lines = recipeIngredients
      .filter(line => String(line.recipe_id) === String(recipe.id))
      .sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map(line => ({ id: line.ingredient_id, amount: Number(line.amount || 0) }));

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
      note: recipe.description || '',
      image: recipe.image || '',
      status: recipe.status || '',
      ingredients: lines
    };
  });
}

function saveBoxExpanded_(box) {
  if (!box || !box.id || !box.name) throw new Error('Box requires id and name');
  const row = {
    id: box.id,
    name: box.name,
    theme: box.theme || '',
    promo_text: box.promoText || box.promo_text || '',
    discount_type: box.discountType || 'percent',
    discount_value: Number(box.discountPct || box.discount_value || 0),
    manual_price: box.manualPrice !== undefined && box.manualPrice !== null ? box.manualPrice : '',
    active: box.active !== false,
    image: box.image || ''
  };
  saveRowById_('boxes', row);

  deleteRowsByMatch_('box_items', 'box_id', box.id);
  const sh = getSheet_('box_items');
  (box.items || []).forEach((recipeId, index) => {
    const rowObj = { box_id: box.id, recipe_id: recipeId, sort_order: index + 1 };
    sh.appendRow(SHEETS.box_items.map(h => rowObj[h] !== undefined ? rowObj[h] : ''));
  });
  return box;
}

function deleteBoxExpanded_(boxId) {
  deleteRowById_('boxes', boxId);
  deleteRowsByMatch_('box_items', 'box_id', boxId);
}

function listBoxesExpanded_() {
  const boxes = listRows_('boxes');
  const items = listRows_('box_items');
  return boxes.map(box => ({
    id: box.id,
    name: box.name,
    theme: box.theme || '',
    promoText: box.promo_text || '',
    discountType: box.discount_type || 'percent',
    discountPct: Number(box.discount_value || 0),
    manualPrice: box.manual_price !== '',
    price: Number(box.manual_price || 0),
    active: normalizeBool_(box.active),
    image: box.image || '',
    items: items
      .filter(row => String(row.box_id) === String(box.id))
      .sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map(row => row.recipe_id)
  }));
}

function normalizeBool_(value) {
  if (value === true || value === false) return value;
  const s = String(value).toLowerCase().trim();
  return ['true','1','yes','ja','y'].indexOf(s) > -1;
}

function adjustStock_(data) {
  if (!data || !data.id) throw new Error('Missing stock item id');
  const sh = getSheet_('ingredients');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');
  const stockCol = headers.indexOf('stock');
  if (idCol === -1 || stockCol === -1) throw new Error('ingredients sheet requires id and stock');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(data.id)) {
      const oldValue = Number(values[r][stockCol] || 0);
      const delta = Number(data.delta || 0);
      const newValue = oldValue + delta;
      sh.getRange(r + 1, stockCol + 1).setValue(newValue);
      appendStockLog_(data.id, delta, oldValue, newValue, data.note || '', data.user || '');
      return { id: data.id, oldValue, newValue, delta };
    }
  }
  throw new Error('Ingredient not found: ' + data.id);
}

function appendStockLog_(itemId, delta, oldValue, newValue, note, user) {
  const sh = getSheet_('stock_logs');
  sh.appendRow([
    new Date().toISOString(),
    'stock.adjust',
    itemId,
    delta,
    oldValue,
    newValue,
    note || '',
    user || ''
  ]);
}

function exportAllAsState_() {
  const settingsRows = listRows_('menu_settings');
  const settingsMap = {};
  settingsRows.forEach(row => settingsMap[row.key] = row.value);

  const recipes = listRecipesExpanded_();
  const boxes = listBoxesExpanded_();

  return {
    shop: {
      name: settingsMap.brand_name || "'t Gezellig Hoekje",
      subtitle: settingsMap.subtitle || 'Koffiebar & Gebak',
      tagline: settingsMap.tagline || 'Warm welkom op het gezelligste plekje van de stad!',
      logo: settingsMap.logo || ''
    },
    settings: {
      menuCategories: (settingsMap.menu_categories || 'Koffie,Thee,Chocolademelk,Donuts,Cupcakes,Kleine Snoepjes,Broodjes,Tosti\'s').split(',').map(s => s.trim()).filter(Boolean)
    },
    ingredients: listRows_('ingredients').map(row => ({
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
    })),
    recipes,
    boxes,
    plan: []
  };
}

function importState_(state) {
  ensureSheets_();
  const data = state || {};

  replaceAllRows_('ingredients', (data.ingredients || []).map(item => ({
    id: item.id,
    name: item.name || '',
    type: item.type || '',
    category: item.category || '',
    supplier: item.supplier || '',
    unit: item.unit || '',
    price: Number(item.price || 0),
    stock: Number(item.stock || 0),
    min_stock: Number(item.minStock || 0),
    calories_per_processed_piece: Number(item.caloriesPerProcessedPiece || item.calories_per_processed_piece || 0),
    processed_yield: Number(item.processedYield || item.processed_yield || 0),
    price_per_processed_piece: Number(item.pricePerProcessedPiece || item.price_per_processed_piece || 0),
    weight_per_piece_g: Number(item.weightPerPieceG || item.weight_per_piece_g || 0),
    price_per_calorie: Number(item.pricePerCalorie || item.price_per_calorie || 0),
    active: item.active !== false,
    image: item.image || '',
    notes: item.note || item.notes || ''
  })));

  replaceAllRows_('processed_products', data.processed_products || []);

  replaceAllRows_('recipes', []);
  replaceAllRows_('recipe_ingredients', []);
  (data.recipes || []).forEach(saveRecipeExpanded_);

  replaceAllRows_('boxes', []);
  replaceAllRows_('box_items', []);
  (data.boxes || []).forEach(saveBoxExpanded_);

  const menuSettings = [
    { key: 'brand_name', value: (data.shop && data.shop.name) || "'t Gezellig Hoekje" },
    { key: 'subtitle', value: (data.shop && data.shop.subtitle) || 'Koffiebar & Gebak' },
    { key: 'tagline', value: (data.shop && data.shop.tagline) || 'Warm welkom op het gezelligste plekje van de stad!' },
    { key: 'logo', value: (data.shop && data.shop.logo) || '' },
    { key: 'menu_categories', value: ((data.settings && data.settings.menuCategories) || []).join(', ') }
  ];
  replaceAllRows_('menu_settings', menuSettings);
}

function buildDashboardSummary_() {
  const state = exportAllAsState_();
  const activeIngredients = (state.ingredients || []).filter(i => i.active !== false).length;
  const activeRecipes = (state.recipes || []).filter(r => r.active !== false).length;
  const activeBoxes = (state.boxes || []).filter(b => b.active !== false).length;
  const lowStock = (state.ingredients || []).filter(i => Number(i.stock || 0) < Number(i.minStock || 0));
  return {
    ingredients: activeIngredients,
    recipes: activeRecipes,
    boxes: activeBoxes,
    lowStockCount: lowStock.length,
    lowStockItems: lowStock.map(i => ({
      id: i.id,
      name: i.name,
      stock: i.stock,
      minStock: i.minStock
    }))
  };
}

function getDemoState_() {
  return {
    shop: {
      name: "'t Gezellig Hoekje",
      subtitle: "Koffiebar & Gebak",
      tagline: "Warm welkom op het gezelligste plekje van de stad!",
      logo: ""
    },
    settings: {
      menuCategories: ["Koffie","Thee","Chocolademelk","Donuts","Cupcakes","Kleine Snoepjes","Broodjes","Tosti's"]
    },
    ingredients: [
      { id:"water", name:"Water", type:"raw", category:"Dranken", supplier:"supermarkt", unit:"stuk", price:8, stock:24, minStock:10, caloriesPerProcessedPiece:50, processedYield:1, pricePerProcessedPiece:8, weightPerPieceG:0, pricePerCalorie:0.16, active:true, image:"", note:"" },
      { id:"coffee_beans", name:"Koffiebonen", type:"raw", category:"Dranken", supplier:"supermarkt", unit:"stuk", price:20, stock:20, minStock:10, active:true, image:"", note:"" },
      { id:"milk", name:"Melk", type:"raw", category:"Zuivel", supplier:"supermarkt", unit:"stuk", price:20, stock:20, minStock:10, active:true, image:"", note:"" },
      { id:"tea_black", name:"English Tea", type:"extra", category:"Thee", supplier:"groothandel", unit:"stuk", price:18, stock:12, minStock:8, active:true, image:"", note:"" },
      { id:"cocoa_mix", name:"Chocolademix", type:"extra", category:"Chocolademelk", supplier:"groothandel", unit:"stuk", price:25, stock:14, minStock:8, active:true, image:"", note:"" }
    ],
    recipes: [
      { id:"klassieke_knuffel", name:"De Klassieke Knuffel", sub:"Cappuccino", category:"Koffie", productType:"drink", station:"drankje maken", animation:"coffee", calories:600, sellPrice:95, active:true, note:"", ingredients:[{id:"coffee_beans",amount:1},{id:"water",amount:1},{id:"milk",amount:1}] },
      { id:"snelle_shot", name:"De Snelle Shot", sub:"Espresso", category:"Koffie", productType:"drink", station:"drankje maken", animation:"coffee", calories:600, sellPrice:75, active:true, note:"", ingredients:[{id:"coffee_beans",amount:1},{id:"water",amount:1}] }
    ],
    boxes: [
      { id:"spoedshift_box", name:"De Spoedshift Box", theme:"EMS", items:["snelle_shot","klassieke_knuffel"], discountPct:10, manualPrice:false, price:153, active:true }
    ],
    plan: []
  };
}

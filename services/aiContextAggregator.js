import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, isConnected } from '../config/db.js';
import { accessoryQuery, isAccessoryConnected } from '../config/accessoryDb.js';
import { getCompleteAccessoryReportForLot } from './accessoryQueryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, '../data/sheetsData.json');

// In-memory cache for sheets
let cachedData = null;
let lastCacheLoad = 0;
let lotIndexMap = null;

// In-memory cache for SQL accessory data
let cachedSqlData = {
  materials: [],
  weightCaptures: [],
  transfers: [],
  rgps: [],
  scans: [],
  lotZips: new Map(),
  lotDooris: new Map(),
  rawZips: [],
  rawDooris: [],
  lastLoad: 0
};

const getLot = (r) => String(r["Lot Number"] || r["LOT NUMBER"] || r["Lot No"] || r["LOT NO"] || r["lotNo"] || r["Lot"] || "").trim();

const formatDirectImageUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const driveMatch = trimmed.match(/id=([a-zA-Z0-9_-]+)/) || trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
  }
  return trimmed;
};

/**
 * Loads and caches sheetsData.json with in-memory Lot Map index for O(1) instant lookups
 */
export function getCachedSheetsData(forceRefresh = false) {
  const now = Date.now();
  if (cachedData && !forceRefresh && (now - lastCacheLoad < 30000)) {
    return cachedData;
  }

  try {
    if (!fs.existsSync(DATA_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    const jobOrderData = parsed.jobOrders || [];
    const issuesData = parsed.issues || [];
    const lotLogsData = parsed.lotLogs || [];
    const indexData = parsed.indexRows || [];
    const custom = parsed.customSheets || {};

    const kajButtonData = custom.kaj_button?.rows || [];
    const washingData = custom.washing_sheet?.rows || [];
    const overlockData = custom.overlock_sheet?.rows || [];
    const foldingData = custom.folding_sheet?.rows || [];
    const elasticData = custom.elastic_sheet?.rows || [];
    const barcodeData = custom.barcode_data?.rows || [];
    const zipPurchaseData = custom.zip_purchase_orders?.rows || [];
    const doriPurchaseData = custom.dori_purchase_orders?.rows || [];

    // Build indexed map for instant lookup by lot
    const lotMap = new Map();

    const addToMap = (key, department, row) => {
      if (!key) return;
      if (!lotMap.has(key)) {
        lotMap.set(key, {
          jobOrder: null,
          issues: null,
          logs: [],
          index: [],
          kaj: null,
          wash: null,
          overlock: null,
          folding: null,
          elastic: null,
          barcodes: [],
          zip: null,
          dori: null
        });
      }
      const item = lotMap.get(key);
      if (department === 'jobOrder' && !item.jobOrder) item.jobOrder = row;
      else if (department === 'issues' && !item.issues) item.issues = row;
      else if (department === 'kaj' && !item.kaj) item.kaj = row;
      else if (department === 'wash' && !item.wash) item.wash = row;
      else if (department === 'overlock' && !item.overlock) item.overlock = row;
      else if (department === 'folding' && !item.folding) item.folding = row;
      else if (department === 'elastic' && !item.elastic) item.elastic = row;
      else if (department === 'zip' && !item.zip) item.zip = row;
      else if (department === 'dori' && !item.dori) item.dori = row;
      else if (department === 'logs') item.logs.push(row);
      else if (department === 'index') item.index.push(row);
      else if (department === 'barcodes') item.barcodes.push(row);
    };

    jobOrderData.forEach(r => addToMap(getLot(r), 'jobOrder', r));
    issuesData.forEach(r => addToMap(getLot(r), 'issues', r));
    lotLogsData.forEach(r => addToMap(getLot(r), 'logs', r));
    indexData.forEach(r => addToMap(getLot(r), 'index', r));
    kajButtonData.forEach(r => addToMap(getLot(r), 'kaj', r));
    washingData.forEach(r => addToMap(getLot(r), 'wash', r));
    overlockData.forEach(r => addToMap(getLot(r), 'overlock', r));
    foldingData.forEach(r => addToMap(getLot(r), 'folding', r));
    elasticData.forEach(r => addToMap(getLot(r), 'elastic', r));
    barcodeData.forEach(r => addToMap(getLot(r), 'barcodes', r));
    zipPurchaseData.forEach(r => addToMap(getLot(r), 'zip', r));
    doriPurchaseData.forEach(r => addToMap(getLot(r), 'dori', r));

    lotIndexMap = lotMap;
    cachedData = {
      jobOrderData,
      issuesData,
      lotLogsData,
      indexData,
      kajButtonData,
      washingData,
      overlockData,
      foldingData,
      elasticData,
      barcodeData,
      zipPurchaseData,
      doriPurchaseData,
      updatedAt: parsed.updatedAt
    };
    lastCacheLoad = now;

    return cachedData;
  } catch (err) {
    console.error('Error loading cached sheets data:', err.message);
    return null;
  }
}

/**
 * Loads and caches live SQL Accessory Data (materials, zip, doori from accessory database) with 30s in-memory TTL
 */
export async function getCachedSqlAccessoryData(forceRefresh = false) {
  const now = Date.now();
  if (cachedSqlData.materials.length > 0 && !forceRefresh && (now - cachedSqlData.lastLoad < 30000)) {
    return cachedSqlData;
  }

  try {
    const materials = await accessoryQuery(
      'SELECT id, name, category, stock, unit, cost, threshold, color, packets, poNumber, invoiceNo, location FROM materials ORDER BY category ASC, stock DESC'
    ).catch(() => []);

    const zips = await accessoryQuery(
      'SELECT id, Lot_Number, Garment_Type, Style, Fabric, Total_Pieces, Issue_Date, Supervisor, Priority, Selected_Placements, Placement_Quantities, Placement_Zip_Types, Zip_Selections, Zip_Quality_Data, Total_Cost, Saved_At, Gate_Entry_Person, Gate_Entry_Date, Material_Received_By, Material_Received_Date, Supplier_Name, Material_Entry_Date, po_number FROM zip ORDER BY id DESC'
    ).catch(() => []);

    let dooris = await accessoryQuery(
      'SELECT id, Lot_Number, Garment_Type, Style, Fabric, Total_Pieces, Issue_Date, Supervisor, Dori_Selections, Selected_Placements, Placement_Quantities, Placement_Dori_Types, Total_Cost, Color_Breakdown, Dori_Requirements, Gate_Entry_Person, Gate_Entry_Date, Material_Received_By, Material_Received_Date, Supplier_Name, Material_Entry_Date, po_number FROM doori ORDER BY id DESC'
    ).catch(() => []);

    if (!dooris || dooris.length === 0) {
      dooris = await accessoryQuery(
        'SELECT id, Lot_Number, Garment_Type, Style, Fabric, Total_Pieces, Issue_Date, Supervisor, Dori_Selections, Selected_Placements, Placement_Quantities, Placement_Dori_Types, Total_Cost, Color_Breakdown, Dori_Requirements, Gate_Entry_Person, Gate_Entry_Date, Material_Received_By, Material_Received_Date, Supplier_Name, Material_Entry_Date, NULL as po_number FROM dori_issue ORDER BY id DESC'
      ).catch(() => []);
    }

    const weightCaptures = await accessoryQuery(
      'SELECT id, materialCode, materialName, unit, category, supplier, lotNo, storeLocation, grossWeightKg, tareWeightKg, netWeightKg, weightPerPieceG, pieces, packets, barcodeId, status, approvalStatus, capturedAt FROM weight_capture ORDER BY capturedAt DESC, id DESC LIMIT 20'
    ).catch(() => []);

    const transfers = await accessoryQuery(
      'SELECT id, materialCode, materialName, fromLocation, toLocation, quantity, transferType, operator, transferredAt FROM material_transfers ORDER BY transferredAt DESC LIMIT 10'
    ).catch(() => []);

    const rgps = await accessoryQuery(
      'SELECT id, rgpNo, date, vendor, rgpType, department, purpose, expectedReturnDate, vehicleNo, preparedBy, authorizedBy, entries, createdAt FROM rgp ORDER BY createdAt DESC LIMIT 10'
    ).catch(() => []);

    const scans = await accessoryQuery(
      'SELECT id, lot_number, scan_type, person_name, material_name, quantity, supplier_name, scanned_at FROM scans ORDER BY scanned_at DESC LIMIT 15'
    ).catch(() => []);

    const lotZips = new Map();
    (zips || []).forEach(r => {
      const lot = String(r.Lot_Number || '').trim();
      if (!lot) return;
      if (!lotZips.has(lot)) lotZips.set(lot, []);
      lotZips.get(lot).push(r);
    });

    const lotDooris = new Map();
    (dooris || []).forEach(r => {
      const lot = String(r.Lot_Number || '').trim();
      if (!lot) return;
      if (!lotDooris.has(lot)) lotDooris.set(lot, []);
      lotDooris.get(lot).push(r);
    });

    cachedSqlData = {
      materials: materials || [],
      weightCaptures: weightCaptures || [],
      transfers: transfers || [],
      rgps: rgps || [],
      scans: scans || [],
      lotZips,
      lotDooris,
      rawZips: zips || [],
      rawDooris: dooris || [],
      lastLoad: now
    };
    return cachedSqlData;
  } catch (err) {
    console.warn('Warning querying SQL accessory data:', err.message);
    return cachedSqlData;
  }
}


/**
 * High-performance AI context builder with Multi-Sheet + Live SQL Accessory ERP Intelligence
 * Runs in < 5ms using indexed in-memory data
 */
export async function buildAiAggregatedContext({
  prompt = '',
  chatInput = '',
  message = '',
  query: userQuery = '',
  history = [],
  context = {}
} = {}) {
  const data = getCachedSheetsData();
  const rawPrompt = String(prompt || chatInput || message || userQuery || '').trim();

  // Load live SQL accessory data
  const sqlData = await getCachedSqlAccessoryData();
  const sqlMaterials = sqlData.materials || [];
  const sqlLotZips = sqlData.lotZips || new Map();
  const sqlLotDooris = sqlData.lotDooris || new Map();

  if (!data) {
    return {
      success: false,
      userPrompt: rawPrompt,
      systemInstruction: 'Factory database is currently initializing. Please try again in a moment.',
      kpis: { totalLotsCount: 0, totalQty: 0 }
    };
  }

  const {
    jobOrderData,
    issuesData,
    lotLogsData,
    indexData,
    kajButtonData,
    washingData,
    overlockData,
    foldingData,
    elasticData,
    barcodeData,
    zipPurchaseData,
    doriPurchaseData
  } = data;

  // 1. Detect if user is asking about a specific lot number (e.g. 67046, 11028, 11202, 61008)
  const lotMatch = rawPrompt.match(/\b(\d{3,7}|[a-zA-Z]{1,3}[-_]\d{3,6})\b/);
  const targetLot = lotMatch ? lotMatch[1].trim() : null;

  let specificLotDetails = null;
  if (targetLot) {
    let indexed = lotIndexMap?.get(targetLot);
    let matchedJO = indexed?.jobOrder || jobOrderData.find(r => getLot(r) === targetLot || String(r["Order No."] || "").includes(targetLot));
    let matchedIssue = indexed?.issues || issuesData.find(r => getLot(r) === targetLot);
    let matchedIndex = indexed?.index?.length ? indexed.index : indexData.filter(r => Object.values(r).some(v => String(v || "").includes(targetLot)));
    let matchedLogs = indexed?.logs?.length ? indexed.logs : lotLogsData.filter(r => String(r["Lot Number"] || "").includes(targetLot));
    let matchedKaj = indexed?.kaj || kajButtonData.find(r => getLot(r) === targetLot);
    let matchedWash = indexed?.wash || washingData.find(r => getLot(r) === targetLot);
    let matchedOverlock = indexed?.overlock || overlockData.find(r => getLot(r) === targetLot);
    let matchedFolding = indexed?.folding || foldingData.find(r => getLot(r) === targetLot);
    let matchedElastic = indexed?.elastic || elasticData.find(r => getLot(r) === targetLot);
    let matchedBarcodes = indexed?.barcodes?.length ? indexed.barcodes : barcodeData.filter(r => getLot(r) === targetLot);
    let matchedZip = indexed?.zip || zipPurchaseData.find(r => getLot(r) === targetLot);
    let matchedDori = indexed?.dori || doriPurchaseData.find(r => getLot(r) === targetLot);

    // Look up SQL accessory records for this lot
    const matchedSqlZips = sqlLotZips.get(targetLot) || [];
    const matchedSqlDooris = sqlLotDooris.get(targetLot) || [];

    const rawImg = (matchedJO && (matchedJO["Image URL"] || matchedJO["UPLOAD IMAGE"])) || (matchedIndex.length > 0 && (matchedIndex[0]["Image Url"] || matchedIndex[0]["Image URL"])) || null;
    const directImg = formatDirectImageUrl(rawImg);

    if (matchedJO || matchedIssue || matchedIndex.length > 0 || matchedKaj || matchedWash || matchedOverlock || matchedFolding || matchedElastic || matchedBarcodes.length > 0 || matchedZip || matchedDori || matchedSqlZips.length > 0 || matchedSqlDooris.length > 0) {
      specificLotDetails = {
        lotNumber: targetLot,
        jobOrder: matchedJO || null,
        issuesAndPacking: matchedIssue || null,
        cuttingMaster: matchedIndex.length > 0 ? matchedIndex[0] : null,
        designImageUrl: directImg,
        kajButton: matchedKaj || null,
        washing: matchedWash || null,
        overlock: matchedOverlock || null,
        folding: matchedFolding || null,
        elastic: matchedElastic || null,
        barcodes: matchedBarcodes || [],
        zipPurchase: matchedZip || null,
        doriPurchase: matchedDori || null,
        sqlZips: matchedSqlZips,
        sqlDooris: matchedSqlDooris,
        activityLogs: matchedLogs
      };
    }
  }

  // 2. Detect Party / Buyer queries (e.g. "SS Party", "SS lots", "lots of SS")
  const isSSQuery = /\b(ss|ss\s*party|party\s*ss|ss\s*pattern)\b/i.test(rawPrompt);
  let partyMatches = null;

  if (isSSQuery) {
    const ssRows = jobOrderData.filter(r => String(r['Party Name'] || '').trim().toUpperCase() === 'SS' || String(r['Pattern'] || '').toUpperCase().includes('SS'));
    const allSSLots = ssRows.map(r => getLot(r)).filter(Boolean);
    const uniqueSSLots = [...new Set(allSSLots)];

    const cutLots = uniqueSSLots.filter(l => indexData.some(i => getLot(i) === l));
    const cancelledLots = uniqueSSLots.filter(l => {
      const row = ssRows.find(r => getLot(r) === l);
      return row && (String(row['Status'] || '').toLowerCase().includes('cancel') || Boolean(row['Cancellation Reason']));
    });
    const pendingLots = uniqueSSLots.filter(l => !cutLots.includes(l) && !cancelledLots.includes(l));

    partyMatches = {
      partyName: 'SS',
      totalCount: uniqueSSLots.length,
      cutCount: cutLots.length,
      cancelledCount: cancelledLots.length,
      pendingCount: pendingLots.length,
      allLots: uniqueSSLots,
      sampleCut: cutLots.slice(0, 15),
      samplePending: pendingLots.slice(0, 15)
    };
  }

  // 3. Stage-wise query helpers
  const lowerPrompt = rawPrompt.toLowerCase();
  let stageSearchSummary = null;

  if (lowerPrompt.includes('kaj') || lowerPrompt.includes('button')) {
    stageSearchSummary = {
      stage: 'KajButton Department',
      totalRecords: kajButtonData.length,
      sampleLots: kajButtonData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
    };
  } else if (lowerPrompt.includes('wash')) {
    stageSearchSummary = {
      stage: 'Washing Department',
      totalRecords: washingData.length,
      sampleLots: washingData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
    };
  } else if (lowerPrompt.includes('overlock')) {
    stageSearchSummary = {
      stage: 'Overlock Department',
      totalRecords: overlockData.length,
      sampleLots: overlockData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
    };
  } else if (lowerPrompt.includes('fold')) {
    stageSearchSummary = {
      stage: 'Folding Department',
      totalRecords: foldingData.length,
      sampleLots: foldingData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
    };
  } else if (lowerPrompt.includes('elastic')) {
    stageSearchSummary = {
      stage: 'Elastic Department',
      totalRecords: elasticData.length,
      sampleLots: elasticData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
    };
  } else if (lowerPrompt.includes('barcode')) {
    stageSearchSummary = {
      stage: 'Barcode & Packaging Department',
      totalRecords: barcodeData.length,
      sampleLots: barcodeData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
    };
  } else if (lowerPrompt.includes('zip') || lowerPrompt.includes('zipper')) {
    stageSearchSummary = {
      stage: 'Zip Purchase & Gate Entry Department',
      totalRecords: zipPurchaseData.length + sqlData.rawZips.length,
      sampleLots: [
        ...sqlData.rawZips.slice(0, 5).map(r => r.Lot_Number),
        ...zipPurchaseData.slice(0, 5).map(r => getLot(r))
      ].filter(Boolean)
    };
  } else if (lowerPrompt.includes('dori')) {
    stageSearchSummary = {
      stage: 'Dori Purchase Orders Department',
      totalRecords: doriPurchaseData.length + sqlData.rawDooris.length,
      sampleLots: [
        ...sqlData.rawDooris.slice(0, 5).map(r => r.Lot_Number),
        ...doriPurchaseData.slice(0, 5).map(r => getLot(r))
      ].filter(Boolean)
    };
  }

  // 4. Accessory / Material Inventory Query Detection (SQL Database 'newdata')
  const isAccessoryInventoryQuery = /\b(material|materials|accessory|accessories|trims|inventory|godown|warehouse|location|threshold|alert|low\s*stock|stock|stock\s*report|weight\s*capture|tulai|kanta|transfer|transfers|rgp|gate\s*pass|scan|scans)\b/i.test(rawPrompt);
  let accessoryInventorySection = '';

  if (isAccessoryInventoryQuery) {
    const lowStockItems = sqlMaterials.filter(m => (m.stock !== null && m.threshold !== null && Number(m.stock) <= Number(m.threshold)));
    const categoriesMap = {};
    const locationsMap = {};
    sqlMaterials.forEach(m => {
      const cat = m.category || 'Uncategorized';
      categoriesMap[cat] = (categoriesMap[cat] || 0) + 1;
      const loc = m.location || 'Store';
      locationsMap[loc] = (locationsMap[loc] || 0) + 1;
    });

    // Check if user is asking about a specific item name (e.g. button, zip, rfk, fabric, elastic)
    const specificItems = sqlMaterials.filter(m => lowerPrompt.includes(String(m.name || '').toLowerCase()));

    const wcList = sqlData.weightCaptures || [];
    const transfersList = sqlData.transfers || [];
    const rgpList = sqlData.rgps || [];

    accessoryInventorySection = `
=== VERIFIED SQL ACCESSORY & MATERIAL STORAGE (DATABASE: NEWDATA) ===
Database: newdata (Live Connected on localhost:3306)
Total Registered Accessory Materials: ${sqlMaterials.length} items across ${Object.keys(categoriesMap).length} categories
Total Units in Stock: ${sqlMaterials.reduce((acc, m) => acc + (Number(m.stock) || 0), 0)} units
Low Stock / Threshold Alerts: ${lowStockItems.length} items
Category Breakdown: ${JSON.stringify(categoriesMap)}
Warehouse Godown Locations (${Object.keys(locationsMap).length}): ${Object.keys(locationsMap).slice(0, 10).join(', ')}

${lowStockItems.length > 0 ? `CRITICAL LOW STOCK ALERT ITEMS (REORDER REQUIRED):
${lowStockItems.map(m => `- [${m.id}] ${m.name}: Stock ${m.stock} ${m.unit} (Threshold: ${m.threshold}) | Location: ${m.location || 'Godown'} -> Action: Generate PO immediately`).join('\n')}` : 'All accessory stock above threshold.'}

${specificItems.length > 0 ? `\nMatching Items For Query:\n${JSON.stringify(specificItems, null, 2)}` : ''}

DIGITAL WEIGHT SCALE (KANTA/TULAI) VERIFICATION RECORDS (${wcList.length} recent):
${wcList.slice(0, 5).map(w => `- Lot ${w.lotNo || 'N/A'}: ${w.materialName} | Net: ${w.netWeightKg} kg (Gross: ${w.grossWeightKg} kg, Tare: ${w.tareWeightKg} kg) | Pieces: ${w.pieces} pcs | Wt/Pc: ${w.weightPerPieceG}g | Status: ${w.approvalStatus || 'Approved'} | Location: ${w.storeLocation}`).join('\n')}

WAREHOUSE TRANSFERS (${transfersList.length} recent):
${transfersList.slice(0, 3).map(t => `- ${t.materialName} (${t.materialCode}): ${t.fromLocation} -> ${t.toLocation} | Qty: ${t.quantity} (${t.transferType}) by ${t.operator}`).join('\n')}

RETURNABLE GATE PASSES (RGP) FOR VENDORS (${rgpList.length} recent):
${rgpList.slice(0, 3).map(r => `- ${r.rgpNo}: Vendor ${r.vendor} | Type: ${r.rgpType} (${r.purpose}) | Expected Return: ${r.expectedReturnDate || 'N/A'}`).join('\n')}
================================================================================
CRITICAL DIRECTIVE FOR ACCESSORY STORAGE & SOLUTIONS:
When user asks about materials, accessories, stock levels, weight capture, transfers, or RGP outpasses:
1. Use the verified live SQL records above.
2. Report exact stock numbers, units, locations, weight verification numbers, and highlight threshold warnings.
3. ALWAYS provide structured, practical solutions (e.g. reorder suggestions, QA approval checks, return pass tracking).
`;
  }

  // 5. Build summary of all lots across factory
  let combinedLots = jobOrderData.map(r => ({
    lotNo: getLot(r) || r["Job Order No"] || "N/A",
    party: r["Party Name"] || r["PARTY"] || r["Party"] || "Standard",
    item: r["Garment Type"] || r["Style"] || r["ITEM"] || "Garment",
    brand: r["Brand"] || "",
    fabric: r["Fabric"] || "",
    stage: r["Direct Stitching"] === 'yes' ? 'Direct Stitching' : (r["Emb"] ? 'Embroidery' : (r["Printing"] ? 'Printing' : 'Cutting/WIP')),
    qty: parseFloat(r["Challan Total Qty"] || r["Quantity"] || 0) || 0,
    date: r["Date"] || r["Challan Date"] || "",
    status: r["Status"] || "Active"
  }));

  const totalLotsCount = combinedLots.filter(l => l.lotNo !== "N/A").length;
  const totalQty = combinedLots.reduce((sum, l) => sum + (parseFloat(l.qty) || 0), 0);

  let historyStr = "";
  if (Array.isArray(history) && history.length > 0) {
    historyStr = "\n\nPrior Conversation History:\n" + history.slice(-6).map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n");
  }

  let lotContextSection = "";
  if (specificLotDetails) {
    const isImageRequested = /\b(image|photo|pic|picture|artwork|design\s*image|design\s*artwork|design\s*photo|design\s*(?:dikhao|dena|chahiye|bhejo)|photo\s*(?:dena|dikhao|bhejo|chahiye|de)|image\s*(?:dena|dikhao|bhejo|chahiye|de)|pic\s*(?:dena|dikhao|bhejo|chahiye)|tasveer|tasvir)\b/i.test(rawPrompt);
    const isHistoryRequested = /\b(history|timeline|stages|department|supervisor|audit\s*trail|all\s*details|complete\s*details|full\s*details|lifecycle|journey|kahan\s*tak\s*pahuncha|kya\s*status|status\s*batao|cutting\s*status)\b/i.test(rawPrompt);
    const isImageOnly = isImageRequested && !isHistoryRequested;

    const isBrandRequested = /\b(brand|brand\s*name|marka)\b/i.test(rawPrompt);
    const isFabricRequested = /\b(fabric|kapda|cloth|material)\b/i.test(rawPrompt);
    const isPartyRequested = /\b(party|party\s*name|buyer|client|customer)\b/i.test(rawPrompt) && !/\b(all\s*parties|party\s*report)\b/i.test(rawPrompt);
    const isStyleRequested = /\b(style|garment|garment\s*type|pattern|item)\b/i.test(rawPrompt);
    const isQtyRequested = /\b(quantity|qty|order\s*qty|kitne\s*pcs|kitna\s*order|pieces?|sets?)\b/i.test(rawPrompt);
    const isShadeSizeRequested = /\b(shade|shades|color|colors|colour|size|sizes)\b/i.test(rawPrompt);
    const isZipRequested = /\b(zip|zipper|zip\s*purchase|zip\s*supplier|zip\s*entry|zip\s*status)\b/i.test(rawPrompt);
    const isDoriRequested = /\b(dori|dori\s*purchase|dori\s*order|dori\s*status|dori\s*selection|dori\s*pieces?)\b/i.test(rawPrompt);

    const isSpecificAttributeOnly = (
      isBrandRequested ||
      isFabricRequested ||
      isPartyRequested ||
      isStyleRequested ||
      isQtyRequested ||
      isShadeSizeRequested ||
      isZipRequested ||
      isDoriRequested
    ) && !isHistoryRequested;

    if (isImageOnly) {
      lotContextSection = `
=== VERIFIED PRODUCTION FLOOR DATA FOR LOT ${specificLotDetails.lotNumber} (PHOTO REQUEST) ===
Lot Number: ${specificLotDetails.lotNumber}
Party Name: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Party Name"] || specificLotDetails.jobOrder["PARTY"] || "Mohit Hosiery") : "Mohit Hosiery"}
Brand: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Brand"] || "Standard") : "Standard"}
Garment Type: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Garment Type"] || specificLotDetails.jobOrder["ITEM"] || "Garment") : "Garment"}
Style: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Style"] || "Standard") : "Standard"}
Fabric: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Fabric"] || "Fabric") : "Fabric"}
Design Artwork Image: ${specificLotDetails.designImageUrl || "Not attached"}
=============================================================
CRITICAL DIRECTIVE - USER ASKED ONLY FOR PHOTO / IMAGE:
The user explicitly asked ONLY for the photo / design artwork of Lot ${specificLotDetails.lotNumber} (Prompt: "${rawPrompt}").
DO NOT provide the complete department-by-department timeline, supervisor table, or multi-stage lifecycle audit trail. The user explicitly does not want the lengthy department lifecycle breakdown for photo requests.

RESPONSE REQUIREMENTS:
1. Warm 1-sentence opening presenting the requested design artwork / photo for Lot ${specificLotDetails.lotNumber}.
2. CRITICAL: Embed the image directly using markdown: ![Design Artwork](${specificLotDetails.designImageUrl})
   (NEVER output links like "[View Image]" or "download link". Always embed directly with markdown ![] syntax).
3. Provide ONLY a compact 3-bullet style summary:
   - Lot: ${specificLotDetails.lotNumber}
   - Party: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Party Name"] || "Standard") : "Standard"}
   - Garment & Style: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Garment Type"] || "Garment") : "Garment"} (${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Style"] || "Standard") : "Standard"}) | Fabric: ${specificLotDetails.jobOrder ? (specificLotDetails.jobOrder["Fabric"] || "Fabric") : "Fabric"}
4. Short closing offering to provide full department timeline or cutting status if needed.
5. STRICTLY FORBIDDEN: Do NOT list all departments or full timeline. Do NOT mention Google Sheets or fetching mechanisms.
`;
    } else if (isSpecificAttributeOnly) {
      const jo = specificLotDetails.jobOrder || {};
      let targetAttr = 'Brand';
      let targetVal = jo["Brand"] || "Standard";
      if (isBrandRequested) {
        targetAttr = 'Brand';
        targetVal = jo["Brand"] || "Standard";
      } else if (isFabricRequested) {
        targetAttr = 'Fabric';
        targetVal = jo["Fabric"] || "Standard Fabric";
      } else if (isPartyRequested) {
        targetAttr = 'Party Name';
        targetVal = jo["Party Name"] || jo["PARTY"] || "Standard";
      } else if (isQtyRequested) {
        targetAttr = 'Order Quantity';
        targetVal = `${jo["Quantity"] || jo["Challan Total Qty"] || "0"} ${jo["Unit"] || "PCS"}`;
      } else if (isStyleRequested) {
        targetAttr = 'Garment & Style';
        targetVal = `${jo["Garment Type"] || "Garment"} (${jo["Style"] || "Standard"})`;
      } else if (isShadeSizeRequested) {
        targetAttr = 'Shades & Sizes';
        targetVal = `Shades: ${jo["Shade"] || "Standard"} | Sizes: ${jo["Size"] || "Standard"}`;
      } else if (isZipRequested) {
        targetAttr = 'Zip Purchase & Gate Entry';
        const zp = specificLotDetails.zipPurchase;
        const sqlZip = specificLotDetails.sqlZips?.[0];
        if (sqlZip) {
          targetVal = `Supplier: ${sqlZip.Supplier_Name || 'N/A'} | PO: ${sqlZip.po_number || 'N/A'} | Total Pcs: ${sqlZip.Total_Pieces || 'N/A'} | Selections: ${sqlZip.Zip_Selections || 'N/A'}`;
        } else if (zp) {
          targetVal = `Supplier: ${zp["Supplier Name"] || 'N/A'} | Gate Entry: ${zp["Gate Entry Date"] || 'N/A'} (${zp["Gate Entry Person"] || 'N/A'}) | Received: ${zp["Material Received Date"] || 'N/A'} (${zp["Material Received By"] || 'N/A'})`;
        } else {
          targetVal = 'Zip Purchase record factory production records mein nahi mila (Pending).';
        }
      } else if (isDoriRequested) {
        targetAttr = 'Dori Purchase Order';
        const dp = specificLotDetails.doriPurchase;
        const sqlDori = specificLotDetails.sqlDooris?.[0];
        if (sqlDori) {
          targetVal = `Supplier: ${sqlDori.Supplier_Name || 'N/A'} | PO: ${sqlDori.po_number || 'N/A'} | Total Pcs: ${sqlDori.Total_Pieces || 'N/A'} | Selections: ${sqlDori.Dori_Selections || 'N/A'} | Supervisor: ${sqlDori.Supervisor || 'N/A'}`;
        } else if (dp) {
          targetVal = `Total Pieces: ${dp["Total Pieces"] || 'N/A'} | Fabric: ${dp["Fabric"] || 'N/A'} | Issue Date: ${dp["Issue Date"] || 'N/A'} | Supervisor: ${dp["Supervisor"] || 'N/A'}`;
        } else {
          targetVal = 'Dori Purchase Order record factory production records mein nahi mila (Pending).';
        }
      }

      lotContextSection = `
=== VERIFIED PRODUCTION FLOOR DATA FOR LOT ${specificLotDetails.lotNumber} (${targetAttr.toUpperCase()} REQUEST) ===
Lot Number: ${specificLotDetails.lotNumber}
Requested Attribute (${targetAttr}): ${targetVal}
Party Name: ${jo["Party Name"] || jo["PARTY"] || "Mohit Hosiery"}
Brand: ${jo["Brand"] || "Standard"}
Garment Type: ${jo["Garment Type"] || "Garment"}
Style: ${jo["Style"] || "Standard"}
Fabric: ${jo["Fabric"] || "Fabric"}
Order Qty: ${jo["Quantity"] || jo["Challan Total Qty"] || "0"} ${jo["Unit"] || "PCS"}
=============================================================
CRITICAL DIRECTIVE - USER ASKED ONLY FOR ${targetAttr.toUpperCase()}:
The user asked ONLY for the ${targetAttr} of Lot ${specificLotDetails.lotNumber} (Prompt: "${rawPrompt}").
DO NOT provide the department-by-department timeline, supervisor table, or multi-stage lifecycle audit trail. The user strictly wants ONLY the answer to their specific question.

RESPONSE REQUIREMENTS:
1. Direct, clear opening sentence answering ONLY what the user asked: "Lot ${specificLotDetails.lotNumber} ka ${targetAttr} **${targetVal}** hai."
2. Provide ONLY a compact specification summary:
   - Brand: ${jo["Brand"] || "Standard"}
   - Party: ${jo["Party Name"] || "Standard"}
   - Garment & Style: ${jo["Garment Type"] || "Garment"} (${jo["Style"] || "Standard"}) | Fabric: ${jo["Fabric"] || "Fabric"}
3. Friendly next-question recommendation:
   "💡 Agla Sawaal: Agar aap is lot ka complete department timeline ya tracking dekhna chahte hain, toh \`${specificLotDetails.lotNumber} lot complete history\` pooch sakte hain."
4. STRICTLY FORBIDDEN:
   - Do NOT list all departments or full timeline.
   - Do NOT output tables or Department Audit Trail.
   - Do NOT mention Google Sheets or fetching mechanisms.
`;
    } else {
      lotContextSection = `
=== VERIFIED PRODUCTION FLOOR DATA FOR LOT ${specificLotDetails.lotNumber} ===
Lot Number: ${specificLotDetails.lotNumber}
1. Job Order Master: ${JSON.stringify(specificLotDetails.jobOrder, null, 2)}
2. Cutting Department: ${JSON.stringify(specificLotDetails.cuttingMaster, null, 2)}
3. Stitching Department (Issues & Index Data): ${JSON.stringify({
  ...(specificLotDetails.issuesAndPacking || {}),
  stitchingSupervisor: specificLotDetails.cuttingMaster?.Supervisor || specificLotDetails.issuesAndPacking?.["STITCHING SUPERVISOR"] || null,
  completedStatus: specificLotDetails.cuttingMaster?.["Completed Status"] || null,
  wipStatus: specificLotDetails.cuttingMaster?.["WIP Status"] || null
}, null, 2)}
4. Kaj-Button Department: ${JSON.stringify(specificLotDetails.kajButton, null, 2)}
5. Washing Department: ${JSON.stringify(specificLotDetails.washing, null, 2)}
6. Overlock Department: ${JSON.stringify(specificLotDetails.overlock, null, 2)}
7. Folding Department: ${JSON.stringify(specificLotDetails.folding, null, 2)}
8. Elastic Department: ${JSON.stringify(specificLotDetails.elastic, null, 2)}
9. Barcode & Packing: ${JSON.stringify(specificLotDetails.barcodes, null, 2)}
10. Zip Purchase & Gate Entry (Records): ${JSON.stringify(specificLotDetails.sqlZips.length > 0 ? specificLotDetails.sqlZips : specificLotDetails.zipPurchase, null, 2)}
11. Dori Purchase Order & Trims (Records): ${JSON.stringify(specificLotDetails.sqlDooris.length > 0 ? specificLotDetails.sqlDooris : specificLotDetails.doriPurchase, null, 2)}
12. Production Change Logs: ${JSON.stringify(specificLotDetails.activityLogs, null, 2)}
=============================================================
CRITICAL INSTRUCTION FOR LOT HISTORY & TIMELINE:
The user wants to check the complete department-by-department history of this lot.
Present a structured, chronological lifecycle audit trail covering EVERY department:
1. Job Order Master: Date, Party, Garment Type, Fabric, Order Qty, Direct Stitching ('yes'/'no').
2. Cutting Department: Cut Date (CRITICAL FACTORY RULE: Cut Date is strictly the "Saved At" date from Index records formatted as YYYY-MM-DD. Do NOT use Date of Issue which is stitching date!), Cutting Supervisor (NO supervisor - output "-"), Cut Qty, Status.
3. Stitching Department: Stitching Issue Date (from Date of Issue column), Stitching Supervisor, Status.
   CRITICAL STITCHING COMPLETION RULE:
   - Check "Completed Status" column from production records.
   - If "Completed Status" is populated/filled: Stitching is COMPLETED (✓ STITCHING COMPLETED).
   - If "Completed Status" is blank: Stitching is NOT COMPLETED (Status: ⏳ In Progress / Pending), and you MUST show the latest stitching remarks from "WIP Status" JSON.
4. Kaj-Button Department: Date, KajButton Supervisor, Pcs, Status (WIP / Completed).
5. Washing Department: Date, Washing Supervisor, Plant, Process, Pcs, Status.
6. Overlock Department: Date, Overlock Supervisor, Pcs, Status.
7. Folding Department: Date, Folding Supervisor, Pcs, Status.
8. Elastic Department: Date, Elastic Supervisor, Pcs, Status.
9. Packing & Barcode Department: Packing Supervisor, Packing Date, Barcode IDs, Total Packed, Quality Status.
10. Zip Procurement & Gate Entry: Supplier Name, PO Number, Total Pieces, Selections, Gate Entry Person & Date.
11. Dori Purchase Order & Trims: Supplier Name, PO Number, Total Pieces, Garment Type, Style, Dori Selections, Supervisor.
12. Production Change Logs: Any changes, permissions, timestamps.

CRITICAL PROFESSIONALISM DIRECTIVE:
- NEVER say "I am fetching data from sheets", "as per our Google Sheets", "connected sheets", "sheet data", or "read-only mode".
- NEVER output spreadsheet names like "JobOrder Sheet", "Index Sheet", "Issues Sheet", or tab names.
- Always refer to data professionally as "Production Records", "Factory Floor Logs", "Official Production History", or "Verified Factory Data".
- For EVERY process, state the specific supervisor and date. If a department is not applicable or pending, state that clearly as "Pending / Not initiated on production floor".

CRITICAL IMAGE DISPLAY DIRECTIVE:
- When a Design Artwork Image is present (${specificLotDetails.designImageUrl || 'none'}), embed the image directly into the response using markdown image syntax: ![Design Artwork](${specificLotDetails.designImageUrl}).
- The user specifically requested to SHOW the image directly, NOT provide a download link or URL link.
- NEVER output links like "[View Artwork](...)", "[Download Image](...)", or "Click here to download". Embed the image directly in markdown.
`;
    }
  } else if (partyMatches) {
    lotContextSection = `
=== VERIFIED PARTY PRODUCTION RECORDS: "${partyMatches.partyName}" ===
Total Registered Lots for ${partyMatches.partyName}: ${partyMatches.totalCount} lots
Cut Complete (Verified in Cutting Records): ${partyMatches.cutCount} lots
Pending Cutting: ${partyMatches.pendingCount} lots
Sample Cut Lots (15): ${partyMatches.sampleCut.join(', ')}
Sample Pending Lots (15): ${partyMatches.samplePending.join(', ')}
All ${partyMatches.totalCount} Lots List: ${partyMatches.allLots.join(', ')}
================================================================================
CRITICAL INSTRUCTION FOR ${partyMatches.partyName} LOTS QUERY:
State the exact verified numbers:
- Total Registered Lots: ${partyMatches.totalCount} lots.
- Cut Complete: ${partyMatches.cutCount} lots have been cut.
- Pending Cutting: ${partyMatches.pendingCount} lots are pending cutting.
Never hallucinate or report only 4-5 lots!
`;
  } else if (stageSearchSummary) {
    lotContextSection = `
=== DEPARTMENT INVENTORY DATA: "${stageSearchSummary.stage.toUpperCase()}" ===
Total Verified Lots in ${stageSearchSummary.stage}: ${stageSearchSummary.totalRecords} entries
Sample Lots in this Stage: ${stageSearchSummary.sampleLots.join(', ')}
==============================================================================
`;
  }

  const systemInstruction = `You are "Factory AI Copilot", an executive-grade industrial engineering and multi-stage garment manufacturing AI assistant for Factory Suite Pro.
You converse fluently in Hinglish, Hindi, or English (matching the user's language).

CRITICAL PROFESSIONALISM & TONE DIRECTIVE:
- NEVER mention "Google Sheets", "fetching data from sheets", "connected sheets", "read-only mode", or spreadsheet names in any user response. It is strictly forbidden and unprofessional.
- Speak with executive, industrial-grade ERP authority citing "Verified Factory Production Records", "Factory Database", or "Production Floor Records".

${lotContextSection}
${accessoryInventorySection}

Verified Operations Summary:
- Master Factory Orders: ${jobOrderData.length} active lots
- Cutting Department Authority Records: ${indexData.length} entries
- Stitching & Packing Handover Records: ${issuesData.length} entries
- Kaj-Button Stage Records: ${kajButtonData.length} entries
- Washing & Finishing Records: ${washingData.length} entries
- Overlock Finishing Records: ${overlockData.length} entries
- Folding & Packaging Records: ${foldingData.length} entries
- Elastic Attachment Records: ${elasticData.length} entries
- Barcode Tracking Records: ${barcodeData.length} entries
- Zip Purchase Orders & Gate Entry: ${zipPurchaseData.length + sqlData.rawZips.length} entries
- Dori Purchase Orders & Trims: ${doriPurchaseData.length + sqlData.rawDooris.length} entries
- Registered Accessory Materials (SQL Inventory): ${sqlMaterials.length} items
- Production Activity Logs: ${lotLogsData.length} entries${historyStr}

Guidelines:
1. When asked about SS lots, state the exact 331 verified count and cut/pending breakdown.
2. When asked about Kaj-Button, Washing, Overlock, Folding, Elastic, Barcode, Packing, Zip, or Dori status for any lot, report the exact supervisor, dates, piece quantities, and status from official factory production records.
3. When asked about accessories, materials, zipper stock, buttons, or warehouse locations, cite the verified SQL inventory records and report exact quantities, units, and threshold alerts.
4. Keep tone respectful, industrial-grade, clear, and direct.`;

  return {
    success: true,
    userPrompt: rawPrompt,
    systemInstruction,
    kpis: { totalLotsCount, totalQty }
  };
}

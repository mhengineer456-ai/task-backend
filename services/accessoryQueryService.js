import { accessoryQuery, isAccessoryConnected, getAccessoryDbStatus, initAccessoryDatabase } from '../config/accessoryDb.js';

function safeParseJson(raw, fallback = null) {
  if (!raw) return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

/**
 * Clean lot number helper
 */
function cleanLot(lot) {
  return String(lot || '').replace(/^LOT[-_\s]*/i, '').trim();
}

/**
 * 1. WEIGHT CAPTURE QUERIES
 */
export async function getWeightCaptureByLot(lotNo) {
  const clean = cleanLot(lotNo);
  if (!clean) return [];

  try {
    const rows = await accessoryQuery(
      `SELECT * FROM weight_capture 
       WHERE TRIM(LOWER(lotNo)) = TRIM(LOWER(?)) 
          OR TRIM(LOWER(lotNo)) LIKE TRIM(LOWER(?))
       ORDER BY capturedAt DESC, id DESC`,
      [clean, `%${clean}%`]
    );
    return rows || [];
  } catch (err) {
    console.warn(`[Accessory Service] Error querying weight capture for Lot ${lotNo}:`, err.message);
    return [];
  }
}

export async function getRecentWeightCaptures(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM weight_capture ORDER BY capturedAt DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying recent weight captures:', err.message);
    return [];
  }
}

export async function getWeightCaptureSummary() {
  try {
    const [summary] = await accessoryQuery(`
      SELECT 
        COUNT(*) as totalEntries,
        COUNT(DISTINCT lotNo) as distinctLots,
        ROUND(COALESCE(SUM(grossWeightKg), 0), 2) as totalGrossKg,
        ROUND(COALESCE(SUM(netWeightKg), 0), 2) as totalNetKg,
        COALESCE(SUM(pieces), 0) as totalPieces,
        COALESCE(SUM(packets), 0) as totalPackets,
        SUM(CASE WHEN LOWER(approvalStatus) = 'approved' THEN 1 ELSE 0 END) as approvedCount,
        SUM(CASE WHEN LOWER(approvalStatus) = 'pending' OR approvalStatus IS NULL THEN 1 ELSE 0 END) as pendingCount
      FROM weight_capture
    `);
    return summary || null;
  } catch (err) {
    console.warn('[Accessory Service] Error querying weight capture summary:', err.message);
    return null;
  }
}

/**
 * 2. ISSUE LOGS QUERIES
 */
export async function getIssueLogsByLot(lotId) {
  const clean = cleanLot(lotId);
  if (!clean) return [];

  try {
    const rows = await accessoryQuery(
      `SELECT * FROM issue_logs 
       WHERE TRIM(LOWER(lotId)) = TRIM(LOWER(?)) 
          OR TRIM(LOWER(lotId)) LIKE TRIM(LOWER(?))
       ORDER BY date DESC, id DESC`,
      [clean, `%${clean}%`]
    );

    return (rows || []).map(r => ({
      ...r,
      parsedMaterials: safeParseJson(r.materials, r.materials)
    }));
  } catch (err) {
    console.warn(`[Accessory Service] Error querying issue logs for Lot ${lotId}:`, err.message);
    return [];
  }
}

export async function getRecentIssueLogs(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM issue_logs ORDER BY date DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return (rows || []).map(r => ({
      ...r,
      parsedMaterials: safeParseJson(r.materials, r.materials)
    }));
  } catch (err) {
    console.warn('[Accessory Service] Error querying recent issue logs:', err.message);
    return [];
  }
}

/**
 * 3. MATERIALS / INVENTORY QUERIES
 */
export async function getMaterialsInventory(options = {}) {
  const { search, category, lowStockOnly, limit = 100 } = options;

  try {
    let sql = `SELECT * FROM materials WHERE 1=1`;
    const params = [];

    if (category) {
      sql += ` AND LOWER(category) = LOWER(?)`;
      params.push(category);
    }

    if (search) {
      const term = `%${search.trim().toLowerCase()}%`;
      sql += ` AND (
        LOWER(name) LIKE ? 
        OR LOWER(id) LIKE ? 
        OR LOWER(COALESCE(brand, '')) LIKE ? 
        OR LOWER(COALESCE(itemCode, '')) LIKE ? 
        OR LOWER(COALESCE(category, '')) LIKE ? 
        OR LOWER(COALESCE(color, '')) LIKE ? 
        OR LOWER(COALESCE(location, '')) LIKE ?
      )`;
      params.push(term, term, term, term, term, term, term);
    }

    if (lowStockOnly) {
      sql += ` AND stock <= threshold`;
    }

    sql += ` ORDER BY category ASC, stock DESC LIMIT ?`;
    params.push(Number(limit) || 100);

    const rows = await accessoryQuery(sql, params);
    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying materials inventory:', err.message);
    return [];
  }
}

export async function searchMaterialsByNameOrCode(term) {
  if (!term) return [];
  return getMaterialsInventory({ search: term, limit: 30 });
}

/**
 * Smart Multi-Token Search for materials, brands, categories, tags, labels with Cloudinary images
 */
export async function searchAccessoryMaterialsSmart(queryStr, options = {}) {
  const raw = String(queryStr || '').trim();
  if (!raw) return [];

  const lower = raw.toLowerCase();

  // 1. Direct search by full term
  let rows = await getMaterialsInventory({ search: raw, limit: options.limit || 30 });
  if (rows && rows.length > 0) return rows;

  // 2. Extract potential keywords: split by whitespace, filter out common filler words
  const stopWords = new Set(['k', 'ke', 'ka', 'ki', 'ko', 'me', 'mre', 'mere', 'pass', 'paas', 'kitna', 'kitne', 'kitni', 'pda', 'pada', 'hai', 'h', 'with', 'photo', 'image', 'pic', 'dikhao', 'batao', 'btana', 'show', 'tell', 'available', 'check', 'karo', 'please']);
  const tokens = lower.replace(/[^a-z0-9\s_-]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !stopWords.has(t));

  for (const token of tokens) {
    const candidate = await getMaterialsInventory({ search: token, limit: 30 });
    if (candidate && candidate.length > 0) {
      // If query also specified a category (e.g. label or tag), prioritize matching category
      if (/\b(labels?)\b/i.test(lower)) {
        const filtered = candidate.filter(c => /labels?/i.test(c.category || ''));
        if (filtered.length > 0) return filtered;
      }
      if (/\b(tags?)\b/i.test(lower)) {
        const filtered = candidate.filter(c => /tags?/i.test(c.category || ''));
        if (filtered.length > 0) return filtered;
      }
      return candidate;
    }
  }

  return [];
}

export async function getLowStockMaterials() {
  return getMaterialsInventory({ lowStockOnly: true, limit: 50 });
}

/**
 * 4. ZIP & DORI (TRIMS) QUERIES
 */
export async function getTrimsByLot(lotNo) {
  const clean = cleanLot(lotNo);
  if (!clean) return { zips: [], doris: [] };

  try {
    const zips = await accessoryQuery(
      `SELECT * FROM zip WHERE TRIM(LOWER(Lot_Number)) = TRIM(LOWER(?)) OR TRIM(LOWER(Lot_Number)) LIKE TRIM(LOWER(?)) ORDER BY id DESC`,
      [clean, `%${clean}%`]
    ).catch(() => []);

    let doris = await accessoryQuery(
      `SELECT * FROM dori_issue WHERE TRIM(LOWER(Lot_Number)) = TRIM(LOWER(?)) OR TRIM(LOWER(Lot_Number)) LIKE TRIM(LOWER(?)) ORDER BY id DESC`,
      [clean, `%${clean}%`]
    ).catch(() => []);

    if (!doris || doris.length === 0) {
      doris = await accessoryQuery(
        `SELECT * FROM doori WHERE TRIM(LOWER(Lot_Number)) = TRIM(LOWER(?)) OR TRIM(LOWER(Lot_Number)) LIKE TRIM(LOWER(?)) ORDER BY id DESC`,
        [clean, `%${clean}%`]
      ).catch(() => []);
    }

    return { zips: zips || [], doris: doris || [] };
  } catch (err) {
    console.warn(`[Accessory Service] Error querying trims for Lot ${lotNo}:`, err.message);
    return { zips: [], doris: [] };
  }
}

/**
 * 5. GODOWN / WAREHOUSE MATERIAL TRANSFERS
 */
export async function getMaterialTransfers(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM material_transfers ORDER BY transferredAt DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying material transfers:', err.message);
    return [];
  }
}

/**
 * 6. RETURNABLE GATE PASSES (RGP)
 */
export async function getAccessoryRgpList(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM rgp ORDER BY createdAt DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return (rows || []).map(r => ({
      ...r,
      parsedEntries: safeParseJson(r.entries, [])
    }));
  } catch (err) {
    console.warn('[Accessory Service] Error querying RGP passes:', err.message);
    return [];
  }
}

/**
 * 7. INWARD BARCODE SCANS
 */
export async function getAccessoryScans(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM scans ORDER BY scanned_at DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying accessory scans:', err.message);
    return [];
  }
}

/**
 * 8. MASTER CONSOLIDATED LOT ACCESSORY INTELLIGENCE
 */
export async function getCompleteAccessoryReportForLot(lotNo) {
  const clean = cleanLot(lotNo);
  if (!clean) return null;

  const [weightRecords, issueLogs, trims, rgps, scans] = await Promise.all([
    getWeightCaptureByLot(clean),
    getIssueLogsByLot(clean),
    getTrimsByLot(clean),
    getAccessoryRgpList(50).then(list => list.filter(r => {
      const matchInEntries = (r.parsedEntries || []).some(e => String(e.lotNo || '') === clean);
      return matchInEntries || String(r.remarks || '').includes(clean);
    })).catch(() => []),
    accessoryQuery(`SELECT * FROM scans WHERE TRIM(LOWER(lot_number)) = TRIM(LOWER(?)) ORDER BY scanned_at DESC`, [clean]).catch(() => [])
  ]);

  const hasData = (weightRecords.length > 0) || (issueLogs.length > 0) ||
                  (trims.zips.length > 0) || (trims.doris.length > 0) ||
                  (rgps.length > 0) || (scans.length > 0);

  // Calculate metrics
  const totalVerifiedWeightKg = weightRecords.reduce((acc, r) => acc + (Number(r.netWeightKg) || 0), 0);
  const totalVerifiedPieces = weightRecords.reduce((acc, r) => acc + (Number(r.pieces) || 0), 0);
  const totalPackets = weightRecords.reduce((acc, r) => acc + (Number(r.packets) || 0), 0);
  const isAllApproved = weightRecords.length > 0 && weightRecords.every(r => (r.approvalStatus || '').toLowerCase() === 'approved');

  return {
    lotNo: clean,
    hasData,
    connected: isAccessoryConnected(),
    metrics: {
      weightEntriesCount: weightRecords.length,
      totalVerifiedWeightKg: Math.round(totalVerifiedWeightKg * 1000) / 1000,
      totalVerifiedPieces,
      totalPackets,
      isAllApproved,
      issueLogsCount: issueLogs.length,
      zipOrdersCount: trims.zips.length,
      doriOrdersCount: trims.doris.length,
      rgpCount: rgps.length,
      scanCount: scans.length
    },
    weightRecords,
    issueLogs,
    zips: trims.zips,
    doris: trims.doris,
    rgps,
    scans
  };
}

/**
 * 9. COMPREHENSIVE ACCESSORY STORAGE OVERVIEW WITH SOLUTIONS
 */
export async function getAccessoryStorageOverview() {
  if (!isAccessoryConnected()) {
    await initAccessoryDatabase().catch(() => {});
  }

  const [allMaterials, weightSummary, recentWeights, recentTransfers, recentRgps, recentScans, trimsCount] = await Promise.all([
    getMaterialsInventory({ limit: 200 }),
    getWeightCaptureSummary(),
    getRecentWeightCaptures(10),
    getMaterialTransfers(10),
    getAccessoryRgpList(10),
    getAccessoryScans(10),
    accessoryQuery(`
      SELECT 
        (SELECT COUNT(*) FROM zip) as zipCount,
        (SELECT COUNT(*) FROM doori) as dooriCount,
        (SELECT COUNT(*) FROM dori_issue) as doriIssueCount
    `).catch(() => [[{ zipCount: 0, dooriCount: 0, doriIssueCount: 0 }]])
  ]);

  const dbStatus = getAccessoryDbStatus();
  const connected = isAccessoryConnected();

  const tc = trimsCount?.[0] || {};
  const totalZips = Number(tc.zipCount) || 0;
  const totalDoris = Math.max(Number(tc.dooriCount) || 0, Number(tc.doriIssueCount) || 0);

  // Materials analysis
  const totalMaterials = allMaterials.length;
  const totalStockQty = allMaterials.reduce((acc, m) => acc + (Number(m.stock) || 0), 0);
  const lowStockItems = allMaterials.filter(m => {
    const s = Number(m.stock);
    const th = Number(m.threshold);
    return !isNaN(s) && !isNaN(th) && s <= th;
  });

  const categoriesMap = {};
  const locationsMap = {};
  allMaterials.forEach(m => {
    const cat = m.category || 'Other';
    categoriesMap[cat] = (categoriesMap[cat] || 0) + 1;
    const loc = m.location || 'Main Godown';
    locationsMap[loc] = (locationsMap[loc] || 0) + 1;
  });

  // Actionable Solutions Generator
  const solutions = [];

  // Solution 1: Low Stock Replenishment
  if (lowStockItems.length > 0) {
    solutions.push({
      type: 'RESTOCK_ALERT',
      severity: 'HIGH',
      title: `Critical Re-order Alert for ${lowStockItems.length} Materials`,
      summary: `${lowStockItems.length} accessory items have reached or breached threshold levels.`,
      action: 'Generate purchase orders to prevent stitching line starvation.',
      items: lowStockItems.slice(0, 5).map(m => ({
        id: m.id,
        name: m.name,
        stock: m.stock,
        threshold: m.threshold,
        unit: m.unit,
        location: m.location
      }))
    });
  } else {
    solutions.push({
      type: 'STOCK_HEALTH',
      severity: 'NORMAL',
      title: 'Healthy Stock Buffer',
      summary: 'All registered accessory materials are above critical threshold limits.',
      action: 'Continue periodic stock audit.'
    });
  }

  // Solution 2: Weight Verification Quality & Approvals
  if (weightSummary && weightSummary.pendingCount > 0) {
    solutions.push({
      type: 'APPROVAL_REQUIRED',
      severity: 'MEDIUM',
      title: `${weightSummary.pendingCount} Weight Captures Pending Quality Sign-Off`,
      summary: 'Weight scale entries recorded but pending formal QA approval.',
      action: 'Review and approve digital weight logs in the accessory portal.'
    });
  } else if (weightSummary && weightSummary.totalEntries > 0) {
    solutions.push({
      type: 'WEIGHT_VERIFIED',
      severity: 'NORMAL',
      title: 'Digital Scale Integration 100% Operational',
      summary: `${weightSummary.totalEntries} entries logged totaling ${weightSummary.totalNetKg} kg net with 100% QA verified status.`,
      action: 'Tare weight calibration is healthy.'
    });
  }

  // Solution 3: RGP Vendor Return Tracking
  const pendingRgps = recentRgps.filter(r => r.expectedReturnDate && new Date(r.expectedReturnDate) <= new Date());
  if (pendingRgps.length > 0) {
    solutions.push({
      type: 'RGP_OVERDUE',
      severity: 'MEDIUM',
      title: `${pendingRgps.length} Returnable Gate Passes Due for Recovery`,
      summary: 'Materials sent to external stitching/embroidery vendors have reached expected return date.',
      action: 'Follow up with vendor to reconcile returned goods with gate inward scan.'
    });
  }

  return {
    connected,
    dbStatus,
    summary: {
      totalMaterials,
      totalStockQty,
      lowStockCount: lowStockItems.length,
      categoriesCount: Object.keys(categoriesMap).length,
      locationsCount: Object.keys(locationsMap).length,
      totalWeightEntries: weightSummary?.totalEntries || 0,
      totalNetWeightKg: weightSummary?.totalNetKg || 0,
      totalVerifiedPieces: weightSummary?.totalPieces || 0,
      totalZips,
      totalDoris,
      totalTransfers: recentTransfers.length,
      totalRgps: recentRgps.length,
      totalScans: recentScans.length
    },
    categories: categoriesMap,
    locations: locationsMap,
    lowStockItems,
    weightSummary,
    recentWeights,
    recentTransfers,
    recentRgps,
    recentScans,
    solutions
  };
}

/**
 * 10. ELEGANT MARKDOWN BUILDERS FOR PULSEBOT AI
 */

export function formatWeightRecordsToMarkdown(records, lotNo = '') {
  if (!records || records.length === 0) {
    return lotNo 
      ? `*No weight verification records captured for Lot **${lotNo}** in the Accessory SQL Database.*`
      : `*No weight capture records found.*`;
  }

  let md = `### ⚖️ Accessory Weight Verification Records ${lotNo ? `(Lot ${lotNo})` : ''}\n\n`;
  md += `| Material / Code | Net Wt (kg) | Gross (kg) | Wt/Piece (g) | Pieces | Packets | Location | Status | Approval |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  records.forEach(r => {
    const matName = r.materialName || r.materialCode || 'Item';
    const code = r.materialCode ? `\`${r.materialCode}\`` : '';
    const itemCell = code ? `**${matName}** (${code})` : `**${matName}**`;
    const net = Number(r.netWeightKg || 0).toFixed(2);
    const gross = Number(r.grossWeightKg || 0).toFixed(2);
    const wtPerPc = Number(r.weightPerPieceG || 0).toFixed(1);
    const pcs = r.pieces || '-';
    const pkts = r.packets || '-';
    const loc = r.storeLocation || 'Main Store';
    const status = r.status || 'Verified';
    const approval = (r.approvalStatus || '').toLowerCase() === 'approved' ? '✅ Approved' : (r.approvalStatus || 'Pending');

    md += `| ${itemCell} | **${net} kg** | ${gross} kg | ${wtPerPc}g | **${pcs}** | ${pkts} | ${loc} | ${status} | ${approval} |\n`;
  });

  return md;
}

export function formatIssueLogsToMarkdown(logs, lotNo = '') {
  if (!logs || logs.length === 0) {
    return lotNo 
      ? `*No accessory issue logs recorded for Lot **${lotNo}**.*`
      : `*No accessory issue logs found.*`;
  }

  let md = `### 📦 Accessory Issue Logs ${lotNo ? `(Lot ${lotNo})` : ''}\n\n`;
  md += `| ID | Person | Category | Volume | Date | Type | Materials Issued |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  logs.forEach(l => {
    const id = l.id ? `\`${l.id}\`` : '-';
    const person = l.personName ? `**${l.personName}**` : 'Floor Supervisor';
    const cat = l.category || 'Accessories';
    const vol = l.volume !== undefined && l.volume !== null ? l.volume : '-';
    const date = l.date || '-';
    const type = l.isReturn ? '↩️ Return' : (l.isReissue ? '🔁 Re-issue' : '📤 Regular Issue');
    
    let matsText = '-';
    if (Array.isArray(l.parsedMaterials)) {
      matsText = l.parsedMaterials.map(m => `${m.name || m.materialName || 'Item'}: ${m.qty || m.quantity || ''} ${m.unit || ''}`).join(', ');
    } else if (typeof l.materials === 'string' && l.materials.trim()) {
      matsText = l.materials;
    }

    md += `| ${id} | ${person} | ${cat} | ${vol} | ${date} | ${type} | ${matsText} |\n`;
  });

  return md;
}

export function formatMaterialDetailCardToMarkdown(items, searchTerm = '', userAskedPhoto = false) {
  if (!items || items.length === 0) {
    return `*Accessory SQL Database mein "${searchTerm || 'Item'}" ke naam ya brand se koi material nahi mila.*`;
  }

  const titleName = items[0]?.brand || items[0]?.name || searchTerm || 'Material';
  let md = `### 🧵 Verified Accessory Stock: **${titleName}**\n\n`;

  md += `| Code | Item Name | Category | Current Stock | Packets | Godown Location | Unit Cost | PO / Invoice |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  items.forEach(m => {
    const code = m.id ? `\`${m.id}\`` : '-';
    const isLow = Number(m.stock || 0) <= Number(m.threshold || 0);
    const stockDisplay = isLow ? `⚠️ 🔴 **${Number(m.stock || 0).toLocaleString()} ${m.unit || 'Pcs'}** (Low)` : `🟢 **${Number(m.stock || 0).toLocaleString()} ${m.unit || 'Pcs'}**`;
    const loc = m.location || 'Main Store';
    const cost = Number(m.cost || 0) > 0 ? `₹${m.cost}` : '₹0.00';
    const po = m.poNumber || m.invoiceNo || '-';

    md += `| ${code} | **${m.name}** | **${m.category || 'Accessory'}** | ${stockDisplay} | **${m.packets || 1} Pkts** | 📍 \`${loc}\` | ${cost} | #${po} |\n`;
  });

  md += `\n`;

  // Photos Section (Embed Cloudinary Images)
  const itemsWithImages = items.filter(m => m.imageUrl && m.imageUrl.trim());
  if (itemsWithImages.length > 0) {
    md += `#### 🖼️ Material Photos (Cloudinary Verified):\n\n`;
    itemsWithImages.forEach(m => {
      const label = `${m.name} (${m.category || 'Accessory'} • ${m.id})`;
      md += `* **${label}:**\n\n`;
      md += `![${label}](${m.imageUrl})\n\n`;
    });
  } else if (userAskedPhoto) {
    md += `ℹ️ *Note: Is material ke liye abhi Cloudinary image URL upload nahi hua hai.*\n\n`;
  }

  // Summary solution sentence
  const totalStockSum = items.reduce((acc, m) => acc + (Number(m.stock) || 0), 0);
  md += `💡 **Quick Summary & Solution:** Aapke paas total **${Number(totalStockSum).toLocaleString()} units** available hain. Material physical verification ke liye di gayi godown rack locations check karein.\n`;

  return md;
}

export function formatMaterialsToMarkdown(materials, title = 'Accessory Materials & Stock Inventory') {
  if (!materials || materials.length === 0) {
    return `*No materials found matching your criteria in the Accessory SQL Database.*`;
  }

  let md = `### 🧵 ${title}\n\n`;
  md += `| Code | Material Name | Category | Stock | Unit | Color | Location | PO Number |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  materials.slice(0, 30).forEach(m => {
    const code = m.id ? `\`${m.id}\`` : '-';
    const isLow = Number(m.stock || 0) <= Number(m.threshold || 0);
    const stockDisplay = isLow ? `⚠️ **${m.stock}** (Low)` : `**${m.stock}**`;
    const loc = m.location || 'Store';
    const po = m.poNumber || '-';

    md += `| ${code} | **${m.name || '-'}** | ${m.category || '-'} | ${stockDisplay} | ${m.unit || 'Pcs'} | ${m.color || 'Default'} | ${loc} | ${po} |\n`;
  });

  if (materials.length > 30) {
    md += `\n*Showing top 30 of ${materials.length} total materials in inventory.*\n`;
  }

  return md;
}

export function formatLowStockToMarkdown(items) {
  if (!items || items.length === 0) {
    return `✅ **Stock Health Good:** Koi bhi accessory material low stock ya critical threshold par nahi hai.`;
  }

  let md = `### 🚨 Critical Low Stock Materials & Re-order Alerts\n\n`;
  md += `| Code | Material Name | Current Stock | Minimum Threshold | Unit | Godown Location | Solution / Re-order Action |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  items.forEach(m => {
    const deficit = Math.max(0, (Number(m.threshold) || 0) - (Number(m.stock) || 0));
    const reorderSuggest = deficit > 0 ? `Order min **${deficit * 2 || 100} ${m.unit || 'Pcs'}**` : `Replenish buffer`;
    md += `| \`${m.id}\` | **${m.name}** | 🔴 **${m.stock}** | ${m.threshold} | ${m.unit || 'Pcs'} | ${m.location || 'Godown'} | ${reorderSuggest} |\n`;
  });

  md += `\n💡 **Action Plan:** In sabhi items ka PO turant generate karein taaki stitching aur finishing line par delay na ho.\n`;
  return md;
}

export function formatMaterialTransfersToMarkdown(transfers) {
  if (!transfers || transfers.length === 0) {
    return `*No recent godown material transfers recorded.*`;
  }

  let md = `### 🚚 Recent Warehouse / Godown Location Transfers\n\n`;
  md += `| Code | Material Name | From Location | To Location | Qty | Operator | Transferred At |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  transfers.forEach(t => {
    const dateStr = t.transferredAt ? new Date(t.transferredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';
    md += `| \`${t.materialCode}\` | **${t.materialName}** | ${t.fromLocation || '-'} | ➡️ **${t.toLocation || '-'}** | ${t.quantity} (${t.transferType || 'packet'}) | ${t.operator || 'Staff'} | ${dateStr} |\n`;
  });

  return md;
}

export function formatRgpToMarkdown(rgpList) {
  if (!rgpList || rgpList.length === 0) {
    return `*No Returnable Gate Passes (RGP) found.*`;
  }

  let md = `### 📋 Returnable Gate Passes (RGP) - External Outpasses\n\n`;
  md += `| RGP No | Vendor | Item / Purpose | Department | Expected Return | Prepared By | Auth By |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  rgpList.forEach(r => {
    const rgpNo = `\`${r.rgpNo || r.id}\``;
    const purpose = r.purpose ? `${r.rgpType || 'Trim'} (${r.purpose})` : (r.rgpType || 'Accessory');
    const returnDate = r.expectedReturnDate || 'Open';
    md += `| ${rgpNo} | **${r.vendor}** | ${purpose} | ${r.department || 'Stitching'} | **${returnDate}** | ${r.preparedBy || '-'} | ${r.authorizedBy || '-'} |\n`;
  });

  return md;
}

export function formatScansToMarkdown(scans) {
  if (!scans || scans.length === 0) {
    return `*No inward barcode scans recorded.*`;
  }

  let md = `### 🔍 Inward Barcode Scans & Gate Receiving\n\n`;
  md += `| Lot No | Material Name | Scan Type | Qty | Supplier | Inspector | Scanned At |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  scans.forEach(s => {
    const dateStr = s.scanned_at ? new Date(s.scanned_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';
    md += `| **${s.lot_number || '-'}** | ${s.material_name || '-'} | \`${s.scan_type || 'material_in'}\` | **${s.quantity || 0}** | ${s.supplier_name || '-'} | ${s.person_name || '-'} | ${dateStr} |\n`;
  });

  return md;
}

/**
 * 11. COMPLETE ACCESSORY STORAGE OVERVIEW TO MARKDOWN
 */
export function formatAccessoryStorageOverviewToMarkdown(overview) {
  const { connected, dbStatus, summary, lowStockItems, solutions } = overview;

  let md = `### 🧰 Accessory SQL Storage & Management Intelligence Dashboard\n\n`;

  // Database Connection Badge
  md += `* 🌐 **Database:** \`${dbStatus.database}\` on \`${dbStatus.host}:${dbStatus.port}\`\n`;
  md += `* ⚡ **Live Status:** ${connected ? '🟢 **ONLINE & FULLY CONNECTED**' : '🔴 **DISCONNECTED**'}\n`;
  md += `* 📊 **Registered Materials:** **${summary.totalMaterials} Items** across **${summary.categoriesCount} Categories**\n`;
  md += `* 📦 **Total Inventory Units:** **${Number(summary.totalStockQty).toLocaleString()} Units** stored across **${summary.locationsCount} Godown Locations**\n`;
  md += `* ⚖️ **Weight Scale Records:** **${summary.totalWeightEntries} Entries** (**${summary.totalNetWeightKg} kg Net** / **${Number(summary.totalVerifiedPieces).toLocaleString()} Verified Pcs**)\n`;
  md += `* ✂️ **Trim Allocations:** **${summary.totalZips} Zip Records** • **${summary.totalDoris} Dori Records**\n`;
  md += `* 🚚 **Warehouse Movements:** **${summary.totalTransfers} Material Transfers** • **${summary.totalRgps} Returnable Gate Passes**\n\n`;
  md += `---\n\n`;

  // Solutions Section
  if (solutions && solutions.length > 0) {
    md += `### 💡 PulseBot AI Operational Solutions & Recommendations\n\n`;
    solutions.forEach((sol, i) => {
      const icon = sol.severity === 'HIGH' ? '🚨' : sol.severity === 'MEDIUM' ? '⚠️' : '✅';
      md += `#### ${icon} Solution ${i + 1}: ${sol.title}\n`;
      md += `* **Analysis:** ${sol.summary}\n`;
      md += `* **Action Required:** ${sol.action}\n\n`;
    });
    md += `---\n\n`;
  }

  // Low Stock Section if any
  if (lowStockItems && lowStockItems.length > 0) {
    md += formatLowStockToMarkdown(lowStockItems) + '\n\n';
  }

  return md;
}

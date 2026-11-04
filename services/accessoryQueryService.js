import { accessoryQuery, isAccessoryConnected, getAccessoryDbStatus } from '../config/accessoryDb.js';

function safeParseJson(raw, fallback = null) {
  if (!raw || typeof raw !== 'string') return fallback;
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
        SUM(CASE WHEN approvalStatus = 'Approved' THEN 1 ELSE 0 END) as approvedCount,
        SUM(CASE WHEN approvalStatus = 'Pending' THEN 1 ELSE 0 END) as pendingCount
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
      sql += ` AND (LOWER(name) LIKE ? OR LOWER(id) LIKE ? OR LOWER(color) LIKE ? OR LOWER(location) LIKE ?)`;
      params.push(term, term, term, term);
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
  return getMaterialsInventory({ search: term, limit: 20 });
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
 * 5. MASTER CONSOLIDATED LOT ACCESSORY INTELLIGENCE
 * Combines weight verification + issue logs + trim orders for a specific Lot
 */
export async function getCompleteAccessoryReportForLot(lotNo) {
  const clean = cleanLot(lotNo);
  if (!clean) return null;

  const [weightRecords, issueLogs, trims] = await Promise.all([
    getWeightCaptureByLot(clean),
    getIssueLogsByLot(clean),
    getTrimsByLot(clean)
  ]);

  const hasData = (weightRecords.length > 0) || (issueLogs.length > 0) || (trims.zips.length > 0) || (trims.doris.length > 0);

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
      doriOrdersCount: trims.doris.length
    },
    weightRecords,
    issueLogs,
    zips: trims.zips,
    doris: trims.doris
  };
}

/**
 * 6. ELEGANT MARKDOWN BUILDERS FOR PULSEBOT AI
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
    const approval = r.approvalStatus === 'Approved' ? '✅ Approved' : (r.approvalStatus || 'Pending');

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

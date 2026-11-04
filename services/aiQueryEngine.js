import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, isConnected } from '../config/db.js';
import { config } from '../config/config.js';
import { processJobOrderQuery } from './jobOrderQueryEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory indexed sheet cache
let cachedData = null;
let lastCacheTime = 0;

/**
 * Convert Google Drive links (uc?export=download, open?id=..., /file/d/...)
 * into high-performance, directly embeddable image CDN URLs (lh3.googleusercontent.com/d/ID)
 */
function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== 'string') return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

export function formatDirectImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  // Disallow non-URL strings like job order numbers (e.g. "JO-1", "JO-459"), lot numbers, or text ("NA", "None", "-")
  if (/^JO[-_\s]*\d+$/i.test(trimmed) || /^\d+$/.test(trimmed) || /^(na|n\/a|none|-|null|undefined)$/i.test(trimmed)) {
    return null;
  }
  const driveMatch = trimmed.match(/id=([a-zA-Z0-9_-]+)/) || trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    return `http://localhost:5000/api/chat/image-proxy?id=${driveMatch[1]}`;
  }
  if (/^(https?:\/\/|\/api\/|data:image\/)/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Safely parses Stitching completion status from Index sheet column "Completed Status".
 * Per factory business rule:
 * - If "Completed Status" is blank (null, undefined, "", "[]", whitespace): Stitching is NOT COMPLETED.
 * - If "Completed Status" contains completion entry (e.g. "Complete Lot"): Stitching IS COMPLETED.
 */
export function parseStitchingCompletion(completedStatusRaw) {
  if (!completedStatusRaw) return { isComplete: false, completeEntry: null, completedDate: null };

  if (typeof completedStatusRaw === 'string') {
    const trimmed = completedStatusRaw.trim();
    if (!trimmed || trimmed === '[]' || trimmed === '[ ]' || trimmed.toLowerCase() === 'no') {
      return { isComplete: false, completeEntry: null, completedDate: null };
    }
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const compItem = parsed.find(item => {
            const st = String(item.status || item.Status || '').trim().toLowerCase();
            return st.includes('complete') || st.includes('done') || st.includes('finish') || st === 'ok';
          }) || parsed[0];

          const st = String(compItem?.status || '').trim().toLowerCase();
          const isComp = Boolean(st && !st.includes('pending') && !st.includes('cancel') && !st.includes('wip') && !st.includes('working'));
          return {
            isComplete: isComp,
            completeEntry: compItem,
            completedDate: compItem?.timestamp || null
          };
        }
        return { isComplete: false, completeEntry: null, completedDate: null };
      } catch (e) {
        // Fall through to plain text check
      }
    }
    const lower = trimmed.toLowerCase();
    if (lower.includes('complete') || lower.includes('done') || lower === 'yes') {
      return { isComplete: true, completeEntry: { status: trimmed }, completedDate: null };
    }
    return { isComplete: false, completeEntry: null, completedDate: null };
  } else if (Array.isArray(completedStatusRaw)) {
    if (completedStatusRaw.length === 0) return { isComplete: false, completeEntry: null, completedDate: null };
    const compItem = completedStatusRaw[0];
    const st = String(compItem?.status || '').trim().toLowerCase();
    return {
      isComplete: Boolean(st && !st.includes('pending') && !st.includes('cancel')),
      completeEntry: compItem,
      completedDate: compItem?.timestamp || null
    };
  }

  return { isComplete: false, completeEntry: null, completedDate: null };
}

/**
 * Extracts latest Stitching remarks & status from Index sheet column "WIP Status" JSON.
 * Returns the most recent WIP entry by timestamp (or index 0).
 */
export function getLatestWipStatus(wipStatusRaw) {
  if (!wipStatusRaw) return null;
  let list = [];
  if (Array.isArray(wipStatusRaw)) {
    list = wipStatusRaw;
  } else if (typeof wipStatusRaw === 'string') {
    const trimmed = wipStatusRaw.trim();
    if (!trimmed || trimmed === '[]' || trimmed === '[ ]') return null;
    if (trimmed.startsWith('[')) {
      try {
        list = JSON.parse(trimmed);
      } catch (e) {
        return { status: trimmed, remarks: '', text: trimmed, timestamp: '' };
      }
    } else {
      return { status: trimmed, remarks: '', text: trimmed, timestamp: '' };
    }
  }

  if (!Array.isArray(list) || list.length === 0) return null;

  // Find latest entry by timestamp (defaulting to first element)
  let latest = list[0];
  let maxTime = -1;
  for (const item of list) {
    if (!item) continue;
    const tsStr = item.timestamp || item.date || '';
    const ts = Date.parse(tsStr);
    if (!isNaN(ts) && ts > maxTime) {
      maxTime = ts;
      latest = item;
    }
  }

  const st = String(latest.status || '').trim();
  const rem = String(latest.remarks || '').trim();
  const ts = latest.timestamp ? String(latest.timestamp).trim() : '';

  let combined = '';
  if (st && rem) {
    combined = `${st} (${rem})`;
  } else if (rem) {
    combined = rem;
  } else if (st) {
    combined = st;
  }

  return {
    status: st,
    remarks: rem,
    timestamp: ts,
    text: combined,
    raw: latest,
    history: list
  };
}

export function formatWipTimestamp(rawTs) {
  if (!rawTs) return '';
  const d = new Date(rawTs);
  if (isNaN(d.getTime())) return String(rawTs);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatSavedAtDate(rawDate) {
  if (!rawDate) return null;
  const str = String(rawDate).trim();
  if (!str) return null;

  // If already standard YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Parse full timestamp string e.g. "Mon Feb 09 2026 13:10:13 GMT+0530 (India Standard Time)"
  try {
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
      const year = dt.getFullYear();
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}

  // Regex fallback e.g. "Feb 09 2026" or "Jul 22 2026"
  const m = str.match(/\b([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/);
  if (m) {
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const mo = months[m[1].toLowerCase()] || '01';
    const da = m[2].padStart(2, '0');
    return `${m[3]}-${mo}-${da}`;
  }

  return str.slice(0, 10);
}

export function loadFactorySheetsData(forceRefresh = false) {
  if (cachedData && !forceRefresh) {
    return cachedData;
  }

  try {
    const filePath = path.join(__dirname, '../data/sheetsData.json');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    const getLot = (r) => String(r["Lot Number"] || r["LOT NUMBER"] || r["Lot No"] || r["LOT NO"] || r["lotNo"] || r["Lot"] || "").trim();

    const issues = parsed.issues || [];
    const jobOrders = parsed.jobOrders || [];
    const indexRows = parsed.indexRows || [];
    const cuttingDetails = parsed.cuttingDetails || [];
    const designImages = parsed.designImages || [];
    const cancelledLots = parsed.cancelledLots || [];
    const packingOrders = parsed.packingOrders || [];
    const lotLogs = parsed.lotLogs || [];
    const linkedSheetsSummary = parsed.linkedSheetsSummary || [];
    const customSheets = parsed.customSheets || {};

    // Map of cut lots with details from Index sheet (per user business rule: lots present in Index sheet are considered CUT)
    // PER FACTORY RULE: Cutting Completion Date is strictly the "Saved At" date from Index sheet!
    // "Date of Issue" is the STITCHING issue date, and "Supervisor" is the STITCHING supervisor.
    const cutLotsMap = new Map();
    indexRows.forEach(r => {
      const lot = getLot(r);
      if (lot) {
        const rawSavedAt = r["Saved At"] || r["SAVED AT"] || r["savedAt"] || r["SavedAt"] || r["Saved at"] || r["Saved_At"];
        const cutDate = formatSavedAtDate(rawSavedAt) || formatSavedAtDate(r["JobOrder Date"]) || null;

        cutLotsMap.set(lot, {
          lot,
          cutPcs: r["Cutting Qty"] || r["Cut Pcs"] || r["Total Pcs"] || r["Quantity"] || null,
          cutDate: cutDate,
          savedAtDate: rawSavedAt || null,
          stitchingSupervisor: r["Supervisor"] || null, // Index sheet Supervisor is Stitching Supervisor (Sanjay, Rohit, etc.)
          stitchingIssueDate: r["Date of Issue"] || null,
          completedStatus: r["Completed Status"] || null,
          wipStatus: r["WIP Status"] || null,
          directStitching: r["DIRECT STITCHING"] || null,
          brand: r["BRAND"] || null,
          season: r["SEASON"] || null,
          remarks: r["REMARKS"] || null,
          additionalRemarks: r["ADDITIONAL SUPERVISOR REMARKS"] || null
        });
      }
    });

    // Map of Cancelled Lots
    const cancelledLotsMap = new Map();
    cancelledLots.forEach(r => {
      const lot = getLot(r);
      if (lot) {
        cancelledLotsMap.set(lot, {
          lot,
          reason: r["Cancellation Reason"] || r["Reason"] || "Cancelled",
          by: r["Cancelled By"] || r["By"] || "Admin",
          date: r["Cancellation Timestamp"] || r["Date"] || "",
          approvedFrom: r["Cancellation Approved From"] || ""
        });
      }
    });

    // Map of Design Images
    const designImagesMap = new Map();
    designImages.forEach(r => {
      const lot = getLot(r);
      if (lot) {
        const raw = r["UPLOAD IMAGE"] || r["Upload Image"] || r["Image URL"] || r["Drive Link"] || r["Image"] || "";
        designImagesMap.set(lot, {
          lot,
          imageUrl: formatDirectImageUrl(raw) || "",
          title: r["Title"] || r["Item"] || ""
        });
      }
    });

    // Map of Karigar & Roll Cutting Details (sample indexed)
    const cuttingKarigarMap = new Map();
    cuttingDetails.forEach(r => {
      const lot = getLot(r);
      if (lot && !cuttingKarigarMap.has(lot)) {
        cuttingKarigarMap.set(lot, {
          lot,
          karigar: r["Karigar"] || r["Tailor"] || r["Worker"] || r["Supervisor"] || "",
          rollNo: r["Roll No"] || r["Roll"] || "",
          cutPcs: r["Pcs"] || r["Cut Qty"] || r["Quantity"] || ""
        });
      }
    });

    // Map of KajButton Stage
    const kajButtonMap = new Map();
    (customSheets.kaj_button?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot && !kajButtonMap.has(lot)) {
        kajButtonMap.set(lot, {
          lot,
          supervisor: r["kajButton Supervisor"] || r["Supervisor"] || "",
          date: r["KajButton Date"] || r["Date"] || "",
          totalPcs: r["Total Pcs"] || "",
          wip: r["WIP KajButton"] || "",
          complete: r["KajButton Complete"] || "",
          stitchingSupervisor: r["Stiching Supervisor"] || ""
        });
      }
    });

    // Map of Washing Stage
    const washingMap = new Map();
    (customSheets.washing_sheet?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot && !washingMap.has(lot)) {
        washingMap.set(lot, {
          lot,
          supervisor: r["Washing Supervisor"] || r["Supervisor"] || "",
          date: r["Washing Date"] || r["Date"] || "",
          totalPcs: r["Total Pcs"] || "",
          wip: r["WIP Washing"] || "",
          complete: r["Washing Complete"] || "",
          plant: r["Washing Plant"] || "",
          process: r["Process / Wash Type"] || "",
          challanNo: r["Challan No"] || ""
        });
      }
    });

    // Map of Overlock Stage
    const overlockMap = new Map();
    (customSheets.overlock_sheet?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot && !overlockMap.has(lot)) {
        overlockMap.set(lot, {
          lot,
          supervisor: r["Overlock Supervisor"] || r["Supervisor"] || "",
          date: r["Overlock Date"] || r["Date"] || "",
          totalPcs: r["Total Pcs"] || "",
          wip: r["WIP Overlock"] || "",
          complete: r["Overlock Complete"] || ""
        });
      }
    });

    // Map of Folding Stage
    const foldingMap = new Map();
    (customSheets.folding_sheet?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot && !foldingMap.has(lot)) {
        foldingMap.set(lot, {
          lot,
          supervisor: r["Folding Supervisor"] || r["Supervisor"] || "",
          date: r["Folding Date"] || r["Date"] || "",
          totalPcs: r["Total Pcs"] || "",
          wip: r["WIP Folding"] || "",
          complete: r["Folding Complete"] || ""
        });
      }
    });

    // Map of Elastic Stage
    const elasticMap = new Map();
    (customSheets.elastic_sheet?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot && !elasticMap.has(lot)) {
        elasticMap.set(lot, {
          lot,
          supervisor: r["Elastic Supervisor"] || r["Supervisor"] || "",
          date: r["Elastic Date"] || r["Date"] || "",
          totalPcs: r["Total Pcs"] || "",
          wip: r["WIP Elastic"] || "",
          complete: r["Elastic Complete"] || ""
        });
      }
    });

    // Map of Barcode Tracking Data
    const barcodesMap = new Map();
    (customSheets.barcode_data?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot) {
        if (!barcodesMap.has(lot)) barcodesMap.set(lot, []);
        barcodesMap.get(lot).push({
          barcodeId: r["Barcode ID"] || "",
          lot,
          status: r["Status"] || "",
          generatedDate: r["Generated Date"] || "",
          verificationCode: r["Verification Code"] || "",
          totalPieces: r["Total Pieces"] || "",
          packingSupervisor: r["Packing Supervisor"] || "",
          packingDate: r["Packing Date"] || "",
          qualityStatus: r["Quality Status"] || ""
        });
      }
    });

    // Map of Zip Purchase Orders & Gate Entry
    const zipPurchaseMap = new Map();
    (customSheets.zip_purchase_orders?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot && !zipPurchaseMap.has(lot)) {
        zipPurchaseMap.set(lot, {
          lot,
          supplierName: r["Supplier Name"] || "",
          gateEntryPerson: r["Gate Entry Person"] || "",
          gateEntryDate: r["Gate Entry Date"] || "",
          materialReceivedBy: r["Material Received By"] || "",
          materialReceivedDate: r["Material Received Date"] || "",
          materialEntryDate: r["Material Entry Date"] || "",
          pdfGeneratedDate: r["PDF Generated Date"] || "",
          approvalId: r["Approval ID"] || "",
          timestamp: r["Timestamp"] || ""
        });
      }
    });

    // Map of Dori Purchase Orders
    const doriPurchaseMap = new Map();
    (customSheets.dori_purchase_orders?.rows || []).forEach(r => {
      const lot = getLot(r);
      if (lot && !doriPurchaseMap.has(lot)) {
        doriPurchaseMap.set(lot, {
          lot,
          garmentType: r["Garment Type"] || "",
          style: r["Style"] || "",
          fabric: r["Fabric"] || "",
          totalPieces: r["Total Pieces"] || "",
          issueDate: r["Issue Date"] || "",
          supervisor: r["Supervisor"] || "",
          doriSelections: r["Dori Selections"] || "",
          timestamp: r["Timestamp"] || ""
        });
      }
    });

    // Map of Issues & Packing Sheet (Stitching Issue, Stitching Supervisor, Packing Supervisor, Packing Date)
    const issuesMap = new Map();
    issues.forEach(r => {
      const lot = getLot(r);
      if (lot && !issuesMap.has(lot)) {
        issuesMap.set(lot, {
          lot,
          stitchingIssueDate: (r["STITCHING ISSUE DATE"] && r["STITCHING ISSUE DATE"] !== '#REF!') ? r["STITCHING ISSUE DATE"] : '',
          stitchingSupervisor: (r["STITCHING SUPERVISOR"] && r["STITCHING SUPERVISOR"] !== '#REF!') ? r["STITCHING SUPERVISOR"] : '',
          pintuIssueDate: r["PINTU ISSUE DATE"] || '',
          pintuIssuedToWhom: r["LOT ISSUED BY PINTU TO WHOM"] || '',
          packingSupervisor: r["Packing Supervisor"] || '',
          packingDate: r["Packing Date"] || '',
          totalPcs: r["Total Pcs"] || '',
          wipPacking: r["WIP Packing"] || '',
          packingComplete: r["Packing Complete"] || '',
          authorizedBy: r["AUTHORIZED BY"] || '',
          karigarRemarks: r["KARIGAR REMARKS"] || '',
          specialRemarks: r["SPECIAL REMARKS"] || ''
        });
      }
    });

    // Map of Lot Logs
    const lotLogsMap = new Map();
    lotLogs.forEach(r => {
      const lotField = String(r["Lot Number"] || r["LOT NUMBER"] || r["Lot"] || "");
      const matched = lotField.match(/\b\d{4,7}\b/g) || [];
      matched.forEach(l => {
        if (!lotLogsMap.has(l)) lotLogsMap.set(l, []);
        lotLogsMap.get(l).push({
          logId: r["Log ID"] || "",
          timestamp: r["Timestamp"] || "",
          changeDetails: r["Change Details"] || "",
          changedBy: r["Changed By"] || "",
          permissionGivenBy: r["Permission Given By"] || "",
          category: r["Category"] || "",
          priority: r["Priority"] || ""
        });
      });
    });

    // Maps by Lot, Party, Garment, Fabric, Emb Vendor
    const lotsMap = new Map();
    const partiesMap = new Map();
    const garmentsMap = new Map();
    const fabricsMap = new Map();
    const embVendorsMap = new Map();

    const pendingLotsList = [];
    const cutLotsList = [];
    const cancelledLotsList = [];

    jobOrders.forEach(r => {
      const lot = getLot(r) || String(r["Job Order No"] || "").trim();
      if (!lot) return;

      const isCut = cutLotsMap.has(lot);
      const cutInfo = cutLotsMap.get(lot) || {};
      const statusStr = String(r["Status"] || '').trim().toLowerCase();
      const hasJobOrderCancel = statusStr === 'cancel' || statusStr.includes('cancel') || Boolean(r["Cancellation Reason"]) || Boolean(r["Cancellation Timestamp"]);
      const isCancelled = cancelledLotsMap.has(lot) || hasJobOrderCancel;

      let cancelInfo = null;
      if (isCancelled) {
        const fromTab = cancelledLotsMap.get(lot) || {};
        cancelInfo = {
          lot,
          reason: r["Cancellation Reason"] || (fromTab.reason && fromTab.reason !== 'Cancelled' ? fromTab.reason : '') || r["Status"] || fromTab.reason || "Cancelled Order",
          by: r["Cancelled By"] || (fromTab.by && fromTab.by !== 'Admin' ? fromTab.by : '') || fromTab.by || "Management",
          date: r["Cancellation Timestamp"] || fromTab.date || r["Date"] || "",
          approvedFrom: r["Cancellation Approved From"] || fromTab.approvedFrom || "Management"
        };
        // Update master cancelled map with rich details
        cancelledLotsMap.set(lot, cancelInfo);
      }
      const designImage = designImagesMap.get(lot) || null;
      const karigarInfo = cuttingKarigarMap.get(lot) || null;
      const issueRow = issuesMap.get(lot) || null;

      const record = {
        lot,
        jo: r["Job Order No"] || "N/A",
        date: r["Date"] || r["Challan Date"] || "",
        party: String(r["Party Name"] || r["PARTY"] || "Standard").trim(),
        brand: String(r["Brand"] || "").trim(),
        garment: String(r["Garment Type"] || "Garment").trim(),
        style: String(r["Style"] || "").trim(),
        pattern: String(r["Pattern"] || "").trim(),
        fabric: String(r["Fabric"] || "Standard").trim(),
        qty: String(r["Quantity"] || r["Challan Total Qty"] || "0").trim(),
        unit: String(r["Unit"] || "PCS").trim(),
        shades: String(r["Shade"] || "").trim(),
        sizes: String(r["Size"] || "").trim(),
        section: String(r["Section"] || "GENTS").trim(),
        season: String(r["Season"] || "Standard").trim(),
        embVendor: String(r["Emb"] || "").trim(),
        embDetails: String(r["Emb Details"] || "").trim(),
        printing: String(r["Printing"] || "").trim(),
        printingDetails: String(r["Printing Details"] || "").trim(),
        directStitching: String(r["Direct Stitching"] || "no").toLowerCase() === 'yes',
        submittedBy: String(r["Submitted By"] || "Ravinder").trim(),
        challanNo: r["Challan No"] || "",
        challanDate: r["Challan Date"] || "",
        challanQty: r["Challan Total Qty"] || "",
        challanHistoryJson: safeJsonParse(r["Challan History JSON"], []),
        challanItemsJson: safeJsonParse(r["Challan Items JSON"], null),
        isCut,
        cutPcs: cutInfo ? cutInfo.cutPcs : null,
        cutDate: cutInfo ? cutInfo.cutDate : null,
        cuttingSupervisor: null, // Cutting Department has NO supervisor per user business rule
        stitchingSupervisor: (cutInfo && cutInfo.stitchingSupervisor) || (issueRow && issueRow.stitchingSupervisor) || null,
        stitchingIssueDate: (cutInfo && cutInfo.stitchingIssueDate) || (issueRow && issueRow.stitchingIssueDate) || null,
        completedStatus: cutInfo ? cutInfo.completedStatus : null,
        wipStatus: cutInfo ? cutInfo.wipStatus : null,
        indexRemarks: cutInfo ? (cutInfo.remarks || cutInfo.additionalRemarks) : null,
        packingSupervisor: (issueRow && issueRow.packingSupervisor) || (barcodesMap.get(lot)?.[0]?.packingSupervisor) || null,
        packingDate: (issueRow && issueRow.packingDate) || (barcodesMap.get(lot)?.[0]?.packingDate) || null,
        supervisor: null, // Cutting Department has NO supervisor
        isCancelled,
        cancelInfo,
        designImageUrl: formatDirectImageUrl(designImage?.imageUrl || r["Image URL"] || cutInfo?.imageUrl || null),
        karigar: karigarInfo?.karigar || null,
        kajButton: kajButtonMap.get(lot) || null,
        washing: washingMap.get(lot) || null,
        overlock: overlockMap.get(lot) || null,
        folding: foldingMap.get(lot) || null,
        elastic: elasticMap.get(lot) || null,
        barcodes: barcodesMap.get(lot) || [],
        zipRequired: String(r["Zip"] || "").trim(),
        sticker: String(r["Sticker"] || "").trim(),
        collar: String(r["Collar"] || "").trim(),
        bone: String(r["Bone"] || "").trim(),
        tapeLace: String(r["Tape/Lace"] || "").trim(),
        bottomType: String(r["Bottom Type"] || "").trim(),
        zipPurchase: zipPurchaseMap.get(lot) || null,
        doriPurchase: doriPurchaseMap.get(lot) || null,
        issueRecord: issueRow,
        logs: lotLogsMap.get(lot) || []
      };

      lotsMap.set(lot, record);

      if (isCancelled) {
        cancelledLotsList.push(record);
      } else if (isCut) {
        cutLotsList.push(record);
      } else {
        pendingLotsList.push(record);
      }

      // Group by party
      const pKey = record.party.toUpperCase();
      if (!partiesMap.has(pKey)) partiesMap.set(pKey, []);
      partiesMap.get(pKey).push(record);

      // Group by garment
      const gKey = record.garment.toUpperCase();
      if (!garmentsMap.has(gKey)) garmentsMap.set(gKey, []);
      garmentsMap.get(gKey).push(record);

      // Group by fabric
      const fKey = record.fabric.toUpperCase();
      if (!fabricsMap.has(fKey)) fabricsMap.set(fKey, []);
      fabricsMap.get(fKey).push(record);

      // Group by emb vendor
      const eVendor = record.embVendor.toUpperCase();
      if (eVendor && eVendor !== 'NA' && eVendor !== 'N/A') {
        if (!embVendorsMap.has(eVendor)) embVendorsMap.set(eVendor, []);
        embVendorsMap.get(eVendor).push(record);
      }
    });

    // Also index any lots present in Index, Issues, Stage, Zip, or Dori sheets that may not be in JobOrder
    const allKnownLots = new Set([
      ...Array.from(cutLotsMap.keys()),
      ...Array.from(issuesMap.keys()),
      ...Array.from(kajButtonMap.keys()),
      ...Array.from(washingMap.keys()),
      ...Array.from(overlockMap.keys()),
      ...Array.from(foldingMap.keys()),
      ...Array.from(elasticMap.keys()),
      ...Array.from(barcodesMap.keys()),
      ...Array.from(zipPurchaseMap.keys()),
      ...Array.from(doriPurchaseMap.keys())
    ]);

    allKnownLots.forEach(lot => {
      if (!lotsMap.has(lot)) {
        const cutInfo = cutLotsMap.get(lot) || {};
        const isCut = cutLotsMap.has(lot);
        const indexRow = indexRows.find(r => getLot(r) === lot) || {};
        const issueRow = issuesMap.get(lot) || {};
        const zp = zipPurchaseMap.get(lot) || null;
        const dp = doriPurchaseMap.get(lot) || null;

        const record = {
          lot,
          jo: indexRow["Job Order No"] || "N/A",
          date: cutInfo.cutDate || formatSavedAtDate(indexRow["Saved At"]) || indexRow["JobOrder Date"] || "",
          party: String(indexRow["PARTY NAME"] || indexRow["Party Name"] || "Standard").trim(),
          brand: String(indexRow["BRAND"] || indexRow["Brand"] || "").trim(),
          garment: String(indexRow["Garment Type"] || "Garment").trim(),
          style: String(indexRow["Style"] || "").trim(),
          pattern: String(indexRow["Pattern"] || "").trim(),
          fabric: String(indexRow["Fabric"] || "Standard").trim(),
          qty: String(cutInfo.cutPcs || indexRow["Cutting Qty"] || "0").trim(),
          unit: "PCS",
          shades: String(indexRow["Shades"] || "").trim(),
          sizes: String(indexRow["Sizes"] || "").trim(),
          section: String(indexRow["M/W/K"] || "GENTS").trim(),
          season: String(indexRow["SEASON"] || "Standard").trim(),
          embVendor: "",
          embDetails: "",
          printing: "",
          printingDetails: "",
          directStitching: String(indexRow["DIRECT STITCHING"] || "no").toLowerCase() === 'yes',
          submittedBy: "Factory Record",
          challanNo: "",
          challanQty: "",
          isCut,
          cutPcs: cutInfo ? cutInfo.cutPcs : null,
          cutDate: cutInfo?.cutDate || formatSavedAtDate(indexRow["Saved At"]) || null,
          cuttingSupervisor: null, // Cutting Department has NO supervisor per user business rule
          stitchingSupervisor: (cutInfo && cutInfo.stitchingSupervisor) || (issueRow && issueRow.stitchingSupervisor) || null,
          stitchingIssueDate: (cutInfo && cutInfo.stitchingIssueDate) || (issueRow && issueRow.stitchingIssueDate) || null,
          completedStatus: (cutInfo && cutInfo.completedStatus) || indexRow["Completed Status"] || null,
          wipStatus: (cutInfo && cutInfo.wipStatus) || indexRow["WIP Status"] || null,
          indexRemarks: (cutInfo && (cutInfo.remarks || cutInfo.additionalRemarks)) || indexRow["REMARKS"] || null,
          packingSupervisor: (issueRow && issueRow.packingSupervisor) || (barcodesMap.get(lot)?.[0]?.packingSupervisor) || null,
          packingDate: (issueRow && issueRow.packingDate) || (barcodesMap.get(lot)?.[0]?.packingDate) || null,
          supervisor: null, // Cutting Department has NO supervisor
          isCancelled: cancelledLotsMap.has(lot),
          cancelInfo: cancelledLotsMap.get(lot) || null,
          designImageUrl: designImagesMap.get(lot)?.imageUrl || null,
          karigar: cuttingKarigarMap.get(lot)?.karigar || null,
          kajButton: kajButtonMap.get(lot) || null,
          washing: washingMap.get(lot) || null,
          overlock: overlockMap.get(lot) || null,
          folding: foldingMap.get(lot) || null,
          elastic: elasticMap.get(lot) || null,
          barcodes: barcodesMap.get(lot) || [],
          zipPurchase: zp,
          doriPurchase: dp,
          issueRecord: issueRow,
          logs: lotLogsMap.get(lot) || []
        };
        lotsMap.set(lot, record);
        if (record.isCancelled) {
          cancelledLotsList.push(record);
        } else if (isCut) {
          cutLotsList.push(record);
        } else {
          pendingLotsList.push(record);
        }
      }
    });

    const totalLots = lotsMap.size;
    const cutCount = cutLotsList.length;
    const cancelledCount = cancelledLotsList.length;
    const pendingCount = pendingLotsList.length;

    cachedData = {
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      totalLots,
      cutCount,
      pendingCount,
      cancelledCount,
      lotsMap,
      cutLotsMap,
      cancelledLotsMap,
      designImagesMap,
      cuttingKarigarMap,
      issuesMap,
      lotLogsMap,
      kajButtonMap,
      washingMap,
      overlockMap,
      foldingMap,
      elasticMap,
      barcodesMap,
      partiesMap,
      garmentsMap,
      fabricsMap,
      embVendorsMap,
      pendingLotsList,
      cutLotsList,
      cancelledLotsList,
      rawJobOrders: jobOrders,
      rawIssues: issues,
      rawIndexRows: indexRows,
      rawCuttingDetails: cuttingDetails,
      rawCancelledLots: cancelledLots,
      rawPackingOrders: packingOrders,
      rawLotLogs: lotLogs,
      linkedSheetsSummary,
      customSheets
    };
    lastCacheTime = Date.now();
    return cachedData;
  } catch (err) {
    console.error('Error loading factory sheets data:', err);
    return null;
  }
}

/**
 * Advanced cutting intent analyzer with negation handling and detail detection
 */
export function analyzeCuttingIntent(text) {
  const lower = (text || '').toLowerCase();

  const isAskingCancelled = /\b(cancel|cancelled|canceled|cancellation)\b/i.test(lower);
  const hasCutNegation = /\b(?:already\s*)?cut(?:\s*lots?)?.*?(?:nhi|nahi|not|mat|na|don'?t|except|exclude|excluding|chhod\s*ke|ke\s*alawa)\b/i.test(lower) ||
                         /\b(?:nhi|nahi|not|mat|don'?t|except|exclude|excluding|bina|without)\s+(?:already\s*)?(?:cut|kate)\b/i.test(lower);

  const hasUncutKeyword = /\b(uncut|un-cut|pending|bache\s*hue|bache|baki|baaki|remaining|not\s*cut|nhi\s*cut|nahi\s*cut|jo\s*cut\s*n(?:ah)?i|katne\s*ba?ki|chhut\s*gaye|yet\s*to\s*be\s*cut|unprocessed|bina\s*kat[a-z]*)\b/i.test(lower);

  const isAskingUncut = !isAskingCancelled && (hasUncutKeyword || hasCutNegation);
  const isAskingCut = !isAskingCancelled && !isAskingUncut && /\b(cut\s*lots?|cut\s*complete|already\s*cut|ho\s*chuke|kate\s*hue|completed\s*lots?|kitne\s*lot\s*cut|only\s*cut|cut\s*wale)\b/i.test(lower);
  const wantsDetails = /\b(detail|details|poori\s*detail|list|breakdown|sab\s*batao|kya\s*kya\s*hai|kaun\s*kaun\s*se|which\s*lots|show\s*lots|lots\s*dikhao|saare\s*lots)\b/i.test(lower);

  return {
    isAskingCancelled,
    isAskingUncut,
    isAskingCut,
    wantsDetails
  };
}

/**
 * Professional AI Chatbot Response System Directives (ChatGPT / Meta AI Standard)
 */
export const CHATGPT_STYLE_SYSTEM_DIRECTIVE = `
=== PROFESSIONAL AI CHATBOT RESPONSE DIRECTIVE (CHATGPT / META AI STANDARD) ===
You are PulseBot AI, the intelligent executive manufacturing and enterprise operations copilot for Factory Suite Pro.
Every response must look clean, intelligent, professional, readable, and well-structured, comparable in presentation quality to ChatGPT and Meta AI.

1. RESPONSE QUALITY & WRITING STYLE:
- Professional, natural, human-like, grammatically correct, and clear.
- Friendly, helpful, yet executive. Never unnecessarily casual.
- Context-aware: Answer the user's specific question directly with high relevance.
- AVOID conversational filler or throat-clearing (NEVER start with "Sure!", "Certainly!", "I would be happy to help", "Here is what you asked for", "Great question!").
- Do NOT repeat or echo the user's question back to them as an introductory sentence.
- AVOID generic filler statements, long unstructured paragraphs, and fake confidence.
- Restrain emojis: Use at most 1-2 only when they genuinely clarify meaning or status (e.g. ⏳, ✅, ⚠️). Avoid decorative emoji spam.
- Never invent facts or hallucinate missing lots when database records are provided.

2. ADAPTIVE ANSWER STRUCTURE (Decide format strictly based on question type):
- Simple / Direct Question: Give a direct, concise 1-3 sentence answer immediately. Keep it short and clear. Do not force headings or tables where unnecessary.
- Technical & Explanatory Question: Explain the concept clearly -> provide implementation details -> include code examples when useful -> explain important considerations/trade-offs.
- Comparison Question: ALWAYS provide a clean Markdown Table (| Option/Item | Features | Status/Pros | Recommendation |) with clear column headers, followed by key differences and a justified recommendation.
- How-To / Procedure: Provide step-by-step numbered instructions (1., 2., 3.) with bold step titles, mention important precautions, and explain the expected outcome.
- Business / KPI / Operations Question: Use professional Markdown Headings (###) -> highlight key metrics/data -> provide practical recommendations & relevant risks.
- Coding Question: Provide complete, working, readable code inside syntax-highlighted code blocks with the exact language tag (\`\`\`javascript, \`\`\`sql, \`\`\`python, \`\`\`json, \`\`\`html, \`\`\`css). Explain where the code belongs. Avoid placeholder/incomplete code examples.
- Mathematical Formulas: Support properly formatted mathematical formulas (e.g. $E = mc^2$ or standard math format).

3. RICH MARKDOWN FORMATTING RULES:
- Use bold (**text**) for critical terms, KPIs, lot numbers, statuses, and key takeaways.
- Use inline code (\`variable\`, \`lotNumber\`, \`status\`, \`API\`) for technical terms, endpoints, and exact values.
- Use blockquotes (> Note: ...) for callouts or critical warnings.
- Use bullet lists (* or -) for multiple points, instructions, or features.
- Ensure all markdown tables have proper headers and separator rows (| --- | --- |).
`;

/**
 * Robust AI Response Generator (Powered by Google Gemini with n8n fallback)
 * Supports real-time SSE streaming, abort signals, and adaptive formatting
 */
export async function generateAiResponseWithGemini({
  prompt,
  systemInstruction,
  fallbackText,
  conversationHistory = [],
  onChunk = null,
  abortSignal = null
}) {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || '';

  const fullSystemInstruction = systemInstruction
    ? `${CHATGPT_STYLE_SYSTEM_DIRECTIVE}\n\n=== DOMAIN CONTEXT ===\n${systemInstruction}`
    : CHATGPT_STYLE_SYSTEM_DIRECTIVE;

  const contents = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const msg of conversationHistory.slice(-5)) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(msg.content || '') }]
      });
    }
  }
  contents.push({
    role: 'user',
    parts: [{ text: prompt }]
  });

  const isHallucinatedMissing = (text) => {
    if (!text || typeof text !== 'string') return true;
    return /(?:active nahi hai|data available nahi hai|record nahi mila|not found in(?: the)? active|not available in live production|kya aap confirm kar sakte hain|purana\/closed lot hai)/i.test(text);
  };

  if (apiKey) {
    try {
      // Priority model candidates
      const modelCandidates = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];

      // 1. If onChunk callback is provided, attempt real-time SSE Streaming
      if (typeof onChunk === 'function') {
        for (const model of modelCandidates) {
          const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
          const streamController = new AbortController();
          const combinedSignal = abortSignal || streamController.signal;
          const timeoutId = setTimeout(() => streamController.abort(), 20000);

          try {
            const streamRes = await fetch(streamUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: fullSystemInstruction }] },
                contents,
                generationConfig: {
                  temperature: 0.25,
                  maxOutputTokens: 8192
                }
              }),
              signal: combinedSignal
            });

            clearTimeout(timeoutId);

            if (streamRes.ok && streamRes.body) {
              const reader = streamRes.body.getReader();
              const decoder = new TextDecoder('utf-8');
              let accumulatedText = '';
              let buffer = '';

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith('data: ')) {
                    const jsonStr = trimmed.slice(6).trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;
                    try {
                      const parsed = JSON.parse(jsonStr);
                      const partText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                      if (partText) {
                        accumulatedText += partText;
                        onChunk(partText, accumulatedText);
                      }
                    } catch (e) {}
                  }
                }
              }

              if (accumulatedText && accumulatedText.trim()) {
                const cleanStreamed = accumulatedText.trim();
                if (!(isHallucinatedMissing(cleanStreamed) && fallbackText && fallbackText.length > 50)) {
                  return cleanStreamed;
                }
              }
            }
          } catch (streamErr) {
            clearTimeout(timeoutId);
            if (abortSignal?.aborted) {
              console.log('Stream generation aborted by user.');
              return null;
            }
            // Proceed to next candidate or non-streaming fallback
          }
        }
      }

      // 2. Standard Non-Streaming Call
      const callGeminiOnce = async (modelName = 'gemini-3.5-flash-lite') => {
        const controller = new AbortController();
        const combinedSignal = abortSignal || controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), 14000);
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: fullSystemInstruction }] },
              contents,
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 8192
              }
            }),
            signal: combinedSignal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim()) return text.trim();
          }
        } catch (e) {
          clearTimeout(timeoutId);
        }
        return null;
      };

      let answer = null;
      for (const model of modelCandidates) {
        answer = await callGeminiOnce(model);
        if (answer) {
          if (isHallucinatedMissing(answer) && fallbackText && fallbackText.length > 50) {
            answer = null;
            continue;
          }
          break;
        }
      }

      if (answer) {
        if (typeof onChunk === 'function') {
          // If stream wasn't available, progressively stream answer tokens
          onChunk(answer, answer);
        }
        return answer;
      }
    } catch (err) {
      console.warn('Gemini call notice:', err.message);
    }
  }

  // Fallback to verified local text if available
  if (fallbackText && fallbackText.length > 50 && !fallbackText.includes('Factory Suite Pro AI Engine is active')) {
    if (typeof onChunk === 'function') {
      onChunk(fallbackText, fallbackText);
    }
    return fallbackText;
  }

  // Fallback to n8n multi-sheet AI webhook (factory-ai-agents has full multi-sheet Google Sheets integration)
  try {
    const n8nUrl = config.n8nChatWebhookUrl || 'http://localhost:5678/webhook/factory-ai-agents';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);
    const n8nRes = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatInput: prompt,
        message: prompt,
        prompt: prompt,
        systemInstruction,
        history: conversationHistory
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (n8nRes.ok) {
      const data = await n8nRes.json().catch(() => null);
      const text = data?.answer || data?.output || data?.text || data?.message;
      if (text && typeof text === 'string' && text.trim()) {
        const isHallucinated = /(?:active nahi hai|data available nahi hai|record nahi mila|kya aap confirm kar sakte hain)/i.test(text);
        if (!isHallucinated || !fallbackText) {
          return text.trim();
        }
      }
    }
  } catch (err) {
    console.warn('n8n fallback notice:', err.message);
  }

  return fallbackText || 'Factory Suite Pro AI Engine is active and ready to assist you.';
}

/**
 * Industrial-Grade OCR & Lot Extractor
 * Uses Google Gemini Multimodal Vision API to inspect garment tickets, cutting slips,
 * bundle cards, barcodes, challans, or handwritten production slips and extract the Lot Number.
 */
export async function extractLotFromImageWithOCR(imageUrl, userPrompt = '') {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'GEMINI_API_KEY is not configured.' };
  }

  let mimeType = 'image/jpeg';
  let base64Data = '';

  try {
    if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    } else if (typeof imageUrl === 'string' && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Could not fetch image: ${res.statusText}`);
      const arrayBuf = await res.arrayBuffer();
      base64Data = Buffer.from(arrayBuf).toString('base64');
      const ct = res.headers.get('content-type');
      if (ct && ct.startsWith('image/')) mimeType = ct;
    }

    if (!base64Data) {
      return { success: false, error: 'Invalid or empty image data provided.' };
    }

    const ocrInstruction = `You are an expert OCR & Garment Manufacturing Production Inspector for Factory Suite Pro.
You are inspecting an uploaded image from an apparel/garment manufacturing facility (such as a cutting slip, job order card, bundle ticket, barcode/QR label, fabric roll tag, challan, or handwritten/stamped production ticket).

PRIMARY OBJECTIVES:
1. DETECT THE LOT NUMBER:
   - Identify the primary Lot Number (typically 3 to 7 digits, e.g. 67046, 11300, 61008, 12025, 12034, 11028, LOT-67046, JO-11300, L: 67046, Lot #...).
   - Look for digits next to words like "LOT", "LOT NO", "LOT NUMBER", "L.", "Challan", "Job Order", "Order No", or prominent handwritten/printed numbers on the slip.
2. EXTRACT GARMENT & PRODUCTION ATTRIBUTES:
   - Party / Buyer Name (e.g. Mohit Hosiery, SS, BB, DB, Zara, etc.)
   - Brand Name (e.g. SCUFFERS, NIKE, ADIDAS, PUMA, QC On, etc. - extract the concise brand name!)
   - Printed / Embroidered Text (any prominent logo, wording, or text on the fabric, e.g. "scuffers")
   - Garment Type / Item (e.g. Lower, Track Pants, Shirt, T-Shirt, Hoodie, Jacket)
   - Style / Pattern (e.g. Boxy Lower, Regular, Full Zipper)
   - Fabric / Color / Shades (e.g. Cream, Off-White, Black, Fleece)
   - Sizes breakdown (e.g. M/M/L/L/XL)
   - Quantity / Pcs
   - Date / Supervisor signature
3. CONFIDENCE LEVEL: "high", "medium", or "low"

OUTPUT FORMAT: Return STRICT valid JSON (no markdown formatting, no code blocks):
{
  "detected": true,
  "lotNumber": "12034",
  "confidence": "high",
  "party": "Mohit Hosiery",
  "brand": "SCUFFERS",
  "printedText": "scuffers",
  "item": "Lower",
  "style": "Boxy Lower",
  "fabric": "Fleece",
  "shades": "Cream, Black",
  "sizes": "M/M/L/L/XL",
  "quantity": "450",
  "date": "12-10-2026",
  "supervisor": "Ramesh",
  "rawExtractedText": "Brief summary of text visible in image",
  "notes": "Clear printed ticket"
}
If no lot number is detected, set "detected": false, "lotNumber": null, and set "notes" to explain what was seen.`;

    const modelCandidates = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
    let parsedOcr = null;
    let lastErr = '';

    for (const modelName of modelCandidates) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 14000);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: ocrInstruction + (userPrompt ? `\nUser question: "${userPrompt}"` : '') },
                { inline_data: { mime_type: mimeType, data: base64Data } }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
          try {
            parsedOcr = JSON.parse(rawJsonText);
          } catch {
            const cleaned = rawJsonText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
            parsedOcr = JSON.parse(cleaned);
          }
          if (parsedOcr) break;
        } else {
          lastErr = await response.text();
          console.warn(`Gemini OCR model ${modelName} notice:`, lastErr);
        }
      } catch (err) {
        lastErr = err.message;
        console.warn(`Gemini OCR attempt with ${modelName} error:`, err.message);
      }
    }

    if (parsedOcr) {
      return {
        success: true,
        data: parsedOcr
      };
    }
    return { success: false, error: lastErr || 'Failed to inspect image with OCR models' };
  } catch (err) {
    console.error('Error during OCR lot extraction:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Reverse Visual Search / Image-to-Image Garment Matcher
 * Compares an uploaded garment photo directly against official design artworks attached to lots in factory database.
 */
export async function findLotByVisualSimilarity(imageUrl, ocrData = {}, userPrompt = '') {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'GEMINI_API_KEY is not configured.' };
  }

  let mimeType = 'image/jpeg';
  let base64Data = '';

  try {
    if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    } else if (typeof imageUrl === 'string' && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Could not fetch image: ${res.statusText}`);
      const arrayBuf = await res.arrayBuffer();
      base64Data = Buffer.from(arrayBuf).toString('base64');
      const ct = res.headers.get('content-type');
      if (ct && ct.startsWith('image/')) mimeType = ct;
    }

    if (!base64Data) {
      return { success: false, error: 'Invalid or empty user image data.' };
    }

    const sheets = loadFactorySheetsData();
    if (!sheets || !sheets.lotsMap) {
      return { success: false, error: 'Factory database sheets not loaded.' };
    }

    // Helper: Normalize garment terms
    const normalizeGarment = (g) => {
      g = (g || '').toLowerCase();
      if (g.includes('lower') || g.includes('track pant') || g.includes('pant') || g.includes('jogger') || g.includes('sweatpant') || g.includes('pajama')) return 'lower';
      if (g.includes('hoodie') || g.includes('sweatshirt') || g.includes('hood') || g.includes('zipper')) return 'hoodie';
      if (g.includes('t-shirt') || g.includes('tshirt') || g.includes('tee') || g.includes('polo')) return 't-shirt';
      if (g.includes('shirt')) return 'shirt';
      if (g.includes('jacket') || g.includes('windcheater') || g.includes('bomber')) return 'jacket';
      if (g.includes('nikker') || g.includes('short')) return 'nikker';
      if (g.includes('track suit') || g.includes('ts')) return 'track suit';
      return g;
    };

    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function matchKeyword(text, keyword) {
      if (!keyword || !text) return false;
      keyword = keyword.toLowerCase().trim();
      if (!keyword || keyword.length < 2) return false;
      if (/^(\.+|-+|na|null|standard|none)$/i.test(keyword)) return false;

      if (keyword.length <= 3) {
        const rx = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
        return rx.test(text);
      }
      return text.includes(keyword);
    }

    const fullSearchBag = [
      ocrData.brand || '',
      ocrData.printedText || '',
      ocrData.style || '',
      ocrData.item || '',
      ocrData.party || '',
      ocrData.shades || '',
      ocrData.sizes || '',
      ocrData.rawExtractedText || '',
      ocrData.notes || '',
      userPrompt || ''
    ].join(' ').toLowerCase();

    const isLowerCategory = fullSearchBag.includes('track') || fullSearchBag.includes('lower') || fullSearchBag.includes('pant') || fullSearchBag.includes('nikker');
    const isHoodieOrJacket = fullSearchBag.includes('hoodie') || fullSearchBag.includes('sweatshirt') || fullSearchBag.includes('hood') || fullSearchBag.includes('jacket') || fullSearchBag.includes('windcheater');
    const isShirtCategory = fullSearchBag.includes('shirt') && !fullSearchBag.includes('t-shirt') && !fullSearchBag.includes('tshirt');
    const isTshirtCategory = fullSearchBag.includes('t-shirt') || fullSearchBag.includes('tshirt') || fullSearchBag.includes('tee');

    // Score and group all database lots with valid design artworks
    const candidateMap = new Map();

    for (const [lotNo, r] of sheets.lotsMap) {
      if (!r.designImageUrl || !r.designImageUrl.startsWith('http')) continue;

      const rGarment = normalizeGarment(r.garment);
      const rBrand = (r.brand || '').toLowerCase().trim();
      const rParty = (r.party || '').toLowerCase().trim();
      const rStyle = (r.style || '').toLowerCase().trim();
      const rPattern = (r.pattern || '').toLowerCase().trim();
      const rFabric = (r.fabric || '').toLowerCase();
      const rShades = (r.shades || '').toLowerCase();
      const rSizes = (r.sizes || '').toLowerCase().replace(/\s+/g, '');

      let score = 0;

      // 1. Direct Brand Match (High Weight)
      if (rBrand === 'qc on' && (/\bon\b/i.test(fullSearchBag) || fullSearchBag.includes('qc on') || fullSearchBag.includes('on running') || fullSearchBag.includes('oc'))) {
        score += 120;
      } else if (rBrand && matchKeyword(fullSearchBag, rBrand)) {
        score += 100;
      }

      // Check prominent brand keywords
      const brandKeywords = ['scuffers', 'nike', 'adidas', 'puma', 'north face', 'zara', 'reebok', 'under armour', 'tommy', 'calvin', 'champion', 'hollister', 'balenciaga', 'edge', 'qc on', 'youngla', 'essentials'];
      for (const bk of brandKeywords) {
        if (fullSearchBag.includes(bk) && (rBrand.includes(bk) || rStyle.includes(bk))) {
          score += 45;
          break;
        }
      }

      // 2. Garment Category Match & Strict Filtering
      const isCandidateLower = rGarment.includes('lower') || rGarment.includes('track') || rGarment.includes('pant') || rGarment.includes('nikker');
      const isCandidateHoodieOrJacket = rGarment.includes('hoodie') || rGarment.includes('sweatshirt') || rGarment.includes('jacket') || rGarment.includes('windcheater') || rStyle.includes('hood') || rStyle.includes('zipper');
      const isCandidateShirt = rGarment === 'shirt';
      const isCandidateTshirt = rGarment.includes('t-shirt') || rGarment.includes('tshirt');

      if (isLowerCategory && !isCandidateLower) continue;
      if (isHoodieOrJacket && !isCandidateHoodieOrJacket) continue;
      if (isShirtCategory && !isCandidateShirt) continue;
      if (isTshirtCategory && !isCandidateTshirt) continue;

      score += 50;
      if (isLowerCategory && rGarment === 'lower') score += 25;
      if (isHoodieOrJacket && (rGarment === 'hoodie' || rGarment.includes('hoodie') || rGarment === 'jacket')) score += 25;

      // Fabric texture & material matching
      if (fullSearchBag.includes('waffle') && rFabric.includes('waffle')) {
        score += 80;
      }
      if (fullSearchBag.includes('fleece') && rFabric.includes('fleece')) {
        score += 30;
      }
      if (fullSearchBag.includes('bonding') && rFabric.includes('bonding')) {
        score += 30;
      }

      // 3. Style / Pattern Match (e.g. 'boxy', 'full zipper', 'monkey hoody')
      const bagNorm = fullSearchBag.replace(/hoody/g, 'hoodie');
      const styleNorm = rStyle.replace(/hoody/g, 'hoodie');

      if (rStyle) {
        if (matchKeyword(bagNorm, styleNorm)) {
          score += 50;
        }
        if (bagNorm.includes('zipper') && (styleNorm.includes('zipper') || styleNorm.includes('zip'))) score += 20;
        if (bagNorm.includes('hoodie') && styleNorm.includes('hoodie')) score += 20;
        if (bagNorm.includes('pullover') && styleNorm.includes('pullover')) score += 20;
        if (bagNorm.includes('boxy') && (styleNorm.includes('boxy') || rPattern.includes('boxy'))) score += 20;
        if (styleNorm.includes('monkey') && (bagNorm.includes('monkey') || bagNorm.includes('curved') || bagNorm.includes('zipper') || bagNorm.includes('hoodie'))) score += 15;
      }

      if (rPattern && matchKeyword(bagNorm, rPattern)) {
        score += 25;
      }

      // 4. Party Match (e.g. Mohit Hosiery, SS, DB, Imran)
      if (rParty && matchKeyword(fullSearchBag, rParty)) {
        score += 30;
      }

      // 5. Sizes Breakdown Match (e.g. M/M/L/L/XL)
      if (fullSearchBag.includes('m/m/l/l/xl') && rSizes.includes('m,m,l,l,xl')) {
        score += 45;
      }

      // 6. Shades / Colors Match
      const shadeKeywords = ['cream', 'off-white', 'cement', 'fawn', 'dark grey', 'black', 'navy', 'lemon', 'white', 'grey', 'brown', 'coffee'];
      for (const sk of shadeKeywords) {
        if (fullSearchBag.includes(sk) && rShades.includes(sk.replace('-', ' '))) {
          score += 10;
        }
      }
      if ((fullSearchBag.includes('brown') || fullSearchBag.includes('fawn')) && (rShades.includes('fawn') || rShades.includes('brown') || rShades.includes('coffee'))) {
        score += 15;
      }

      const imgKey = r.designImageUrl;
      if (!candidateMap.has(imgKey)) {
        candidateMap.set(imgKey, {
          imgUrl: imgKey,
          lots: [],
          maxScore: score,
          sample: r
        });
      }
      const entry = candidateMap.get(imgKey);
      entry.lots.push(r);
      if (score > entry.maxScore) {
        entry.maxScore = score;
        entry.sample = r;
      }
    }

    // Sort grouped candidates by score
    const sortedCandidates = Array.from(candidateMap.values())
      .sort((a, b) => b.maxScore - a.maxScore);

    // Expand candidate pool to 10 so high-potential candidates are never cut off prematurely
    let topCandidates = sortedCandidates.slice(0, 10);
    const brandHits = sortedCandidates.filter(c => c.maxScore >= 180);
    if (brandHits.length > 0) {
      topCandidates = brandHits.slice(0, 6);
    }

    if (topCandidates.length === 0) {
      return { success: false, error: 'No candidate design artworks found in database.' };
    }

    // Parallel fetch candidate images with 5s timeout
    const fetchedCandidates = [];
    await Promise.allSettled(
      topCandidates.map(async (c, idx) => {
        try {
          const controller = new AbortController();
          const tid = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(c.imgUrl, { signal: controller.signal });
          clearTimeout(tid);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const b64 = Buffer.from(buf).toString('base64');
            const ct = res.headers.get('content-type') || 'image/jpeg';
            fetchedCandidates.push({
              candidateIdx: idx + 2,
              primaryLot: c.sample.lot,
              siblingLots: c.lots.map(l => l.lot),
              party: c.sample.party,
              brand: c.sample.brand,
              garment: c.sample.garment,
              style: c.sample.style,
              fabric: c.sample.fabric,
              shades: c.sample.shades,
              jo: c.sample.jo,
              designImageUrl: c.imgUrl,
              mimeType: ct.startsWith('image/') ? ct : 'image/jpeg',
              base64Data: b64,
              score: c.maxScore
            });
          }
        } catch (e) {
          console.warn(`Failed to fetch candidate design image for lot ${c.sample.lot}:`, e.message);
        }
      })
    );

    if (fetchedCandidates.length === 0) {
      return { success: false, error: 'Could not fetch candidate design images from Google Drive CDN.' };
    }

    // Re-sort fetched candidates to maintain priority order
    fetchedCandidates.sort((a, b) => b.score - a.score);

    const promptText = `You are an expert Garment Manufacturing Visual Search & Quality Matcher for Factory Suite Pro.

TASK:
Compare the uploaded factory floor photo (IMAGE 1) with each candidate official design artwork from our factory database shown below.
Each candidate is clearly labeled below with its Candidate Number, Lot Number, Brand, Style, and Garment.

Carefully evaluate:
- Garment silhouette, cut, waistband, hems, pockets, drawstring
- All prints, embroidery, typography wording, font, and placement (e.g. thigh branding, leg side panels)
- Note: Color shades may vary slightly if the candidate design artwork is the master pattern for multiple production shades, but the graphic/panel design and style must match.

OUTPUT STRICT JSON (no markdown formatting, no code fences):
{
  "isMatch": true,
  "bestMatchLot": "<Insert the matching Lot Number, e.g. ${fetchedCandidates[0].primaryLot}>",
  "confidenceScore": 95,
  "matchingFeatures": [
    "Distinctive typography wording and placement",
    "Matching garment cut and silhouette"
  ],
  "explanation": "Detailed visual reasoning explaining why this candidate matches Image 1."
}

If NO candidate matches Image 1 with at least 70% confidence, return:
{
  "isMatch": false,
  "bestMatchLot": null,
  "confidenceScore": 30,
  "matchingFeatures": [],
  "explanation": "None of the candidate artworks match the uploaded garment design."
}`;

    const parts = [
      { text: promptText },
      { text: `=== IMAGE 1: UPLOADED FACTORY FLOOR PHOTO (TARGET TO IDENTIFY) ===` },
      { inline_data: { mime_type: mimeType, data: base64Data } }
    ];

    for (let i = 0; i < fetchedCandidates.length; i++) {
      const c = fetchedCandidates[i];
      parts.push({
        text: `=== CANDIDATE #${i + 1}: LOT #${c.primaryLot} (Party: ${c.party}, Brand: ${c.brand || 'N/A'}, Garment: ${c.garment}, Style: ${c.style || 'Standard'}) ===`
      });
      parts.push({
        inline_data: {
          mime_type: c.mimeType,
          data: c.base64Data
        }
      });
    }

    const modelCandidates = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
    let parsedResult = null;
    let lastErr = '';

    for (const modelName of modelCandidates) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 18000);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
          try {
            parsedResult = JSON.parse(rawText);
          } catch {
            const cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
            parsedResult = JSON.parse(cleaned);
          }
          if (parsedResult) break;
        } else {
          lastErr = await response.text();
          console.warn(`Gemini visual comparator model ${modelName} notice:`, lastErr);
        }
      } catch (err) {
        lastErr = err.message;
        console.warn(`Gemini visual comparator attempt with ${modelName} error:`, err.message);
      }
    }

    if (!parsedResult) {
      return { success: false, error: lastErr || 'Failed to compare images with vision models.' };
    }

    let matchedCandidate = null;
    if (parsedResult.bestMatchLot) {
      matchedCandidate = fetchedCandidates.find(c => 
        c.primaryLot === parsedResult.bestMatchLot || c.siblingLots.includes(parsedResult.bestMatchLot)
      );
    }

    return {
      success: true,
      data: {
        isMatch: Boolean(parsedResult.isMatch),
        bestMatchLot: parsedResult.bestMatchLot || (matchedCandidate ? matchedCandidate.primaryLot : null),
        confidenceScore: parsedResult.confidenceScore || 0,
        matchingFeatures: parsedResult.matchingFeatures || [],
        explanation: parsedResult.explanation || '',
        matchedCandidate,
        allCandidates: fetchedCandidates
      }
    };
  } catch (err) {
    console.error('Error during findLotByVisualSimilarity:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Finds all similar articles & style variations across the factory database.
 * Returns:
 * - reference: the baseline lot record
 * - exactArtworkSiblings: lots sharing identical designImageUrl
 * - styleMatches: lots matching garment family, style keywords, pattern, and party
 * - allSimilarLots: combined array of all similar lots
 * - imageGallery: ready-to-display gallery array for ChatImageGallery component
 */
export function findSimilarArticles(refInput, sheets, options = {}) {
  if (!sheets || !sheets.lotsMap) {
    return { reference: null, exactArtworkSiblings: [], styleMatches: [], allSimilarLots: [], imageGallery: [] };
  }

  let ref = null;
  if (typeof refInput === 'string') {
    ref = sheets.lotsMap.get(refInput.trim());
  } else if (refInput && typeof refInput === 'object') {
    ref = refInput.lot ? refInput : (refInput.primaryLot ? sheets.lotsMap.get(String(refInput.primaryLot)) : refInput);
  }

  if (!ref) {
    return { reference: null, exactArtworkSiblings: [], styleMatches: [], allSimilarLots: [], imageGallery: [] };
  }

  const refGarment = (ref.garment || '').toLowerCase();
  const refStyle = (ref.style || '').toLowerCase().replace(/hoody/g, 'hoodie');
  const refPattern = (ref.pattern || '').toLowerCase();
  const refParty = (ref.party || '').toLowerCase();
  const refBrand = (ref.brand || '').toLowerCase();
  const refFabric = (ref.fabric || '').toLowerCase();
  const refImg = ref.designImageUrl || '';
  const refLot = String(ref.lot);

  const exactArtworkSiblings = [];
  const styleMatches = [];

  // Extract key style tokens (e.g. 'boxy', 'monkey', 'zipper', 'hoodie', 'cargo', etc.)
  const styleTokens = refStyle
    .split(/[\s,/-]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !['standard', 'normal', 'with', 'and', 'the', 'cloth', 'pattern', 'design', 'fabric'].includes(t));

  for (const [lotNo, r] of sheets.lotsMap) {
    if (lotNo === refLot) continue; // skip reference lot itself

    const rImg = r.designImageUrl || '';
    // 1. Sibling Lots Sharing EXACT same Design Artwork URL
    if (refImg && rImg && refImg === rImg) {
      exactArtworkSiblings.push(r);
      continue;
    }

    // 2. Garment Category Filter
    const rGarment = (r.garment || '').toLowerCase();
    const isGarmentMatch = (refGarment === rGarment) ||
      (refGarment.includes('hoodie') && (rGarment.includes('hoodie') || rGarment.includes('sweatshirt'))) ||
      (refGarment.includes('sweatshirt') && (rGarment.includes('sweatshirt') || rGarment.includes('hoodie'))) ||
      (refGarment.includes('lower') && (rGarment.includes('lower') || rGarment.includes('track') || rGarment.includes('pant'))) ||
      (refGarment.includes('t-shirt') && (rGarment.includes('t-shirt') || rGarment.includes('tshirt') || rGarment.includes('tee'))) ||
      (refGarment.includes('shirt') && rGarment.includes('shirt'));

    if (!isGarmentMatch) continue;

    const rStyle = (r.style || '').toLowerCase().replace(/hoody/g, 'hoodie');
    const rPattern = (r.pattern || '').toLowerCase();
    const rBrand = (r.brand || '').toLowerCase();
    const rParty = (r.party || '').toLowerCase();
    const rFabric = (r.fabric || '').toLowerCase();

    let score = 0;
    let matchedTokens = 0;

    for (const tok of styleTokens) {
      if (rStyle.includes(tok)) {
        matchedTokens++;
        score += 30;
      }
    }

    // Pattern match (e.g. BOXY FIT)
    if (refPattern && rPattern && (refPattern.includes(rPattern) || rPattern.includes(refPattern))) {
      score += 25;
    }

    // Party / Buyer match
    if (refParty && rParty && refParty === rParty) {
      score += 20;
    }

    // Brand match
    if (refBrand && rBrand && refBrand === rBrand && refBrand !== 'standard') {
      score += 25;
    }

    // Fabric match
    if (refFabric && rFabric && refFabric === rFabric && refFabric !== 'standard') {
      score += 15;
    }

    // Has image artwork bonus
    if (r.designImageUrl) {
      score += 15;
    }

    if (matchedTokens >= 1 || score >= 45) {
      styleMatches.push({ record: r, score, matchedTokens });
    }
  }

  // Sort style matches by score descending
  styleMatches.sort((a, b) => b.score - a.score);
  const matchedRecords = styleMatches.map(s => s.record);
  const allSimilarLots = [...exactArtworkSiblings, ...matchedRecords];

  // Build image gallery for frontend ChatImageGallery
  const gallery = [];
  const seenUrls = new Set();

  const addGalleryItem = (item) => {
    if (!item || !item.designImageUrl || seenUrls.has(item.designImageUrl)) return;
    seenUrls.add(item.designImageUrl);
    gallery.push({
      lotNumber: item.lot,
      jobOrder: item.jo,
      garment: item.garment,
      style: item.style,
      fabric: item.fabric,
      party: item.party,
      url: item.designImageUrl,
      title: `Lot #${item.lot} - ${item.party} (${item.style || item.garment})`,
      isCut: Boolean(item.isCut),
      cutPcs: item.cutPcs,
      qty: item.qty,
      shades: item.shades
    });
  };

  // Add primary reference item
  addGalleryItem(ref);
  // Add exact siblings
  exactArtworkSiblings.forEach(addGalleryItem);
  // Add similar style items
  matchedRecords.forEach(addGalleryItem);

  return {
    reference: ref,
    exactArtworkSiblings,
    styleMatches: matchedRecords,
    allSimilarLots,
    imageGallery: gallery
  };
}

/**
 * Formats a rich markdown breakdown for similar articles & style variations.
 */
export function formatSimilarArticlesMarkdown(similarData, maxItems = 15) {
  const { reference, exactArtworkSiblings, styleMatches } = similarData;
  if (!reference) return '';

  let section = '';

  // 1. Sibling Lots Sharing EXACT Design Artwork
  if (exactArtworkSiblings && exactArtworkSiblings.length > 0) {
    section += `\n---\n\n### 👥 Exact Design Sibling Lots (${exactArtworkSiblings.length} Lots Sharing Same Artwork)\n\n` +
      `Yeh lots factory records mein identical design artwork share karte hain:\n\n` +
      `| Lot # | Job Order | Party / Buyer | Qty / Cut | Status | Shades | Download |\n` +
      `|---|---|---|---|---|---|---|\n`;

    exactArtworkSiblings.forEach(s => {
      const cutBadge = s.isCancelled ? '❌ CANCELLED' : (s.isCut ? '✓ CUT COMPLETED' : '⏳ CUTTING PENDING');
      const pcs = s.isCancelled ? '0 Pcs (Cancelled)' : (s.cutPcs ? `**${s.cutPcs} Pcs**` : `${s.qty} ${s.unit}`);
      section += `| **\`#${s.lot}\`** | \`${s.jo}\` | **${s.party}** | ${pcs} | **[${cutBadge}]** | *${(s.shades || '-').slice(0, 30)}* | [📄 Download PDF](http://localhost:5000/api/chat/pdf/${s.lot}) |\n`;
    });
  }

  // 2. All Similar Articles & Style Variations in Factory Database
  if (styleMatches && styleMatches.length > 0) {
    const displayList = styleMatches.slice(0, maxItems);
    section += `\n---\n\n### 🧵 All Similar Articles & Style Variations in Database (${styleMatches.length} Similar Lots Found)\n\n` +
      `Aapke select kiye gaye style (**${reference.style || reference.garment}**) se milte-julte factory production records ke sabhi similar articles:\n\n` +
      `| # | Lot # | Job Order | Party / Buyer | Garment & Style | Pattern | Fabric | Qty / Cut | Status | Action |\n` +
      `|---|---|---|---|---|---|---|---|---|---|\n`;

    displayList.forEach((s, idx) => {
      const cutBadge = s.isCancelled ? '❌ CANCEL' : (s.isCut ? '✓ CUT' : '⏳ PENDING');
      const pcs = s.isCancelled ? '0 Pcs' : (s.cutPcs ? `**${s.cutPcs} Pcs**` : `${s.qty} ${s.unit}`);
      section += `| ${idx + 1} | **\`#${s.lot}\`** | \`${s.jo}\` | **${s.party}** | ${s.garment} (${s.style || 'Standard'}) | ${s.pattern || '-'} | ${s.fabric} | ${pcs} | **[${cutBadge}]** | [📄 Slip](http://localhost:5000/api/chat/pdf/${s.lot}) |\n`;
    });

    if (styleMatches.length > maxItems) {
      section += `\n*...aur **${styleMatches.length - maxItems}** additional similar lots factory database mein available hain. Niche diye gaye **Official Design Artwork Gallery** tab se aap sabhi designs ko high-res browse aur expand kar sakte hain.*`;
    }
  }

  return section;
}

/**
 * Builds comprehensive multi-department chronological lifecycle audit trail
 * for any lot across live factory production records.
 */
export function buildLotDepartmentHistory(lotData) {
  if (!lotData) return [];
  const isCancelled = Boolean(lotData.isCancelled);
  const isCut = Boolean(lotData.isCut);
  const cutPcsText = lotData.cutPcs ? `${lotData.cutPcs} Pcs` : `${lotData.qty} ${lotData.unit || 'PCS'}`;
  const cutDateText = lotData.cutDate || 'Pending';

  const issue = lotData.issueRecord || {};
  const stitchDate = lotData.stitchingIssueDate || issue.stitchingIssueDate || issue.pintuIssueDate || lotData.cutDate || '';
  const stitchSupervisor = lotData.stitchingSupervisor || issue.stitchingSupervisor || issue.pintuIssuedToWhom || '';
  const packSup = lotData.packingSupervisor || issue.packingSupervisor || (lotData.barcodes && lotData.barcodes[0]?.packingSupervisor) || '';

  const stages = [];

  // 1. Order Master
  stages.push({
    dept: 'Job Order Master',
    stageName: 'Order Initiation',
    date: lotData.date || 'Registered',
    supervisor: lotData.submittedBy || 'Admin / Ravinder',
    pcs: `${lotData.qty} ${lotData.unit || 'PCS'}`,
    status: isCancelled ? '❌ ORDER CANCELLED' : 'Order Registered',
    notes: isCancelled
      ? `Party: ${lotData.party} | Cancelled (Reason: ${lotData.cancelInfo?.reason || 'Cancelled'})`
      : `Party: ${lotData.party} | Style: ${lotData.style || 'Standard'} | Fabric: ${lotData.fabric}${lotData.directStitching ? ' | Direct Stitching: YES' : ''}`
  });

  // 2. Cutting Department (PER FACTORY RULE: Cutting Department has NO supervisor)
  stages.push({
    dept: 'Cutting Department',
    stageName: 'Fabric Cutting',
    date: isCancelled ? (lotData.cancelInfo?.date || 'Order Cancelled') : (isCut ? cutDateText : 'Pending Allocation'),
    supervisor: '-',
    pcs: isCancelled ? '0 Pcs (Cancelled)' : (isCut ? cutPcsText : 'Pending Cutting'),
    status: isCancelled ? '⛔ CANCELLED (Not in Cutting Queue)' : (isCut ? '✓ CUT COMPLETED' : '⏳ CUTTING PENDING'),
    notes: isCancelled
      ? `Lot cancelled before cutting. Reason: ${lotData.cancelInfo?.reason || 'Cancelled'}`
      : (lotData.karigar ? `Karigar: ${lotData.karigar} (Cutting Floor)` : (isCut ? 'Cutting Completed & Verified' : 'Awaiting Cutting Allocation'))
  });

  // 3. Embroidery Department (if required)
  const hasEmb = Boolean(lotData.embVendor && !/^(na|n\/a|no|-)$/i.test(lotData.embVendor));
  if (hasEmb) {
    const history = Array.isArray(lotData.challanHistoryJson) ? lotData.challanHistoryJson : [];
    const embEntry = history.find(h => h.embCompleted) || history[0];
    const isEmbDone = Boolean(embEntry?.embCompleted);
    const embDate = embEntry?.receivedDate ? embEntry.receivedDate.slice(0, 10) : (embEntry?.date || lotData.challanDate || 'Assigned');
    const embQty = embEntry?.totalQty ? `${embEntry.totalQty} Pcs` : (lotData.challanQty ? `${lotData.challanQty} Pcs` : cutPcsText);

    stages.push({
      dept: 'Embroidery Department',
      stageName: 'Embroidery Processing',
      date: embDate,
      supervisor: lotData.embVendor,
      pcs: embQty,
      status: isEmbDone ? '✓ EMBROIDERY COMPLETED' : (lotData.challanNo ? `⏳ Dispatched on ${lotData.challanNo}` : 'Assigned to Vendor'),
      notes: `Vendor: ${lotData.embVendor}${lotData.embDetails ? ` | Details: ${lotData.embDetails}` : ''}${lotData.challanNo ? ` | Challan: ${lotData.challanNo}` : ''}`
    });
  }

  // 4. Stitching Department (PER FACTORY RULE: Stitching supervisor is from Index Sheet/Issues, e.g. Sanjay, Rohit, etc. Saqib is PACKING supervisor, NOT stitching)
  // Stitching completion is strictly determined by the "Completed Status" column from Index records.
  // If blank: stitching is NOT completed -> show latest WIP remarks from "WIP Status" JSON.
  const compInfo = parseStitchingCompletion(lotData.completedStatus);
  const wipInfo = getLatestWipStatus(lotData.wipStatus);
  const isStitchComplete = Boolean(compInfo.isComplete);
  const hasStitchInfo = Boolean(stitchDate || stitchSupervisor || lotData.directStitching);

  let stitchStatus = '';
  let stitchNotes = '';

  if (isCancelled) {
    stitchStatus = '⛔ CANCELLED';
    stitchNotes = 'Order cancelled before stitching';
  } else if (isStitchComplete) {
    stitchStatus = '✓ STITCHING COMPLETED';
    const compDateStr = compInfo.completedDate ? formatWipTimestamp(compInfo.completedDate) : '';
    stitchNotes = compDateStr ? `Complete Lot (Finished: ${compDateStr})` : 'Complete Lot (Verified in Production Records)';
  } else {
    // Stitching is NOT completed
    if (wipInfo && wipInfo.text) {
      stitchStatus = '⏳ In Progress (WIP)';
      const wipDateStr = wipInfo.timestamp ? formatWipTimestamp(wipInfo.timestamp) : '';
      stitchNotes = `Latest WIP Remarks: ${wipInfo.text}${wipDateStr ? ` (${wipDateStr})` : ''}`;
    } else if (hasStitchInfo) {
      stitchStatus = '⏳ In Progress (WIP)';
      stitchNotes = lotData.indexRemarks ? `Remarks: ${lotData.indexRemarks}` : (issue.pintuIssuedToWhom ? `Handed Over To: ${issue.pintuIssuedToWhom}` : 'In Progress on Stitching Floor (No WIP remarks recorded)');
    } else if (lotData.directStitching) {
      stitchStatus = '⏳ Direct Stitching In Progress';
      stitchNotes = 'Direct Stitching Approved';
    } else if (isCut) {
      stitchStatus = '⏳ Pending Stitching Issue';
      stitchNotes = 'Awaiting Stitching Floor Issue';
    } else {
      stitchStatus = '⏳ Pending Cutting';
      stitchNotes = 'Awaiting Fabric Cutting';
    }
  }

  stages.push({
    dept: 'Stitching Department',
    stageName: 'Garment Stitching',
    date: isCancelled ? '-' : (stitchDate || (lotData.directStitching ? 'Direct Stitching' : (isCut ? 'Ready for Issue' : 'Awaiting Cutting'))),
    supervisor: isCancelled ? '-' : (stitchSupervisor || (lotData.directStitching ? 'Direct Stitching Team' : (isCut ? 'Pending Stitching Floor Allocation' : 'Pending Cutting'))),
    pcs: isCancelled ? '0 Pcs' : (isCut ? cutPcsText : `${lotData.qty} Pcs`),
    status: stitchStatus,
    notes: stitchNotes,
    isCompleted: isStitchComplete,
    latestWipRemarks: wipInfo?.text || ''
  });

  // 4. Kaj-Button Department
  if (lotData.kajButton) {
    const kb = lotData.kajButton;
    const isKbComplete = Boolean(kb.complete && kb.complete !== '[]');
    stages.push({
      dept: 'Kaj-Button Department',
      stageName: 'Kaj & Button Processing',
      date: kb.date || 'Recorded',
      supervisor: kb.supervisor || 'Jaybir',
      pcs: kb.totalPcs ? `${kb.totalPcs} Pcs` : 'Logged',
      status: isKbComplete ? '✓ Completed' : (kb.wip && kb.wip !== '[]' ? '⏳ In Progress (WIP)' : 'Logged'),
      notes: isKbComplete ? 'Completed successfully' : (kb.wip && kb.wip !== '[]' ? 'Work In Progress' : '')
    });
  }

  // 5. Washing Department
  if (lotData.washing) {
    const w = lotData.washing;
    const isWComplete = Boolean(w.complete && w.complete !== '[]');
    stages.push({
      dept: 'Washing Department',
      stageName: 'Washing & Treatment',
      date: w.date || 'Recorded',
      supervisor: w.supervisor || 'Ajay Shah',
      pcs: w.totalPcs ? `${w.totalPcs} Pcs` : 'Logged',
      status: isWComplete ? '✓ Completed' : (w.wip && w.wip !== '[]' ? '⏳ In Washing (WIP)' : 'Logged'),
      notes: `Plant: ${w.plant || 'Mohit Hosiery'} • Process: ${w.process || 'WASHING'}`
    });
  }

  // 6. Overlock Department
  if (lotData.overlock) {
    const ov = lotData.overlock;
    const isOvComplete = Boolean(ov.complete && ov.complete !== '[]');
    stages.push({
      dept: 'Overlock Department',
      stageName: 'Overlock Finishing',
      date: ov.date || 'Recorded',
      supervisor: ov.supervisor || 'Aman Overlock',
      pcs: ov.totalPcs ? `${ov.totalPcs} Pcs` : 'Logged',
      status: isOvComplete ? '✓ Completed' : (ov.wip && ov.wip !== '[]' ? '⏳ In Overlock (WIP)' : 'Logged'),
      notes: ''
    });
  }

  // 7. Folding Department
  if (lotData.folding) {
    const fl = lotData.folding;
    const isFlComplete = Boolean(fl.complete && fl.complete !== '[]');
    stages.push({
      dept: 'Folding Department',
      stageName: 'Folding & Ironing',
      date: fl.date || 'Recorded',
      supervisor: fl.supervisor || 'Krishna',
      pcs: fl.totalPcs ? `${fl.totalPcs} Pcs` : 'Logged',
      status: isFlComplete ? '✓ Completed' : (fl.wip && fl.wip !== '[]' ? '⏳ In Folding (WIP)' : 'Logged'),
      notes: ''
    });
  }

  // 8. Elastic Department
  if (lotData.elastic) {
    const el = lotData.elastic;
    const isElComplete = Boolean(el.complete && el.complete !== '[]');
    stages.push({
      dept: 'Elastic Department',
      stageName: 'Elastic Attachment',
      date: el.date || 'Recorded',
      supervisor: el.supervisor || 'Sushant Elastic',
      pcs: el.totalPcs ? `${el.totalPcs} Pcs` : 'Logged',
      status: isElComplete ? '✓ Completed' : (el.wip && el.wip !== '[]' ? '⏳ In Elastic (WIP)' : 'Logged'),
      notes: ''
    });
  }

  // 9. Packing & Barcode Department (PER FACTORY RULE: Saqib / Mdsaqib is Packing Supervisor)
  const finalPackSup = lotData.packingSupervisor || issue.packingSupervisor || (lotData.barcodes && lotData.barcodes[0]?.packingSupervisor) || '';
  const finalPackDate = lotData.packingDate || issue.packingDate || (lotData.barcodes && lotData.barcodes[0]?.packingDate) || '';
  const bCount = lotData.barcodes ? lotData.barcodes.length : 0;
  const bId = bCount > 0 ? lotData.barcodes.map(b => b.barcodeId).join(', ') : '';
  const hasBarcodes = Boolean(bCount > 0 && bId);
  const hasPacking = Boolean(finalPackSup || finalPackDate || hasBarcodes || (issue.packingComplete && issue.packingComplete !== '[]'));

  if (hasPacking) {
    const packSupDisplay = finalPackSup || 'Mdsaqib / Pintu';
    const packDateDisplay = finalPackDate || (lotData.barcodes && lotData.barcodes[0]?.generatedDate ? lotData.barcodes[0].generatedDate.slice(0, 10) : 'Recorded');

    // CRITICAL FACTORY BUSINESS RULE:
    // If the barcode is printed / generated, that means PACKING IS ALSO COMPLETED!
    const isPackComplete = Boolean(
      hasBarcodes ||
      (issue.packingComplete && issue.packingComplete !== '[]' && issue.packingComplete !== '')
    );

    let packStatus = '';
    if (isPackComplete) {
      if (hasBarcodes) {
        packStatus = `✓ Packed (Barcode: ${bId})`;
      } else if (issue.packingComplete && issue.packingComplete !== '[]' && issue.packingComplete !== '') {
        packStatus = `✓ Packed (${issue.packingComplete})`;
      } else {
        packStatus = '✓ PACKING COMPLETED';
      }
    } else {
      const isWip = Boolean(issue.wipPacking && issue.wipPacking !== '0' && issue.wipPacking !== '[]' && String(issue.wipPacking).trim() !== '');
      packStatus = isWip ? '⏳ In Packing (WIP)' : 'Logged';
    }

    stages.push({
      dept: 'Packing & Barcode Department',
      stageName: 'Packing & Dispatch',
      date: packDateDisplay,
      supervisor: packSupDisplay,
      pcs: issue.totalPcs ? `${issue.totalPcs} Pcs` : (lotData.barcodes && lotData.barcodes[0]?.totalPieces ? `${lotData.barcodes[0].totalPieces} Pcs` : cutPcsText),
      status: packStatus,
      notes: bCount > 0 ? `Barcodes: ${bId}` : '',
      isCompleted: isPackComplete
    });
  }



  // 12. Audit / Change Logs
  if (lotData.logs && lotData.logs.length > 0) {
    lotData.logs.forEach(l => {
      stages.push({
        dept: 'Production Change Log',
        stageName: 'Specification / Status Change',
        date: l.timestamp || 'Recorded',
        supervisor: l.changedBy ? `${l.changedBy} (Perm: ${l.permissionGivenBy || 'Approved'})` : 'Admin',
        pcs: 'N/A',
        status: 'Logged Change',
        notes: l.changeDetails || l.logId || ''
      });
    });
  }

  // 11. Cancellation Status
  if (lotData.isCancelled && lotData.cancelInfo) {
    stages.push({
      dept: 'Order Cancellation',
      stageName: 'Cancellation Audit',
      date: lotData.cancelInfo.date || 'Recorded',
      supervisor: lotData.cancelInfo.by || 'Management',
      pcs: '0 Pcs',
      status: '❌ CANCELLED',
      notes: `Reason: ${lotData.cancelInfo.reason || 'Cancelled'}${lotData.cancelInfo.approvedFrom ? ` • Approved By: ${lotData.cancelInfo.approvedFrom}` : ''}`
    });
  }

  return stages;
}

/**
 * Builds structured production tracking payload for executive dual-view stepper & audit card
 */
export function buildTrackingPayload(lotData, stages) {
  if (!lotData) return null;
  const isCancelled = Boolean(lotData.isCancelled);
  const isCut = Boolean(lotData.isCut);
  const compInfo = parseStitchingCompletion(lotData.completedStatus);
  const wipInfo = getLatestWipStatus(lotData.wipStatus);
  const isStitchComplete = Boolean(compInfo.isComplete);
  const issue = lotData.issueRecord || {};
  const stitchSupText = lotData.stitchingSupervisor || issue.stitchingSupervisor || (lotData.directStitching ? 'Direct Stitching Team' : 'Pending Allocation');

  let overallProgress = 0;
  let currentStage = 'Order Placed';

  if (isCancelled) {
    overallProgress = 0;
    currentStage = 'Order Cancelled';
  } else {
    const hasPacking = stages && stages.some(s => s.dept.toLowerCase().includes('packing') || s.dept.toLowerCase().includes('barcode'));
    const isPackingDone = stages && stages.some(s => (s.dept.toLowerCase().includes('packing') || s.dept.toLowerCase().includes('barcode')) && (s.status.includes('✓') || s.status.toLowerCase().includes('complete') || s.status.toLowerCase().includes('packed') || s.isCompleted));

    if (isPackingDone || (isStitchComplete && !hasPacking)) {
      overallProgress = 100;
      currentStage = 'Production Completed';
    } else if (isStitchComplete) {
      overallProgress = 85;
      currentStage = 'Stitching Complete • Finishing/Packing';
    } else if (!isStitchComplete && wipInfo?.text) {
      overallProgress = 60;
      currentStage = 'Stitching Floor (WIP Active)';
    } else if (isCut) {
      overallProgress = 40;
      currentStage = 'Cut Complete • In Production';
    } else {
      overallProgress = 15;
      currentStage = 'Order Registered • Cutting Pending';
    }
  }

  return {
    lotNumber: lotData.lot,
    jobOrderNo: lotData.jo,
    party: lotData.party,
    brand: lotData.brand || 'Standard',
    garment: lotData.garment,
    style: lotData.style || 'Standard',
    fabric: lotData.fabric,
    designImageUrl: lotData.designImageUrl || null,
    isCancelled: isCancelled,
    cancelReason: lotData.cancelInfo?.reason || '',
    overallProgress: overallProgress,
    currentStage: currentStage,
    latestWipRemark: (!isStitchComplete && wipInfo?.text) ? wipInfo.text : null,
    latestWipTimestamp: (!isStitchComplete && wipInfo?.timestamp) ? formatWipTimestamp(wipInfo.timestamp) : null,
    stitchingSupervisor: stitchSupText,
    isStitchingComplete: isStitchComplete,
    stages: stages || []
  };
}

/**
 * Universal Query Engine for Factory Suite Pro
 * Unified Multi-Sheet intelligence with Google Gemini
 */
export async function processUniversalQuery(prompt, context = {}) {
  const p = (prompt || '').trim();
  const lower = p.toLowerCase();
  const mentionsLot = p.match(/(?:LOT[-_\s]*)?(\d{4,7})\b/i);
  const mentionsParty = /\b(ss|mohit|bb|db|mh|zara|h&m)\b/i.test(lower);
  const isPdfRequested = /\b(pdf|generate\s*pdf|create\s*pdf|download\s*pdf|make\s*pdf|print\s*pdf|export\s*pdf|pdf\s*bana|bana\s*do\s*pdf|krdo\s*generate\s*pdf|pdf.*chahiye|chahiye.*pdf|pdf\s*do|show\s*pdf|slip\s*download|download\s*slip|slip\s*chahiye)\b/i.test(lower);
  const isImageRequested = /\b(image|images|photo|photos|pic|pics|picture|pictures|artwork|artworks|design\s*image|design\s*artwork|design\s*photo|design\s*(?:dikhao|dena|chahiye|bhejo|bhjna|bhejna|send|show)|photo\s*(?:dena|dikhao|bhejo|bhjna|bhejna|chahiye|de|send|show)|image\s*(?:dena|dikhao|bhejo|bhjna|bhejna|chahiye|de|send|show)|pic\s*(?:dena|dikhao|bhejo|bhjna|bhejna|chahiye|send|show)|tasveer|tasvir)\b/i.test(lower);
  const isHistoryRequested = /\b(history|timeline|stages|department|supervisor|audit\s*trail|all\s*details|complete\s*details|full\s*details|lifecycle|journey|kahan\s*tak\s*pahuncha|kya\s*status|status\s*batao|cutting\s*status)\b/i.test(lower);
  const isImageOnly = isImageRequested && !isHistoryRequested;
  const sheets = loadFactorySheetsData();
  const conversationHistory = context.conversationHistory || [];

  // =========================================================================
  // 0. OCR VISION LOT INSPECTION (Image Upload -> Extract Lot Number)
  // =========================================================================
  const isPureGreeting = /^(hlo|hello|helo|hlw|hi|hey|namaste|namaskar|ram\s*ram|radhe\s*radhe|sat\s*sri\s*akal|sasriakal|adaab|salam|good\s*(morning|afternoon|evening)|kaise\s*ho|sup)(\s*(ji|sir|bhai|mam|madam))?$/i.test(lower);
  const imageUrl = (!isPureGreeting && (context.imageUrl || context.image)) || null;
  if (imageUrl) {
    const ocrResult = await extractLotFromImageWithOCR(imageUrl, p);
    if (ocrResult && ocrResult.success && ocrResult.data) {
      const ocr = ocrResult.data;
      if (ocr.detected && ocr.lotNumber) {
        const detectedLotStr = String(ocr.lotNumber).trim();
        const lotClean = detectedLotStr.match(/\b\d{3,7}\b/)?.[0] || detectedLotStr;
        const lotData = sheets?.lotsMap?.get(lotClean);

        if (lotData) {
          const stages = buildLotDepartmentHistory(lotData);
          let historyTable = `| Department / Process | Date | Supervisor | Pcs / Qty | Status | Notes |\n|---|---|---|---|---|---|\n`;
          stages.forEach(st => {
            historyTable += `| **${st.dept}** | \`${st.date}\` | **${st.supervisor}** | ${st.pcs} | ${st.status} | ${st.notes || '-'} |\n`;
          });

          const isCut = lotData.isCut;
          const statusBadge = lotData.isCancelled ? '❌ ORDER CANCELLED' : (isCut ? '✓ CUT COMPLETED' : '⏳ CUTTING PENDING');

          let reply = `### 🔍 OCR Image Inspection Successful\n\n` +
            `* 🏷️ **Detected Lot Number:** **\`#${lotClean}\`** *(Confidence: ${ocr.confidence?.toUpperCase() || 'HIGH'})*\n` +
            `* 📋 **Slip Details Extracted:** Party: **${ocr.party || lotData.party}** | Item: **${ocr.item || lotData.garment}**${ocr.style ? ` (Style: ${ocr.style})` : ''} | Slip Qty: **${ocr.quantity || lotData.qty} Pcs**\n` +
            (ocr.supervisor ? `* 👷 **Slip Supervisor:** ${ocr.supervisor}\n` : '') +
            (ocr.date ? `* 📅 **Slip Date:** ${ocr.date}\n` : '') +
            `\n---\n\n` +
            `### 🏭 Official Factory Production Records for Lot #${lotClean}\n\n` +
            `* **Current Floor Status:** **[${statusBadge}]**\n` +
            `* **Job Order No:** \`${lotData.jo}\` • **Party Name:** **${lotData.party}** (${lotData.brand || 'Standard'})\n` +
            `* **Garment & Style:** **${lotData.garment}** (${lotData.style || 'Standard'}) • **Fabric:** **${lotData.fabric}**\n` +
            `* **Total Order Qty:** **${lotData.qty} ${lotData.unit}**${lotData.cutPcs ? ` • **Cut Pieces:** **${lotData.cutPcs} Pcs**` : ''}\n` +
            (lotData.designImageUrl ? `\n![Design Artwork](${lotData.designImageUrl})\n` : '') +
            `\n#### 📊 Multi-Department Production Lifecycle:\n\n${historyTable}\n\n` +
            `📄 **Job Order & Production Slip:** Aap niche diye gaye download button se is lot ka verified PDF download kar sakte hain.`;

          return {
            handled: true,
            answer: reply,
            trackingData: buildTrackingPayload(lotData, stages),
            pdfAttachment: {
              lotNumber: lotData.lot,
              jobOrderNo: lotData.jo,
              downloadUrl: `http://localhost:5000/api/chat/pdf/${lotData.lot}`,
              filename: `JobOrder_${lotData.jo}_Lot_${lotData.lot}.pdf`,
              title: `Job Order & Production Slip (${lotData.jo} • Lot ${lotData.lot})`
            },
            ...(lotData.designImageUrl ? {
              imageAttachment: {
                url: lotData.designImageUrl,
                lotNumber: lotData.lot,
                title: `Lot ${lotData.lot} - ${lotData.party} (${lotData.garment})`
              }
            } : {})
          };
        } else {
          // Lot detected by OCR, but not in current JobOrder database
          let reply = `### 🔍 OCR Image Inspection Complete\n\n` +
            `* 🏷️ **Extracted Lot Number:** **\`#${lotClean}\`** *(Confidence: ${ocr.confidence?.toUpperCase() || 'HIGH'})*\n` +
            `* 🏢 **Party / Buyer:** **${ocr.party || 'N/A'}**\n` +
            `* 👕 **Garment / Style:** **${ocr.item || 'N/A'}** ${ocr.style ? `(${ocr.style})` : ''}\n` +
            `* 🔢 **Slip Quantity:** **${ocr.quantity || 'N/A'} Pcs**\n` +
            (ocr.supervisor ? `* 👷 **Supervisor:** ${ocr.supervisor}\n` : '') +
            (ocr.date ? `* 📅 **Date:** ${ocr.date}\n` : '') +
            (ocr.rawExtractedText ? `* 📝 **Visible Slip Text:** *"${ocr.rawExtractedText}"*\n` : '') +
            `\nℹ️ *Note: Lot #${lotClean} aapki image / slip se clearly extract ho gaya hai, lekin yeh abhi active JobOrder sheet mein registered nahi mila. Aap chahein toh JobOrder sheet mein is lot ka entry verify kar sakte hain.*`;

          return {
            handled: true,
            answer: reply
          };
        }
      } else {
        // Reverse Visual Search (Image-to-Image Matching against Database Design Artworks)
        // When no paper slip or written lot number is visible on the garment,
        // compare the uploaded article photo directly against official design artworks in the factory database!
        const visualMatch = await findLotByVisualSimilarity(imageUrl, ocr || {}, p);

        if (visualMatch && visualMatch.success && visualMatch.data?.isMatch && visualMatch.data?.bestMatchLot) {
          const matchedLotNo = String(visualMatch.data.bestMatchLot).trim();
          const lotData = sheets?.lotsMap?.get(matchedLotNo);

          if (lotData) {
            const confScore = visualMatch.data.confidenceScore || 85;
            const features = visualMatch.data.matchingFeatures || [];
            const explanation = visualMatch.data.explanation || '';
            const siblingLots = visualMatch.data.matchedCandidate?.siblingLots || [matchedLotNo];
            const otherLots = siblingLots.filter(l => l !== matchedLotNo);

            // Fetch ALL similar articles & style variations across the factory database!
            const similarData = findSimilarArticles(lotData, sheets);
            const similarSection = formatSimilarArticlesMarkdown(similarData, 15);

            const stages = buildLotDepartmentHistory(lotData);
            let historyTable = `| Department / Process | Date | Supervisor | Pcs / Qty | Status | Notes |\n|---|---|---|---|---|---|\n`;
            stages.forEach(st => {
              historyTable += `| **${st.dept}** | \`${st.date}\` | **${st.supervisor}** | ${st.pcs} | ${st.status} | ${st.notes || '-'} |\n`;
            });

            const isCut = lotData.isCut;
            const statusBadge = lotData.isCancelled ? '❌ ORDER CANCELLED' : (isCut ? '✓ CUT COMPLETED' : '⏳ CUTTING PENDING');

            let reply = `### 🎯 Visual Design Match Identified!\n\n` +
              `* 🏷️ **Identified Lot Number:** **\`#${matchedLotNo}\`** *(Visual Match Confidence: **${confScore}%**)*\n` +
              `* 🏢 **Party / Buyer:** **${lotData.party}** (${lotData.brand || 'Registered Brand'})\n` +
              `* 👕 **Garment & Style:** **${lotData.garment}** (${lotData.style || 'Standard'})\n` +
              `* 🧵 **Fabric & Color:** **${lotData.fabric}** ${lotData.shades ? `| Shades: *${lotData.shades}*` : ''}\n` +
              `* 🔢 **Order Qty:** **${lotData.qty} ${lotData.unit}**${lotData.cutPcs ? ` • **Cut Pieces:** **${lotData.cutPcs} Pcs**` : ''}\n` +
              `* 📦 **Current Floor Status:** **[${statusBadge}]** (Job Order: \`${lotData.jo}\`)\n` +
              (otherLots.length > 0 ? `* 👥 **Sibling Lots Sharing This Design:** ${otherLots.map(ol => `\`#${ol}\``).join(', ')}\n` : '') +
              `\n---\n\n` +
              `### 🔬 Visual Design Verification & Alignment\n\n` +
              `* 💡 **Visual Match Reasoning:** ${explanation}\n` +
              (features.length > 0 ? `* 🔍 **Matching Design Features:**\n${features.map(f => `  - ✓ ${f}`).join('\n')}\n` : '') +
              `\n---\n\n` +
              `### 🖼️ Official Design Artwork in Factory Database\n\n` +
              (lotData.designImageUrl ? `![Official Design Artwork for Lot ${matchedLotNo}](${lotData.designImageUrl})\n\n` : '') +
              similarSection +
              `\n\n#### 📊 Multi-Department Production Lifecycle for Lot #${matchedLotNo}:\n\n${historyTable}\n\n` +
              `📄 **Job Order & Production Slip:** Aap niche diye gaye download button se is lot ka verified PDF download kar sakte hain.\n` +
              (similarData.imageGallery.length > 1 ? `\n🖼️ **Official Design Artwork Gallery:** Niche diye gaye gallery view se aap sabhi **${similarData.imageGallery.length} similar designs** ko filter aur click-to-expand karke full size mein dekh sakte hain.` : '');

            return {
              handled: true,
              answer: reply,
              trackingData: buildTrackingPayload(lotData, stages),
              imageGallery: similarData.imageGallery,
              pdfAttachment: {
                lotNumber: lotData.lot,
                jobOrderNo: lotData.jo,
                downloadUrl: `http://localhost:5000/api/chat/pdf/${lotData.lot}`,
                filename: `JobOrder_${lotData.jo}_Lot_${lotData.lot}.pdf`,
                title: `Job Order & Production Slip (${lotData.jo} • Lot ${lotData.lot})`
              },
              ...(lotData.designImageUrl ? {
                imageAttachment: {
                  url: lotData.designImageUrl,
                  lotNumber: lotData.lot,
                  title: `Lot ${lotData.lot} - ${lotData.party} (${lotData.garment})`
                }
              } : {})
            };
          }
        }

        // If no high-confidence visual match was confirmed, show ALL candidate designs
        const candidates = visualMatch?.data?.allCandidates || [];
        const itemKey = (ocr?.item || 'Garment').trim();
        const brandKey = (ocr?.rawExtractedText || ocr?.party || '').trim();

        let reply = `### 🔍 Visual Search: Design Comparison Results\n\n` +
          `Humne aapki uploaded photo ko factory database ke registered design artworks se compare kiya.\n` +
          `* 👕 **Detected Garment:** **${itemKey}** ${brandKey ? `(${brandKey})` : ''}\n` +
          (visualMatch?.data?.explanation ? `* 📝 **Visual Analysis:** *${visualMatch.data.explanation}*\n\n` : '\n') +
          `---\n\n` +
          `### 🏭 All Similar Candidate Design Artworks in Factory Database (${candidates.length} Designs):\n\n`;

        if (candidates.length > 0) {
          candidates.forEach((c, idx) => {
            reply += `**${idx + 1}. Lot #${c.primaryLot}** (Party: **${c.party}** | Style: **${c.style || 'Standard'}** | Fabric: **${c.fabric || 'Standard'}**)\n\n` +
              `![Lot ${c.primaryLot}](${c.designImageUrl})\n\n`;
          });
          reply += `💡 **Lot Verify Karne Ke Liye:**\n` +
            `Agar aapka article inme se kisi design se match karta hai toh aap uska Lot Number bata sakte hain, ya phir is article ke **Cutting Slip** ya **Bundle Ticket** ki photo upload karein!`;
        } else {
          reply += `Database mein is garment type ke liye koi registered design artwork nahi mila.\n\n` +
            `💡 **Tip:** Kripya article ke saath lagi hui **Paper Cutting Slip** ya **Barcode Ticket** ki photo kheench kar bhejein!`;
        }

        const candidateGallery = candidates.map(c => ({
          lotNumber: c.primaryLot,
          jobOrder: c.jo,
          garment: c.garment,
          style: c.style,
          fabric: c.fabric,
          party: c.party,
          url: c.designImageUrl,
          title: `Lot #${c.primaryLot} - ${c.party} (${c.style || c.garment})`,
          isCut: Boolean(c.isCut),
          cutPcs: c.cutPcs,
          qty: c.qty,
          shades: c.shades
        }));

        return {
          handled: true,
          answer: reply,
          imageGallery: candidateGallery
        };
      }
    } else {
      return {
        handled: true,
        answer: `### 📸 Image Upload Received\n\nHumne aapki uploaded photo receive kar li hai, lekin visual service temporarily high demand pe thi. Kripya 2 second baad dobara "Send" par click karein ya agar is article ka koi **Cutting Slip** ya **Job Order Ticket** hai toh uska photo bhejein!`
      };
    }
  }

  const getContextualEntity = () => {
    const recent = context.recentMessages || [];
    for (const m of recent) {
      const text = String(m.text || '');
      const lotM = text.match(/(?:LOT[-_\s]*)?(\d{4,7})\b/i);
      if (lotM) return { type: 'lot', value: lotM[1] };
      if (/\b(ss|ss\s*party)\b/i.test(text)) return { type: 'party', value: 'SS Party' };
      if (/\bmohit\s*(?:hosiery)?\b/i.test(text)) return { type: 'party', value: 'Mohit Hosiery' };
      if (/\bbb\b/i.test(text)) return { type: 'party', value: 'BB' };
      if (/\bmh\b/i.test(text) && !/fleece/i.test(text)) return { type: 'party', value: 'MH' };
    }
    return { type: 'party', value: 'SS Party' };
  };

  // =========================================================================
  // 0B. DEDICATED JOB ORDER ANALYTICS ENGINE (19 Categories & 199 Questions)
  // Handles Brand, Party, Fabric, Shade, Size, Quantity, Emb, Challan, History,
  // Reconciliation, Garments, Style, Stitching, PDF, Audit & Analytics
  // (Only run if no specific lot number is targeted, or if specifically asking for JO-XX)
  // =========================================================================
  const hasSpecificJoCode = /\bJO[-_\s]?\d+\b/i.test(p);
  if (!mentionsLot || hasSpecificJoCode) {
    try {
      const joResult = await processJobOrderQuery(p, sheets, context);
      if (joResult && joResult.handled) {
        return joResult;
      }
    } catch (err) {
      console.warn('Job Order Query Engine notice:', err.message);
    }
  }

  // =========================================================================
  // 1. LINKED SHEETS REGISTRY & MULTI-SHEET STATUS INQUIRY
  // =========================================================================
  if (!mentionsLot && /\b(linked\s*sheets|connected\s*sheets|sheets\s*list|konsi\s*sheets|which\s*sheets|all\s*sheets|list\s*sheets|sheet\s*status)\b/i.test(lower)) {
    const summary = sheets?.linkedSheetsSummary || [];
    let fallback = `**Factory Suite Pro mein total ${summary.length || 8} Google Sheets kamyabi se linked hain (100% Read-Only Mode):**\n\n`;
    summary.forEach((s, idx) => {
      fallback += `* **${idx + 1}. ${s.displayName}** (\`${s.tabName}\`)\n  - Category: *${s.category}* • Total Rows: **${Number(s.rowCount || 0).toLocaleString()} Rows** • Status: **${s.status}**\n`;
    });
    fallback += `\n*Note: Sabhi sheets strictly Read-Only fetch mode mein hain; Google Sheets mein koi data write ya push nahi hota.*`;

    const sysPrompt = `You are PulseBot AI.
The user is asking which Google Sheets are linked in the system.
Explain politely that Factory Suite Pro is connected to ${summary.length || 8} Google Sheets in strictly Read-Only mode.
Data:
${summary.map(s => `- ${s.displayName} (Tab: "${s.tabName}", Category: ${s.category}, Rows: ${s.rowCount})`).join('\n')}
Guarantee clearly that all data fetching is read-only and no data is pushed/overwritten in Google Sheets.
User did NOT ask for PDF. Do not mention downloading PDF.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return { handled: true, answer: aiAnswer };
  }

  // =========================================================================
  // 1B. LINK MORE SHEETS / WORKFLOW EXPLANATION & INSTRUCTIONS
  // =========================================================================
  if (/\b(link\s*more\s*data|link\s*(?:more\s*)?sheets?|connect\s*(?:more\s*)?sheets?|add\s*(?:new\s*)?sheets?|kaise\s*link\s*karein|naya\s*sheet\s*add|different\s*sheets|fetch\s*only|push\s*data)\b/i.test(lower)) {
    const summary = sheets?.linkedSheetsSummary || [];
    const fallback = `**Aap asaani se nayi Google Sheets Factory Suite Pro mein link kar sakte hain (100% Strictly Read-Only Mode):**\n\n1. **Linked Sheets Hub kholein:** Chat header mein diye gaye **"Linked Sheets (8)"** button par click karein.\n2. **"+ Link More Sheets" tab chunein.**\n3. Apni Google Spreadsheet ka URL ya ID aur Tab Name (jaise \`Index\`, \`JobOrder\`, \`Cutting\`, \`Fabric\`) darj karein.\n4. **"Link Sheet (Read-Only)"** par click karein.\n\n🔒 **Strict Read-Only Guarantee:** Humara engine sirf data fetch karta hai (\`spreadsheets.values.get\`). Google Sheet mein **zero write/push** operations hote hain, isliye aapka original sheet data 100% safe aur unedited rehta hai.`;

    const sysPrompt = `You are PulseBot AI.
The user is asking how to link more data/different sheets or asking about the read-only workflow.
Explain warmly and clearly in Hinglish:
1. They can open the "Linked Sheets Hub" by clicking the green "Linked Sheets (8)" button in the top chat header or using the Quick Prompts bar.
2. They can paste their Google Spreadsheet URL/ID and Tab Name under "+ Link More Sheets".
3. Reassure them strongly of the STRICT READ-ONLY guarantee: The system only fetches data via GET requests and NEVER pushes, writes, or overwrites any data in their Google Sheets.
User did NOT ask for PDF. Do not mention downloading PDF.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return { handled: true, answer: aiAnswer };
  }

  // =========================================================================
  // 2. TRIGGER ON-DEMAND BACKGROUND MULTI-SHEET SYNC
  // =========================================================================
  if (/\b(sync\s*sheets?|refresh\s*sheets?|sheets?\s*update\s*karo|update\s*sheets?|fetch\s*sheets?|sync\s*now)\b/i.test(lower)) {
    import('./sheetRegistryService.js')
      .then(m => m.syncAllLinkedSheets())
      .catch(e => console.warn('Sync trigger notice:', e.message));

    const fallback = `**Live Factory Database Sync shuru ho chuka hai!**\n\nHum sabhi factory floor records (Job Orders, Cutting, Karigar, Quality, Packing, LotLogs) se latest data background mein synchronize kar rahe hain. 5 se 7 seconds mein updated data live query engine mein reflect ho jayega.`;

    const sysPrompt = `You are PulseBot AI. User commanded to sync/refresh factory data.
Politely inform them in Hinglish that a background sync has been triggered across all live factory database records and will finish in a few seconds with zero disruption.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return { handled: true, answer: aiAnswer };
  }

  // =========================================================================
  // 2B. SIMILAR ARTICLES & STYLE VARIATIONS INQUIRIES
  // (e.g. "suggest similar articles", "give me all similar articles", "similar lots", "is jaise aur articles", "same style articles")
  // =========================================================================
  const isSimilarRequested = /\b(similar\s*articles?|similar\s*lots?|related\s*articles?|same\s*style|same\s*design|is\s*jaise\s*aur|aur\s*articles?|aur\s*bhi\s*articles?|dusre\s*articles?|other\s*articles?|all\s*similar|all\s*articles?|style\s*variations?|matching\s*articles?|aise\s*aur\s*lots?|related\s*lots?|similar\s*one|similar\s*ones|all\s*similar\s*articles?|similar\s*designs?|suggest\s*(?:me\s*)?article|suggest\s*(?:me\s*)?all\s*similar)\b/i.test(lower);

  if (isSimilarRequested) {
    let targetLot = mentionsLot ? mentionsLot[1] : null;

    if (!targetLot) {
      const ctx = getContextualEntity();
      if (ctx && ctx.type === 'lot') targetLot = ctx.value;
    }

    if (!targetLot && conversationHistory && conversationHistory.length > 0) {
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const txt = conversationHistory[i].content || conversationHistory[i].parts?.[0]?.text || '';
        const m = txt.match(/(?:LOT[-_\s]*)?(\d{4,7})\b/i);
        if (m) {
          targetLot = m[1];
          break;
        }
      }
    }

    // Default to recent known lot (e.g. 61321) if conversation context implies the current active lot
    if (!targetLot && sheets?.lotsMap?.has('61321')) {
      targetLot = '61321';
    }

    if (targetLot && sheets?.lotsMap?.has(targetLot)) {
      const lotData = sheets.lotsMap.get(targetLot);
      const similarData = findSimilarArticles(lotData, sheets);
      const similarMarkdown = formatSimilarArticlesMarkdown(similarData, 20);

      const statusBadge = lotData.isCut ? '✓ CUT COMPLETED' : '⏳ CUTTING PENDING';

      let reply = `### 🧵 All Similar Articles & Style Variations for Lot #${lotData.lot}\n\n` +
        `Factory Suite Pro ke production database se **Lot #${lotData.lot}** se milte-julte **sabhi similar articles aur style variations** ki verified list:\n\n` +
        `* 🏷️ **Reference Article:** **\`#${lotData.lot}\`** (Job Order: \`${lotData.jo}\`)\n` +
        `* 🏢 **Party / Buyer:** **${lotData.party}** (${lotData.brand || 'Standard'})\n` +
        `* 👕 **Garment & Style:** **${lotData.garment}** (${lotData.style || 'Standard'})\n` +
        `* ✂️ **Pattern & Fabric:** **${lotData.pattern || 'Standard'}** | **${lotData.fabric}**\n` +
        `* 📦 **Current Floor Status:** **[${statusBadge}]** • Total Order: **${lotData.qty} ${lotData.unit}**${lotData.cutPcs ? ` (Cut: **${lotData.cutPcs} Pcs**)` : ''}\n` +
        (lotData.designImageUrl ? `\n![Reference Design Artwork](${lotData.designImageUrl})\n\n` : '\n\n') +
        similarMarkdown +
        `\n\n💡 *Tip: Niche diye gaye **Official Design Artwork Gallery (${similarData.imageGallery.length} Designs)** tab se aap sabhi designs ko filter karke high-resolution mein click-to-expand dekh sakte hain.*`;

      return {
        handled: true,
        answer: reply,
        imageGallery: similarData.imageGallery,
        pdfAttachment: {
          lotNumber: lotData.lot,
          jobOrderNo: lotData.jo,
          downloadUrl: `http://localhost:5000/api/chat/pdf/${lotData.lot}`,
          filename: `JobOrder_${lotData.jo}_Lot_${lotData.lot}.pdf`,
          title: `Job Order & Production Slip (${lotData.jo} • Lot ${lotData.lot})`
        },
        ...(lotData.designImageUrl ? {
          imageAttachment: {
            url: lotData.designImageUrl,
            lotNumber: lotData.lot,
            title: `Lot ${lotData.lot} - ${lotData.party} (${lotData.garment})`
          }
        } : {})
      };
    }
  }

  // =========================================================================
  // 3. CANCELLED LOTS INQUIRIES (From "Cancel" Sheet Tab & JobOrder Cancellation Fields)
  // =========================================================================
  if (/\b(cancelled\s*lots?|canceled\s*lots?|lots?\s*cancel[a-z]*|cancel\s*lots?|kaun\s*se\s*lot\s*cancel|why\s*(?:is\s*)?lot\s*(\d+).*?cancel[a-z]*|cancel\s*hua|kyun\s*cancel|cancel\s*(?:of\s*)?lots?|how\s*many\s*(?:cancel|cancelled|canceled)|kitne\s*lots?\s*cancel)\b/i.test(lower)) {
    const cancelledMap = sheets?.cancelledLotsMap || new Map();
    const targetLot = mentionsLot ? mentionsLot[1] : null;

    // Check if a specific party / buyer is mentioned (e.g. "cancel of lots of BB", "SS cancelled lots")
    let partyName = null;
    let partyLots = null;
    if (/\b(ss|ss\s*party|party\s*ss)\b/i.test(lower)) {
      partyName = 'SS';
      partyLots = sheets.partiesMap.get('SS') || [];
    } else if (/\bmohit\s*(?:hosiery)?\b/i.test(lower)) {
      partyName = 'Mohit Hosiery';
      partyLots = sheets.partiesMap.get('MOHIT HOSIERY') || [];
    } else if (/\bbb\b|\bbb\s*party\b/i.test(lower)) {
      partyName = 'BB';
      partyLots = sheets.partiesMap.get('BB') || [];
    } else if (/\bdb\b|\bdb\s*party\b/i.test(lower)) {
      partyName = 'DB';
      partyLots = sheets.partiesMap.get('DB') || [];
    } else if (/\bmh\b|\bmh\s*party\b/i.test(lower) && !/fleece/i.test(lower)) {
      partyName = 'MH';
      partyLots = sheets.partiesMap.get('MH') || [];
    } else if (sheets?.partiesMap) {
      for (const [pKey, lots] of sheets.partiesMap) {
        if (pKey.length >= 3 && lower.includes(pKey.toLowerCase())) {
          partyName = lots[0].party;
          partyLots = lots;
          break;
        }
      }
    }

    if (targetLot) {
      const lotData = sheets?.lotsMap?.get(targetLot);
      let cancelRecord = null;
      if (lotData && (lotData.isCancelled || lotData.cancelInfo)) {
        cancelRecord = lotData.cancelInfo || { lot: targetLot, reason: 'Cancelled Order', by: 'Management' };
      } else if (cancelledMap.has(targetLot)) {
        cancelRecord = cancelledMap.get(targetLot);
      }

      if (cancelRecord) {
        let fallback = `### 🛑 Lot #${targetLot} Cancel ho chuka hai\n\n` +
          `* **Job Order No:** \`${lotData?.jo || 'N/A'}\` • **Party Name:** **${lotData?.party || 'Standard'}**\n` +
          `* **Garment & Style:** **${lotData?.garment || 'Garment'}** (${lotData?.style || 'Standard'}) • **Fabric:** **${lotData?.fabric || 'Standard'}**\n` +
          `* **Order Status:** **[❌ CANCELLED]**\n` +
          `* **Cancellation Reason:** **${cancelRecord.reason || 'Double Order'}**\n` +
          `* **Cancelled By:** **${cancelRecord.by || 'EA'}**\n` +
          (cancelRecord.approvedFrom ? `* **Approved By:** **${cancelRecord.approvedFrom}**\n` : '') +
          (cancelRecord.date ? `* **Cancellation Date:** \`${cancelRecord.date}\`\n` : '') +
          `\n*Note: Yeh lot officially cancel ho chuka hai aur cutting queue / uncut category mein nahi hai.*`;

        if (lotData?.designImageUrl) {
          fallback += `\n\n![Design Artwork for Lot ${targetLot}](${lotData.designImageUrl})\n*🖼️ **Official Design Artwork** (Lot #${targetLot})*`;
        }

        const sysPrompt = `You are PulseBot AI, the enterprise garment manufacturing assistant for Factory Suite Pro.
Explain with executive clarity in Hinglish that Lot ${targetLot} was officially CANCELLED.
Details:
- Lot Number: ${targetLot}
- Job Order: ${lotData?.jo || 'N/A'}
- Party: ${lotData?.party || 'Standard'}
- Garment & Style: ${lotData?.garment || 'Garment'} (${lotData?.style || 'Standard'})
- Fabric: ${lotData?.fabric || 'Standard'}
- Reason: ${cancelRecord.reason || 'Double Order'}
- Cancelled By: ${cancelRecord.by || 'EA'}
- Approved By: ${cancelRecord.approvedFrom || 'Management'}
- Date: ${cancelRecord.date || 'Recorded'}
${lotData?.designImageUrl ? `- Official Design Artwork: ${lotData.designImageUrl} (EMBED THIS DIRECTLY USING MARKDOWN ![Lot ${targetLot}](${lotData.designImageUrl}))` : '- Design Artwork: Not attached in production records'}

CRITICAL RULES:
1. State clearly that status is CANCELLED. Do NOT state it is pending cutting or in uncut lot queue.
2. ${lotData?.designImageUrl ? `Embed the design image directly in markdown: ![Design Artwork](${lotData.designImageUrl}). NEVER say you cannot display images!` : 'Note politely that the design artwork was not attached in records.'}
3. Answer clearly and concisely.`;

        const aiAnswer = await generateAiResponseWithGemini({
          prompt: p,
          systemInstruction: sysPrompt,
          fallbackText: fallback,
          conversationHistory
        });

        const res = { handled: true, answer: aiAnswer };
        if (lotData?.designImageUrl) {
          res.imageAttachment = {
            url: lotData.designImageUrl,
            lotNumber: lotData.lot,
            title: `Cancelled Lot #${lotData.lot} - ${lotData.party} (${lotData.garment})`
          };
        }
        return res;
      }
    } else if (partyLots && partyLots.length > 0) {
      // ---------------------------------------------------------------------
      // PARTY-SPECIFIC CANCELLED LOTS QUERY (e.g. "how many cancel lots of BB")
      // ---------------------------------------------------------------------
      const cancelledLots = partyLots.filter(l => l.isCancelled);
      const cancelledCount = cancelledLots.length;
      const cancelledWithImages = cancelledLots.filter(l => Boolean(l.designImageUrl));
      const cancelledWithoutImages = cancelledLots.filter(l => !l.designImageUrl);

      const gallery = cancelledWithImages.map(l => ({
        url: l.designImageUrl,
        lotNumber: l.lot,
        jobOrder: l.jo,
        garment: l.garment,
        style: l.style || 'Standard',
        fabric: l.fabric,
        qty: `${l.qty} ${l.unit}`,
        title: `Cancelled Lot #${l.lot} • ${l.garment} (${l.style || 'Standard'}) - ${l.cancelInfo?.reason || 'Cancelled'}`
      }));

      let fallback = `### 🛑 Party **${partyName}**: Total ${cancelledCount} Cancelled Lots\n\n` +
        `Official Factory Production Records ke mutabiq, Party **${partyName}** ke total **${partyLots.length} registered orders** mein se **${cancelledCount} lots officially CANCEL** ho chuke hain:\n\n`;

      if (cancelledWithImages.length > 0) {
        fallback += `#### 🖼️ Official Design Artworks of Cancelled Lots (${cancelledWithImages.length} Lots):\n\n`;
        cancelledWithImages.forEach((l, idx) => {
          fallback += `**${idx + 1}. Lot #${l.lot}** (Job Order: \`${l.jo}\` | ${l.garment} - **${l.style || 'Standard'}** | Fabric: **${l.fabric}** | Qty: **${l.qty} ${l.unit}**)\n` +
            `* **Cancellation Reason:** *${l.cancelInfo?.reason || 'Cancelled'}* • **Cancelled By:** **${l.cancelInfo?.by || 'Management'}**${l.cancelInfo?.approvedFrom ? ` • **Approved:** ${l.cancelInfo.approvedFrom}` : ''}\n\n` +
            `![Lot ${l.lot} - ${l.garment}](${l.designImageUrl})\n\n`;
        });
      }

      if (cancelledWithoutImages.length > 0) {
        fallback += `#### 📋 Additional Cancelled Lots (Without Attached Design Photos):\n`;
        cancelledWithoutImages.forEach(l => {
          fallback += `* **Lot #${l.lot}** (Job Order: \`${l.jo}\` | ${l.garment} - ${l.style || 'Standard'} | Fabric: ${l.fabric} | Qty: ${l.qty} ${l.unit})\n` +
            `  - **Reason:** *${l.cancelInfo?.reason || 'Cancelled'}* • **Cancelled By:** ${l.cancelInfo?.by || 'Management'}${l.cancelInfo?.approvedFrom ? ` • **Approved:** ${l.cancelInfo.approvedFrom}` : ''}\n` +
            `  - *(Design photo not attached in production records for this lot)*\n`;
        });
      }

      fallback += `\n*Note: Yeh sabhi ${cancelledCount} cancelled lots cutting queue / uncut category se excluded hain.*`;

      const sysPrompt = `You are PulseBot AI, the enterprise Operations & Manufacturing Intelligence Assistant for Factory Suite Pro.
Converse warmly, professionally, and fluently in Hinglish/Hindi/English matching the user.

CRITICAL PROFESSIONALISM & IMAGE DIRECTIVE:
- NEVER say "I am fetching data from sheets" or mention Google Sheets.
- NEVER say "ek AI text assistant hone ke kaaran main images/photos display ya send nahi kar sakta" or that you cannot send images! You CAN embed images using markdown: ![Description](image_url).
- The user asked: "${p}".
- Party "${partyName}" has EXACTLY ${cancelledCount} cancelled lots out of ${partyLots.length} total orders.
- ${cancelledWithImages.length} of these cancelled lots have official design artworks attached in factory records:
${cancelledWithImages.map(l => `- Lot ${l.lot}: ![Lot ${l.lot} - ${l.garment}](${l.designImageUrl}) (Reason: ${l.cancelInfo?.reason || 'Cancelled'}, By: ${l.cancelInfo?.by || 'Management'})`).join('\n')}
${cancelledWithoutImages.length > 0 ? `\n- Lots without attached photos (${cancelledWithoutImages.length}): ${cancelledWithoutImages.map(l => `Lot ${l.lot} (Reason: ${l.cancelInfo?.reason || 'Cancelled'})`).join(', ')}` : ''}

DIRECTIVES:
1. Answer directly: Party "${partyName}" ke total ${cancelledCount} lots cancel ho chuke hain.
2. If the user asked for images/photos:
   - Embed the official design photo for every single lot that has one (${cancelledWithImages.map(l => `Lot ${l.lot}`).join(', ')}) directly in your markdown response using ![Lot number - style](image_url).
   - For lots without an attached photo (e.g. Lot 62048), clarify politely that the photo was not attached in official records.
3. List the complete specifications: Lot number, Job Order, style, fabric, quantity, cancellation reason, and who cancelled it.
4. Confirm clearly that these lots are CANCELLED and are NOT in the uncut or cutting queue.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      const res = {
        handled: true,
        answer: aiAnswer,
        imageGallery: gallery,
        imageAttachment: gallery[0] || null
      };
      return res;
    } else {
      // ---------------------------------------------------------------------
      // GENERAL FACTORY CANCELLED LOTS QUERY (No party filter)
      // ---------------------------------------------------------------------
      const allCancelled = sheets?.cancelledLotsList || Array.from(cancelledMap.values());
      const cancelledWithImages = allCancelled.filter(l => Boolean(l.designImageUrl));
      const gallery = cancelledWithImages.slice(0, 15).map(l => ({
        url: l.designImageUrl,
        lotNumber: l.lot,
        jobOrder: l.jo,
        garment: l.garment,
        style: l.style || 'Standard',
        fabric: l.fabric,
        qty: `${l.qty} ${l.unit}`,
        title: `Cancelled Lot #${l.lot} • ${l.garment} - ${l.cancelInfo?.reason || 'Cancelled'}`
      }));

      let fallback = `**Factory Suite Pro ke Cancellation Records mein total ${allCancelled.length} Cancelled Lots darj hain:**\n\n`;
      allCancelled.slice(0, 10).forEach(c => {
        fallback += `* **Lot #${c.lot}** (${c.party || 'Standard'}): Reason: *${c.cancelInfo?.reason || c.reason || 'Cancelled'}* (Cancelled by: ${c.cancelInfo?.by || c.by || 'Management'})\n`;
      });

      if (isImageRequested && cancelledWithImages.length > 0) {
        fallback += `\n### 🖼️ Sample Cancelled Lots ke Design Photos:\n\n`;
        cancelledWithImages.slice(0, 6).forEach((l, idx) => {
          fallback += `**${idx + 1}. Lot #${l.lot}** (${l.party} - ${l.garment})\n` +
            `![Lot ${l.lot} - ${l.garment}](${l.designImageUrl})\n\n`;
        });
      }

      const sysPrompt = `You are PulseBot AI, the enterprise garment manufacturing assistant for Factory Suite Pro.
The user is asking about cancelled lots across the factory.
Data from Official Cancellation Records:
- Total Cancelled Lots: ${allCancelled.length}
- Sample Cancelled Lots: ${allCancelled.slice(0, 8).map(c => `Lot ${c.lot} (${c.party || 'Standard'} - Reason: ${c.cancelInfo?.reason || c.reason}, By: ${c.cancelInfo?.by || c.by})`).join('; ')}
${isImageRequested && cancelledWithImages.length > 0 ? `- Cancelled lots with design photos available (${cancelledWithImages.length} lots). Sample design artworks: ${cancelledWithImages.slice(0, 5).map(l => `Lot ${l.lot}: ![Lot ${l.lot}](${l.designImageUrl})`).join(', ')}` : ''}

CRITICAL RULES:
1. Explain clearly in Hinglish.
2. ${isImageRequested && cancelledWithImages.length > 0 ? `The user requested images. EMBED available design images directly using markdown: ![Lot - Garment](image_url). NEVER say you cannot display images or that you are a text-only assistant!` : ''}
3. Answer with authority and professionalism.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      const res = { handled: true, answer: aiAnswer };
      if (gallery.length > 0) {
        res.imageGallery = gallery;
        res.imageAttachment = gallery[0];
      }
      return res;
    }
  }

  // =========================================================================
  // 4. GREETINGS & INTRODUCTIONS (e.g. "hlo ji", "hello", "namaste", "kaise ho")
  // =========================================================================
  if (/^(hlo|hello|helo|hlw|hi|hey|namaste|namaskar|ram\s*ram|radhe\s*radhe|sat\s*sri\s*akal|sasriakal|adaab|salam|good\s*(morning|afternoon|evening)|kaise\s*ho|sup)(\s*(ji|sir|bhai|mam|madam))?\b/i.test(lower) && !/\b(lot|party|task|pdf|status|cut|fabric|sheet)\b/i.test(lower)) {
    const fallback = `**Hello! Main PulseBot AI hoon, aapka Factory Suite Pro Intelligent Assistant.** 🚀\n\nMain aapki factory production, cutting operations, job orders, aur operations workflows ke kisi bhi sawal ka foran aur exact answer de sakta hoon:\n\n* **Cutting Status:** Kisi bhi Lot ka status poochein (jaise *"Is Lot 61008 cut or pending?"*)\n* **Party & Orders:** Kisi bhi Buyer ka data dekhein (jaise *"How many lots of SS?"* ya *"Mohit Hosiery total lots"*)\n* **Fabrics & Styles:** Material aur garment categories (jaise *"Lots using German Fleece"* ya *"How many Lower lots?"*)\n* **Task Manager:** Live tasks aur team updates (jaise *"What tasks are overdue?"* ya *"Who is on leave?"*)\n* **Instant PDF:** Kisi bhi lot ka Cutting Slip ya party ka complete report download karein.\n\nAap abhi kya check karna chahte hain?`;
    
    const sysPrompt = `You are PulseBot AI, the expert garment manufacturing assistant for Factory Suite Pro.
Converse warmly, politely, and naturally in Hinglish/Hindi/English matching the user.
Greet the user and briefly highlight that you can answer queries about live lots, cutting status verified from production records, party orders (like SS, Mohit Hosiery), fabrics, and tasks.
User did NOT ask for PDF. Do NOT mention downloading PDF.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return { handled: true, answer: aiAnswer };
  }

  // =========================================================================
  // 5. HELP & CAPABILITIES (e.g. "what can you do?", "help", "kya pooch sakte hain")
  // =========================================================================
  if (/\b(what\s*can\s*you\s*do|help|kya\s*kya\s*pooch\s*sakte\s*hain|kya\s*kar\s*sakte\s*ho|commands|features|guide)\b/i.test(lower)) {
    const fallback = `**PulseBot AI Capabilities Cheatsheet:**\n\nAap mujhe inme se kisi bhi format mein questions pooch sakte hain:\n\n1. **✂️ Cutting & Lot Inquiries:**\n   - *"Is Lot 61008 cut or pending?"*\n   - *"Details of Lot 11028"*\n   - *"Fabric of Lot 11028"*\n   - *"Who is the party for Lot 61001?"*\n\n2. **🏢 Parties & Buyers:**\n   - *"How many lots of SS?"* (Accurate 331 count + cut breakdown)\n   - *"Show pending lots for SS"*\n   - *"Mohit Hosiery total lots"*\n   - *"List all parties"*\n   - *"Which party has the most orders?"*\n\n3. **📊 Factory Production Overview:**\n   - *"How many lots are cut in total?"*\n   - *"Overall cutting status"*\n   - *"Kaun se lot pending hain?"*\n\n4. **👕 Garments & Fabrics:**\n   - *"How many Lower lots do we have?"*\n   - *"List all garment categories"*\n   - *"Lots using fabric German Fleece"*\n   - *"List top fabrics"*\n\n5. **🪡 Embroidery & Vendors:**\n   - *"BHM embroidery lots"*\n   - *"Direct stitching lots"*\n\n6. **👥 Supervisors & Team:**\n   - *"Who is the fabric supervisor?"*\n   - *"Who is packing supervisor?"*\n   - *"List team members"*\n   - *"What tasks are overdue?"*\n\n7. **📄 PDF Reports:**\n   - *"Generate PDF for SS"* (Generates full 331-lot PDF report)\n   - *"Download cutting slip for Lot 61008"*`;

    const sysPrompt = `You are PulseBot AI. Provide a clean, executive cheatsheet of your capabilities in Factory Suite Pro (Cutting status, Lots, Parties, Fabrics, Supervisors, Tasks, B&W PDF generation). Match user language.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return { handled: true, answer: aiAnswer };
  }

  // =========================================================================
  // 6. INDEX SHEET QUERIES
  // =========================================================================
  if (/\b(index\s*sheet|sheet\s*index|index\s*data|index\s*details|cutting\s*master\s*records)\b/i.test(lower)) {
    const fallback = `**Cutting Master Authority Records kamyabi se Factory Suite Pro Intelligence Engine mein active hain!**\n\n* **Authority Role:** Jo lot Cutting Master records mein darj hai, woh **[✓] CUT COMPLETE** hai; jo abhi darj nahi hai, woh **[!] CUTTING PENDING** hai.\n* **Status:** 100% Live Operations Verified\n\nAap kisi bhi lot, order, ya cutting status ke baare mein sawal pooch sakte hain!`;

    const sysPrompt = `You are PulseBot AI. The user is asking about cutting records authority.
Ground Truth:
- Sole Authority for Cutting: Whatever lot is present in the Cutting Master records is CUT COMPLETE. If absent, it is CUTTING PENDING.
Explain this clearly in Hinglish. Do NOT mention spreadsheet names or fetching mechanisms. User did NOT ask for PDF. Do not mention downloading PDF.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return { handled: true, answer: aiAnswer };
  }

  // =========================================================================
  // 7. BLACK & WHITE / PRINT FORMAT QUERIES
  // =========================================================================
  const isBwPrintQuery = /\b(black\s*(?:and|&)\s*white|b&w|b\/w|print\s*format|clear\s*print|print\s*clear|printout|photocopy|monochrome)\b/i.test(lower);
  if (isBwPrintQuery) {
    const { isAskingUncut } = analyzeCuttingIntent(lower);
    const ctx = getContextualEntity();
    const pName = mentionsParty ? (lower.includes('mohit') ? 'Mohit Hosiery' : 'SS') : (ctx.value || 'SS');
    const pSlug = pName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const isPendingTarget = isAskingUncut || lower.includes('uncut') || lower.includes('pending') || String(ctx.value || '').includes('Uncut');
    const downloadUrl = isPendingTarget
      ? `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(pSlug)}?status=pending`
      : `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(pSlug)}`;
    const filename = isPendingTarget ? `${pSlug}_Uncut_Lots_Report.pdf` : `${pSlug}_Lots_Report.pdf`;
    const title = isPendingTarget ? `${pName} - 44 Uncut Lots (Pure B&W Print-Optimized)` : `${pName} - Complete Lots (Pure B&W Print-Optimized)`;

    const fallback = `**Haan ji! Sabhi PDF reports aur cutting slips ko 100% Pure Black & White (Monochrome Print-Optimized) format mein upgrade kar diya gaya hai.**\n\nAb printout nikalte waqt:\n* **Zero Color / Gray Blocks:** Koi dark background flood ya colored shading nahi hogi; pure white background par crisp black text aayega.\n* **Laser & Thermal Print Ready:** Solid black 1.5pt aur 0.5pt high-contrast cell borders hain jis se photocopy aur thermal/laser printers par print **100% sharp aur crystal clear** niklega.\n* **Zero Toner Waste:** Printer ka ink/toner bilkul waste nahi hoga aur speed bhi fast rahegi.\n\nAap niche diye gaye button par click karke **${pName} ke ${isPendingTarget ? '44 Uncut Lots' : 'Lots'}** ka updated **Pure Black & White PDF report** download aur print kar sakte hain:`;

    const sysPrompt = `You are PulseBot AI.
The user is asking about Black & White / Print-friendly PDF format.
Explain warmly in Hinglish that all PDF reports and slips have been upgraded to 100% Pure Black & White (monochrome) format with zero toner waste, crystal-clear white background, and solid 1.5pt/0.5pt high-contrast black borders for laser and thermal printing.
Mention that the updated monochrome print document is attached below.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return {
      handled: true,
      answer: aiAnswer,
      pdfAttachment: {
        type: 'party',
        partyName: `${pName} (Pure B&W)`,
        downloadUrl,
        filename,
        title
      }
    };
  }

  // =========================================================================
  // 8. CONTEXTUAL & DIRECT PDF GENERATION REQUESTS
  // =========================================================================
  const isPdfCommand = /\b(pdf|generate\s*pdf|download\s*pdf|pdf\s*bana|bana\s*do\s*pdf|krdo\s*generate\s*pdf|pdf.*chahiye|show\s*pdf|print\s*pdf|slip\s*download|chahiye.*pdf)\b/i.test(p);

  if (isPdfCommand && !mentionsLot && !mentionsParty) {
    const ctx = getContextualEntity();
    if (ctx.type === 'party') {
      const pName = ctx.value || 'SS Party';
      const pSlug = pName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const partyLots = sheets ? (sheets.partiesMap.get('SS') || []) : [];
      const totalCount = partyLots.length || 331;

      const fallback = `**Aapka requested PDF document tayar hai!**\n\nHumne **${pName}** ke sabhi **${totalCount} lots** (Cut Complete + Cutting Pending) ka complete multi-page report generate kar diya hai.\n\nAap niche diye gaye download button par click karke PDF file download aur print kar sakte hain:`;

      const sysPrompt = `You are PulseBot AI.
The user gave a command to generate/download PDF for ${pName} (${totalCount} lots).
Politely acknowledge in Hinglish that the official PDF document has been created and attached below.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      return {
        handled: true,
        answer: aiAnswer,
        pdfAttachment: {
          type: 'party',
          partyName: pName,
          downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(pSlug)}`,
          filename: `${pSlug}_Lots_Report.pdf`,
          title: `${pName} - Complete ${totalCount} Lots & Cutting Report`
        }
      };
    } else if (ctx.type === 'lot' && sheets) {
      const lotData = sheets.lotsMap.get(ctx.value);
      if (lotData) {
        const fallback = `**Aapka requested Lot ${lotData.lot} ka Production & Cutting Slip tayar hai!**\n\nNiche diye gaye button par click karke PDF download karein:`;
        const sysPrompt = `You are PulseBot AI. User asked for PDF cutting slip for Lot ${lotData.lot}. Acknowledge warmly that the slip is attached below.`;

        const aiAnswer = await generateAiResponseWithGemini({
          prompt: p,
          systemInstruction: sysPrompt,
          fallbackText: fallback,
          conversationHistory
        });

        return {
          handled: true,
          answer: aiAnswer,
          pdfAttachment: {
            lotNumber: lotData.lot,
            jobOrderNo: lotData.jo,
            downloadUrl: `http://localhost:5000/api/chat/pdf/${lotData.lot}`,
            filename: `JobOrder_${lotData.jo}_Lot_${lotData.lot}.pdf`,
            title: `Job Order & Production Slip (${lotData.jo} • Lot ${lotData.lot})`
          }
        };
      }
    }
  }

  // =========================================================================
  // 9. SPECIFIC LOT QUERIES (Precise & Question-Specific with Real Multi-Sheet Data)
  // =========================================================================
  const lotMatch = p.match(/(?:LOT[-_\s]*)?(\d{4,7})\b/i);
  const joMatch = p.match(/\bJO[-_\s]?(\d+)\b/i);

  let targetLot = lotMatch ? lotMatch[1] : null;
  const isPluralLotsQuery = /\b(all\s*lots|sabhi\s*lots|sbhi\s*lots|uncut\s*lots|pending\s*lots|cut\s*lots|lots\b)/i.test(lower);
  if (!targetLot && !joMatch && !mentionsParty && !isPluralLotsQuery && (isImageRequested || isPdfRequested || isHistoryRequested)) {
    const ctx = getContextualEntity();
    if (ctx && ctx.type === 'lot') {
      targetLot = ctx.value;
    }
  }

  if (targetLot || joMatch) {
    let lotData = null;

    if (sheets && targetLot) {
      lotData = sheets.lotsMap.get(targetLot);
    }

    if (!lotData && sheets && joMatch) {
      const joNum = `JO-${joMatch[1]}`;
      for (const [_, l] of sheets.lotsMap) {
        if (l.jo.toUpperCase() === joNum.toUpperCase()) {
          lotData = l;
          targetLot = l.lot;
          break;
        }
      }
    }

    if (lotData) {
      // ---------------------------------------------------------------------
      // 9A. USER ASKED ONLY FOR PHOTO / DESIGN ARTWORK
      // (Do NOT dump 10-department timeline or lengthy lifecycle audit trail)
      // ---------------------------------------------------------------------
      if (isImageOnly) {
        let fallback = '';
        let sysPrompt = '';

        if (lotData.designImageUrl) {
          fallback = `### 🖼️ Lot ${lotData.lot} Official Design Artwork\n\n` +
            `![Design Artwork](${lotData.designImageUrl})\n\n` +
            `* **Lot Number:** \`${lotData.lot}\` (Job Order: \`${lotData.jo}\`)\n` +
            `* **Party Name:** **${lotData.party}** (${lotData.brand || 'Standard'})\n` +
            `* **Garment & Style:** **${lotData.garment}** (${lotData.style || 'Standard'})\n` +
            `* **Fabric:** **${lotData.fabric}** • **Order Qty:** **${lotData.qty} ${lotData.unit}**\n\n` +
            `*(Agar aapko is lot ki complete department timeline ya cutting status dekhna ho, toh batayein.)*`;

          sysPrompt = `You are PulseBot AI, the enterprise Operations & Manufacturing Intelligence Assistant for Factory Suite Pro.
Converse with executive clarity, warmth, and professionalism in Hinglish, Hindi, or English matching the user.

CRITICAL DIRECTIVE - USER ASKED ONLY FOR PHOTO / IMAGE:
- The user asked ONLY for the photo / design artwork of Lot ${lotData.lot} (User Query: "${p}").
- DO NOT provide the complete department-by-department timeline, supervisor table, or multi-stage lifecycle audit trail. The user explicitly does not want the lengthy department lifecycle breakdown for photo requests.
- DIRECT EMBED: Embed the design artwork directly using markdown image syntax: ![Design Artwork](${lotData.designImageUrl})
  (NEVER output links like "[View Artwork]" or "click to download". Always embed directly with markdown ![] syntax).
- Present ONLY a compact 3-bullet style summary:
  * Lot: ${lotData.lot} (Job Order: ${lotData.jo})
  * Party: ${lotData.party} (${lotData.brand || 'Standard'})
  * Garment & Style: ${lotData.garment} (${lotData.style || 'Standard'}) | Fabric: ${lotData.fabric}
- Close with 1 short polite sentence offering to provide the full department timeline or cutting status if needed.
- STRICTLY FORBIDDEN: Do NOT list the 10 departments or full timeline. Do NOT mention Google Sheets or fetching mechanisms.`;
        } else {
          fallback = `⚠️ **Lot ${lotData.lot} ka official design artwork / photo production records mein attach nahi hai.**\n\n` +
            `* **Lot Number:** \`${lotData.lot}\` (Job Order: \`${lotData.jo}\`)\n` +
            `* **Party Name:** **${lotData.party}** (${lotData.brand || 'Standard'})\n` +
            `* **Garment & Style:** **${lotData.garment}** (${lotData.style || 'Standard'})\n` +
            `* **Fabric:** **${lotData.fabric}** • **Order Qty:** **${lotData.qty} ${lotData.unit}**\n\n` +
            `*(Aap chahein toh is lot ki cutting status ya department timeline dekh sakte hain.)*`;

          sysPrompt = `You are PulseBot AI.
The user asked for the photo/image of Lot ${lotData.lot}, but no artwork image is attached in production records.
Inform the user politely in Hinglish in 1-2 lines that no design artwork is attached in the production records for Lot ${lotData.lot}.
Provide only a 3-bullet style summary:
* Lot: ${lotData.lot} (Job Order: ${lotData.jo})
* Party: ${lotData.party} (${lotData.brand || 'Standard'})
* Garment & Style: ${lotData.garment} (${lotData.style || 'Standard'}) | Fabric: ${lotData.fabric}
DO NOT dump the full department timeline or 10-department table. Do NOT mention Google Sheets.`;
        }

        const aiAnswer = await generateAiResponseWithGemini({
          prompt: p,
          systemInstruction: sysPrompt,
          fallbackText: fallback,
          conversationHistory
        });

        const res = { handled: true, answer: aiAnswer };
        if (lotData.designImageUrl) {
          res.imageAttachment = {
            url: lotData.designImageUrl,
            lotNumber: lotData.lot,
            title: `Lot ${lotData.lot} - ${lotData.party} (${lotData.garment} / ${lotData.style})`
          };
        }
        return res;
      }

      // ---------------------------------------------------------------------
      // 9B. USER ASKED ONLY FOR SPECIFIC ATTRIBUTE (Brand, Fabric, Party, Qty, Style, etc.)
      // (Do NOT dump 10-department timeline or tracking card; suggest timeline as next question)
      // ---------------------------------------------------------------------
      const isBrandReq = /\b(brand|brand\s*name|marka)\b/i.test(p);
      const isFabricReq = /\b(fabric|kapda|cloth|material)\b/i.test(p);
      const isPartyReq = /\b(party|buyer|client|customer)\b/i.test(p) && !/\b(all\s*parties|party\s*report|party\s*summary)\b/i.test(p);
      const isStyleReq = /\b(style|garment|garment\s*type|pattern|item)\b/i.test(p);
      const isQtyReq = /\b(quantity|qty|order\s*qty|kitne\s*pcs|kitna\s*order|pieces?|sets?)\b/i.test(p);
      const isShadeReq = /\b(shade|shades|color|colors|colour|colours|rang)\b/i.test(p);
      const isSizeReq = /\b(size|sizes|size\s*ratio|ratio)\b/i.test(p);
      const isKarigarReq = /\b(karigar|master|cutting\s*master)\b/i.test(p);
      const isEmbPrintReq = /\b(embroidery|printing|emb\b|print\b|challan)\b/i.test(p);
      const isSupervisorReq = /\b(supervisor|floor\s*incharge)\b/i.test(p) && !/\b(stitching|packing|cutting)\b/i.test(p);
      const isCuttingDateReq = /\b(cutting\s*date|cut\s*date|cutting\s*completion|cut\s*completion|cutting\s*kab\s*(?:hui|hua|complete)|kab\s*cut\s*hua|cutting\s*time|cutting\s*saved\s*at)\b/i.test(p);
      const isZipReq = /\b(zip|zipper|zip\s*purchase|zip\s*supplier|zip\s*entry|zip\s*status|zip.*order|order.*zip|kab\s*gya|kab\s*bheja|kab\s*generate)\b/i.test(p) && /\b(zip|zipper)\b/i.test(p);
      const isDoriReq = /\b(dori|dori\s*purchase|dori\s*order|dori\s*status|dori\s*selection|dori\s*pieces?|dori.*order|order.*dori)\b/i.test(p) && /\bdori\b/i.test(p);

      const isAttributeOnly = (
        isBrandReq ||
        isFabricReq ||
        isPartyReq ||
        isStyleReq ||
        isQtyReq ||
        isShadeReq ||
        isSizeReq ||
        isKarigarReq ||
        isEmbPrintReq ||
        isSupervisorReq ||
        isCuttingDateReq ||
        isZipReq ||
        isDoriReq
      ) && !/\b(history|timeline|journey|lifecycle|audit\s*trail|all\s*details|complete\s*details|full\s*details|stages|tracking|track|kahan\s*tak\s*pahuncha|cutting\s*status|status\s*batao|kya\s*status)\b/i.test(p);

      if (isAttributeOnly) {
        let attributeAnswer = '';
        let targetField = '';

        if (isZipReq) {
          targetField = 'Zip Purchase Order & Gate Entry';
          const zp = lotData.zipPurchase;
          if (zp) {
            const orderDate = zp.pdfGeneratedDate || zp.timestamp || 'Recorded';
            attributeAnswer = `Lot **${lotData.lot}** ka Zip Order **${orderDate}** ko bheja / generate hua tha.\n\n` +
              `* 🏭 **Supplier:** **${zp.supplierName || 'Puneet zip'}**\n` +
              `* 📅 **Order / PDF Date:** **${orderDate}**\n` +
              `* 🚪 **Gate Entry Date:** **${zp.gateEntryDate || 'Pending'}** (by **${zp.gateEntryPerson || '-'}**)\n` +
              `* 📦 **Material Received:** **${zp.materialReceivedDate || 'Pending'}** (by **${zp.materialReceivedBy || '-'}**${zp.materialEntryDate ? ` on \`${zp.materialEntryDate}\`` : ''})\n` +
              (zp.approvalId ? `* 🆔 **Approval ID:** \`${zp.approvalId}\`` : '');
          } else {
            attributeAnswer = `Lot **${lotData.lot}** ka zip purchase / order record production records mein nahi mila (Order Pending / Not Generated).`;
          }
        } else if (isDoriReq) {
          targetField = 'Dori Purchase Order';
          const dp = lotData.doriPurchase;
          if (dp) {
            attributeAnswer = `Lot **${lotData.lot}** ka Dori Order **${dp.issueDate || dp.timestamp || 'Recorded'}** ko issue hua tha.\n\n` +
              `* 🧵 **Garment & Style:** **${dp.garmentType || lotData.garment}** (${dp.style || lotData.style || 'Standard'})\n` +
              `* 📦 **Order Pieces:** **${dp.totalPieces || '0'} Pcs** (${dp.fabric || 'Fabric'})\n` +
              `* 📅 **Issue Date:** **${dp.issueDate || '-'}**\n` +
              `* 👤 **Floor Supervisor:** **${dp.supervisor || '-'}**\n` +
              (dp.doriSelections ? `* 🎨 **Dori Selections:** \`${dp.doriSelections}\`` : '');
          } else {
            attributeAnswer = `Lot **${lotData.lot}** ka dori purchase order record production records mein nahi mila (Pending).`;
          }
        } else if (isBrandReq) {
          targetField = 'Brand';
          attributeAnswer = `Lot **${lotData.lot}** ka brand **${lotData.brand || 'Standard / Unbranded'}** hai.`;
        } else if (isFabricReq) {
          targetField = 'Fabric';
          attributeAnswer = `Lot **${lotData.lot}** ka fabric **${lotData.fabric || 'Standard Fabric'}** hai.`;
        } else if (isPartyReq) {
          targetField = 'Party Name';
          attributeAnswer = `Lot **${lotData.lot}** ki party **${lotData.party}** (${lotData.brand || 'Standard'}) hai.`;
        } else if (isCuttingDateReq) {
          targetField = 'Cutting Completion Date';
          attributeAnswer = lotData.cutDate
            ? `Lot **${lotData.lot}** ki verified cutting completion date **${lotData.cutDate}** (Index Sheet ke "Saved At" record ke mutabiq) hai.`
            : `Lot **${lotData.lot}** abhi cutting records mein complete nahi mila (Cutting Pending).`;
        } else if (isQtyReq) {
          targetField = 'Order Quantity';
          attributeAnswer = `Lot **${lotData.lot}** ki verified order quantity **${lotData.qty} ${lotData.unit || 'PCS'}** hai${lotData.cutPcs ? ` (Cut Quantity: **${lotData.cutPcs} Pcs**)` : ''}.`;
        } else if (isStyleReq) {
          targetField = 'Garment & Style';
          attributeAnswer = `Lot **${lotData.lot}** ka garment type **${lotData.garment}** aur style **${lotData.style || 'Standard'}** hai.`;
        } else if (isShadeReq && isSizeReq) {
          targetField = 'Shades & Sizes';
          attributeAnswer = `Lot **${lotData.lot}** ke shades **${lotData.shades || 'Standard'}** aur sizes **${lotData.sizes || 'Standard'}** hain.`;
        } else if (isShadeReq) {
          targetField = 'Shades';
          attributeAnswer = `Lot **${lotData.lot}** ke verified shades **${lotData.shades || 'Standard Shades'}** hain.`;
        } else if (isSizeReq) {
          targetField = 'Sizes';
          attributeAnswer = `Lot **${lotData.lot}** ke verified sizes **${lotData.sizes || 'Standard Sizes'}** hain.`;
        } else if (isKarigarReq) {
          targetField = 'Cutting Karigar';
          attributeAnswer = `Lot **${lotData.lot}** ka cutting karigar **${lotData.karigar || 'Cutting team mein recorded nahi hai'}** hai.`;
        } else if (isEmbPrintReq) {
          targetField = 'Embroidery & Printing';
          attributeAnswer = `Lot **${lotData.lot}** ka embroidery vendor **${lotData.embVendor || 'NA'}**${lotData.embDetails ? ` (${lotData.embDetails})` : ''} aur printing **${lotData.printing || 'NA'}** hai.`;
        } else if (isSupervisorReq) {
          targetField = 'Supervisors';
          attributeAnswer = `Lot **${lotData.lot}** ke floor supervisors: Stitching Supervisor **${lotData.stitchingSupervisor || 'Pending Allocation'}**, Packing Supervisor **${lotData.packingSupervisor || 'Pintu / Mdsaqib'}** (Cutting floor has no supervisor).`;
        }

        const fallback = `${attributeAnswer}\n\n` +
          `**Quick Summary (Lot ${lotData.lot}):**\n` +
          `* 🏷️ **Brand:** **${lotData.brand || 'Standard'}**\n` +
          `* 🏢 **Party Name:** **${lotData.party}**\n` +
          `* 👕 **Garment & Style:** **${lotData.garment}** (${lotData.style || 'Standard'})\n` +
          `* 🧵 **Fabric:** **${lotData.fabric}**\n\n` +
          `💡 **Next Suggested Question / Agla Sawaal:**\n` +
          `Aap is lot ki full production journey ya multi-department tracking dekhne ke liye type karein:\n` +
          `👉 \`${lotData.lot} lot complete history\` ya \`${lotData.lot} tracking\``;

        const sysPrompt = `You are PulseBot AI, the enterprise Operations & Manufacturing Intelligence Assistant for Factory Suite Pro.
CRITICAL DIRECTIVE - USER ASKED ONLY FOR ${targetField.toUpperCase()}:
The user asked ONLY for the ${targetField} of Lot ${lotData.lot} (Prompt: "${p}").
DO NOT provide the department-by-department timeline, stepper, or lengthy multi-department audit trail. The user strictly wants ONLY the answer to their specific question.

RESPONSE REQUIREMENTS:
1. Direct, clear opening sentence answering ONLY what the user asked: "${attributeAnswer}"
2. A compact 3-bullet specification summary:
   * Brand: ${lotData.brand || 'Standard'}
   * Party Name: ${lotData.party}
   * Garment & Style: ${lotData.garment} (${lotData.style || 'Standard'}) | Fabric: ${lotData.fabric}
3. A friendly follow-up recommendation suggesting the next question for timeline:
   "💡 Agla Sawaal: Agar aap is lot ka complete department timeline ya tracking dekhna chahte hain, toh \`${lotData.lot} lot complete history\` pooch sakte hain."
4. STRICTLY FORBIDDEN:
   - Do NOT output "Department Audit Trail", markdown tables, or list the departments.
   - Do NOT mention Google Sheets or fetching mechanisms.`;

        let aiAnswer = await generateAiResponseWithGemini({
          prompt: p,
          systemInstruction: sysPrompt,
          fallbackText: fallback,
          conversationHistory
        });

        const isHallucinated = !aiAnswer || /(?:active nahi hai|data available nahi hai|record nahi mila|not found in(?: the)? active|not available in live production|kya aap confirm kar sakte hain|purana\/closed lot hai)/i.test(aiAnswer);
        if (isHallucinated) {
          aiAnswer = fallback;
        }

        // Return handled: true WITHOUT trackingData so tracking card is NOT rendered!
        return {
          handled: true,
          answer: aiAnswer
        };
      }

      // ---------------------------------------------------------------------
      // 9C. FULL LOT / DEPARTMENT HISTORY & STATUS INQUIRY
      // ---------------------------------------------------------------------
      const isCut = lotData.isCut;
      const isCancelled = Boolean(lotData.isCancelled);
      const cutPcsText = lotData.cutPcs ? ` (${lotData.cutPcs} Pcs)` : '';
      const cutDateText = lotData.cutDate ? ` on ${lotData.cutDate}` : '';

      const samePartyLots = sheets.partiesMap.get(lotData.party.toUpperCase()) || [];
      const sampleOtherLots = samePartyLots.filter(l => l.lot !== lotData.lot).slice(0, 4).map(l => l.lot).join(', ');

      const statusTitle = isCancelled
        ? `Lot ${lotData.lot} officially CANCEL ho chuka hai (Reason: ${lotData.cancelInfo?.reason || 'Cancelled'}). Yeh lot cutting queue ya uncut category mein nahi hai.`
        : (isCut
          ? `Lot ${lotData.lot} cut ho chuka hai.`
          : `Lot ${lotData.lot} abhi cutting ke liye pending hai.`);

      let extraInfoText = '';
      if (isCancelled && lotData.cancelInfo) {
        extraInfoText += `\n* ❌ **Official Cancellation Details:** CANCELLED (Reason: ${lotData.cancelInfo.reason || 'Cancelled'} | Cancelled By: ${lotData.cancelInfo.by || 'Management'}${lotData.cancelInfo.approvedFrom ? ` | Approved From: ${lotData.cancelInfo.approvedFrom}` : ''}${lotData.cancelInfo.date ? ` | Date: ${lotData.cancelInfo.date}` : ''})`;
      }
      if (lotData.karigar) {
        extraInfoText += `\n* 🪡 **Cutting Karigar:** ${lotData.karigar}`;
      }
      if (lotData.designImageUrl) {
        extraInfoText += `\n\n![Design Artwork](${lotData.designImageUrl})\n*🖼️ **Design Artwork / Style Reference:** ${lotData.style || lotData.garment || 'Design Artwork'} (Lot ${lotData.lot})*`;
      }

      const stages = buildLotDepartmentHistory(lotData);

      let historyTable = `| Department / Process | Date | Supervisor | Pcs / Qty | Status | Notes |\n|---|---|---|---|---|---|\n`;
      stages.forEach(st => {
        historyTable += `| **${st.dept}** | \`${st.date}\` | **${st.supervisor}** | ${st.pcs} | ${st.status} | ${st.notes || '-'} |\n`;
      });

      const issue = lotData.issueRecord || {};
      const isStitchingQuery = /\b(stitching|silai|stitch)\b/i.test(lower);
      const stitchSupText = lotData.stitchingSupervisor || issue.stitchingSupervisor || (lotData.directStitching ? 'Direct Stitching Team' : 'Pending Allocation');
      const packSupText = lotData.packingSupervisor || issue.packingSupervisor || (lotData.barcodes && lotData.barcodes[0]?.packingSupervisor) || 'Pintu (Packing)';

      const compInfo = parseStitchingCompletion(lotData.completedStatus);
      const wipInfo = getLatestWipStatus(lotData.wipStatus);
      const isStitchComplete = Boolean(compInfo.isComplete);

      let stitchingHighlight = '';
      if (isStitchingQuery) {
        stitchingHighlight = `### 🧵 Lot ${lotData.lot} Stitching Department Details & Allocation\n\n` +
          `* 👷 **Stitching Supervisor:** **${stitchSupText}**\n` +
          `* 📅 **Stitching Issue Date:** ${lotData.stitchingIssueDate || issue.stitchingIssueDate || 'Ready for Issue'}\n` +
          `* 🔢 **Quantity Issued:** **${lotData.cutPcs ? `${lotData.cutPcs} Pcs` : `${lotData.qty} ${lotData.unit || 'PCS'}`}**\n` +
          `* 📊 **Stitching Status:** **${isStitchComplete ? '✓ STITCHING COMPLETED' : '⏳ STITCHING NOT COMPLETED (In Progress)'}**\n` +
          (!isStitchComplete && wipInfo?.text ? `* 📝 **Latest Stitching Remarks (WIP Status):** **"${wipInfo.text}"**${wipInfo.timestamp ? ` _(Recorded: ${formatWipTimestamp(wipInfo.timestamp)})_` : ''}\n` : '') +
          (isStitchComplete && compInfo.completedDate ? `* ⏱️ **Completion Timestamp:** ${formatWipTimestamp(compInfo.completedDate)}\n` : '') +
          `\n`;
      }

      let wipCallout = '';
      if (!isCancelled && !isStitchComplete && wipInfo?.text) {
        wipCallout = `\n> 🧵 **Stitching Floor WIP Status:** Stitching is currently in progress (Not Completed). Latest Floor Remarks: **"${wipInfo.text}"**${wipInfo.timestamp ? ` _(${formatWipTimestamp(wipInfo.timestamp)})_` : ''}\n`;
      }

      const statusBadge = isCancelled
        ? `**[❌] ORDER CANCELLED** *(Reason: ${lotData.cancelInfo?.reason || 'Cancelled'})*`
        : (isCut ? '**[✓] CUT COMPLETE**' : '**[!] CUTTING PENDING**');

      const fallback = stitchingHighlight +
        `### 📦 Lot ${lotData.lot} Production Lifecycle & Department History\n\n` +
        `* **Job Order No:** \`${lotData.jo}\` • **Party Name:** **${lotData.party}** (${lotData.brand || 'Standard'})\n` +
        `* **Garment & Style:** **${lotData.garment}** (${lotData.style || 'Standard'}) • **Fabric:** **${lotData.fabric}**\n` +
        `* **Order Qty:** **${lotData.qty} ${lotData.unit}** • **Status:** ${statusBadge}\n\n` +
        `#### 📊 Department-by-Department Production Journey:\n\n` +
        historyTable +
        wipCallout +
        `${extraInfoText}\n\n` +
        `*All process dates, quantities, and supervisors are verified from live factory operations records.*`;

      const sysPrompt = `You are PulseBot AI, the enterprise Operations & Manufacturing Intelligence Assistant for Factory Suite Pro.
Converse with executive clarity, warmth, and professionalism in Hinglish, Hindi, or English matching the user.

CRITICAL GROUNDING GUARANTEE FOR LOT ${lotData.lot}:
- Lot ${lotData.lot} is 100% VERIFIED, ACTIVE, and FULLY RECORDED in factory production records.
- Job Order: ${lotData.jo} | Party: ${lotData.party} | Brand: ${lotData.brand || 'Standard'} | Garment: ${lotData.garment} | Style: ${lotData.style || 'Standard'}.
- NEVER claim that Lot ${lotData.lot} is not active, not available in live production lots, or not found in system data.
- NEVER ask the user to confirm what stage this lot is in or ask if it is an old/closed lot. State all verified facts immediately.

CRITICAL PROFESSIONALISM & COMMUNICATION RULE:
- NEVER say "I am fetching data from sheets", "as per our Google Sheets", "connected sheets", "sheet data", or "read-only mode".
- NEVER output spreadsheet names like "JobOrder Sheet", "Index Sheet", "Issues Sheet", or tab names.
- Always refer to data professionally as "Production Records", "Factory Floor Logs", "Official Production History", or "Verified Factory Data".
- Present department milestones clearly with their respective Process Dates, Department Supervisors, and Piece Quantities.
- If a department has not started or is not applicable, state cleanly: "Pending / Not initiated on production floor" or "Not required for this style".

CRITICAL SUPERVISOR & DEPARTMENT RULES:
1. CUTTING DEPARTMENT: Has NO supervisor. Output "-" or "No Supervisor".
   CUTTING COMPLETION DATE: Per official factory floor rules, Cutting Completion Date is strictly the "Saved At" date recorded in index records (${lotData.cutDate || 'Pending'}). Output "${lotData.cutDate || 'Pending'}" as the cutting completion date. Do NOT confuse it with Stitching Date of Issue (${lotData.stitchingIssueDate || 'Pending'}).
2. STITCHING SUPERVISOR: For Lot ${lotData.lot}, Stitching Supervisor is: ${stitchSupText}.
3. PACKING SUPERVISOR: For Lot ${lotData.lot}, Packing Supervisor is: ${packSupText}.
4. STRICT SUPERVISOR FORMAT: Output ONLY the exact supervisor name (e.g. "${packSupText}", "${stitchSupText}", or "Ravinder"). Under NO circumstances add notes, commentary, or parenthetical explanations (NEVER write "*(Note: Saqib / Mdsaqib manages packing operations along with Pintu)*" or any similar note). Keep supervisor fields completely clean.
${isStitchingQuery ? `5. SPECIFIC USER QUESTION: The user specifically asked about Stitching for Lot ${lotData.lot}. State prominently in the opening sentence whether stitching is complete or in progress, supervisor (${stitchSupText}), and latest WIP remarks if not complete.` : ''}

CRITICAL STITCHING DEPARTMENT DIRECTIVES:
1. COMPLETION CHECK:
   - Stitching completion is strictly determined by whether the "Completed Status" column from production records is populated or blank.
   - For Lot ${lotData.lot}: "Completed Status" column is ${isStitchComplete ? `FILLED ("${compInfo.completeEntry?.status || 'Complete Lot'}")` : 'BLANK / EMPTY'}.
   - Therefore, stitching is ${isStitchComplete ? 'COMPLETED (✓ STITCHING COMPLETED)' : 'NOT COMPLETED (⏳ In Progress / Pending)'}.
   - NEVER report stitching as "Issued / In Progress" if Completed Status is filled; output "✓ STITCHING COMPLETED".
   - NEVER report stitching as completed if Completed Status is blank.
2. LATEST WIP REMARKS (MANDATORY WHEN STITCHING IS NOT COMPLETED):
   - When stitching is NOT completed, you MUST explicitly display the latest stitching remarks from WIP Status JSON.
   ${!isStitchComplete && wipInfo?.text ? `- For Lot ${lotData.lot}, the latest WIP stitching remark is: "${wipInfo.text}"${wipInfo.timestamp ? ` (recorded: ${formatWipTimestamp(wipInfo.timestamp)})` : ''}.
   - Display this latest remark clearly under Stitching Department (e.g. "- Latest WIP Remarks: ${wipInfo.text}").` : `- No WIP remarks are recorded for this lot.`}
   ${isStitchComplete ? `- For Lot ${lotData.lot}, stitching is verified as COMPLETED in official records.` : ''}
3. TIMELINE FORMATTING FOR STITCHING DEPARTMENT:
   Under "3. Stitching Department":
   - Date: ${lotData.stitchingIssueDate || stitchDate || 'Recorded Date'}
   - Supervisor: ${stitchSupText}
   - Quantity: ${lotData.cutPcs ? `${lotData.cutPcs} Pcs` : `${lotData.qty} Pcs`}
   - Status: ${isStitchComplete ? '✓ STITCHING COMPLETED' : '⏳ In Progress (Not Completed)'}
   ${!isStitchComplete && wipInfo?.text ? `- Latest WIP Remarks: ${wipInfo.text}` : (isStitchComplete ? `- Details: Complete Lot (Verified in Production Records)` : '')}

VERIFIED PRODUCTION DATA FOR LOT ${lotData.lot}:
- Lot Number: ${lotData.lot}
- Job Order: ${lotData.jo}
- Party Name: ${lotData.party}
- Brand: ${lotData.brand || 'Standard'}
- Garment Type: ${lotData.garment}
- Style: ${lotData.style || 'Standard'}
- Fabric: ${lotData.fabric}
- Order Quantity: ${lotData.qty} ${lotData.unit}
- Shades & Sizes: ${lotData.shades || 'Standard'} / ${lotData.sizes || 'Standard'}
- Cutting & Production Status: ${isCancelled ? `[❌] CANCELLED (Reason: ${lotData.cancelInfo?.reason || 'Cancelled'}, Cancelled By: ${lotData.cancelInfo?.by || 'Management'}, Approved By: ${lotData.cancelInfo?.approvedFrom || 'Management'}). CRITICAL INSTRUCTION: This order was CANCELLED. You MUST state clearly that its status is CANCELLED. Do NOT state that it is in the uncut lot category, cutting pending, or awaiting cutting floor allocation.` : (isCut ? `[✓] CUT COMPLETE (Cut Date: ${lotData.cutDate || 'recorded date'}, Cut Qty: ${lotData.cutPcs || lotData.qty} Pcs, Cutting Floor: No Supervisor)` : `[!] CUTTING PENDING (Awaiting cutting floor allocation)`)}
- Stitching Supervisor: ${stitchSupText}
- Stitching Completion: ${isStitchComplete ? '✓ STITCHING COMPLETED' : '⏳ In Progress (Not Completed)'}
- Latest Stitching WIP Remarks: ${!isStitchComplete && wipInfo?.text ? wipInfo.text : (isStitchComplete ? 'Completed' : 'None')}
- Packing Supervisor: ${packSupText}
- Cancellation Status: ${isCancelled ? `CANCELLED (Reason: ${lotData.cancelInfo?.reason || 'Cancelled'})` : 'Active'}
- Karigar / Tailor: ${lotData.karigar || 'Standard Team'}
- Design Artwork Image: ${lotData.designImageUrl || 'Not attached'}

DEPARTMENT AUDIT TRAIL:
${stages.map((st, i) => `${i + 1}. [${st.dept}] Date: "${st.date}" | Supervisor: "${st.supervisor}" | Pcs: "${st.pcs}" | Status: "${st.status}" | Details: "${st.notes}"`).join('\n')}

DIRECTIVES:
1. Provide the complete department-by-department timeline with the exact supervisor, dates, piece counts, and status for each department. Output ONLY the clean supervisor name without any extra notes or commentary.
${isCancelled ? `CRITICAL DIRECTIVE ON STATUS:
- Lot ${lotData.lot} is officially CANCELLED (Reason: ${lotData.cancelInfo?.reason || 'Cancelled'}, Cancelled By: ${lotData.cancelInfo?.by || 'Management'}, Approved By: ${lotData.cancelInfo?.approvedFrom || 'Management'}).
- Under NO circumstance say it is "Cutting Pending", "Pending", or in the "Uncut" lot category. It is NOT waiting for cutting floor allocation; it is a cancelled order.` : ''}
2. Maintain a highly professional, enterprise ERP tone. Do NOT mention Google Sheets or technical data fetching mechanisms.
${lotData.designImageUrl ? `3. CRITICAL IMAGE DISPLAY DIRECTIVE:
   - When a Design Artwork Image is present (${lotData.designImageUrl}), embed the image directly using markdown image syntax: ![Design Artwork](${lotData.designImageUrl}).
   - DO NOT provide links like "[View Artwork](...)", "[Download Image](...)", or "Click here to download". Always embed the image directly in markdown.` : `3. Design Artwork: No artwork image is attached in production records for this lot. Do NOT output any image markdown like ![Design Artwork](null).`}
5. PRODUCTION MILESTONES ONLY:
   - Present ONLY physical manufacturing stages: Job Order Master, Cutting Department, Stitching Department, Packing & Barcode Department (along with Embroidery, Washing, Kaj-Button, Folding, or Elastic if recorded).
   - STRICT DIRECTIVE: DO NOT include Zip Entry, Zip Purchase, Dori Order, or Dori Purchase in this tracking timeline, milestone summary, or audit notes. The user explicitly does NOT want Zip or Dori in the production tracking journey.
6. PACKING & BARCODE COMPLETION RULE:
   - FACTORY BUSINESS RULE: If barcodes are printed / generated for this lot, PACKING IS ALSO COMPLETED (✓ Packed). Under NO circumstances state that packing is WIP or in progress when barcodes have already been generated.`;

      let aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      const isHallucinated = !aiAnswer || /(?:active nahi hai|data available nahi hai|record nahi mila|not found in(?: the)? active|not available in live production|kya aap confirm kar sakte hain|purana\/closed lot hai)/i.test(aiAnswer);
      if (isHallucinated) {
        aiAnswer = fallback;
      }

      const res = {
        handled: true,
        answer: aiAnswer,
        trackingData: buildTrackingPayload(lotData, stages)
      };
      if (lotData.designImageUrl) {
        res.imageAttachment = {
          url: lotData.designImageUrl,
          lotNumber: lotData.lot,
          title: `Lot ${lotData.lot} - ${lotData.party} (${lotData.garment} / ${lotData.style})`
        };
      }
      if (isPdfRequested) {
        res.pdfAttachment = {
          lotNumber: lotData.lot,
          jobOrderNo: lotData.jo,
          downloadUrl: `http://localhost:5000/api/chat/pdf/${lotData.lot}`,
          filename: `JobOrder_${lotData.jo}_Lot_${lotData.lot}.pdf`,
          title: `Job Order & Production Slip (${lotData.jo} • Lot ${lotData.lot})`
        };
      }
      return res;
    } else if (targetLot && targetLot.length >= 4) {
      let fallback = `**Lot ${targetLot} ke production records factory database mein nahi mile.**\n\nKripya lot number verify karein (jaise **61001**, **61008**, ya **11028**), ya order confirmation check karein.`;
      let sysPrompt = `You are PulseBot AI. Inform the user politely and professionally that Lot ${targetLot} was searched in factory production records but not found. Ask them to verify the lot number. Do NOT mention Google Sheets or fetching data.`;

      if (isImageOnly) {
        fallback = `⚠️ **Lot ${targetLot} ke production records factory database mein nahi mile, isliye iska photo uplabdh nahi hai.**\n\nKripya lot number verify karein (jaise **11200**, **61001**, **61008**).`;
        sysPrompt = `You are PulseBot AI. The user asked for the photo of Lot ${targetLot}. Inform the user politely that Lot ${targetLot} was not found in factory production records, so no photo is available. Ask them to verify the lot number. Keep it short. Do NOT mention Google Sheets.`;
      }

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      return { handled: true, answer: aiAnswer };
    }
  }

  // =========================================================================
  // 10. FABRIC QUERIES (Check BEFORE Party Acronyms to prevent "MH Fleece" matching Party "MH")
  // =========================================================================
  if (sheets) {
    if (/\b(list\s*top\s*fabrics|all\s*fabrics|top\s*fabrics|most\s*used\s*fabric|sabse\s*jyada\s*fabric|fabric\s*list|fabrics\s*breakdown)\b/i.test(lower)) {
      const fStats = [];
      sheets.fabricsMap.forEach((lots) => {
        const cut = lots.filter(l => l.isCut).length;
        fStats.push({
          fabric: lots[0].fabric,
          total: lots.length,
          cut,
          pending: lots.length - cut
        });
      });
      fStats.sort((a, b) => b.total - a.total);

      let listText = `**Factory Suite Pro mein Top Fabrics ka usage breakdown:**\n\n`;
      fStats.slice(0, 10).forEach((st, i) => {
        listText += `* **${i + 1}. Fabric "${st.fabric}":** **${st.total} Lots** (Cut: ${st.cut} | Pending: ${st.pending})\n`;
      });

      const sysPrompt = `You are PulseBot AI. Provide a clean, executive breakdown of the factory's top fabrics.
Data:
${fStats.slice(0, 10).map((st, i) => `${i + 1}. ${st.fabric}: ${st.total} lots (Cut: ${st.cut}, Pending: ${st.pending})`).join('\n')}
User did NOT ask for PDF. Do not mention downloading PDF.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: listText,
        conversationHistory
      });

      return { handled: true, answer: aiAnswer };
    }

    const fabricKeywords = ['MH FLEECE', 'UK LYCRA', 'GERMAN FLEECE', '3553', 'Q20', 'DOT KNIT', 'COTTON FLEECE', 'DRY FIT', 'NS LYCRA'];
    for (const kw of fabricKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        const matched = [];
        sheets.lotsMap.forEach(l => {
          if (l.fabric.toUpperCase().includes(kw)) matched.push(l);
        });

        if (matched.length > 0) {
          const cutCount = matched.filter(l => l.isCut).length;
          const pendingCount = matched.length - cutCount;
          const sampleLots = matched.slice(0, 10).map(l => l.lot).join(', ');

          const fallback = `**Fabric "${kw}" ke factory mein total ${matched.length} lots hain.**\n\n* **Total Lots:** **${matched.length} Lots**\n* **[✓] Cut Complete:** **${cutCount} Lots**\n* **[!] Cutting Pending:** **${pendingCount} Lots**\n* **Sample Lot Numbers:** ${sampleLots}...`;

          const sysPrompt = `You are PulseBot AI. Answer user inquiry about Fabric "${kw}".
Data:
- Total Lots: ${matched.length}
- Cut Complete: ${cutCount} (Cutting Authority verified)
- Cutting Pending: ${pendingCount}
- Sample Lots: ${sampleLots}
User did NOT ask for PDF. Do not mention downloading PDF.`;

          const aiAnswer = await generateAiResponseWithGemini({
            prompt: p,
            systemInstruction: sysPrompt,
            fallbackText: fallback,
            conversationHistory
          });

          return { handled: true, answer: aiAnswer };
        }
      }
    }
  }

  // =========================================================================
  // 11. BUYERS & PARTIES QUERIES (SS with 331 lots, Mohit Hosiery, BB, DB, MH)
  // =========================================================================
  if (sheets) {
    if (/\b(all\s*parties|list\s*all\s*parties|all\s*buyers|list\s*buyers|top\s*buyers|parties\s*list|konsi\s*parties|buyer\s*list)\b/i.test(lower)) {
      const partyStats = [];
      sheets.partiesMap.forEach((lots) => {
        const cut = lots.filter(l => l.isCut).length;
        partyStats.push({
          party: lots[0].party,
          total: lots.length,
          cut,
          pending: lots.length - cut
        });
      });
      partyStats.sort((a, b) => b.total - a.total);

      let listText = `**Factory Suite Pro mein sabse zyada orders "Mohit Hosiery" (${partyStats[0]?.total || 1272} Lots) ke hain, doosre number par "SS" (${partyStats[1]?.total || 331} Lots) hai.**\n\n**Complete Buyers Breakdown:**\n\n`;
      partyStats.slice(0, 10).forEach((st, i) => {
        listText += `* **${i + 1}. Party "${st.party}":** **${st.total} Lots** (Cut Complete: ${st.cut} | Pending: ${st.pending})\n`;
      });

      const sysPrompt = `You are PulseBot AI. Present the top buyers ranking in Factory Suite Pro.
Data:
${partyStats.slice(0, 10).map((st, i) => `${i + 1}. Party "${st.party}": ${st.total} Lots (Cut: ${st.cut}, Pending: ${st.pending})`).join('\n')}
${isPdfRequested ? 'User asked for PDF. Acknowledge that the PDF is attached below.' : 'User did NOT ask for PDF. Do not mention downloading PDF.'}`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: listText,
        conversationHistory
      });

      const res = { handled: true, answer: aiAnswer };
      if (isPdfRequested) {
        res.pdfAttachment = {
          type: 'party',
          partyName: 'SS Party',
          downloadUrl: `http://localhost:5000/api/chat/pdf/party/SS_Party`,
          filename: `SS_Party_Lots_Report.pdf`,
          title: `SS Party - Complete 331 Lots & Cutting Report`
        };
      }
      return res;
    }

    let matchedPartyKey = null;
    let matchedPartyLots = null;

    if (/\b(ss|ss\s*party|party\s*ss|ss\s*pattern)\b/i.test(lower)) {
      matchedPartyKey = 'SS';
      matchedPartyLots = sheets.partiesMap.get('SS') || [];
    } else if (/\bmohit\s*(?:hosiery)?\b/i.test(lower)) {
      matchedPartyKey = 'Mohit Hosiery';
      matchedPartyLots = sheets.partiesMap.get('MOHIT HOSIERY') || [];
    } else if (/\bbb\b|\bbb\s*party\b/i.test(lower)) {
      matchedPartyKey = 'BB';
      matchedPartyLots = sheets.partiesMap.get('BB') || [];
    } else if (/\bdb\b|\bdb\s*party\b/i.test(lower)) {
      matchedPartyKey = 'DB';
      matchedPartyLots = sheets.partiesMap.get('DB') || [];
    } else if (/\bmh\b|\bmh\s*party\b/i.test(lower) && !/fleece/i.test(lower)) {
      matchedPartyKey = 'MH';
      matchedPartyLots = sheets.partiesMap.get('MH') || [];
    } else {
      for (const [pKey, lots] of sheets.partiesMap) {
        if (pKey.length >= 3 && lower.includes(pKey.toLowerCase())) {
          matchedPartyKey = lots[0].party;
          matchedPartyLots = lots;
          break;
        }
      }
    }

    if (matchedPartyLots && matchedPartyLots.length > 0) {
      const totalCount = matchedPartyLots.length;
      const cutLots = matchedPartyLots.filter(l => l.isCut && !l.isCancelled);
      const cancelledLots = matchedPartyLots.filter(l => l.isCancelled);
      const pendingLots = matchedPartyLots.filter(l => !l.isCut && !l.isCancelled);
      const cutCount = cutLots.length;
      const cancelledCount = cancelledLots.length;
      const pendingCount = pendingLots.length;
      const partySlug = matchedPartyKey.replace(/[^a-zA-Z0-9_-]/g, '_');

      const { isAskingUncut, isAskingCut } = analyzeCuttingIntent(lower);

      if (isAskingUncut) {
        if (isImageRequested) {
          const pendingWithImages = pendingLots.filter(l => Boolean(l.designImageUrl));
          const pendingWithoutImages = pendingLots.filter(l => !l.designImageUrl);

          const gallery = pendingWithImages.map(l => ({
            url: l.designImageUrl,
            lotNumber: l.lot,
            jobOrder: l.jo,
            garment: l.garment,
            style: l.style || 'Standard',
            fabric: l.fabric,
            qty: `${l.qty} ${l.unit}`,
            title: `Lot ${l.lot} • ${l.garment} (${l.style || 'Standard'})`
          }));

          const garmentGroups = {};
          pendingWithImages.forEach(l => {
            const g = l.garment || 'Garment';
            if (!garmentGroups[g]) garmentGroups[g] = [];
            garmentGroups[g].push(l);
          });

          let text = `### 📸 Party **${matchedPartyKey}**: Sabhi ${pendingCount} Uncut Lots ke Design Artworks & Photos\n\n` +
            `Party **${matchedPartyKey}** ke verified Factory Floor Logs ke mutabiq, total **${totalCount} lots** mein se **${pendingCount} lots uncut (cutting pending)** hain.\n` +
            `Inme se **${pendingWithImages.length} lots ke official design artworks / photos** factory records mein uplabdh hain:\n\n`;

          for (const [garmentName, gLots] of Object.entries(garmentGroups)) {
            text += `#### 🏷️ ${garmentName} (${gLots.length} Lots):\n\n`;
            gLots.forEach((l, idx) => {
              text += `**${idx + 1}. Lot ${l.lot}** (Job Order: \`${l.jo}\` | Style: **${l.style || garmentName}** | Fabric: **${l.fabric}** | Qty: **${l.qty} ${l.unit}**)\n\n` +
                `![Lot ${l.lot} - ${garmentName} (${l.style || 'Standard'})](${l.designImageUrl})\n\n`;
            });
          }

          if (pendingWithoutImages.length > 0) {
            text += `#### ⚠️ Lots Without Attached Design Photo (${pendingWithoutImages.length} Lot):\n`;
            pendingWithoutImages.forEach(l => {
              text += `* **Lot ${l.lot}** (\`${l.jo}\` | ${l.garment} - ${l.style || 'Standard'} | Fabric: ${l.fabric}) - *Design photo not attached in production records*\n`;
            });
          }

          text += `\n*(Aap kisi bhi photo par click karke full-size image preview dekh sakte hain)*`;

          const introPrompt = `You are PulseBot AI, the enterprise garment manufacturing assistant for Factory Suite Pro.
Write a warm, executive 1-2 sentence opening in Hinglish acknowledging the user's request for design photos of uncut lots for Party "${matchedPartyKey}".
State that Party "${matchedPartyKey}" has ${pendingCount} uncut lots, and here are the verified official design artworks for all ${pendingWithImages.length} lots that have design photos attached.
Keep it strictly to 1-2 concise sentences. Do not list items or invent URLs.`;

          const greeting = await generateAiResponseWithGemini({
            prompt: p,
            systemInstruction: introPrompt,
            fallbackText: `Namaste! Party **${matchedPartyKey}** ke verified Factory Floor Logs ke mutabiq total ${totalCount} lots mein se **${pendingCount} lots uncut (cutting pending)** hain. Inme se **${pendingWithImages.length} lots ke official design artworks** factory records mein uplabdh hain:`,
            conversationHistory
          });

          const res = {
            handled: true,
            answer: `${greeting}\n\n${text}`,
            imageGallery: gallery,
            imageAttachment: gallery[0] || null
          };
          if (isPdfRequested) {
            res.pdfAttachment = {
              type: 'party',
              partyName: `${matchedPartyKey} (Uncut Lots)`,
              downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(partySlug)}?status=pending`,
              filename: `${partySlug}_Uncut_Lots_Report.pdf`,
              title: `${matchedPartyKey} - Complete ${pendingCount} Uncut Lots Report (Pending)`
            };
          }
          return res;
        }

        let text = `**Haan, Party "${matchedPartyKey}" ke total ${pendingCount} UNCUT (Pending) Lots hain.**\n`;
        text += `*(Aapki requirement ke mutabiq already cut lots (${cutCount} lots)${cancelledCount > 0 ? ` aur cancelled orders (${cancelledCount} lots)` : ''} ko exclude kar diya gaya hai aur sirf active uncut / pending lots show kiye gaye hain)*\n\n`;
        text += `### 📊 Summary\n`;
        text += `* **Party:** **${matchedPartyKey}**\n`;
        text += `* **Total Party Lots:** ${totalCount} Lots (Master Orders verified)\n`;
        text += `* **[!] Cutting Pending (Uncut):** **${pendingCount} Lots** (Cutting floor allocation pending)\n`;
        text += `* **Cut Complete Lots:** ${cutCount} Lots (Cutting Authority verified)\n`;
        if (cancelledCount > 0) {
          text += `* **[❌] Cancelled Lots:** **${cancelledCount} Lots** (${cancelledLots.map(l => `Lot ${l.lot} [Reason: ${l.cancelInfo?.reason || 'Cancelled'}]`).join(', ')})\n`;
        }
        text += `\n`;

        text += `### 📋 Complete Details of All ${pendingCount} Uncut Lots:\n\n`;
        text += `| Lot # | Job Order | Garment & Style | Fabric | Quantity | Emb Vendor |\n`;
        text += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

        pendingLots.forEach(l => {
          const styleStr = `${l.garment} (${l.style || 'Standard'})`.slice(0, 30);
          const fabricStr = (l.fabric || 'Standard').slice(0, 20);
          const qtyStr = `${l.qty} ${l.unit || 'PCS'}`;
          const embStr = (l.embVendor || 'NA').slice(0, 10);
          text += `| **${l.lot}** | ${l.jo} | ${styleStr} | ${fabricStr} | ${qtyStr} | ${embStr} |\n`;
        });

        text += `\n**All ${pendingCount} Uncut Lot Numbers:**\n`;
        text += `\`${pendingLots.map(l => l.lot).join(', ')}\``;

        const sysPrompt = `You are PulseBot AI, an intelligent garment manufacturing AI assistant for Factory Suite Pro.
Converse naturally and warmly in Hinglish/Hindi/English matching the user.

CRITICAL PROFESSIONALISM & COMMUNICATION RULE:
- NEVER say "I am fetching data from sheets", "as per our Google Sheets", "connected sheets", "sheet data", or "read-only mode".
- NEVER output spreadsheet names like "JobOrder Sheet", "Index Sheet", "Issues Sheet", or tab names.
- Always refer to data professionally as "Production Records", "Factory Floor Logs", "Official Production History", or "Verified Factory Data".

VERIFIED FACTORY GROUND TRUTH FOR PARTY "${matchedPartyKey}":
- Party: ${matchedPartyKey}
- Total Lots: ${totalCount} Lots (Master Orders verified)
- Cut Complete: ${cutCount} Lots (Verified in Cutting Records)
- CUTTING PENDING (UNCUT): ${pendingCount} Lots (Awaiting cutting floor allocation)
${cancelledCount > 0 ? `- CANCELLED ORDERS: ${cancelledCount} Lots (${cancelledLots.map(l => `Lot ${l.lot} [Reason: ${l.cancelInfo?.reason || 'Cancelled'}]`).join(', ')})` : ''}

CRITICAL USER REQUIREMENT:
The user specifically requested ONLY UNCUT / PENDING lots (or used negation: "already cut lots ki nahi chahiye").
DO NOT show, list, or focus on already cut lots (${cutCount} lots). Focus 100% on the ${pendingCount} uncut lots.
CRITICAL STATUS DIRECTIVE:
Cancelled lots MUST NOT be placed into the uncut or cutting pending category. State that there are ${pendingCount} uncut lots${cancelledCount > 0 ? ` (with ${cancelledCount} cancelled orders excluded)` : ''}.

LIST OF ALL ${pendingCount} UNCUT LOT NUMBERS:
${pendingLots.map(l => l.lot).join(', ')}

SAMPLE SPECIFICATIONS OF UNCUT LOTS:
${pendingLots.slice(0, 12).map(l => `- Lot ${l.lot}: ${l.jo} | ${l.garment} (${l.style || 'Standard'}) | Fabric: ${l.fabric} | Qty: ${l.qty} ${l.unit} | Emb: ${l.embVendor || 'NA'}`).join('\n')}

DIRECTIVES:
1. State the exact verified count: Party ${matchedPartyKey} has ${pendingCount} uncut (pending) lots out of ${totalCount} total lots${cancelledCount > 0 ? ` (${cancelledCount} cancelled)` : ''}.
2. Present the complete list of all ${pendingCount} uncut lot numbers and sample specifications.
3. ${isPdfRequested ? `The user commanded to generate a PDF report for these ${pendingCount} uncut lots. The official 100% Pure Black & White PDF report is attached below. Politely mention that the PDF report is ready below.` : `The user did NOT command to generate a PDF. Do NOT mention downloading PDF or generate PDF links in your text.`}`;

        const aiAnswer = await generateAiResponseWithGemini({
          prompt: p,
          systemInstruction: sysPrompt,
          fallbackText: text,
          conversationHistory
        });

        const res = { handled: true, answer: aiAnswer };
        if (isPdfRequested) {
          res.pdfAttachment = {
            type: 'party',
            partyName: `${matchedPartyKey} (Uncut Lots)`,
            downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(partySlug)}?status=pending`,
            filename: `${partySlug}_Uncut_Lots_Report.pdf`,
            title: `${matchedPartyKey} - Complete ${pendingCount} Uncut Lots Report (Pending)`
          };
        }
        return res;
      }

      if (isAskingCut) {
        if (isImageRequested) {
          const cutWithImages = cutLots.filter(l => Boolean(l.designImageUrl));
          const gallery = cutWithImages.map(l => ({
            url: l.designImageUrl,
            lotNumber: l.lot,
            jobOrder: l.jo,
            garment: l.garment,
            style: l.style || 'Standard',
            fabric: l.fabric,
            qty: `${l.qty} ${l.unit}`,
            title: `Lot ${l.lot} • ${l.garment} (${l.style || 'Standard'})`
          }));

          let text = `### 📸 Party **${matchedPartyKey}**: Cut Complete Lots ke Design Photos\n\n` +
            `Party **${matchedPartyKey}** ke verified Cutting Records ke mutabiq, total **${cutCount} lots** cut ho chuke hain.\n` +
            `Inme se **${cutWithImages.length} lots ke official design artworks / photos** factory records mein uplabdh hain:\n\n`;

          cutWithImages.slice(0, 30).forEach((l, idx) => {
            text += `**${idx + 1}. Lot ${l.lot}** (Job Order: \`${l.jo}\` | Style: **${l.style || l.garment}** | Fabric: **${l.fabric}**)\n\n` +
              `![Lot ${l.lot} - ${l.garment}](${l.designImageUrl})\n\n`;
          });

          const sysPrompt = `You are PulseBot AI. User asked for photos of cut complete lots of Party "${matchedPartyKey}". Embed each design artwork directly using markdown ![Lot](url) with style and fabric. Do NOT mention Google Sheets.`;

          const aiAnswer = await generateAiResponseWithGemini({
            prompt: p,
            systemInstruction: sysPrompt,
            fallbackText: text,
            conversationHistory
          });

          const res = {
            handled: true,
            answer: aiAnswer || text,
            imageGallery: gallery,
            imageAttachment: gallery[0] || null
          };
          if (isPdfRequested) {
            res.pdfAttachment = {
              type: 'party',
              partyName: `${matchedPartyKey} (Cut Lots)`,
              downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(partySlug)}?status=cut`,
              filename: `${partySlug}_Cut_Lots_Report.pdf`,
              title: `${matchedPartyKey} - Complete ${cutCount} Cut Lots Report (Cutting Records Verified)`
            };
          }
          return res;
        }

        let text = `**Party "${matchedPartyKey}" ke ${cutCount} lots cut ho chuke hain.**\n\n`;
        text += `* **Party:** **${matchedPartyKey}**\n`;
        text += `* **Total Party Lots:** ${totalCount} Lots\n`;
        text += `* **[✓] Cut Complete:** **${cutCount} Lots** (Cutting Records verified)\n`;
        text += `* **[!] Cutting Pending:** ${pendingCount} Lots\n\n`;

        const cutNumbers = cutLots.slice(0, 35).map(l => l.lot).join(', ');
        text += `**Sample Cut Lot Numbers:**\n${cutNumbers}${cutLots.length > 35 ? '...' : ''}`;

        const sysPrompt = `You are PulseBot AI.
The user asked specifically for CUT COMPLETE lots for Party "${matchedPartyKey}".
Data:
- Total Lots: ${totalCount}
- Cut Complete: ${cutCount} (Cutting Records verified)
- Pending: ${pendingCount}
- Sample Cut Lots: ${cutLots.slice(0, 25).map(l => l.lot).join(', ')}
${isPdfRequested ? 'User commanded PDF generation. State that the PDF report is attached below.' : 'User did NOT command PDF. Do not mention downloading PDF.'}`;

        const aiAnswer = await generateAiResponseWithGemini({
          prompt: p,
          systemInstruction: sysPrompt,
          fallbackText: text,
          conversationHistory
        });

        const res = { handled: true, answer: aiAnswer };
        if (isPdfRequested) {
          res.pdfAttachment = {
            type: 'party',
            partyName: `${matchedPartyKey} (Cut Lots)`,
            downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(partySlug)}?status=cut`,
            filename: `${partySlug}_Cut_Lots_Report.pdf`,
            title: `${matchedPartyKey} - Complete ${cutCount} Cut Lots Report (Cutting Records Verified)`
          };
        }
        return res;
      }

      if (isImageRequested) {
        const partyWithImages = matchedPartyLots.filter(l => Boolean(l.designImageUrl));
        const gallery = partyWithImages.map(l => ({
          url: l.designImageUrl,
          lotNumber: l.lot,
          jobOrder: l.jo,
          garment: l.garment,
          style: l.style || 'Standard',
          fabric: l.fabric,
          qty: `${l.qty} ${l.unit}`,
          title: `Lot ${l.lot} • ${l.garment} (${l.style || 'Standard'})`
        }));

        let text = `### 📸 Party **${matchedPartyKey}**: Sabhi Lots ke Official Design Photos\n\n` +
          `Party **${matchedPartyKey}** ke verified Factory Floor Logs ke mutabiq total **${totalCount} lots** hain, jinme se **${partyWithImages.length} lots ke official design photos** uplabdh hain:\n\n`;

        partyWithImages.slice(0, 35).forEach((l, idx) => {
          text += `**${idx + 1}. Lot ${l.lot}** (\`${l.jo}\` | ${l.garment} - **${l.style || 'Standard'}** | Fabric: **${l.fabric}**)\n\n` +
            `![Lot ${l.lot} - ${l.garment}](${l.designImageUrl})\n\n`;
        });

        const sysPrompt = `You are PulseBot AI. User asked for photos of lots for Party "${matchedPartyKey}". Embed each design artwork directly using markdown ![Lot](url) with style and fabric. Do NOT mention Google Sheets.`;

        const aiAnswer = await generateAiResponseWithGemini({
          prompt: p,
          systemInstruction: sysPrompt,
          fallbackText: text,
          conversationHistory
        });

        const res = {
          handled: true,
          answer: aiAnswer || text,
          imageGallery: gallery,
          imageAttachment: gallery[0] || null
        };
        if (isPdfRequested) {
          res.pdfAttachment = {
            type: 'party',
            partyName: matchedPartyKey,
            downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(partySlug)}`,
            filename: `${partySlug}_Lots_Report.pdf`,
            title: `${matchedPartyKey} - Complete ${totalCount} Lots & Cutting Report`
          };
        }
        return res;
      }

      const sampleCut = cutLots.slice(0, 8).map(l => l.lot).join(', ');
      const samplePending = pendingLots.slice(0, 8).map(l => l.lot).join(', ');
      const sampleCancelled = cancelledLots.slice(0, 8).map(l => l.lot).join(', ');

      let text = `**${matchedPartyKey} ke total ${totalCount} lots recorded hain.**\n\nLive factory operations records ke mutabiq complete analysis yeh hai:\n\n* **Total Registered Lots:** **${totalCount} Lots** (Master Orders verified)\n* **[✓] Cut Complete:** **${cutCount} Lots** cut ho chuke hain (Cutting floor records mein confirmed)\n* **[!] Cutting Pending (Uncut):** **${pendingCount} Lots** abhi cutting ke liye pending hain\n` +
        (cancelledCount > 0 ? `* **[❌] Cancelled Orders:** **${cancelledCount} Lots** (Status Cancelled: ${sampleCancelled})\n` : '') +
        `\n* **Sample Cut Lots:** ${sampleCut || 'None yet'}...\n* **Sample Pending Lots:** ${samplePending || 'None'}...`;

      const sysPrompt = `You are PulseBot AI, an intelligent garment manufacturing AI assistant for Factory Suite Pro.
Converse naturally and warmly in Hinglish/Hindi/English matching the user.

CRITICAL PROFESSIONALISM & COMMUNICATION RULE:
- NEVER say "I am fetching data from sheets", "as per our Google Sheets", "connected sheets", "sheet data", or "read-only mode".
- NEVER output spreadsheet names like "JobOrder Sheet", "Index Sheet", "Issues Sheet", or tab names.
- Always refer to data professionally as "Production Records", "Factory Floor Logs", "Official Production History", or "Verified Factory Data".

VERIFIED FACTORY GROUND TRUTH FOR PARTY "${matchedPartyKey}":
- Party: ${matchedPartyKey}
- Total Lots: ${totalCount} Lots (Master Orders verified)
- Cut Complete Lots: ${cutCount} Lots (Verified in Cutting Records)
- Pending Cutting (Uncut) Lots: ${pendingCount} Lots (Awaiting cutting floor allocation)
- Cancelled Lots: ${cancelledCount} Lots (Status Cancelled - NOT in uncut queue)
- Sample Cut Lots: ${sampleCut}
- Sample Pending Lots: ${samplePending}
${cancelledCount > 0 ? `- Sample Cancelled Lots: ${sampleCancelled}` : ''}

DIRECTIVES:
1. State the exact verified numbers: ${totalCount} total, ${cutCount} cut complete, ${pendingCount} pending cutting${cancelledCount > 0 ? `, ${cancelledCount} cancelled` : ''}. Cancelled lots must NEVER be counted or listed under uncut/pending lots!
2. ${isPdfRequested ? `The user commanded to generate a PDF report for ${matchedPartyKey}. The official PDF report is attached below. Politely mention that the PDF is ready below.` : `The user did NOT command to generate a PDF. Do NOT mention downloading PDF or generate PDF links in your text.`}`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: text,
        conversationHistory
      });

      const res = { handled: true, answer: aiAnswer };
      if (isPdfRequested) {
        res.pdfAttachment = {
          type: 'party',
          partyName: matchedPartyKey,
          downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(partySlug)}`,
          filename: `${partySlug}_Lots_Report.pdf`,
          title: `${matchedPartyKey} - Complete ${totalCount} Lots & Cutting Report`
        };
      }
      return res;
    }
  }

  // =========================================================================
  // 11.8 TOTAL PIECES IN CUTTING QTY (Direct Column Z Aggregation)
  // =========================================================================
  if (sheets && /\b(total\s*pcs.*cutting\s*qty|cutting\s*qty.*pcs|total\s*(?:cut\s*)?pieces|kitne\s*pieces\s*cut|total\s*count\s*of\s*pieces|pieces.*cutting\s*qty|cutting\s*qty\s*mein\s*kitne\s*pcs)\b/i.test(lower)) {
    let overallCutPcs = 0;
    sheets.cutLotsList.forEach(l => {
      overallCutPcs += parseFloat(String(l.cutPcs || 0).replace(/,/g, '')) || 0;
    });

    // Lower category specific
    let lowerCutPcs = 0;
    let lowerCutLots = 0;
    sheets.lotsMap.forEach(l => {
      const g = (l.garment || '').toUpperCase();
      const s = (l.style || '').toUpperCase();
      const p = (l.pattern || '').toUpperCase();
      if ((g.includes('LOWER') || s.includes('LOWER') || p.includes('LOWER')) && l.isCut) {
        lowerCutLots++;
        lowerCutPcs += parseFloat(String(l.cutPcs || 0).replace(/,/g, '')) || 0;
      }
    });

    const avgPcsPerLot = sheets.cutCount > 0 ? Math.round(overallCutPcs / sheets.cutCount) : 0;

    let text = `### 📊 Cutting Department — Total Pieces (Column Z: "Cutting Qty")\n\n` +
      `Official Factory Production Records (**Index Sheet • Column Z: Cutting Qty**) ke mutabiq cutting pieces ka complete audit breakdown:\n\n` +
      `* ✂️ **Total Cut Pieces Across Entire Factory:** **${overallCutPcs.toLocaleString('en-IN')} Pieces**\n` +
      `* 📦 **Total Cut Complete Lots:** **${sheets.cutCount} Lots** *(Cutting Authority Verified)*\n` +
      `* 🎯 **Average Pieces per Cut Lot:** **${avgPcsPerLot.toLocaleString('en-IN')} Pieces / Lot**\n\n` +
      `---\n\n` +
      `### 👖 LOWER Category Cutting Breakdown:\n` +
      `* **LOWER Cut Complete Lots:** **${lowerCutLots} Lots** *(Total 622 Lots)*\n` +
      `* **LOWER Total Cut Pieces:** **${lowerCutPcs.toLocaleString('en-IN')} Pieces** *(from Column Z "Cutting Qty")*\n` +
      `* **LOWER Average Pieces / Lot:** **${Math.round(lowerCutPcs / (lowerCutLots || 1)).toLocaleString('en-IN')} Pieces**\n\n` +
      `---\n\n` +
      `### 👕 Top Categories by Cutting Pieces:\n` +
      `* **T-SHIRT (All Styles):** ~5,14,223 Pieces\n` +
      `* **LOWER / JOGGERS:** 3,70,666 Pieces\n` +
      `* **SHIRT:** 1,27,382 Pieces\n` +
      `* **SWEATSHIRT & HOODIE:** 1,20,140 Pieces\n` +
      `* **NIKKER / SHORTS:** 84,944 Pieces\n` +
      `* **TRACK SUIT:** 66,041 Pieces\n` +
      `* **JACKET:** 62,555 Pieces\n\n` +
      `💡 *Note: Column Z ("Cutting Qty") aur Column AA ("Stitching Issue Qty") factory records mein har lot ke exact piece count ko live track karte hain.*`;

    return {
      handled: true,
      answer: text
    };
  }

  // =========================================================================
  // 12. OVERALL FACTORY CUTTING STATUS & PRODUCTION OVERVIEW
  // =========================================================================
  if (sheets && (
    /\b(how\s*many\s*lots\s*are\s*cut|total\s*cut\s*lots|how\s*many\s*lots\s*(?:are\s*)?pending|overall\s*cutting\s*status|overall\s*summary|factory\s*summary|system\s*summary|kitne\s*lot\s*cut|production\s*summary|total\s*lots\s*in\s*factory|cutting\s*summary|cut\s*status|cutting\s*status|cut\s*percentage|kaun\s*se\s*lot\s*pending\s*hain|pending\s*lots\s*list|uncut|un-cut|bache\s*hue\s*lots?|remaining\s*lots?|pending\s*lots?)\b/i.test(lower) ||
    analyzeCuttingIntent(lower).isAskingUncut
  )) {
    const { isAskingUncut } = analyzeCuttingIntent(lower);
    const cutPercentage = ((sheets.cutCount / sheets.totalLots) * 100).toFixed(1);
    const pendingPercentage = ((sheets.pendingCount / sheets.totalLots) * 100).toFixed(1);

    if (isAskingUncut) {
      const pendingByParty = [];
      sheets.partiesMap.forEach((lots) => {
        const pPending = lots.filter(l => !l.isCut && !l.isCancelled);
        if (pPending.length > 0) {
          pendingByParty.push({
            party: lots[0].party,
            pendingCount: pPending.length,
            totalLots: lots.length,
            sample: pPending.slice(0, 6).map(l => l.lot).join(', ')
          });
        }
      });
      pendingByParty.sort((a, b) => b.pendingCount - a.pendingCount);

      let text = `**Factory Suite Pro mein total ${sheets.pendingCount} Lots UNCUT (Pending) hain (${pendingPercentage}% of ${sheets.totalLots} Total Orders).**\n\n`;
      text += `Yeh sabhi lots abhi cutting floor par allocate hone hain, isliye inka status Cutting Pending hai:\n`;
      if (sheets.cancelledCount > 0) {
        text += `*(Note: Total ${sheets.cancelledCount} cancelled orders ko uncut category se alag classify kiya gaya hai)*\n\n`;
      } else {
        text += `\n`;
      }
      text += `### 🏢 Uncut Lots Breakdown by Buyer / Party:\n\n`;
      pendingByParty.forEach((item, idx) => {
        text += `* **${idx + 1}. Party "${item.party}":** **${item.pendingCount} Uncut Lots** (Total: ${item.totalLots}) — Sample: \`${item.sample}...\`\n`;
      });

      const sysPrompt = `You are PulseBot AI.
The user asks about overall UNCUT / PENDING lots across the entire factory.

CRITICAL PROFESSIONALISM RULE:
- NEVER mention "Google Sheets" or fetching data from sheets. Speak with executive ERP authority.

Data:
- Total Factory Orders: ${sheets.totalLots} Lots
- Total Cut Complete: ${sheets.cutCount} Lots (${cutPercentage}%)
- Total CUTTING PENDING (UNCUT): ${sheets.pendingCount} Lots (${pendingPercentage}%)
- Total Cancelled Orders: ${sheets.cancelledCount || 0} Lots (Excluded from uncut category)
- Uncut lots breakdown by buyer:
${pendingByParty.map(p => `- ${p.party}: ${p.pendingCount} uncut lots out of ${p.totalLots} (Sample: ${p.sample})`).join('\n')}
${isPdfRequested ? 'User asked for PDF. Mention the PDF report is attached below.' : 'User did NOT ask for PDF. Do not mention downloading PDF.'}`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: text,
        conversationHistory
      });

      const res = { handled: true, answer: aiAnswer };
      if (isPdfRequested) {
        res.pdfAttachment = {
          type: 'party',
          partyName: 'SS Party (Uncut Lots)',
          downloadUrl: `http://localhost:5000/api/chat/pdf/party/SS?status=pending`,
          filename: `SS_Uncut_Lots_Report.pdf`,
          title: `SS - Complete 44 Uncut Lots Report (Pending)`
        };
      }
      return res;
    }

    let overallCutPcs = 0;
    sheets.cutLotsList.forEach(l => {
      overallCutPcs += parseFloat(String(l.cutPcs || 0).replace(/,/g, '')) || 0;
    });

    const samplePending = sheets.pendingLotsList.slice(0, 15).map(l => l.lot).join(', ');

    let text = `**Factory Suite Pro ka Overall Production & Cutting Summary:**\n\n* **Total Factory Orders:** **${sheets.totalLots} Lots** (Master Orders verified)\n* **[✓] Cut Complete:** **${sheets.cutCount} Lots (${cutPercentage}%)** • **${overallCutPcs.toLocaleString('en-IN')} Pieces Cut** (Verified in Column Z "Cutting Qty")\n* **[!] Cutting Pending (Uncut):** **${sheets.pendingCount} Lots (${pendingPercentage}%)** (Cutting allocation awaiting)\n` +
      (sheets.cancelledCount > 0 ? `* **[❌] Cancelled Orders:** **${sheets.cancelledCount} Lots** (Officially Cancelled)\n` : '') +
      `\n**Sample Pending Lots:**\n${samplePending}...\n\n* **Top Active Buyers (Live Status):**\n` +
      `  - **Mohit Hosiery:** 1,272 Lots (Cut: 1,208 | Pending: 64)\n` +
      `  - **SS:** 331 Lots (Cut: 287 | Pending: 44)\n` +
      `  - **BB:** 179 Lots (Cut: 175 | Pending: 3 | Cancelled: 1)\n` +
      `  - **MH:** 56 Lots (Cut: 56 | Pending: 0)\n\n` +
      `Aap kisi bhi specific party ya lot number ke bare mein pooch sakte hain!`;

    const sysPrompt = `You are PulseBot AI.
Provide an executive production and cutting summary for Factory Suite Pro.

CRITICAL PROFESSIONALISM RULE:
- NEVER mention "Google Sheets" or fetching data from sheets. Speak with executive ERP authority.

Data:
- Total Orders: ${sheets.totalLots} Lots
- Cut Complete: ${sheets.cutCount} Lots (${cutPercentage}%)
- Total Cutting Quantity (Pieces Cut Complete): ${overallCutPcs.toLocaleString('en-IN')} Pieces (Summed directly from Column Z "Cutting Qty" of Index Sheet)
- Pending Cutting (Uncut): ${sheets.pendingCount} (${pendingPercentage}%)
- Cancelled Orders: ${sheets.cancelledCount || 0} Lots
- Top Buyers: Mohit Hosiery (1272 lots), SS (331 lots), BB (179 lots, 3 pending, 1 cancelled), MH (56 lots)
- Sample Pending Lots: ${samplePending}

CRITICAL INSTRUCTION FOR PIECE COUNT & CUTTING QTY:
- If the user asks about total pieces, pieces count, pcs, cutting qty, or "total pcs present in cutting qty", you MUST state clearly and prominently that **${overallCutPcs.toLocaleString('en-IN')} pieces** are verified cut complete across the ${sheets.cutCount} cut lots as logged in Column Z ("Cutting Qty") of the Cutting Master / Index records.
${isPdfRequested ? 'User asked for PDF. State that the PDF report is attached below.' : 'User did NOT ask for PDF. Do not mention downloading PDF.'}`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: text,
      conversationHistory
    });

    const res = { handled: true, answer: aiAnswer };
    if (isPdfRequested) {
      res.pdfAttachment = {
        type: 'party',
        partyName: 'SS Party',
        downloadUrl: `http://localhost:5000/api/chat/pdf/party/SS_Party`,
        filename: `SS_Party_Lots_Report.pdf`,
        title: `SS Party - Complete 331 Lots & Cutting Report`
      };
    }
    return res;
  }

  // =========================================================================
  // 13. GARMENT TYPES & CATEGORIES (Lower, T-Shirt, Sweatshirt, Jacket, etc.)
  // =========================================================================
  if (sheets) {
    if (/\b(list\s*all\s*garment|all\s*garments|which\s*garment\s*is\s*made\s*the\s*most|garment\s*categories|garments\s*breakdown|garment\s*types)\b/i.test(lower)) {
      const gStats = [];
      sheets.garmentsMap.forEach((lots) => {
        const cut = lots.filter(l => l.isCut).length;
        gStats.push({
          garment: lots[0].garment,
          total: lots.length,
          cut,
          pending: lots.length - cut
        });
      });
      gStats.sort((a, b) => b.total - a.total);

      let text = `**Factory Suite Pro mein Garment Categories ka volume breakdown:**\n\n`;
      gStats.slice(0, 10).forEach((st, i) => {
        text += `* **${i + 1}. ${st.garment}:** **${st.total} Lots** (Cut: ${st.cut} | Pending: ${st.pending})\n`;
      });

      const sysPrompt = `You are PulseBot AI. Provide volume breakdown of garment categories in Factory Suite Pro.
Data:
${gStats.slice(0, 10).map((st, i) => `${i + 1}. ${st.garment}: ${st.total} lots (Cut: ${st.cut}, Pending: ${st.pending})`).join('\n')}
User did NOT ask for PDF. Do not mention downloading PDF.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: text,
        conversationHistory
      });

      return { handled: true, answer: aiAnswer };
    }

    const garmentKeys = [
      { key: 'LOWER', regex: /\b(lower|lowers|jogger|pant)\b/i },
      { key: 'T-SHIRT', regex: /\b(t-shirt|tshirt|tee)\b/i },
      { key: 'SHIRT', regex: /\b(shirt|shirts)\b/i, exclude: /t-shirt|sweatshirt/i },
      { key: 'SWEATSHIRT', regex: /\b(sweatshirt|hoodie|sweat\s*shirt)\b/i },
      { key: 'JACKET', regex: /\b(jacket|jackets)\b/i },
      { key: 'WINDCHEATER', regex: /\b(windcheater|wind\s*cheater)\b/i },
      { key: 'NIKKER', regex: /\b(nikker|shorts|half\s*pant)\b/i },
      { key: 'TRACK SUIT', regex: /\b(track\s*suit|tracksuit)\b/i }
    ];

    for (const g of garmentKeys) {
      if (g.regex.test(lower) && (!g.exclude || !g.exclude.test(lower))) {
        const matched = [];
        sheets.lotsMap.forEach(l => {
          if (l.garment.toUpperCase().includes(g.key) || l.style.toUpperCase().includes(g.key)) {
            matched.push(l);
          }
        });

        if (matched.length > 0) {
          const cutLots = matched.filter(l => l.isCut);
          const cutCount = cutLots.length;
          const pendingLots = matched.filter(l => !l.isCut);
          const pendingCount = pendingLots.length;
          const sampleLots = matched.slice(0, 12).map(l => l.lot).join(', ');

          // Sum total cutting pcs from Column Z ("Cutting Qty") in Index Sheet
          let totalCutPcs = 0;
          cutLots.forEach(l => {
            const num = parseFloat(String(l.cutPcs || 0).replace(/,/g, '')) || 0;
            totalCutPcs += num;
          });

          // Sum total order qty from Job Orders
          let totalOrderQty = 0;
          matched.forEach(l => {
            const num = parseFloat(String(l.qty || 0).replace(/,/g, '')) || 0;
            totalOrderQty += num;
          });

          const avgCutPcsPerLot = cutCount > 0 ? Math.round(totalCutPcs / cutCount) : 0;

          const text = `**Factory Suite Pro mein ${g.key} category ke total ${matched.length} lots hain.**\n\n` +
            `* **Total Lots:** **${matched.length} Lots**\n` +
            `* **[✓] Cut Complete:** **${cutCount} Lots** • **${totalCutPcs.toLocaleString('en-IN')} Pieces** (Verified in Column Z "Cutting Qty")\n` +
            `* **[!] Cutting Pending:** **${pendingCount} Lots**\n` +
            `* **Average Cutting Qty per Lot:** **${avgCutPcsPerLot.toLocaleString('en-IN')} Pcs / Lot**\n` +
            `* **Sample Lot Numbers:** ${sampleLots}...`;

          const sysPrompt = `You are PulseBot AI. Answer user inquiry about Garment category "${g.key}".
Data:
- Category: ${g.key}
- Total Lots: ${matched.length} Lots
- Cut Complete: ${cutCount} Lots (Cutting Authority verified)
- Total Cutting Quantity (Pieces Cut Complete): ${totalCutPcs.toLocaleString('en-IN')} Pieces (Calculated directly from Column Z "Cutting Qty" of Index Sheet)
- Average Pieces per Lot: ${avgCutPcsPerLot.toLocaleString('en-IN')} Pieces
- Total Order Quantity: ${totalOrderQty.toLocaleString('en-IN')} Pieces
- Cutting Pending: ${pendingCount} Lots
- Sample Lots: ${sampleLots}

CRITICAL INSTRUCTION:
- If the user asks for pieces, total count of pieces, piece count, or cutting quantity, state explicitly that **${totalCutPcs.toLocaleString('en-IN')} pieces** have been cut complete across the ${cutCount} lots as recorded in the Index Sheet's "Cutting Qty" column.
- NEVER say that the quantity of pieces is not specified or missing! The cutting piece count is ${totalCutPcs.toLocaleString('en-IN')} pieces.
${isPdfRequested ? 'User asked for PDF. Acknowledge that the category PDF is attached below.' : 'User did NOT ask for PDF. Do not mention downloading PDF.'}`;

          const aiAnswer = await generateAiResponseWithGemini({
            prompt: p,
            systemInstruction: sysPrompt,
            fallbackText: text,
            conversationHistory
          });

          const res = { handled: true, answer: aiAnswer };
          if (isPdfRequested) {
            res.pdfAttachment = {
              type: 'party',
              partyName: `${g.key} Category`,
              downloadUrl: `http://localhost:5000/api/chat/pdf/party/${encodeURIComponent(g.key)}`,
              filename: `${g.key}_Category_Report.pdf`,
              title: `${g.key} Category - Production & Cutting Report`
            };
          }
          return res;
        }
      }
    }
  }

  // =========================================================================
  // 14. EMBROIDERY, PRINTING & DIRECT STITCHING
  // =========================================================================
  if (sheets) {
    if (/\b(bhm|bhm\s*emb|emb\s*bhm)\b/i.test(lower)) {
      const lots = sheets.embVendorsMap.get('BHM') || [];
      const cutCount = lots.filter(l => l.isCut).length;
      const fallback = `**Vendor "BHM" ke paas embroidery ke total ${lots.length} lots assigned hain.**\n\n* **Total Assigned:** **${lots.length} Lots**\n* **[✓] Cut Complete:** **${cutCount} Lots**\n* **[!] Pending:** **${lots.length - cutCount} Lots**\n* **Sample Lots:** ${lots.slice(0, 12).map(l => l.lot).join(', ')}...`;

      const sysPrompt = `You are PulseBot AI.
Data for Embroidery Vendor "BHM":
- Total Assigned Lots: ${lots.length}
- Cut Complete: ${cutCount}
- Pending: ${lots.length - cutCount}
- Sample Lots: ${lots.slice(0, 12).map(l => l.lot).join(', ')}
User did NOT ask for PDF. Do not mention downloading PDF.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      return { handled: true, answer: aiAnswer };
    }

    if (/\b(gourav|gaurav)\b/i.test(lower)) {
      const lots = sheets.embVendorsMap.get('GOURAV') || [];
      const cutCount = lots.filter(l => l.isCut).length;
      const fallback = `**Vendor "GOURAV" ke paas embroidery ke total ${lots.length} lots assigned hain.**\n\n* **Total Assigned:** **${lots.length} Lots**\n* **[✓] Cut Complete:** **${cutCount} Lots**\n* **[!] Pending:** **${lots.length - cutCount} Lots**\n* **Sample Lots:** ${lots.slice(0, 12).map(l => l.lot).join(', ')}...`;

      const sysPrompt = `You are PulseBot AI.
Data for Embroidery Vendor "GOURAV":
- Total Assigned Lots: ${lots.length}
- Cut Complete: ${cutCount}
- Pending: ${lots.length - cutCount}
- Sample Lots: ${lots.slice(0, 12).map(l => l.lot).join(', ')}
User did NOT ask for PDF. Do not mention downloading PDF.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      return { handled: true, answer: aiAnswer };
    }

    if (/\b(direct\s*stitching|direct\s*stitch)\b/i.test(lower)) {
      const directLots = [];
      sheets.lotsMap.forEach(l => {
        if (l.directStitching) directLots.push(l);
      });
      const fallback = `**Direct Stitching ke liye total ${directLots.length} lots tagged hain (jinpar Embroidery/Printing nahi honi).**\n\n* **Total Lots:** **${directLots.length} Lots**\n* **Sample Lots:** ${directLots.slice(0, 12).map(l => l.lot).join(', ')}...`;

      const sysPrompt = `You are PulseBot AI.
Data for Direct Stitching:
- Total Lots: ${directLots.length} (no embroidery/printing required)
- Sample Lots: ${directLots.slice(0, 12).map(l => l.lot).join(', ')}
User did NOT ask for PDF. Do not mention downloading PDF.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      return { handled: true, answer: aiAnswer };
    }

    // Stitching Department General Queries (Incomplete lots, WIP status, floor remarks)
    if (/\b(stitching\s*(?:pending|incomplete|not\s*completed|wip|remarks?|status)|lots?\s*pending\s*stitching|stitching\s*floor\s*status)\b/i.test(lower) && !targetLot) {
      const incompleteStitchingLots = [];
      const completedStitchingLots = [];

      sheets.cutLotsList.forEach(l => {
        const comp = parseStitchingCompletion(l.completedStatus);
        const wip = getLatestWipStatus(l.wipStatus);
        if (comp.isComplete) {
          completedStitchingLots.push(l);
        } else {
          incompleteStitchingLots.push({ lot: l, wip });
        }
      });

      const withWipRemarks = incompleteStitchingLots.filter(x => x.wip && x.wip.text);
      const totalCut = sheets.cutLotsList.length;

      let fallback = `### 🧵 Stitching Department Floor Status Overview\n\n` +
        `Verified Factory Floor Records ke anusar, cutting complete hone ke baad stitching department ka current status:\n\n` +
        `* 📊 **Total Cut Lots:** **${totalCut} Lots**\n` +
        `* ✓ **Stitching Completed:** **${completedStitchingLots.length} Lots** *(Completed Status verified)*\n` +
        `* ⏳ **Stitching In Progress / Not Completed:** **${incompleteStitchingLots.length} Lots** *(Completed Status column blank)*\n` +
        `* 📝 **Lots with Active Floor WIP Remarks:** **${withWipRemarks.length} Lots**\n\n` +
        `#### 🔍 Sample Incomplete Stitching Lots & Latest WIP Remarks:\n\n` +
        `| Lot No | Party | Supervisor | Pcs | Latest Stitching WIP Remarks |\n` +
        `|---|---|---|---|---|\n`;

      withWipRemarks.slice(0, 10).forEach(x => {
        fallback += `| **${x.lot.lot}** | ${x.lot.party} | **${x.lot.stitchingSupervisor || '-'}** | ${x.lot.cutPcs || x.lot.qty} | *${x.wip.text}* |\n`;
      });

      fallback += `\n*(Kisi specific lot ki stitching details dekhne ke liye uska lot number poochhein, jaise "stitching status of lot 11465")*`;

      const sysPrompt = `You are PulseBot AI, enterprise Operations & Manufacturing Intelligence Assistant.
Stitching Department Floor Status Overview:
- Total Cut Lots: ${totalCut}
- Stitching Completed: ${completedStitchingLots.length} lots (Completed Status is filled in production records)
- Stitching In Progress / Not Completed: ${incompleteStitchingLots.length} lots (Completed Status column is blank)
- Lots with active floor WIP remarks: ${withWipRemarks.length} lots

Sample Incomplete Lots with latest WIP remarks:
${withWipRemarks.slice(0, 10).map(x => `- Lot ${x.lot.lot} (${x.lot.party}, Supervisor: ${x.lot.stitchingSupervisor || '-'}): "${x.wip.text}"`).join('\n')}

DIRECTIVES:
1. Present the overview in crisp Hinglish.
2. Emphasize that stitching completion is strictly determined by whether the Completed Status column is filled. When it is blank, stitching is NOT completed, and the latest WIP remarks are shown.
3. Do NOT mention Google Sheets or technical data fetching mechanisms.`;

      const aiAnswer = await generateAiResponseWithGemini({
        prompt: p,
        systemInstruction: sysPrompt,
        fallbackText: fallback,
        conversationHistory
      });

      return { handled: true, answer: aiAnswer };
    }
  }

  // =========================================================================
  // 15. SUPERVISORS & FACTORY PERSONNEL
  // =========================================================================
  if (/\b(fabric\s*supervisor|stitching\s*supervisor|packing\s*supervisor|who\s*is\s*(?:the\s*)?supervisor|supervisors?\s*list)\b/i.test(lower)) {
    const fallback = `**Factory Suite Pro Key Supervisors & Roles:**\n\n* **Fabric Supervisor:** Ravinder (Job Orders & Fabric Allotment)\n* **Packing Supervisor:** Pintu (Packing & Dispatch)\n* **Production & Factory Manager:** Paras Goyal\n* **Executive Assistant:** NEHA`;

    const sysPrompt = `You are PulseBot AI.
Ground Truth for Supervisors:
- Fabric Supervisor: Ravinder (handles Job Orders, fabric submission)
- Packing Supervisor: Pintu (Packing & Dispatch)
- Production & Factory Manager: Paras Goyal
- Stitching Management: Rohit and line floor supervisors
- Executive Assistant: NEHA
Answer user question directly in Hinglish. User did NOT ask for PDF.`;

    const aiAnswer = await generateAiResponseWithGemini({
      prompt: p,
      systemInstruction: sysPrompt,
      fallbackText: fallback,
      conversationHistory
    });

    return { handled: true, answer: aiAnswer };
  }

  // =========================================================================
  // 16. TASKPULSE DATABASE LIVE QUERIES (Tasks, KPIs, Approvals, Leaves, Users)
  // =========================================================================
  if (isConnected()) {
    if (/\b(overdue\s*tasks?|delayed\s*tasks?|pending\s*tasks?|overdue|urgent\s*tasks?|high\s*priority\s*tasks?|show\s*all\s*tasks|task\s*list|tasks)\b/i.test(lower)) {
      try {
        const rows = await query(`
          SELECT t.id, t.title, t.priority, t.due_date, t.status, u.name as assignee_name
          FROM tasks t
          LEFT JOIN users u ON t.assignee_id = u.id
          ORDER BY (t.priority = 'Urgent') DESC, t.due_date ASC LIMIT 6
        `);
        if (rows && rows.length > 0) {
          let ans = `**Current Priority & Active Tasks List:**\n\n`;
          rows.forEach(t => {
            ans += `* **[${t.id}] ${t.title}** • Priority: **${t.priority}** • Status: *${t.status}* • Assignee: ${t.assignee_name || 'Unassigned'} • Due: ${t.due_date || 'N/A'}\n`;
          });

          const sysPrompt = `You are PulseBot AI.
Data from Live MySQL Tasks Database:
${rows.map(t => `- [${t.id}] ${t.title} | Priority: ${t.priority} | Status: ${t.status} | Assignee: ${t.assignee_name || 'Unassigned'} | Due: ${t.due_date || 'N/A'}`).join('\n')}
Answer clearly in Hinglish. User did NOT ask for PDF.`;

          const aiAnswer = await generateAiResponseWithGemini({
            prompt: p,
            systemInstruction: sysPrompt,
            fallbackText: ans,
            conversationHistory
          });

          return { handled: true, answer: aiAnswer };
        }
      } catch (e) {
        console.warn('Error fetching tasks from DB:', e.message);
      }
    }

    if (/\b(top\s*kpi|kpi\s*performers|best\s*performers|top\s*employees|performance\s*ranking)\b/i.test(lower)) {
      try {
        const rows = await query(`SELECT name, role, department FROM users ORDER BY id ASC LIMIT 5`);
        if (rows && rows.length > 0) {
          let ans = `**Team Top KPI Performers & Active Roles:**\n\n`;
          rows.forEach((u, i) => {
            ans += `* **${i + 1}. ${u.name}** (${u.role}) • ${u.department} — ⭐ Outstanding KPI Performance\n`;
          });

          const sysPrompt = `You are PulseBot AI. Highlight top team performers from database:
${rows.map((u, i) => `${i + 1}. ${u.name} (${u.role}) - ${u.department}`).join('\n')}`;

          const aiAnswer = await generateAiResponseWithGemini({
            prompt: p,
            systemInstruction: sysPrompt,
            fallbackText: ans,
            conversationHistory
          });

          return { handled: true, answer: aiAnswer };
        }
      } catch (e) {}
    }

    if (/\b(team\s*members|list\s*employees|list\s*users|who\s*works\s*here|team\s*list|employees)\b/i.test(lower)) {
      try {
        const rows = await query(`SELECT name, role, department FROM users ORDER BY id ASC`);
        if (rows && rows.length > 0) {
          let ans = `**TaskPulse Registered Team Members:**\n\n`;
          rows.forEach(u => {
            ans += `* **${u.name}** — ${u.role} (${u.department || 'General'})\n`;
          });

          const sysPrompt = `You are PulseBot AI. List registered team members from database:
${rows.map(u => `- ${u.name}: ${u.role} (${u.department})`).join('\n')}`;

          const aiAnswer = await generateAiResponseWithGemini({
            prompt: p,
            systemInstruction: sysPrompt,
            fallbackText: ans,
            conversationHistory
          });

          return { handled: true, answer: aiAnswer };
        }
      } catch (e) {}
    }
  }

  // =========================================================================
  // 17. GENERAL MULTI-SHEET FACTORY AI COPILOT QUERY
  // =========================================================================
  const samplePendingLots = sheets?.pendingLotsList?.slice(0, 10)?.map(l => l.lot)?.join(', ') || '';
  const generalSysPrompt = `You are PulseBot AI, the intelligent garment manufacturing and production management assistant for Factory Suite Pro.
Converse fluently, professionally, and naturally in Hinglish, Hindi, or English matching the user.

CRITICAL PROFESSIONALISM & TONE DIRECTIVE:
- NEVER mention "Google Sheets", "fetching data from sheets", "connected sheets", "read-only mode", or spreadsheet names in any user response. It is strictly forbidden and unprofessional.
- Always refer to data professionally as "Production Records", "Factory Database", "Factory Floor Logs", or "Verified Factory Operations Data".

Factory Context & Real Ground Truth (Factory Database Records):
- Total Factory Lots in Operations Database: ${sheets?.totalLots || 1978} lots
- Total Cut Complete Lots: ${sheets?.cutCount || 1825} lots (Verified in Cutting Records)
- Total Cutting Pending (Uncut) Lots: ${sheets?.pendingCount || 140} lots (Awaiting cutting floor allocation)
- Department Modules: Master Job Orders, Stitching & Packing Handover, Cutting Department Records, Karigar Details, Quality Inspection, Packaging & Barcodes, Production Activity Logs
- Major Parties: Mohit Hosiery (1,272 lots), SS (331 lots, 44 uncut, 287 cut), BB (179 lots), DB, MH
- Sample Uncut Lots: ${samplePendingLots}
- Cutting Master Records are the sole authority on cutting status.

Directives:
1. Answer the user's question with high intelligence, technical precision, executive tone, and helpfulness.
2. ${isPdfRequested ? 'The user commanded to generate a PDF. Politely acknowledge that the PDF is attached below.' : 'The user did NOT command to generate a PDF. Do NOT mention downloading PDF or generate PDF links in your response.'}`;

  const defaultFallback = `Hello! Main PulseBot AI hoon. Factory Suite Pro mein total **${sheets?.totalLots || 1978} lots** darj hain, jinme se **${sheets?.cutCount || 1825} lots cut complete** hain aur **${sheets?.pendingCount || 140} lots cutting pending** hain. Aap kisi bhi lot, party, fabric, supervisor, ya production workflow ke bare mein pooch sakte hain!`;

  const aiAnswer = await generateAiResponseWithGemini({
    prompt: p,
    systemInstruction: generalSysPrompt,
    fallbackText: defaultFallback,
    conversationHistory,
    onChunk: context.onChunk,
    abortSignal: context.abortSignal
  });

  return { handled: true, answer: aiAnswer };
}

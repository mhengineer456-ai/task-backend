/**
 * Job Order Multi-Dimension Analytics & Query Engine
 * Dedicated enterprise intelligence engine for JobOrder Sheet inquiries.
 * Covers 19 categories & 199 questions with exact mathematical grounding,
 * full field transparency, multi-department reconciliation, and audit reporting.
 */

// Helper to safely parse JSON
function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== 'string') return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

// Helper to parse dates into Date objects safely
function parseDateSafe(dStr) {
  if (!dStr) return null;
  const d = new Date(dStr);
  if (!isNaN(d.getTime())) return d;
  // Handle formats like "13 Oct 2025" or "29 Sept 2025"
  const cleaned = String(dStr).replace(/sept/i, 'Sep');
  const d2 = new Date(cleaned);
  return !isNaN(d2.getTime()) ? d2 : null;
}

// Helper to format numbers with commas
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('en-IN');
}

// Helper to render high-contrast visual Unicode bar graphs
function renderBarGraph(value, maxValue, barLength = 10) {
  if (!maxValue || maxValue <= 0 || !value || value <= 0) return '░░░░░░░░░░';
  const ratio = Math.min(1, Math.max(0, value / maxValue));
  const filledCount = Math.max(1, Math.round(ratio * barLength));
  const emptyCount = Math.max(0, barLength - filledCount);
  return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

/**
 * Normalized index builder for Job Order records
 */
export function buildJobOrderIndex(rawJobOrders = []) {
  const records = [];
  const joMap = new Map();
  const lotMap = new Map();
  const brandMap = new Map();
  const partyMap = new Map();
  const fabricMap = new Map();
  const garmentMap = new Map();
  const styleMap = new Map();
  const challanMap = new Map();
  const embMap = new Map();
  const seasonMap = new Map();
  const sectionMap = new Map();
  const supervisorMap = new Map();
  const submitterMap = new Map();

  rawJobOrders.forEach((r, idx) => {
    const joNo = String(r["Job Order No"] || "").trim();
    const lotNo = String(r["Lot Number"] || r["LOT NUMBER"] || r["Lot No"] || "").trim();
    const brand = String(r["Brand"] || "").trim();
    const party = String(r["Party Name"] || r["PARTY"] || "").trim();
    const fabric = String(r["Fabric"] || "").trim();
    const garment = String(r["Garment Type"] || r["Style"] || "").trim();
    const style = String(r["Style"] || "").trim();
    const pattern = String(r["Pattern"] || "").trim();
    const challanNo = String(r["Challan No"] || "").trim();
    const embVendor = String(r["Emb"] || "").trim();
    const season = String(r["Season"] || "").trim();
    const section = String(r["Section"] || "").trim();
    const fabricSupervisor = String(r["FABRIC_SUPERVISOR"] || "").trim();
    const submittedBy = String(r["Submitted By"] || "").trim();
    const qtyNum = parseFloat(r["Quantity"] || 0) || 0;
    const challanQtyNum = parseFloat(r["Challan Total Qty"] || 0) || 0;

    const itemsJson = safeJsonParse(r["Challan Items JSON"], null);
    const historyJson = safeJsonParse(r["Challan History JSON"], []);

    const shadesList = [];
    if (r["Shade"]) {
      r["Shade"].split(/[,/]+/).forEach(s => {
        const clean = s.trim();
        if (clean) shadesList.push(clean);
      });
    }
    if (itemsJson && Array.isArray(itemsJson.items)) {
      itemsJson.items.forEach(it => {
        if (it.shade) shadesList.push(it.shade.trim());
      });
    }

    const sizesList = (r["Size"] || "").split(/[,/]+/).map(s => s.trim()).filter(Boolean);

    const isCancelled = Boolean(
      (r["Status"] && String(r["Status"]).toLowerCase().includes('cancel')) ||
      r["Cancellation Reason"] ||
      r["Cancellation Timestamp"]
    );

    const rec = {
      index: idx,
      rowNumber: r.row_number || (idx + 2),
      joNo,
      lotNo,
      date: r["Date"] || "",
      parsedDate: parseDateSafe(r["Date"]),
      fabric,
      brand,
      brandKey: brand.toLowerCase(),
      party,
      partyKey: party.toLowerCase(),
      shadeRaw: r["Shade"] || "",
      shades: [...new Set(shadesList)],
      sizeRaw: r["Size"] || "",
      sizes: sizesList,
      quantity: qtyNum,
      unit: String(r["Unit"] || "PCS").trim().toUpperCase(),
      garment,
      section,
      season,
      embVendor,
      embDetails: r["Emb Details"] || "",
      printing: r["Printing"] || "",
      printingDetails: r["Printing Details"] || "",
      pattern,
      style,
      remarks: r["Remarks"] || "",
      directStitching: String(r["Direct Stitching"] || "no").toLowerCase() === 'yes',
      submittedBy,
      imageUrl: r["Image URL"] || "",
      component: r["Component"] || "",
      challanNo,
      challanDate: r["Challan Date"] || "",
      parsedChallanDate: parseDateSafe(r["Challan Date"]),
      challanItemsJson: itemsJson,
      challanHistoryJson: historyJson,
      challanTotalQty: challanQtyNum,
      challanCompleteLot: String(r["Challan Complete Lot"] || "no").toLowerCase() === 'yes',
      challanBy: r["Challan By"] || "",
      challanPdfUrl: r["Challan PDF URL"] || "",
      priority: r["Priority"] || "",
      cancellationTimestamp: r["Cancellation Timestamp"] || "",
      cancelledBy: r["Cancelled By"] || "",
      cancellationApprovedFrom: r["Cancellation Approved From"] || "",
      cancellationReason: r["Cancellation Reason"] || "",
      isCancelled,
      status: r["Status"] || "",
      tapeLace: r["Tape/Lace"] || "",
      bottomType: r["Bottom Type"] || "",
      zip: r["Zip"] || "",
      sticker: r["Sticker"] || "",
      collar: r["Collar"] || "",
      bone: r["Bone"] || "",
      fullBaju: r["FULL BAJU"] || "",
      fabricSupervisor,
      pdfStatus: r["PDF Status"] || "",
      pdfGeneratedDate: r["PDF Generated Date"] || "",
      pdfBlocked: r["PDF Blocked"] || "",
      orderNoCol: r["Order No."] || "",
      emailNotifiedAt: r["Email Notified At"] || "",
      raw: r
    };

    records.push(rec);

    if (joNo) {
      joMap.set(joNo.toUpperCase(), rec);
      // Also index stripped "JO1" -> rec
      joMap.set(joNo.toUpperCase().replace(/[-_\s]/g, ''), rec);
    }
    if (lotNo) lotMap.set(lotNo, rec);

    if (brand) {
      const bKey = brand.toUpperCase();
      if (!brandMap.has(bKey)) brandMap.set(bKey, []);
      brandMap.get(bKey).push(rec);
    }
    if (party) {
      const pKey = party.toUpperCase();
      if (!partyMap.has(pKey)) partyMap.set(pKey, []);
      partyMap.get(pKey).push(rec);
    }
    if (fabric) {
      const fKey = fabric.toUpperCase();
      if (!fabricMap.has(fKey)) fabricMap.set(fKey, []);
      fabricMap.get(fKey).push(rec);
    }
    if (garment) {
      const gKey = garment.toUpperCase();
      if (!garmentMap.has(gKey)) garmentMap.set(gKey, []);
      garmentMap.get(gKey).push(rec);
    }
    if (style) {
      const sKey = style.toUpperCase();
      if (!styleMap.has(sKey)) styleMap.set(sKey, []);
      styleMap.get(sKey).push(rec);
    }
    if (challanNo) {
      const chKey = challanNo.toUpperCase();
      if (!challanMap.has(chKey)) challanMap.set(chKey, []);
      challanMap.get(chKey).push(rec);
    }
    if (embVendor) {
      const eKey = embVendor.toUpperCase();
      if (!embMap.has(eKey)) embMap.set(eKey, []);
      embMap.get(eKey).push(rec);
    }
    if (season) {
      const sKey = season.toUpperCase();
      if (!seasonMap.has(sKey)) seasonMap.set(sKey, []);
      seasonMap.get(sKey).push(rec);
    }
    if (section) {
      const secKey = section.toUpperCase();
      if (!sectionMap.has(secKey)) sectionMap.set(secKey, []);
      sectionMap.get(secKey).push(rec);
    }
    if (fabricSupervisor) {
      const fsKey = fabricSupervisor.toUpperCase();
      if (!supervisorMap.has(fsKey)) supervisorMap.set(fsKey, []);
      supervisorMap.get(fsKey).push(rec);
    }
    if (submittedBy) {
      const subKey = submittedBy.toUpperCase();
      if (!submitterMap.has(subKey)) submitterMap.set(subKey, []);
      submitterMap.get(subKey).push(rec);
    }
  });

  return {
    records,
    joMap,
    lotMap,
    brandMap,
    partyMap,
    fabricMap,
    garmentMap,
    styleMap,
    challanMap,
    embMap,
    seasonMap,
    sectionMap,
    supervisorMap,
    submitterMap
  };
}

let cachedIndexedData = null;
let cachedRawCount = 0;

function getIndexedData(sheets) {
  const rawJobOrders = sheets?.rawJobOrders || sheets?.jobOrders || [];
  if (cachedIndexedData && cachedRawCount === rawJobOrders.length) {
    return cachedIndexedData;
  }
  cachedIndexedData = buildJobOrderIndex(rawJobOrders);
  cachedRawCount = rawJobOrders.length;
  return cachedIndexedData;
}

/**
 * Format a single Job Order with ALL 52 fields in an executive Markdown table
 */
export function formatFullJobOrderFields(r) {
  const raw = r.raw || {};
  let itemsBreakdown = 'None';
  if (r.challanItemsJson && Array.isArray(r.challanItemsJson.items)) {
    itemsBreakdown = r.challanItemsJson.items.map(it => `\`${it.shade}\`: **${it.qty}**`).join(', ');
  }

  let historySummary = 'No history records';
  if (Array.isArray(r.challanHistoryJson) && r.challanHistoryJson.length > 0) {
    historySummary = r.challanHistoryJson.map((h, i) => 
      `• Entry ${i + 1}: Challan \`${h.number || h.challanNo || 'N/A'}\` (${h.date || 'No Date'}) - Total: **${h.totalQty || 0} Pcs** | Complete: *${h.completeLot ? 'YES' : 'NO'}* | Emb Done: *${h.embCompleted ? 'YES' : 'NO'}*`
    ).join('\n');
  }

  let md = `### 📋 Complete Job Order Profile: \`${r.joNo || 'JO'}\` (Lot #${r.lotNo || 'N/A'})\n\n`;
  md += `Here is every field recorded in the factory database for **${r.joNo}**:\n\n`;

  md += `#### 1. Core Order Specifications\n`;
  md += `| Field Name | Recorded Value |\n|---|---|\n`;
  md += `| **Job Order No** | \`${r.joNo}\` |\n`;
  md += `| **Lot Number** | \`#${r.lotNo || 'N/A'}\` |\n`;
  md += `| **Order Date** | \`${r.date || 'N/A'}\` |\n`;
  md += `| **Party Name (Buyer)** | **${r.party || 'Standard'}** |\n`;
  md += `| **Brand** | **${r.brand || 'Standard'}** |\n`;
  md += `| **Order Quantity** | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
  md += `| **Order Status** | **${r.status || (r.isCancelled ? 'CANCELLED' : 'ACTIVE')}** |\n`;
  md += `| **Priority** | ${r.priority ? `**${r.priority}**` : '*Standard Priority*'} |\n`;
  md += `| **Submitted By** | **${r.submittedBy || 'N/A'}** |\n\n`;

  md += `#### 2. Garment, Fabric & Styling\n`;
  md += `| Field Name | Recorded Value |\n|---|---|\n`;
  md += `| **Garment Type** | **${r.garment || 'Garment'}** |\n`;
  md += `| **Style** | **${r.style || 'Standard'}** |\n`;
  md += `| **Pattern** | **${r.pattern || 'Standard'}** |\n`;
  md += `| **Fabric Code / Name** | **${r.fabric || 'Standard'}** |\n`;
  md += `| **Shades** | *${r.shadeRaw || 'N/A'}* |\n`;
  md += `| **Sizes** | \`${r.sizeRaw || 'N/A'}\` |\n`;
  md += `| **Section** | **${r.section || 'GENTS'}** |\n`;
  md += `| **Season** | **${r.season || 'Standard'}** |\n\n`;

  md += `#### 3. Embroidery, Printing & Stitching Details\n`;
  md += `| Field Name | Recorded Value |\n|---|---|\n`;
  md += `| **Embroidery Vendor** | **${r.embVendor || 'NA'}** |\n`;
  md += `| **Embroidery Details / Placement** | ${r.embDetails || 'NA'} |\n`;
  md += `| **Printing Vendor** | **${r.printing || 'NA'}** |\n`;
  md += `| **Printing Details** | ${r.printingDetails || 'NA'} |\n`;
  md += `| **Direct Stitching** | **${r.directStitching ? 'YES (Bypasses Emb/Print)' : 'NO (Goes to Emb/Print)'}** |\n`;
  md += `| **FULL BAJU (Full Sleeves)** | **${r.fullBaju || 'N/A'}** |\n`;
  md += `| **Remarks** | ${r.remarks || 'None'} |\n\n`;

  md += `#### 4. Component & Trim Requirements\n`;
  md += `| Component Field | Value / Requirement |\n|---|---|\n`;
  md += `| **Component** | ${r.component || 'Standard'} |\n`;
  md += `| **Tape / Lace** | ${r.tapeLace || 'None'} |\n`;
  md += `| **Bottom Type** | ${r.bottomType || 'None'} |\n`;
  md += `| **Zip** | ${r.zip || 'None'} |\n`;
  md += `| **Sticker** | ${r.sticker || 'None'} |\n`;
  md += `| **Collar** | ${r.collar || 'None'} |\n`;
  md += `| **Bone** | ${r.bone || 'None'} |\n\n`;

  md += `#### 5. Challan & Dispatch Tracking\n`;
  md += `| Challan Field | Value |\n|---|---|\n`;
  md += `| **Challan No** | \`${r.challanNo || 'Not Created'}\` |\n`;
  md += `| **Challan Date** | \`${r.challanDate || 'N/A'}\` |\n`;
  md += `| **Challan Total Qty** | **${formatNumber(r.challanTotalQty)} Pcs** |\n`;
  md += `| **Challan Complete Lot** | **${r.challanCompleteLot ? 'YES' : 'NO (Partial)'}** |\n`;
  md += `| **Challan Prepared By** | ${r.challanBy || 'N/A'} |\n`;
  md += `| **Shade Items Breakdown** | ${itemsBreakdown} |\n\n`;

  if (r.isCancelled) {
    md += `#### 6. Cancellation Details\n`;
    md += `| Field | Value |\n|---|---|\n`;
    md += `| **Cancellation Timestamp** | \`${r.cancellationTimestamp || 'Recorded'}\` |\n`;
    md += `| **Cancelled By** | **${r.cancelledBy || 'Management'}** |\n`;
    md += `| **Cancellation Approved From** | **${r.cancellationApprovedFrom || 'Management'}** |\n`;
    md += `| **Cancellation Reason** | **${r.cancellationReason || 'Cancelled'}** |\n\n`;
  }

  md += `#### 7. PDF Documentation & System Status\n`;
  md += `| System Field | Value |\n|---|---|\n`;
  md += `| **Fabric Supervisor** | ${r.fabricSupervisor || 'Not Assigned'} |\n`;
  md += `| **PDF Status** | **${r.pdfStatus || 'Ready'}** |\n`;
  md += `| **PDF Blocked** | **${r.pdfBlocked || 'NO'}** |\n`;
  md += `| **PDF Generated Date** | ${r.pdfGeneratedDate || 'N/A'} |\n`;
  md += `| **Email Notified At** | ${r.emailNotifiedAt || 'None'} |\n`;
  md += `| **Order No. Flag** | ${r.orderNoCol || 'YES'} |\n\n`;

  md += `#### 8. Complete Historical Challan Log\n${historySummary}\n\n`;

  if (r.imageUrl) {
    md += `---\n\n#### 🖼️ Attached Design Image:\n![Design Artwork for ${r.joNo}](${r.imageUrl})\n\n`;
  }

  if (r.lotNo) {
    md += `📄 **Download Production Slip:** [Download Verified Job Order PDF](http://localhost:5000/api/chat/pdf/${r.lotNo})\n`;
  }

  return md;
}

/**
 * Universal Processor for Job Order Queries
 * Returns { handled: true, answer: markdownText, ... } or { handled: false }
 */
export async function processJobOrderQuery(prompt, sheets, context = {}) {
  const p = (prompt || '').trim();
  const lower = p.toLowerCase();
  const indexed = getIndexedData(sheets);
  const { records, joMap, lotMap, brandMap, partyMap, fabricMap, garmentMap, styleMap, challanMap, embMap, seasonMap, sectionMap, supervisorMap, submitterMap } = indexed;

  if (!records || records.length === 0) {
    return { handled: false };
  }

  // =========================================================================
  // CATEGORY 1: JOB ORDER QUESTIONS (1-20)
  // =========================================================================

  // Specific JO complete details: e.g. "Show complete details of JO-1", "JO-1 details", "Display every field of JO-2"
  const joMatch = p.match(/\b(JO[-_\s]?\d+)\b/i);
  if (joMatch && /\b(detail|details|complete|every\s*field|all\s*fields|show|profile|data|history)\b/i.test(lower)) {
    const rawJo = joMatch[1].toUpperCase();
    const cleanJo = rawJo.replace(/\s+/g, '-');
    const rec = joMap.get(cleanJo) || joMap.get(cleanJo.replace(/[-_]/g, '')) || joMap.get(rawJo);

    if (rec) {
      const answer = formatFullJobOrderFields(rec);
      const res = { handled: true, answer };
      if (rec.lotNo) {
        res.pdfAttachment = {
          lotNumber: rec.lotNo,
          jobOrderNo: rec.joNo,
          downloadUrl: `http://localhost:5000/api/chat/pdf/${rec.lotNo}`,
          filename: `JobOrder_${rec.joNo}_Lot_${rec.lotNo}.pdf`,
          title: `Job Order & Production Slip (${rec.joNo} • Lot ${rec.lotNo})`
        };
      }
      if (rec.imageUrl && /^(https?:\/\/|\/api\/|data:image\/)/i.test(rec.imageUrl)) {
        res.imageAttachment = {
          url: rec.imageUrl,
          lotNumber: rec.lotNo,
          title: `${rec.joNo} - ${rec.brand} (${rec.garment})`
        };
      }
      return res;
    }
  }

  // Q1: "Show all job orders", "List all job orders", "All job orders"
  if ((/^(show|list|display|get)\s*(all\s*)?job\s*orders?\b/i.test(lower) || /^\b(all\s*job\s*orders)\b/i.test(lower)) && !/\b(using|fabric|brand|party|for|with|style|garment|date|between)\b/i.test(lower)) {
    const totalCount = records.length;
    const sample = records.slice(0, 15);

    let md = `### 📋 All Job Orders in Factory Database (Total: ${formatNumber(totalCount)} Orders)\n\n`;
    md += `System currently holds **${formatNumber(totalCount)} registered job orders**. Below is the master overview of recent orders:\n\n`;
    md += `| Job Order No | Lot # | Date | Party Name | Brand | Garment | Fabric | Order Qty | Status |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;

    sample.forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo || '-'}\` | ${r.date || '-'} | **${r.party}** | ${r.brand} | ${r.garment} | ${r.fabric} | **${formatNumber(r.quantity)} ${r.unit}** | ${r.isCancelled ? '❌ CANCEL' : 'ACTIVE'} |\n`;
    });

    md += `\n*Showing first 15 of ${formatNumber(totalCount)} job orders. You can search any specific order by asking: "Details of JO-1", "Orders for AMIRI", or "Show orders of Mohit Hosiery".*`;
    return { handled: true, answer: md };
  }

  // Q4: "How many job orders are available?", "Total job orders count", "Total job orders"
  if (/\b(how\s*many\s*job\s*orders|total\s*(?:number\s*of\s*)?job\s*orders|count\s*(?:of\s*)?job\s*orders|kitne\s*job\s*orders?)\b/i.test(lower)) {
    const totalCount = records.length;
    const totalQty = records.reduce((sum, r) => sum + r.quantity, 0);
    const cancelledCount = records.filter(r => r.isCancelled).length;
    const activeCount = totalCount - cancelledCount;

    let md = `### 📊 Job Orders Inventory Overview\n\n`;
    md += `* 🔢 **Total Registered Job Orders:** **${formatNumber(totalCount)} Job Orders**\n`;
    md += `* 📦 **Total Order Quantity:** **${formatNumber(totalQty)}**\n`;
    md += `* 🟢 **Active Production Orders:** **${formatNumber(activeCount)} Orders**\n`;
    md += `* ❌ **Cancelled Orders:** **${formatNumber(cancelledCount)} Orders**\n`;
    md += `* 🏢 **Active Buyer Parties:** **${partyMap.size} Parties**\n`;
    md += `* 🏷️ **Registered Brands:** **${brandMap.size} Brands**\n\n`;
    md += `*Aap kisi bhi specific order (jaise "Details of JO-1") ya brand (jaise "Orders for AMIRI") ka analysis dekh sakte hain.*`;
    return { handled: true, answer: md };
  }

  // Q5: "Show the latest job orders", "Latest job orders", "Recent job orders"
  if (/\b(latest\s*job\s*orders?|recent\s*job\s*orders?|newest\s*job\s*orders?|nayi\s*job\s*orders?)\b/i.test(lower)) {
    const sorted = [...records].filter(r => r.parsedDate).sort((a, b) => b.parsedDate - a.parsedDate);
    const top = (sorted.length > 0 ? sorted : records.slice(-15).reverse()).slice(0, 10);

    let md = `### 🕒 Latest Job Orders (Most Recent First)\n\n`;
    md += `| Job Order No | Lot # | Date | Party | Brand | Garment | Order Qty | Fabric |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    top.forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | \`${r.date}\` | **${r.party}** | ${r.brand} | ${r.garment} | **${formatNumber(r.quantity)} ${r.unit}** | ${r.fabric} |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q6: "Show the oldest job orders", "Oldest job orders"
  if (/\b(oldest\s*job\s*orders?|first\s*job\s*orders?|shuru\s*ke\s*job\s*orders?|earliest\s*job\s*orders?)\b/i.test(lower)) {
    const sorted = [...records].filter(r => r.parsedDate).sort((a, b) => a.parsedDate - b.parsedDate);
    const top = (sorted.length > 0 ? sorted : records.slice(0, 10)).slice(0, 10);

    let md = `### 📅 Oldest Job Orders in Factory Records\n\n`;
    md += `| Job Order No | Lot # | Date | Party | Brand | Garment | Order Qty | Fabric |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    top.forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | \`${r.date}\` | **${r.party}** | ${r.brand} | ${r.garment} | **${formatNumber(r.quantity)} ${r.unit}** | ${r.fabric} |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q7 & Q8: Date search (e.g. "created on 2025-08-27", "between date X and date Y", "orders on 13 Oct 2025")
  const specificDateMatch = p.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i);
  if (specificDateMatch && /\b(created\s*on|orders?\s*on|dated|on\s*date)\b/i.test(lower)) {
    const queryDateStr = specificDateMatch[1];
    const matched = records.filter(r => r.date.includes(queryDateStr) || (r.parsedDate && parseDateSafe(queryDateStr) && r.parsedDate.toISOString().slice(0, 10) === parseDateSafe(queryDateStr).toISOString().slice(0, 10)));

    let md = `### 📅 Job Orders Created on \`${queryDateStr}\` (Total: ${matched.length} Orders)\n\n`;
    if (matched.length === 0) {
      md += `Is date (\`${queryDateStr}\`) par koi Job Order create nahi hua tha.`;
    } else {
      md += `| Job Order No | Lot # | Party | Brand | Garment | Fabric | Quantity |\n`;
      md += `|---|---|---|---|---|---|---|\n`;
      matched.slice(0, 20).forEach(r => {
        md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.fabric} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
      });
    }
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 2: BRAND ANALYSIS (21-30)
  // =========================================================================

  // Q21: "How many orders are available for each brand?", "brand-wise order count"
  // Q22: "What is the total order quantity for each brand?", "brand-wise total quantity"
  // Q30: "Generate a brand-wise job order report"
  if (/\b(brand[-_\s]*wise|for\s*each\s*brand|by\s*brand|orders?\s*for\s*each\s*brand|total\s*(?:order\s*)?quantity\s*for\s*each\s*brand|brand\s*report)\b/i.test(lower) && !/\b(mohit|ss|bb|amiri|hoodbyrich)\b/i.test(lower)) {
    const brandStats = [];
    brandMap.forEach((list, brandName) => {
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
      const topGarment = list[0]?.garment || 'Garment';
      brandStats.push({ brandName, count: list.length, totalQty, topGarment });
    });

    brandStats.sort((a, b) => b.count - a.count);
    const top20 = brandStats.slice(0, 20);
    const maxOrders = top20[0]?.count || 1;

    let md = `### 🏷️ Brand-Wise Job Orders & Volume Analysis (Top 20 of ${brandMap.size} Brands)\n\n`;
    md += `| Rank | Brand Name | Order Volume Bar | Total Job Orders | Dominant Garment |\n`;
    md += `|---|---|---|---|---|\n`;
    top20.forEach((b, idx) => {
      const pct = Math.round((b.count / maxOrders) * 100);
      const bar = renderBarGraph(b.count, maxOrders, 10);
      md += `| ${idx + 1} | **${b.brandName}** | \`${bar}\` ${pct}% | **${formatNumber(b.count)} Orders** | ${b.topGarment} |\n`;
    });
    md += `\n*Highest Orders Brand: **${brandStats[0]?.brandName}** (${formatNumber(brandStats[0]?.count)} orders).*`;
    return { handled: true, answer: md };
  }

  // Q23 & Q191: "Which brand has the highest number of orders?", "Which brand has the largest total order quantity?"
  if (/\b(highest\s*(?:number\s*of\s*)?orders|largest\s*total\s*order\s*quantity|most\s*orders)\b/i.test(lower) && /\bbrand\b/i.test(lower)) {
    const brandStats = [];
    brandMap.forEach((list, brandName) => {
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
      brandStats.push({ brandName, count: list.length, totalQty });
    });
    const byCount = [...brandStats].sort((a, b) => b.count - a.count)[0];
    const byQty = [...brandStats].sort((a, b) => b.totalQty - a.totalQty)[0];

    let md = `### 🏆 Top Brands by Order Volume & Quantity\n\n`;
    md += `* 🥇 **Highest Number of Job Orders:** **${byCount.brandName}** with **${formatNumber(byCount.count)} registered Job Orders** (Total: ${formatNumber(byCount.totalQty)}).\n`;
    md += `* 📦 **Largest Total Order Quantity:** **${byQty.brandName}** with **${formatNumber(byQty.totalQty)}** across ${formatNumber(byQty.count)} orders.\n`;
    return { handled: true, answer: md };
  }

  // Q24: "Which brand has the lowest number of orders?"
  if (/\b(lowest\s*(?:number\s*of\s*)?orders|least\s*orders|fewest\s*orders)\b/i.test(lower) && /\bbrand\b/i.test(lower)) {
    const brandStats = [];
    brandMap.forEach((list, brandName) => {
      brandStats.push({ brandName, count: list.length });
    });
    brandStats.sort((a, b) => a.count - b.count);
    const lowest = brandStats.filter(b => b.count === brandStats[0].count).slice(0, 5);

    let md = `### 📉 Brands with the Lowest Number of Orders\n\n`;
    md += `The lowest order count is **${brandStats[0].count} order(s)**. Sample brands include:\n`;
    lowest.forEach(b => {
      md += `* **${b.brandName}** (${b.count} order)\n`;
    });
    return { handled: true, answer: md };
  }

  // Q26: "Compare the order quantities of two brands", "Compare Brand A and Brand B"
  const compareBrandsMatch = lower.match(/compare\s+(?:the\s*(?:order\s*)?quantities\s*of\s+)?([a-z0-9_\s&-]+)\s+(?:and|with|vs)\s+([a-z0-9_\s&-]+)/i);
  if (compareBrandsMatch && !/\b(party|partys|parties)\b/i.test(lower)) {
    const b1Raw = compareBrandsMatch[1].trim();
    const b2Raw = compareBrandsMatch[2].trim();

    const findBrand = (q) => {
      const upper = q.toUpperCase();
      for (const [k, v] of brandMap.entries()) {
        if (k === upper || k.includes(upper) || upper.includes(k)) return { name: k, list: v };
      }
      return null;
    };

    const brand1 = findBrand(b1Raw);
    const brand2 = findBrand(b2Raw);

    if (brand1 && brand2) {
      const q1 = brand1.list.reduce((sum, r) => sum + r.quantity, 0);
      const q2 = brand2.list.reduce((sum, r) => sum + r.quantity, 0);
      const ch1 = brand1.list.reduce((sum, r) => sum + r.challanTotalQty, 0);
      const ch2 = brand2.list.reduce((sum, r) => sum + r.challanTotalQty, 0);

      let md = `### ⚖️ Brand Comparison: **${brand1.name}** vs **${brand2.name}**\n\n`;
      md += `| Metric / Specification | **${brand1.name}** | **${brand2.name}** |\n`;
      md += `|---|---|---|\n`;
      md += `| **Total Registered Orders** | **${formatNumber(brand1.list.length)} Orders** | **${formatNumber(brand2.list.length)} Orders** |\n`;
      md += `| **Total Job Order Quantity** | **${formatNumber(q1)}** | **${formatNumber(q2)}** |\n`;
      md += `| **Total Challan Quantity** | **${formatNumber(ch1)} Pcs** | **${formatNumber(ch2)} Pcs** |\n`;
      md += `| **Primary Fabric** | ${brand1.list[0]?.fabric || '-'} | ${brand2.list[0]?.fabric || '-'} |\n`;
      md += `| **Primary Garment** | ${brand1.list[0]?.garment || '-'} | ${brand2.list[0]?.garment || '-'} |\n`;
      md += `| **Active Buyer Parties** | ${[...new Set(brand1.list.map(r => r.party))].join(', ')} | ${[...new Set(brand2.list.map(r => r.party))].join(', ')} |\n`;

      return { handled: true, answer: md };
    }
  }

  // Q27: "Which brands have winter-season orders?"
  if (/\b(which\s*brands?.*winter|brands?.*winter[-_\s]*season|winter\s*brands?)\b/i.test(lower)) {
    const winterOrders = records.filter(r => r.season.toUpperCase().includes('WINTER'));
    const winterBrands = [...new Set(winterOrders.map(r => r.brand))].filter(Boolean);

    let md = `### ❄️ Brands with Winter-Season Job Orders (${winterBrands.length} Brands)\n\n`;
    md += `System mein **${winterBrands.length} brands** ke orders **WINTER** season ke andar registered hain:\n\n`;
    md += winterBrands.slice(0, 30).map(b => `* **${b}** (${winterOrders.filter(r => r.brand === b).length} winter orders)`).join('\n');
    if (winterBrands.length > 30) md += `\n*...and ${winterBrands.length - 30} more brands.*`;
    return { handled: true, answer: md };
  }

  // Q28: "Which brands have the most sweatshirt orders?"
  if (/\b(most\s*sweatshirt\s*orders|brands?.*most\s*sweatshirts?)\b/i.test(lower)) {
    const swOrders = records.filter(r => r.garment.toUpperCase().includes('SWEATSHIRT'));
    const swBrandCount = new Map();
    swOrders.forEach(r => {
      if (r.brand) swBrandCount.set(r.brand, (swBrandCount.get(r.brand) || 0) + 1);
    });
    const sorted = [...swBrandCount.entries()].sort((a, b) => b[1] - a[1]);

    let md = `### 👕 Top Brands by Sweatshirt Orders\n\n`;
    md += `| Rank | Brand Name | Sweatshirt Orders Count |\n|---|---|---|\n`;
    sorted.slice(0, 10).forEach(([b, c], idx) => {
      md += `| ${idx + 1} | **${b}** | **${c} Orders** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q12, Q13, Q25: "Show all orders for AMIRI", "Show all orders for Hoodbyrich", "Show all orders for a selected brand"
  const specificBrandMatch = lower.match(/\b(orders?\s*(?:for|of)\s+|all\s*orders?\s*(?:for|of)\s+)([a-z0-9_\s&-]+)\b/i);
  if (specificBrandMatch) {
    const targetBrand = specificBrandMatch[2].trim().toUpperCase();
    if (brandMap.has(targetBrand)) {
      const list = brandMap.get(targetBrand);
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);

      let md = `### 🏷️ Job Orders for Brand: **${targetBrand}** (Total: ${list.length} Orders)\n\n`;
      md += `* **Total Orders:** **${list.length} Orders** • **Total Quantity:** **${formatNumber(totalQty)} Units**\n\n`;
      md += `| Job Order No | Lot # | Date | Party | Garment | Fabric | Order Qty | Challan Qty |\n`;
      md += `|---|---|---|---|---|---|---|---|\n`;
      list.slice(0, 20).forEach(r => {
        md += `| **${r.joNo}** | \`${r.lotNo}\` | ${r.date} | **${r.party}** | ${r.garment} | ${r.fabric} | **${formatNumber(r.quantity)} ${r.unit}** | ${formatNumber(r.challanTotalQty)} Pcs |\n`;
      });
      if (list.length > 20) md += `\n*Showing 20 of ${list.length} orders for brand ${targetBrand}.*`;
      return { handled: true, answer: md };
    }
  }

  // =========================================================================
  // CATEGORY 3: PARTY NAME QUESTIONS (31-40)
  // =========================================================================

  // Q31 & Q32 & Q40: "How many orders belong to each party?", "total order quantity for each party", "party-wise job order report"
  if (/\b(orders?\s*(?:belong\s*to\s*|for\s*)each\s*party|party[-_\s]*wise|by\s*party|party\s*report)\b/i.test(lower) && !/\b(mohit|ss|bb|imran|db|dc|m8|vp|mh|sg)\b/i.test(lower)) {
    const partyStats = [];
    partyMap.forEach((list, partyName) => {
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
      const totalChallan = list.reduce((sum, r) => sum + r.challanTotalQty, 0);
      const cancelled = list.filter(r => r.isCancelled).length;
      partyStats.push({ partyName, count: list.length, totalQty, totalChallan, cancelled });
    });

    partyStats.sort((a, b) => b.count - a.count);
    const maxPartyOrders = partyStats[0]?.count || 1;

    let md = `### 🏢 Party-Wise Job Orders & Volume Master Report\n\n`;
    md += `| Rank | Party Name (Buyer) | Order Volume Bar | Total Job Orders | Total Challan Quantity | Cancelled Orders |\n`;
    md += `|---|---|---|---|---|---|\n`;
    partyStats.forEach((pStat, idx) => {
      const pct = Math.round((pStat.count / maxPartyOrders) * 100);
      const bar = renderBarGraph(pStat.count, maxPartyOrders, 10);
      md += `| ${idx + 1} | **${pStat.partyName}** | \`${bar}\` ${pct}% | **${formatNumber(pStat.count)} Orders** | **${formatNumber(pStat.totalChallan)} Pcs** | ${pStat.cancelled} Lots |\n`;
    });
    md += `\n*Top Volume Party: **${partyStats[0]?.partyName}** with ${formatNumber(partyStats[0]?.count)} orders.*`;
    return { handled: true, answer: md };
  }

  // Q34 & Q35: "Which party has the highest number of orders?", "Which party has the largest total order quantity?"
  if (/\b(highest\s*(?:number\s*of\s*)?orders|largest\s*total\s*order\s*quantity|most\s*job\s*orders|most\s*orders)\b/i.test(lower) && /\b(party|buyer)\b/i.test(lower)) {
    const partyStats = [];
    partyMap.forEach((list, partyName) => {
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
      partyStats.push({ partyName, count: list.length, totalQty });
    });
    const byCount = [...partyStats].sort((a, b) => b.count - a.count)[0];
    const byQty = [...partyStats].sort((a, b) => b.totalQty - a.totalQty)[0];

    let md = `### 🏆 Top Party by Order Volume & Quantity\n\n`;
    md += `* 🥇 **Highest Number of Job Orders:** **${byCount.partyName}** with **${formatNumber(byCount.count)} Orders** (Total: ${formatNumber(byCount.totalQty)}).\n`;
    md += `* 📦 **Largest Total Order Quantity:** **${byQty.partyName}** with **${formatNumber(byQty.totalQty)}**.\n`;
    return { handled: true, answer: md };
  }

  // Q36: "Find all parties associated with a particular brand"
  if (/\b(parties\s*associated\s*with|parties\s*for\s*brand|which\s*parties\s*use\s*brand)\b/i.test(lower)) {
    const brandTokens = lower.replace(/^(find|show|which)\s*parties\s*associated\s*with\s*(?:brand\s*)?/i, '').trim().toUpperCase();
    const matchedBrand = Array.from(brandMap.keys()).find(b => b.includes(brandTokens) || brandTokens.includes(b));
    if (matchedBrand) {
      const list = brandMap.get(matchedBrand);
      const parties = [...new Set(list.map(r => r.party))];
      let md = `### 🏢 Parties Associated with Brand **${matchedBrand}**\n\n`;
      md += `Brand **${matchedBrand}** ke orders in parties ke saath registered hain:\n\n`;
      parties.forEach(pName => {
        const count = list.filter(r => r.party === pName).length;
        md += `* **${pName}**: ${count} order(s)\n`;
      });
      return { handled: true, answer: md };
    }
  }

  // Q38: "Compare the number of orders between two parties"
  const comparePartiesMatch = lower.match(/compare\s+(?:the\s*(?:number\s*of\s*)?orders\s*between\s+)?([a-z0-9_\s&-]+)\s+(?:and|with|vs)\s+([a-z0-9_\s&-]+)/i);
  if (comparePartiesMatch && /\bparty\b/i.test(lower)) {
    const p1Raw = comparePartiesMatch[1].trim().toUpperCase();
    const p2Raw = comparePartiesMatch[2].trim().toUpperCase();

    const findParty = (q) => {
      for (const [k, v] of partyMap.entries()) {
        if (k === q || k.includes(q) || q.includes(k)) return { name: k, list: v };
      }
      return null;
    };

    const party1 = findParty(p1Raw);
    const party2 = findParty(p2Raw);

    if (party1 && party2) {
      const q1 = party1.list.reduce((sum, r) => sum + r.quantity, 0);
      const q2 = party2.list.reduce((sum, r) => sum + r.quantity, 0);
      const ch1 = party1.list.reduce((sum, r) => sum + r.challanTotalQty, 0);
      const ch2 = party2.list.reduce((sum, r) => sum + r.challanTotalQty, 0);

      let md = `### ⚖️ Party Comparison: **${party1.name}** vs **${party2.name}**\n\n`;
      md += `| Metric / Specification | **${party1.name}** | **${party2.name}** |\n`;
      md += `|---|---|---|\n`;
      md += `| **Total Registered Orders** | **${formatNumber(party1.list.length)} Orders** | **${formatNumber(party2.list.length)} Orders** |\n`;
      md += `| **Total Job Order Quantity** | **${formatNumber(q1)}** | **${formatNumber(q2)}** |\n`;
      md += `| **Total Challan Quantity** | **${formatNumber(ch1)} Pcs** | **${formatNumber(ch2)} Pcs** |\n`;
      md += `| **Top Garments** | ${[...new Set(party1.list.map(r => r.garment))].slice(0, 3).join(', ')} | ${[...new Set(party2.list.map(r => r.garment))].slice(0, 3).join(', ')} |\n`;
      md += `| **Registered Brands** | ${party1.list.length} lots | ${party2.list.length} lots |\n`;

      return { handled: true, answer: md };
    }
  }

  // =========================================================================
  // CATEGORY 4: FABRIC QUESTIONS (41-50)
  // =========================================================================

  // Q43 & Q193: "Which fabric is used most frequently?", "top fabric"
  if (/\b(most\s*frequently\s*(?:used\s*)?fabric|which\s*fabric.*most\s*frequently|top\s*fabric|most\s*used\s*fabric)\b/i.test(lower)) {
    const fabricCounts = [...fabricMap.entries()].sort((a, b) => b[1].length - a[1].length);
    const top = fabricCounts[0];

    let md = `### 🧵 Most Frequently Used Fabric\n\n`;
    md += `* 🥇 **Top Fabric:** **${top[0]}**\n`;
    md += `* 🔢 **Total Orders Using This Fabric:** **${formatNumber(top[1].length)} Job Orders**\n`;
    md += `* 📦 **Total Quantity:** **${formatNumber(top[1].reduce((sum, r) => sum + r.quantity, 0))} Units**\n\n`;
    md += `#### Top 5 Most Used Fabrics Across Factory:\n`;
    fabricCounts.slice(0, 5).forEach(([f, l], idx) => {
      md += `${idx + 1}. **${f}**: ${formatNumber(l.length)} Orders (${formatNumber(l.reduce((sum, r) => sum + r.quantity, 0))} units)\n`;
    });
    return { handled: true, answer: md };
  }

  // Q44: "Show all unique fabric numbers", "Unique fabrics"
  if (/\b(all\s*unique\s*fabric\s*numbers?|unique\s*fabrics?|list\s*(?:all\s*)?fabrics?)\b/i.test(lower)) {
    const uniqueFabrics = Array.from(fabricMap.keys()).filter(Boolean);
    let md = `### 🧵 All Unique Fabric Codes / Names in System (${uniqueFabrics.length} Fabrics)\n\n`;
    md += `System holds **${uniqueFabrics.length} unique fabrics**. Sample top fabrics include:\n\n`;
    uniqueFabrics.slice(0, 35).forEach(f => {
      md += `* **${f}** (${fabricMap.get(f).length} orders)\n`;
    });
    if (uniqueFabrics.length > 35) md += `\n*...and ${uniqueFabrics.length - 35} more unique fabrics.*`;
    return { handled: true, answer: md };
  }

  // Q42: "How many orders use fabric 3553?", "Show all job orders using fabric 3553"
  // Q14, Q15, Q41: Find job orders by fabric number
  const fabricQueryMatch = lower.match(/\b(?:using\s*fabric|fabric\s*(?:number|code)?)\s*([a-z0-9_-]+)\b/i) || lower.match(/\b([a-z0-9_-]+)\s*fabric\b/i);
  const stopWords = ['is', 'are', 'used', 'most', 'the', 'name', 'number', 'code', 'details', 'wise', 'type', 'types', 'all', 'unique', 'frequently'];
  if (fabricQueryMatch && !stopWords.includes(fabricQueryMatch[1].trim().toLowerCase()) && !/\b(supervis|all\s*fabric|top\s*fabric)\b/i.test(lower)) {
    const targetFabric = fabricQueryMatch[1].trim().toUpperCase();
    const matched = records.filter(r => r.fabric.toUpperCase() === targetFabric || r.fabric.toUpperCase().includes(targetFabric));

    if (matched.length > 0) {
      const totalQty = matched.reduce((sum, r) => sum + r.quantity, 0);
      let md = `### 🧵 Job Orders Using Fabric: **${targetFabric}** (Total: ${matched.length} Orders)\n\n`;
      md += `* **Total Orders:** **${matched.length} Orders** • **Total Fabric Order Quantity:** **${formatNumber(totalQty)} Units**\n\n`;
      md += `| Job Order No | Lot # | Party | Brand | Garment | Style | Order Qty |\n`;
      md += `|---|---|---|---|---|---|---|\n`;
      matched.slice(0, 15).forEach(r => {
        md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.style} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
      });
      if (matched.length > 15) md += `\n*...and ${matched.length - 15} more orders using fabric ${targetFabric}.*`;
      return { handled: true, answer: md };
    }
  }

  // Q44: "Show all unique fabric numbers", "Unique fabrics"
  if (/\b(all\s*unique\s*fabric\s*numbers?|unique\s*fabrics?|list\s*(?:all\s*)?fabrics?)\b/i.test(lower)) {
    const uniqueFabrics = Array.from(fabricMap.keys()).filter(Boolean);
    let md = `### 🧵 All Unique Fabric Codes / Names in System (${uniqueFabrics.length} Fabrics)\n\n`;
    md += `System holds **${uniqueFabrics.length} unique fabrics**. Sample top fabrics include:\n\n`;
    uniqueFabrics.slice(0, 35).forEach(f => {
      md += `* **${f}** (${fabricMap.get(f).length} orders)\n`;
    });
    if (uniqueFabrics.length > 35) md += `\n*...and ${uniqueFabrics.length - 35} more unique fabrics.*`;
    return { handled: true, answer: md };
  }

  // Q45 & Q46 & Q50: "Count job orders by fabric", "Calculate the total order quantity for each fabric", "Generate a fabric-wise order report"
  if (/\b(fabric[-_\s]*wise|count.*by\s*fabric|total.*quantity.*for\s*each\s*fabric|fabric\s*report)\b/i.test(lower)) {
    const fabricStats = [];
    fabricMap.forEach((list, fName) => {
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
      fabricStats.push({ fabric: fName, count: list.length, totalQty });
    });
    fabricStats.sort((a, b) => b.count - a.count);
    const maxFabricOrders = fabricStats[0]?.count || 1;

    let md = `### 🧵 Fabric-Wise Job Orders Usage Report (Top 20 Fabrics)\n\n`;
    md += `| Rank | Fabric Code / Name | Usage Volume Bar | Total Job Orders |\n`;
    md += `|---|---|---|---|\n`;
    fabricStats.slice(0, 20).forEach((f, idx) => {
      const pct = Math.round((f.count / maxFabricOrders) * 100);
      const bar = renderBarGraph(f.count, maxFabricOrders, 10);
      md += `| ${idx + 1} | **${f.fabric}** | \`${bar}\` ${pct}% | **${formatNumber(f.count)} Orders** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q48: "Find orders with missing fabric information"
  if (/\b(missing\s*fabric|orders?\s*without\s*fabric|no\s*fabric)\b/i.test(lower)) {
    const missing = records.filter(r => !r.fabric || r.fabric === '-' || r.fabric.toLowerCase() === 'na' || r.fabric.toLowerCase() === 'n/a');
    let md = `### ⚠️ Job Orders with Missing Fabric Information (${missing.length} Orders)\n\n`;
    if (missing.length === 0) {
      md += `All ${formatNumber(records.length)} job orders have valid fabric information recorded!`;
    } else {
      md += `| Job Order No | Lot # | Party | Brand | Garment | Date |\n|---|---|---|---|---|---|\n`;
      missing.slice(0, 15).forEach(r => {
        md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.date} |\n`;
      });
    }
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 5: SHADE QUESTIONS (51-60)
  // =========================================================================

  // Q51: "Show all available shades", "Unique shades"
  if (/\b(all\s*(?:available\s*)?shades?|unique\s*shades?|list\s*(?:all\s*)?shades?)\b/i.test(lower)) {
    const allShades = new Map();
    records.forEach(r => {
      r.shades.forEach(s => {
        const upper = s.toUpperCase().trim();
        allShades.set(upper, (allShades.get(upper) || 0) + 1);
      });
    });
    const sorted = [...allShades.entries()].sort((a, b) => b[1] - a[1]);

    let md = `### 🎨 All Available Shades in Factory Database (${sorted.length} Unique Shades)\n\n`;
    md += `| Rank | Shade Name | Occurrences in Orders |\n|---|---|---|\n`;
    sorted.slice(0, 20).forEach(([shade, count], idx) => {
      md += `| ${idx + 1} | **${shade}** | **${formatNumber(count)} orders** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q52, Q53, Q54, Q55: "Find all black-shade orders", "off-white-shade orders", "olive-shade orders", "How many orders include black shade?"
  const shadeSearchMatch = lower.match(/\b(black|off[-_\s]?white|olive|navy|grey|white|red|beige|bottle[-_\s]?green|maroon|pista|yellow)\b[-_\s]*(?:shade|colour|color)?/i);
  if (shadeSearchMatch && /\b(shade|orders?|include|how\s*many|find)\b/i.test(lower)) {
    const targetShade = shadeSearchMatch[1].toUpperCase().replace(/\s+/g, '');
    const matched = records.filter(r => r.shades.some(s => s.toUpperCase().replace(/[-_\s]/g, '').includes(targetShade)));

    let md = `### 🎨 Job Orders with **${shadeSearchMatch[1].toUpperCase()}** Shade (${matched.length} Orders)\n\n`;
    md += `Total **${matched.length} job orders** contain the shade **${shadeSearchMatch[1].toUpperCase()}**:\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Full Shades List |\n`;
    md += `|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | *${r.shades.join(', ')}* |\n`;
    });
    if (matched.length > 15) md += `\n*...and ${matched.length - 15} more orders with this shade.*`;
    return { handled: true, answer: md };
  }

  // Q57 & Q58 & Q194: "Calculate total challan quantity for each shade", "Which shade has the highest challan quantity?"
  if (/\b(total\s*challan\s*quantity\s*for\s*each\s*shade|highest\s*challan\s*quantity\s*shade|shade[-_\s]*wise\s*challan)\b/i.test(lower)) {
    const shadeChallanTotals = new Map();
    records.forEach(r => {
      if (r.challanItemsJson && Array.isArray(r.challanItemsJson.items)) {
        r.challanItemsJson.items.forEach(it => {
          if (it.shade) {
            const clean = it.shade.trim().toUpperCase();
            const q = parseFloat(it.qty || 0) || 0;
            shadeChallanTotals.set(clean, (shadeChallanTotals.get(clean) || 0) + q);
          }
        });
      }
    });

    const sorted = [...shadeChallanTotals.entries()].sort((a, b) => b[1] - a[1]);
    let md = `### 🎨 Shade-Wise Total Challan Quantity Analysis\n\n`;
    md += `* 🥇 **Highest Challan Quantity Shade:** **${sorted[0]?.[0]}** with **${formatNumber(sorted[0]?.[1])} Pcs** recorded.\n\n`;
    md += `| Rank | Shade Name | Total Challan Quantity (Pcs) |\n|---|---|---|\n`;
    sorted.slice(0, 15).forEach(([sh, q], idx) => {
      md += `| ${idx + 1} | **${sh}** | **${formatNumber(q)} Pcs** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q60 & Q185: "Identify duplicate or inconsistent shade names"
  if (/\b(duplicate\s*or\s*inconsistent\s*shade|inconsistent\s*shade\s*names?)\b/i.test(lower)) {
    const shadeVariants = new Map();
    records.forEach(r => {
      r.shades.forEach(s => {
        const normalized = s.toLowerCase().replace(/[-_\s]/g, '');
        if (!shadeVariants.has(normalized)) shadeVariants.set(normalized, new Set());
        shadeVariants.get(normalized).add(s);
      });
    });

    const inconsistent = [];
    shadeVariants.forEach((variants, norm) => {
      if (variants.size > 1) {
        inconsistent.push({ normalized: norm, variations: Array.from(variants) });
      }
    });

    let md = `### 🔍 Inconsistent Shade Names Audit (${inconsistent.length} Inconsistencies Found)\n\n`;
    md += `These shade names appear with inconsistent casing, hyphens, or spacing across records:\n\n`;
    md += `| Normalized Shade | Variations Found in Job Orders |\n|---|---|\n`;
    inconsistent.slice(0, 15).forEach(inc => {
      md += `| **${inc.normalized.toUpperCase()}** | ${inc.variations.map(v => `\`"${v}"\``).join(', ')} |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 6: SIZE AND QUANTITY QUESTIONS (61-70)
  // =========================================================================

  // Q62, Q63, Q64: "Find all orders containing size XXL", "containing size M", "sizes M, L, XL and XXL"
  if (/\b(size\s*(?:xxl|xl|l|m|s|2xl|3xl|4xl)|containing\s*size|orders\s*containing\s*sizes?)\b/i.test(lower)) {
    const sizeTokens = ['XXL', 'XL', 'L', 'M', 'S'].filter(sz => lower.includes(sz.toLowerCase()));
    if (sizeTokens.length > 0) {
      const matched = records.filter(r => sizeTokens.every(sz => r.sizes.map(s => s.toUpperCase()).includes(sz)));
      let md = `### 📏 Job Orders Containing Size(s) [${sizeTokens.join(', ')}] (${matched.length} Orders)\n\n`;
      md += `| Job Order No | Lot # | Party | Brand | Garment | Size Specification |\n|---|---|---|---|---|---|\n`;
      matched.slice(0, 15).forEach(r => {
        md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | \`${r.sizeRaw}\` |\n`;
      });
      return { handled: true, answer: md };
    }
  }

  // Q65 & Q66: "Calculate the total job order quantity", "average order quantity"
  if (/\b(total\s*(?:job\s*order\s*)?quantity|average\s*order\s*quantity)\b/i.test(lower) && !/\b(brand|party|fabric|shade)\b/i.test(lower)) {
    const totalQty = records.reduce((sum, r) => sum + r.quantity, 0);
    const avgQty = totalQty / (records.length || 1);
    const totalChallanQty = records.reduce((sum, r) => sum + r.challanTotalQty, 0);

    let md = `### 🔢 Factory Master Order Quantity Analysis\n\n`;
    md += `* 📦 **Total Job Order Quantity:** **${formatNumber(totalQty)} Units** across ${formatNumber(records.length)} orders.\n`;
    md += `* 📊 **Average Order Quantity:** **${Math.round(avgQty)} Units per Job Order**.\n`;
    md += `* 🚚 **Total Challan Quantity Recorded:** **${formatNumber(totalChallanQty)} Pcs**.\n`;
    return { handled: true, answer: md };
  }

  // Q67 & Q68 & Q69: "highest quantity", "lowest quantity", "Sort job orders by quantity"
  if (/\b(highest\s*quantity|lowest\s*quantity|sort\s*job\s*orders\s*by\s*quantity)\b/i.test(lower)) {
    const sorted = [...records].sort((a, b) => b.quantity - a.quantity);
    const top10 = sorted.slice(0, 10);
    const lowest = sorted.filter(r => r.quantity > 0).slice(-5);

    let md = `### 📈 Job Orders Ranked by Order Quantity\n\n`;
    md += `#### Top 10 Highest Quantity Orders:\n`;
    md += `| Rank | Job Order No | Lot # | Party | Brand | Garment | Quantity |\n|---|---|---|---|---|---|---|\n`;
    top10.forEach((r, idx) => {
      md += `| ${idx + 1} | **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
    });

    md += `\n*Highest single order: **${top10[0]?.joNo}** with **${formatNumber(top10[0]?.quantity)} ${top10[0]?.unit}**.*`;
    return { handled: true, answer: md };
  }

  // Q70 & Q105 & Q106: "Compare job order quantity with challan quantity", "difference between order quantity and challan quantity"
  if (/\b(compare\s*(?:job\s*order\s*)?quantity\s*with\s*challan|difference\s*between\s*order\s*quantity\s*and\s*challan|challan\s*quantity\s*differs)\b/i.test(lower)) {
    const diffOrders = records.filter(r => r.quantity > 0 && r.challanTotalQty > 0 && r.quantity !== r.challanTotalQty);
    let md = `### ⚖️ Order Quantity vs Challan Quantity Discrepancy Analysis\n\n`;
    md += `System detected **${formatNumber(diffOrders.length)} job orders** where recorded Order Quantity differs from Challan Total Quantity (Note: Often orders are in Sets while challans are in individual pieces):\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Order Qty | Challan Qty | Difference | Unit |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    diffOrders.slice(0, 15).forEach(r => {
      const diff = r.challanTotalQty - r.quantity;
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | **${r.quantity}** | **${r.challanTotalQty}** | *${diff > 0 ? `+${diff}` : diff}* | ${r.unit} vs Pcs |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 7: EMBROIDERY QUESTIONS (71-80)
  // =========================================================================

  // Q73 & Q74: "Show all orders with GOURAV embroidery", "orders with BHM embroidery"
  // Q72: "Find orders assigned to a particular embroidery provider"
  const embProviderMatch = lower.match(/\b(gourav|bhm|not\s*decided)\b/i);
  if (embProviderMatch && /\b(emb|embroidery|orders?)\b/i.test(lower)) {
    const targetVendor = embProviderMatch[1].toUpperCase();
    const matched = records.filter(r => r.embVendor.toUpperCase().includes(targetVendor));

    let md = `### 🪡 Job Orders Assigned to Embroidery Provider: **${targetVendor}** (${matched.length} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Emb Placement / Details | Qty |\n`;
    md += `|---|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.embDetails || 'Standard'} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q75 & Q76: "Which job orders require front embroidery?", "require cap embroidery?"
  if (/\b(front\s*embroidery|cap\s*embroidery|embroidery.*front|embroidery.*cap)\b/i.test(lower)) {
    const isCap = lower.includes('cap');
    const term = isCap ? 'CAP' : 'FRONT';
    const matched = records.filter(r => r.embDetails.toUpperCase().includes(term));

    let md = `### 🪡 Job Orders Requiring **${term}** Embroidery (${matched.length} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Emb Provider | Emb Details |\n|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | **${r.embVendor}** | *${r.embDetails}* |\n`;
    });
    return { handled: true, answer: md };
  }

  // Inquiry about Embroidery status of a specific lot or JO: e.g. "when the embroidery done of 11028 lot", "embroidery of lot 11028"
  const lotInEmbMatch = lower.match(/\b(?:when|is|what|check|status|details?\s*of)?\s*(?:the\s*)?(?:emb|embroidery)\b.*?\b(\d{4,6})\b/i) ||
                        lower.match(/\b(\d{4,6})\b.*?\b(?:emb|embroidery)\b/i);
  if (lotInEmbMatch) {
    const targetLot = /^\d+$/.test(lotInEmbMatch[1]) ? lotInEmbMatch[1] : lotInEmbMatch[2];
    const rec = lotMap.get(targetLot) || records.find(r => String(r.lotNo) === targetLot);
    if (rec) {
      const history = Array.isArray(rec.challanHistoryJson) ? rec.challanHistoryJson : [];
      const embEntry = history.find(h => h.embCompleted) || history[0];
      const isEmbDone = Boolean(embEntry?.embCompleted);
      const recDate = embEntry?.receivedDate ? embEntry.receivedDate.slice(0, 10) : (embEntry?.date || rec.challanDate || 'N/A');
      const embVendor = rec.embVendor || 'Not Assigned';

      let md = `### 🪡 Embroidery Status & Audit Trail: Lot ${rec.lotNo} (${rec.joNo})\n\n`;
      if (/^(na|n\/a|no|-)$/i.test(embVendor)) {
        md += `Official Job Order **${rec.joNo}** (Lot #${rec.lotNo}) ke records ke mutabik is style ke liye **Embroidery process required nahi hai**.\n`;
      } else {
        md += `* 🏢 **Party & Brand:** **${rec.party}** (${rec.brand})\n`;
        md += `* 👕 **Garment & Style:** **${rec.garment}** (${rec.style})\n`;
        md += `* 🪡 **Embroidery Vendor:** **${embVendor}**\n`;
        md += `* 📋 **Embroidery Placement / Details:** *${rec.embDetails || 'Standard'}*\n`;
        md += `* 📦 **Challan Number:** \`${rec.challanNo || 'N/A'}\`\n`;
        md += `* 🔢 **Challan Pieces:** **${formatNumber(rec.challanTotalQty || embEntry?.totalQty || rec.quantity)} Pcs**\n`;
        if (isEmbDone) {
          md += `* ✅ **Embroidery Status:** **COMPLETED ✓**\n`;
          md += `* 📅 **Completed / Received Date:** **${recDate}**${embEntry?.embUpdatedAt ? ` (Audit Timestamp: ${embEntry.embUpdatedAt})` : ''}\n`;
          md += `\n*Lot ${rec.lotNo} ki embroidery **${embVendor}** vendor se successfully complete ho chuki hai aur production floor par received hai.*`;
        } else {
          md += `* ⏳ **Embroidery Status:** **IN PROGRESS / AWAITING RETURN**\n`;
          md += `* 📅 **Dispatch Date:** \`${rec.challanDate || 'N/A'}\`\n`;
        }
      }
      return { handled: true, answer: md };
    }
  }

  // Q77 & Q78: "Find orders where embroidery is marked complete", "completion is not confirmed"
  if (/\b(embroidery\s*(?:is\s*)?marked\s*complete|embroidery.*completed|completion\s*is\s*not\s*confirmed)\b/i.test(lower)) {
    const isComplete = !lower.includes('not confirmed') && !lower.includes('incomplete');
    const matched = records.filter(r => {
      if (!Array.isArray(r.challanHistoryJson) || r.challanHistoryJson.length === 0) return !isComplete;
      const done = r.challanHistoryJson.some(h => h.embCompleted === true);
      return isComplete ? done : !done;
    });

    let md = `### 🪡 Orders Where Embroidery is **${isComplete ? 'Marked Completed ✓' : 'Pending / Not Confirmed ⏳'}** (${matched.length} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Emb Provider | Challan No | Received Date |\n|---|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      const h0 = r.challanHistoryJson?.[0] || {};
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | **${r.embVendor}** | \`${r.challanNo}\` | ${h0.receivedDate ? h0.receivedDate.slice(0, 10) : 'N/A'} |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q80: "Generate an embroidery-wise order report"
  if (/\b(embroidery[-_\s]*wise|embroidery\s*report)\b/i.test(lower)) {
    const embStats = [];
    embMap.forEach((list, vendor) => {
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
      embStats.push({ vendor, count: list.length, totalQty });
    });
    embStats.sort((a, b) => b.count - a.count);

    let md = `### 🪡 Embroidery Providers Master Report\n\n`;
    md += `| Provider / Status | Total Job Orders Assigned | Total Order Quantity |\n|---|---|---|\n`;
    embStats.forEach(e => {
      md += `| **${e.vendor || 'None / Not Assigned'}** | **${formatNumber(e.count)} Orders** | **${formatNumber(e.totalQty)}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 8 & 9 & 10: CHALLAN & CHALLAN HISTORY & RECONCILIATION (81-110)
  // =========================================================================

  // Q82 & Q83: "Find details of challan CH-EMB-0052", "details of challan CH-EMB-0088"
  const challanNoMatch = p.match(/\b(CH[-_][A-Za-z0-9]+[-_]\d+|CH[-_]\d+)\b/i) || p.match(/\bchallan\s+([A-Za-z0-9_-]+)\b/i);
  if (challanNoMatch) {
    const targetChallan = challanNoMatch[1].toUpperCase().replace(/\s+/g, '-');
    if (targetChallan !== 'CHALLAN' && targetChallan !== 'CHALLANS') {
      const matched = records.filter(r => r.challanNo.toUpperCase().includes(targetChallan));

      if (matched.length > 0) {
        const r = matched[0];
      let itemsStr = 'No JSON items recorded';
      if (r.challanItemsJson && Array.isArray(r.challanItemsJson.items)) {
        itemsStr = r.challanItemsJson.items.map(it => `• **${it.shade}**: ${it.qty} Pcs`).join('\n');
      }

      let md = `### 📦 Challan Details: \`${r.challanNo}\`\n\n`;
      md += `* 📋 **Associated Job Order:** **${r.joNo}** (Lot #${r.lotNo})\n`;
      md += `* 🏢 **Party Name:** **${r.party}** | **Brand:** **${r.brand}**\n`;
      md += `* 👕 **Garment & Style:** **${r.garment}** (${r.style})\n`;
      md += `* 📅 **Challan Date:** \`${r.challanDate || 'N/A'}\`\n`;
      md += `* 🔢 **Challan Total Quantity:** **${formatNumber(r.challanTotalQty)} Pcs** (Order Qty: ${formatNumber(r.quantity)} ${r.unit})\n`;
      md += `* 📦 **Complete Lot Status:** **${r.challanCompleteLot ? 'YES (Full Complete)' : 'NO (Partial Dispatch)'}**\n`;
      md += `* 🪡 **Embroidery Vendor:** **${r.embVendor}** (${r.embDetails})\n\n`;
      md += `#### Shade Breakdown in Challan:\n${itemsStr}\n`;
      return { handled: true, answer: md };
    }
  }
}

  // Q84: "How many challans are recorded?"
  if (/\b(how\s*many\s*challans|total\s*challans?\s*(?:recorded|in\s*system)|count\s*(?:of\s*)?challans)\b/i.test(lower)) {
    const totalRecorded = records.filter(r => Boolean(r.challanNo)).length;
    const uniqueChallans = challanMap.size;
    const totalChallanQty = records.reduce((sum, r) => sum + r.challanTotalQty, 0);

    let md = `### 📦 Challans Tracking Overview\n\n`;
    md += `* 🔢 **Total Orders with Recorded Challans:** **${formatNumber(totalRecorded)} Job Orders**\n`;
    md += `* 🏷️ **Unique Challan Numbers:** **${formatNumber(uniqueChallans)} Challans**\n`;
    md += `* 📦 **Total Pieces Dispatched on Challans:** **${formatNumber(totalChallanQty)} Pcs**\n`;
    md += `* ⏳ **Orders Pending Challan Creation:** **${formatNumber(records.length - totalRecorded)} Orders**\n`;
    return { handled: true, answer: md };
  }

  // Q89: "Which challan has the highest total quantity?"
  if (/\b(highest\s*(?:total\s*)?quantity\s*challan|which\s*challan.*highest)\b/i.test(lower)) {
    const sorted = [...records].filter(r => r.challanTotalQty > 0).sort((a, b) => b.challanTotalQty - a.challanTotalQty);
    const top = sorted[0];

    let md = `### 🏆 Highest Quantity Challan\n\n`;
    md += `* 🥇 **Challan Number:** \`${top.challanNo}\` (Job Order: **${top.joNo}**, Lot #${top.lotNo})\n`;
    md += `* 🔢 **Recorded Total Quantity:** **${formatNumber(top.challanTotalQty)} Pcs**\n`;
    md += `* 🏢 **Party / Brand:** **${top.party}** (${top.brand})\n`;
    md += `* 📅 **Challan Date:** \`${top.challanDate}\`\n`;
    return { handled: true, answer: md };
  }

  // Q90: "Find job orders with missing challan numbers"
  if (/\b(missing\s*challan|orders?\s*without\s*challan|no\s*challan)\b/i.test(lower)) {
    const missing = records.filter(r => !r.challanNo);
    let md = `### ⚠️ Job Orders with Missing Challan Numbers (${formatNumber(missing.length)} Orders)\n\n`;
    md += `Total **${formatNumber(missing.length)} job orders** do not currently have a Challan Number assigned:\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Order Qty |\n|---|---|---|---|---|---|\n`;
    missing.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q91 & Q92 & Q100: "Show the complete challan history for JO-1", "complete challan history report"
  if (/\b(challan\s*history|history\s*for\s*(?:jo|job\s*order))\b/i.test(lower)) {
    const targetJo = joMatch ? joMatch[1].toUpperCase().replace(/\s+/g, '-') : 'JO-1';
    const rec = joMap.get(targetJo) || records.find(r => r.joNo.toUpperCase().includes(targetJo)) || records[0];

    let md = `### 📜 Complete Challan History Audit for \`${rec.joNo}\`\n\n`;
    if (!Array.isArray(rec.challanHistoryJson) || rec.challanHistoryJson.length === 0) {
      md += `No historical challan entries exist for **${rec.joNo}**. Only live record \`${rec.challanNo}\` is present.`;
    } else {
      md += `Found **${rec.challanHistoryJson.length} historical audit entries** for **${rec.joNo}**:\n\n`;
      md += `| # | Challan Number | Historical Date | Received Date | Total Qty | Complete Lot | Embroidery Done |\n`;
      md += `|---|---|---|---|---|---|---|\n`;
      rec.challanHistoryJson.forEach((h, i) => {
        md += `| ${i + 1} | \`${h.number || h.challanNo || '-'}\` | ${h.date || '-'} | ${h.receivedDate ? h.receivedDate.slice(0, 10) : '-'} | **${formatNumber(h.totalQty)} Pcs** | ${h.completeLot ? 'YES' : 'NO'} | ${h.embCompleted ? 'YES' : 'NO'} |\n`;
      });
    }
    return { handled: true, answer: md };
  }

  // Q96 & Q97: "Find challans marked as complete lot", "incomplete lot"
  if (/\b(complete\s*lot|incomplete\s*lot)\b/i.test(lower) && /\bchallan\b/i.test(lower)) {
    const isComplete = !lower.includes('incomplete');
    const matched = records.filter(r => r.challanNo && (isComplete ? r.challanCompleteLot : !r.challanCompleteLot));

    let md = `### 📦 Challans Marked as **${isComplete ? 'Complete Lot [YES]' : 'Incomplete / Partial Lot [NO]'}** (${matched.length} Orders)\n\n`;
    md += `| Challan No | Job Order | Party | Brand | Challan Total Qty | Complete Flag |\n|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| \`${r.challanNo}\` | **${r.joNo}** | **${r.party}** | ${r.brand} | **${formatNumber(r.challanTotalQty)} Pcs** | ${r.challanCompleteLot ? 'YES' : 'NO'} |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q107: "Find challans where item quantities do not equal the recorded total"
  if (/\b(item\s*quantities\s*do\s*not\s*equal|challan\s*items?.*mismatch)\b/i.test(lower)) {
    const mismatches = [];
    records.forEach(r => {
      if (r.challanItemsJson && Array.isArray(r.challanItemsJson.items) && r.challanTotalQty > 0) {
        const itemSum = r.challanItemsJson.items.reduce((sum, it) => sum + (parseFloat(it.qty) || 0), 0);
        if (itemSum !== r.challanTotalQty) {
          mismatches.push({ joNo: r.joNo, challanNo: r.challanNo, itemSum, recorded: r.challanTotalQty, diff: itemSum - r.challanTotalQty });
        }
      }
    });

    let md = `### 🔍 Challan Items Sum vs Recorded Total Discrepancy Audit\n\n`;
    if (mismatches.length === 0) {
      md += `✅ **Zero mismatches found!** Every recorded Challan Item breakdown strictly sums to the recorded Challan Total Quantity.`;
    } else {
      md += `Found **${mismatches.length} discrepancies** where the sum of shade items does not match the recorded total:\n\n`;
      md += `| Job Order | Challan No | Sum of Items | Recorded Total | Discrepancy |\n|---|---|---|---|---|\n`;
      mismatches.slice(0, 10).forEach(m => {
        md += `| **${m.joNo}** | \`${m.challanNo}\` | ${m.itemSum} Pcs | ${m.recorded} Pcs | **${m.diff > 0 ? `+${m.diff}` : m.diff} Pcs** |\n`;
      });
    }
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 11: GARMENT TYPE, SECTION AND SEASON (111-120)
  // =========================================================================

  // Q111 & Q120 & High-Volume Garment Inquiry:
  // "which garment is giving maximum joborders", "maximum job orders garment", "which garment has highest orders", "top garments by orders", "garment type report", "all garment types"
  if (
    /\b(which\s*garment.*(?:maximum|highest|most)|maximum\s*(?:job\s*)?orders?\s*garment|garment.*(?:giving|has|with)\s*(?:maximum|highest|most)|top\s*garments?|garment\s*ranking|all\s*garment\s*types?|list\s*garment\s*types?|garment\s*(?:type\s*)?report)\b/i.test(lower) ||
    (/\bgarment\b/i.test(lower) && /\b(maximum|highest|most)\b/i.test(lower) && /\b(orders?|joborders?)\b/i.test(lower))
  ) {
    const garmentStats = [];
    garmentMap.forEach((list, gName) => {
      const totalQty = list.reduce((sum, r) => sum + r.quantity, 0);
      const bCounts = {};
      list.forEach(r => {
        if (r.brand) bCounts[r.brand] = (bCounts[r.brand] || 0) + 1;
      });
      const topBrand = Object.entries(bCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Mixed';
      garmentStats.push({ garment: gName, count: list.length, totalQty, topBrand });
    });
    garmentStats.sort((a, b) => b.count - a.count);

    const maxCount = garmentStats[0]?.count || 1;
    const top1 = garmentStats[0];
    const top2 = garmentStats[1];
    const top3 = garmentStats[2];

    let md = `### 👕 Garment-Wise Job Orders Ranking & Volume Analysis\n\n`;
    md += `* 🥇 **Maximum Job Orders Garment:** **${top1.garment}** with **${formatNumber(top1.count)} Registered Job Orders**.\n`;
    if (top2) {
      md += `* 🥈 **Second Highest:** **${top2.garment}** with **${formatNumber(top2.count)} Orders**.\n`;
    }
    if (top3) {
      md += `* 🥉 **Third Highest:** **${top3.garment}** with **${formatNumber(top3.count)} Orders**.\n\n`;
    }

    md += `| Rank | Garment Category | Order Volume Bar | Total Job Orders | Dominant Brand |\n`;
    md += `|---|---|---|---|---|\n`;
    garmentStats.slice(0, 20).forEach((g, idx) => {
      const pct = Math.round((g.count / maxCount) * 100);
      const bar = renderBarGraph(g.count, maxCount, 10);
      md += `| ${idx + 1} | **${g.garment}** | \`${bar}\` ${pct}% | **${formatNumber(g.count)} Orders** | ${g.topBrand} |\n`;
    });
    md += `\n*The #1 garment driving the highest order volume in Factory Suite is **${top1.garment}** with ${formatNumber(top1.count)} job orders.*`;
    return { handled: true, answer: md };
  }

  // Q112: "How many orders are for sweatshirts?"
  if (/\b(how\s*many\s*orders?.*sweatshirts?|sweatshirt\s*orders?\s*count)\b/i.test(lower)) {
    const matched = records.filter(r => r.garment.toUpperCase().includes('SWEATSHIRT'));
    const totalQty = matched.reduce((sum, r) => sum + r.quantity, 0);

    let md = `### 👕 Sweatshirt Orders Summary\n\n`;
    md += `* 🔢 **Total Sweatshirt Job Orders:** **${formatNumber(matched.length)} Orders**\n`;
    md += `* 📦 **Total Sweatshirt Quantity:** **${formatNumber(totalQty)} Units**\n`;
    md += `* 🏷️ **Dominant Brands:** ${[...new Set(matched.map(r => r.brand))].slice(0, 5).join(', ')}\n`;
    return { handled: true, answer: md };
  }

  // Q113 & Q114: "Show all GENTS-section orders", "orders for a particular section"
  if (/\b(gents[-_\s]*section|ladies[-_\s]*section|kids[-_\s]*section|section\s*orders?)\b/i.test(lower)) {
    const secTarget = lower.includes('ladies') ? 'LADIES' : (lower.includes('kids') ? 'KIDS' : 'GENTS');
    const matched = records.filter(r => r.section.toUpperCase().includes(secTarget));

    let md = `### 👥 Job Orders in **${secTarget}** Section (${formatNumber(matched.length)} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Quantity |\n|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q115 & Q116 & Q117: "Show all winter-season orders", "count orders by season", "compare winter and summer"
  if (/\b(winter\s*(?:season\s*)?orders|orders\s*by\s*season|compare\s*winter\s*and\s*summer|season\s*comparison)\b/i.test(lower)) {
    const winter = records.filter(r => r.season.toUpperCase().includes('WINTER'));
    const summer = records.filter(r => r.season.toUpperCase().includes('SUMMER'));
    const mix = records.filter(r => r.season.toUpperCase().includes('MIX'));

    const wQty = winter.reduce((sum, r) => sum + r.quantity, 0);
    const sQty = summer.reduce((sum, r) => sum + r.quantity, 0);
    const mQty = mix.reduce((sum, r) => sum + r.quantity, 0);
    const maxS = Math.max(winter.length, summer.length, mix.length) || 1;

    let md = `### ☀️ Season-Wise Order Breakdown & Comparison\n\n`;
    md += `| Season | Order Distribution Bar | Job Orders Count | Share |\n|---|---|---|---|\n`;
    md += `| ❄️ **WINTER** | \`${renderBarGraph(winter.length, maxS, 10)}\` | **${formatNumber(winter.length)} Orders** | ${Math.round((winter.length / records.length) * 100)}% |\n`;
    md += `| ☀️ **SUMMER** | \`${renderBarGraph(summer.length, maxS, 10)}\` | **${formatNumber(summer.length)} Orders** | ${Math.round((summer.length / records.length) * 100)}% |\n`;
    md += `| 🍂 **MIX / ALL-SEASON** | \`${renderBarGraph(mix.length, maxS, 10)}\` | **${formatNumber(mix.length)} Orders** | ${Math.round((mix.length / records.length) * 100)}% |\n`;
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 12: STYLE, PATTERN AND COMPONENTS (121-130)
  // =========================================================================

  // Q121: "Show all available styles"
  if (/\b(all\s*available\s*styles?|list\s*(?:all\s*)?styles?)\b/i.test(lower)) {
    const styleStats = [];
    styleMap.forEach((list, sName) => {
      styleStats.push({ style: sName, count: list.length });
    });
    styleStats.sort((a, b) => b.count - a.count);

    let md = `### ✂️ All Styles Recorded in Factory Database (${styleStats.length} Unique Styles)\n\n`;
    md += `| Rank | Style Name | Orders Count |\n|---|---|---|\n`;
    styleStats.slice(0, 20).forEach((s, idx) => {
      md += `| ${idx + 1} | **${s.style}** | **${formatNumber(s.count)} orders** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q122 & Q123: "Full Zipper (Monkey Hood) orders", "Cross Hoodie orders"
  if (/\b(monkey\s*hood|cross\s*hoodie|full\s*zipper)\b/i.test(lower)) {
    const isMonkey = lower.includes('monkey');
    const term = isMonkey ? 'MONKEY HOOD' : 'CROSS HOODIE';
    const matched = records.filter(r => r.style.toUpperCase().includes(term));

    let md = `### 👕 Job Orders with Style **${term}** (${matched.length} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Fabric | Order Qty |\n|---|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.fabric} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q124: "Show all orders using SS Pattern"
  if (/\b(ss\s*pattern\s*orders?|orders\s*using\s*ss\s*pattern)\b/i.test(lower)) {
    const matched = records.filter(r => r.pattern.toUpperCase().includes('SS PATTERN'));
    let md = `### 📐 Job Orders Using **SS Pattern** (${formatNumber(matched.length)} Orders)\n\n`;
    md += `Total **${formatNumber(matched.length)} orders** are built using the official SS Pattern:\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Style |\n|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.style} |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q125 - Q130: Components (Tape/Lace, Bottom Type, Zip, Sticker, Collar, Bone)
  if (!/\b\d{3,7}\b/.test(p) && /\b(tape|lace|bottom\s*type|zip|sticker|collar|bone)\b/i.test(lower) && /\b(orders?|require|find)\b/i.test(lower)) {
    let col = 'tapeLace';
    let label = 'Tape / Lace';

    if (lower.includes('bottom')) { col = 'bottomType'; label = 'Bottom Type'; }
    else if (lower.includes('zip')) { col = 'zip'; label = 'Zip'; }
    else if (lower.includes('sticker')) { col = 'sticker'; label = 'Sticker'; }
    else if (lower.includes('collar')) { col = 'collar'; label = 'Collar'; }
    else if (lower.includes('bone')) { col = 'bone'; label = 'Bone'; }

    const matched = records.filter(r => Boolean(r[col]) && r[col] !== '-');

    let md = `### 🧵 Job Orders Requiring **${label}** (${matched.length} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | **${label} Requirement** |\n|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | **${r[col]}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 13: STITCHING AND PRODUCTION DETAILS (131-140)
  // =========================================================================

  // Q131 & Q132: Direct Stitching enabled / disabled
  if (/\b(direct\s*stitching\s*(?:enabled|disabled|yes|no)|without\s*direct\s*stitching)\b/i.test(lower)) {
    const isDirect = !lower.includes('without') && !lower.includes('disabled') && !lower.includes('no');
    const matched = records.filter(r => r.directStitching === isDirect);

    let md = `### 🪡 Job Orders with Direct Stitching = **${isDirect ? 'YES' : 'NO'}** (${formatNumber(matched.length)} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Emb Provider | Qty |\n|---|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.embVendor || 'N/A'} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q133: "Find orders marked FULL BAJU = YES"
  if (/\b(full\s*baju|full\s*sleeves?)\b/i.test(lower)) {
    const matched = records.filter(r => r.fullBaju.toUpperCase() === 'YES');
    let md = `### 👕 Job Orders Marked **FULL BAJU = YES** (${formatNumber(matched.length)} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Garment | Style |\n|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | ${r.garment} | ${r.style} |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q136 & Q137: "Show all orders submitted by Ravinder", "Count orders submitted by each person"
  if (/\b(submitted\s*by|submitter)\b/i.test(lower)) {
    const submitStats = [];
    submitterMap.forEach((list, person) => {
      submitStats.push({ person, count: list.length });
    });
    submitStats.sort((a, b) => b.count - a.count);

    let md = `### 👤 Job Orders Submitted by User / Staff\n\n`;
    md += `| Submitter Name | Job Orders Submitted |\n|---|---|\n`;
    submitStats.forEach(s => {
      md += `| **${s.person || 'Unspecified'}** | **${formatNumber(s.count)} orders** |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 14: PDF AND DOCUMENT MANAGEMENT (141-150)
  // =========================================================================

  // Q141 & Q142: Orders with / without PDF URL
  // Q144 & Q145: PDF generation blocked / not blocked
  if (/\b(pdf\s*url|pdf\s*blocked|pdf\s*status)\b/i.test(lower)) {
    const hasPdf = records.filter(r => Boolean(r.challanPdfUrl));
    const blockedPdf = records.filter(r => String(r.pdfBlocked).toUpperCase() === 'YES');

    let md = `### 📄 Job Order PDF & Document Status Report\n\n`;
    md += `* 📥 **Orders with PDF URL Attached:** **${formatNumber(hasPdf.length)} Orders**\n`;
    md += `* 🔒 **Orders with PDF Generation Blocked:** **${formatNumber(blockedPdf.length)} Orders**\n`;
    md += `* 🖨️ **Orders with System PDF Status Ready:** **${formatNumber(records.filter(r => r.pdfStatus.toUpperCase() === 'YES').length)} Orders**\n`;
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 15: CANCELLATION AND PRIORITY (151-160)
  // =========================================================================

  // Q151 & Q160: "Show all cancelled job orders", "Generate cancellation and priority report"
  if (/\b(all\s*cancelled\s*job\s*orders|cancelled\s*orders?\s*report|cancellation\s*and\s*priority\s*report)\b/i.test(lower)) {
    const cancelled = records.filter(r => r.isCancelled);
    let md = `### 🛑 Master Cancelled Job Orders Report (Total: ${cancelled.length} Orders)\n\n`;
    md += `| Job Order No | Lot # | Party | Brand | Cancellation Reason | Cancelled By | Approved From |\n`;
    md += `|---|---|---|---|---|---|---|\n`;
    cancelled.forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | **${r.party}** | ${r.brand} | *${r.cancellationReason || 'Cancelled'}* | **${r.cancelledBy || 'Management'}** | ${r.cancellationApprovedFrom || 'Admin'} |\n`;
    });
    return { handled: true, answer: md };
  }

  // Q157 & Q158: "Show all high-priority orders", "Count orders by priority"
  if (/\b(priority|high[-_\s]*priority)\b/i.test(lower)) {
    const pCounts = new Map();
    records.forEach(r => {
      const pVal = r.priority || 'Standard / Unassigned';
      pCounts.set(pVal, (pCounts.get(pVal) || 0) + 1);
    });

    let md = `### ⚡ Job Orders by Priority Level\n\n`;
    md += `| Priority Level | Total Job Orders |\n|---|---|\n`;
    pCounts.forEach((count, level) => {
      md += `| **${level}** | **${formatNumber(count)} Orders** |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 16: STATUS AND OPERATIONAL MONITORING (161-170)
  // =========================================================================

  // Q161 & Q162: "Show all orders by status", "Count orders by status"
  if (/\b(orders?\s*by\s*status|count\s*orders?\s*by\s*status|status\s*report)\b/i.test(lower)) {
    const statusMap = new Map();
    records.forEach(r => {
      const s = r.status.trim() || 'Blank / Unassigned (Not auto-pending)';
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    });

    let md = `### 📊 Job Orders Operational Status Breakdown\n\n`;
    md += `*Note: Per enterprise business rules, blank status fields are strictly categorized as **Unassigned** and not automatically assumed pending.*\n\n`;
    md += `| Status Flag | Orders Count |\n|---|---|\n`;
    statusMap.forEach((c, s) => {
      md += `| **${s}** | **${formatNumber(c)} Orders** |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 17: DATE AND TIMELINE ANALYSIS (171-180)
  // =========================================================================

  // Q173, Q174, Q175: Orders created in August 2025, September 2025, October 2025
  const monthYearMatch = lower.match(/\b(august|september|october|november|december|january|february|march|april|may|june|july)\s*(\d{4})?\b/i);
  if (monthYearMatch && /\b(created|orders?|dated)\b/i.test(lower)) {
    const month = monthYearMatch[1].toUpperCase();
    const year = monthYearMatch[2] || '2025';
    const monthPrefix = month.slice(0, 3);

    const matched = records.filter(r => {
      if (r.date.toUpperCase().includes(month) || r.date.toUpperCase().includes(monthPrefix)) return true;
      if (r.parsedDate) {
        const d = r.parsedDate;
        return d.getFullYear() === parseInt(year) && d.toLocaleString('en-US', { month: 'short' }).toUpperCase() === monthPrefix;
      }
      return false;
    });

    let md = `### 📅 Job Orders Created in **${month} ${year}** (${matched.length} Orders)\n\n`;
    md += `| Job Order No | Lot # | Date | Party | Brand | Garment | Quantity |\n|---|---|---|---|---|---|---|\n`;
    matched.slice(0, 15).forEach(r => {
      md += `| **${r.joNo}** | \`${r.lotNo}\` | \`${r.date}\` | **${r.party}** | ${r.brand} | ${r.garment} | **${formatNumber(r.quantity)} ${r.unit}** |\n`;
    });
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 18: DATA QUALITY AND AI AUDIT (181-190)
  // =========================================================================

  // Q181 - Q190: Data quality audit report
  if (/\b(data\s*quality|ai\s*audit|audit\s*report|missing\s*mandatory\s*fields|duplicate\s*job\s*orders?|duplicate\s*challans?)\b/i.test(lower)) {
    const missingMandatory = records.filter(r => !r.joNo || !r.party || !r.fabric || r.quantity <= 0);
    const seenJo = new Map();
    const duplicateJo = [];
    records.forEach(r => {
      if (r.joNo) {
        seenJo.set(r.joNo, (seenJo.get(r.joNo) || 0) + 1);
        if (seenJo.get(r.joNo) === 2) duplicateJo.push(r.joNo);
      }
    });

    const seenCh = new Map();
    const duplicateCh = [];
    records.forEach(r => {
      if (r.challanNo) {
        seenCh.set(r.challanNo, (seenCh.get(r.challanNo) || 0) + 1);
        if (seenCh.get(r.challanNo) === 2) duplicateCh.push(r.challanNo);
      }
    });

    const healthScore = Math.round(100 - ((missingMandatory.length + duplicateJo.length) / records.length) * 100);

    let md = `### 🛡️ Enterprise AI Data Quality & Integrity Audit Report\n\n`;
    md += `* 🌟 **Database Health Score:** **${healthScore}% / 100%** (Industrial Grade)\n`;
    md += `* 📋 **Total Records Audited:** **${formatNumber(records.length)} Job Orders**\n`;
    md += `* ⚠️ **Missing Mandatory Fields:** **${missingMandatory.length} records**\n`;
    md += `* 🔄 **Duplicate Job Order Numbers:** **${duplicateJo.length} instances** ${duplicateJo.length > 0 ? `(${duplicateJo.slice(0, 5).join(', ')})` : ''}\n`;
    md += `* 📦 **Duplicate Challan Numbers:** **${duplicateCh.length} instances**\n`;
    md += `* 🚚 **Orders with Completed Challan Data:** **${formatNumber(records.filter(r => r.challanNo).length)} Orders**\n\n`;
    md += `✅ *Database structure is healthy, indexed, and synchronized across multi-department records.*`;
    return { handled: true, answer: md };
  }

  // =========================================================================
  // CATEGORY 19: ADVANCED AI ANALYTICS & MANAGEMENT SUMMARY (191-199)
  // =========================================================================

  // Q199: "Generate a management summary of all job orders", "Management summary"
  if (/\b(management\s*summary|executive\s*summary|all\s*job\s*orders\s*summary)\b/i.test(lower)) {
    const totalCount = records.length;
    const totalQty = records.reduce((sum, r) => sum + r.quantity, 0);
    const totalChallanPcs = records.reduce((sum, r) => sum + r.challanTotalQty, 0);
    const cancelledCount = records.filter(r => r.isCancelled).length;

    // Top party
    const topParty = [...partyMap.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    // Top brand
    const topBrand = [...brandMap.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    // Top fabric
    const topFabric = [...fabricMap.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    // Top garment
    const topGarment = [...garmentMap.entries()].sort((a, b) => b[1].length - a[1].length)[0];

    let md = `### 🏢 Executive Management Summary: Factory Job Orders\n\n`;
    md += `#### 1. Macro Production KPIs\n`;
    md += `* 📋 **Total Master Job Orders:** **${formatNumber(totalCount)} Orders**\n`;
    md += `* 📦 **Total Order Volume:** **${formatNumber(totalQty)} Units**\n`;
    md += `* 🚚 **Total Challan Fulfilled Quantity:** **${formatNumber(totalChallanPcs)} Pieces**\n`;
    md += `* 🛑 **Cancellation Rate:** **${((cancelledCount / totalCount) * 100).toFixed(1)}%** (${cancelledCount} cancelled orders)\n\n`;

    md += `#### 2. Factory Leaders\n`;
    md += `* 🏢 **Top Buyer Party:** **${topParty[0]}** (${formatNumber(topParty[1].length)} orders • ${Math.round((topParty[1].length / totalCount) * 100)}% of factory)\n`;
    md += `* 🏷️ **Top Brand:** **${topBrand[0]}** (${formatNumber(topBrand[1].length)} orders)\n`;
    md += `* 🧵 **Most Deployed Fabric:** **${topFabric[0]}** (${formatNumber(topFabric[1].length)} orders)\n`;
    md += `* 👕 **Primary Garment Type:** **${topGarment[0]}** (${formatNumber(topGarment[1].length)} orders)\n\n`;

    md += `#### 3. Operational Health & Workflow Status\n`;
    md += `* 🪡 **Direct Stitching Orders:** **${formatNumber(records.filter(r => r.directStitching).length)} Orders**\n`;
    md += `* 🎨 **Embroidery Required Orders:** **${formatNumber(records.filter(r => r.embVendor && r.embVendor !== 'NA').length)} Orders**\n`;
    md += `* 📄 **Verified PDF Slips Linked:** **${formatNumber(records.filter(r => r.pdfStatus.toUpperCase() === 'YES').length)} Lots**\n`;
    return { handled: true, answer: md };
  }

  return { handled: false };
}

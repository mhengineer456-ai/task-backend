// Master Multi-Sheet Data Aggregator & Industrial ERP Intelligence Engine
let webhookData = {};
try {
  webhookData = $("Webhook (Incoming AI Query)").first().json.body || {};
} catch (e) {
  try {
    webhookData = $input.first().json.body || $input.first().json || {};
  } catch (err) {
    webhookData = {};
  }
}

const prompt = String(webhookData.prompt || webhookData.chatInput || webhookData.message || webhookData.query || "").trim();
if (!prompt) {
  return [{ json: { status: "skipped", message: "No incoming AI query to process (background sync execution)" } }];
}
const payloadContext = webhookData.context || {};
const history = webhookData.history || [];

let jobOrderData = [];
let issuesData = [];
let lotLogsData = [];
let indexData = [];
let kajButtonData = [];
let washingData = [];
let overlockData = [];
let foldingData = [];
let elasticData = [];
let barcodeData = [];
let zipPurchaseData = [];
let doriPurchaseData = [];

try { jobOrderData = $("Fetch JobOrder Sheet").all().map(item => item.json); } catch (e) {}
try { issuesData = $("Fetch Issues Sheet").all().map(item => item.json); } catch (e) {}
try { lotLogsData = $("Fetch LotLogs Sheet").all().map(item => item.json); } catch (e) {}
try { indexData = $("Fetch Index Sheet").all().map(item => item.json); } catch (e) {}
try { kajButtonData = $("Fetch KajButton Sheet").all().map(item => item.json); } catch (e) {}
try { washingData = $("Fetch Washing Sheet").all().map(item => item.json); } catch (e) {}
try { overlockData = $("Fetch Overlock Sheet").all().map(item => item.json); } catch (e) {}
try { foldingData = $("Fetch Folding Sheet").all().map(item => item.json); } catch (e) {}
try { elasticData = $("Fetch Elastic Sheet").all().map(item => item.json); } catch (e) {}
try { barcodeData = $("Fetch Barcode Data Sheet").all().map(item => item.json); } catch (e) {}
try { zipPurchaseData = $("Fetch ZipPurchaseOrders Sheet").all().map(item => item.json); } catch (e) {}
try { doriPurchaseData = $("Fetch DoriPurchaseOrders Sheet").all().map(item => item.json); } catch (e) {}

const getLot = (r) => String(r["Lot Number"] || r["LOT NUMBER"] || r["Lot No"] || r["LOT NO"] || r["lotNo"] || r["Lot"] || "").trim();

// 1. Detect if user is asking about a specific lot number (e.g. 67046, 11300, 61008)
const lotMatch = prompt.match(/\b(\d{3,7}|[a-zA-Z]{1,3}[-_]\d{3,6})\b/);
const targetLot = lotMatch ? lotMatch[1].trim() : null;

let specificLotDetails = null;
if (targetLot) {
  const matchedJO = jobOrderData.find(r => getLot(r) === targetLot || String(r["Order No."] || "").includes(targetLot));
  const matchedIssue = issuesData.find(r => getLot(r) === targetLot);
  const matchedIndex = indexData.filter(r => Object.values(r).some(v => String(v || "").includes(targetLot)));
  const matchedLogs = lotLogsData.filter(r => String(r["Lot Number"] || "").includes(targetLot));
  const matchedKaj = kajButtonData.find(r => getLot(r) === targetLot);
  const matchedWash = washingData.find(r => getLot(r) === targetLot);
  const matchedOverlock = overlockData.find(r => getLot(r) === targetLot);
  const matchedFolding = foldingData.find(r => getLot(r) === targetLot);
  const matchedElastic = elasticData.find(r => getLot(r) === targetLot);
  const matchedBarcodes = barcodeData.filter(r => getLot(r) === targetLot);
  const matchedZip = zipPurchaseData.find(r => getLot(r) === targetLot);
  const matchedDori = doriPurchaseData.find(r => getLot(r) === targetLot);

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

  const rawImg = (matchedJO && (matchedJO["Image URL"] || matchedJO["UPLOAD IMAGE"])) || (matchedIndex.length > 0 && (matchedIndex[0]["Image Url"] || matchedIndex[0]["Image URL"])) || null;
  const directImg = formatDirectImageUrl(rawImg);

  if (matchedJO || matchedIssue || matchedIndex.length > 0 || matchedKaj || matchedWash || matchedOverlock || matchedFolding || matchedElastic || matchedBarcodes.length > 0 || matchedZip || matchedDori) {
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
      activityLogs: matchedLogs
    };
  }
}

// 2. Detect Party / Buyer queries (e.g. "SS Party", "SS lots", "lots of SS")
const isSSQuery = /\b(ss|ss\s*party|party\s*ss|ss\s*pattern)\b/i.test(prompt);
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
const lowerPrompt = prompt.toLowerCase();
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
    totalRecords: zipPurchaseData.length,
    sampleLots: zipPurchaseData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
  };
} else if (lowerPrompt.includes('dori')) {
  stageSearchSummary = {
    stage: 'Dori Purchase Orders Department',
    totalRecords: doriPurchaseData.length,
    sampleLots: doriPurchaseData.slice(0, 10).map(r => getLot(r)).filter(Boolean)
  };
}

// 4. Build summary of all lots across factory
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
  const isImageRequested = /\b(image|photo|pic|picture|artwork|design\s*image|design\s*artwork|design\s*photo|design\s*(?:dikhao|dena|chahiye|bhejo)|photo\s*(?:dena|dikhao|bhejo|chahiye|de)|image\s*(?:dena|dikhao|bhejo|chahiye|de)|pic\s*(?:dena|dikhao|bhejo|chahiye)|tasveer|tasvir)\b/i.test(prompt);
  const isHistoryRequested = /\b(history|timeline|stages|department|supervisor|audit\s*trail|all\s*details|complete\s*details|full\s*details|lifecycle|journey|kahan\s*tak\s*pahuncha|kya\s*status|status\s*batao|cutting\s*status)\b/i.test(prompt);
  const isImageOnly = isImageRequested && !isHistoryRequested;

  const isBrandRequested = /\b(brand|brand\s*name|marka)\b/i.test(prompt);
  const isFabricRequested = /\b(fabric|kapda|cloth|material)\b/i.test(prompt);
  const isPartyRequested = /\b(party|party\s*name|buyer|client|customer)\b/i.test(prompt) && !/\b(all\s*parties|party\s*report)\b/i.test(prompt);
  const isStyleRequested = /\b(style|garment|garment\s*type|pattern|item)\b/i.test(prompt);
  const isQtyRequested = /\b(quantity|qty|order\s*qty|kitne\s*pcs|kitna\s*order|pieces?|sets?)\b/i.test(prompt);
  const isShadeSizeRequested = /\b(shade|shades|color|colors|colour|size|sizes)\b/i.test(prompt);
  const isZipRequested = /\b(zip|zipper|zip\s*purchase|zip\s*supplier|zip\s*entry|zip\s*status)\b/i.test(prompt);
  const isDoriRequested = /\b(dori|dori\s*purchase|dori\s*order|dori\s*status|dori\s*selection|dori\s*pieces?)\b/i.test(prompt);

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
The user explicitly asked ONLY for the photo / design artwork of Lot ${specificLotDetails.lotNumber} (Prompt: "${prompt}").
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
      targetVal = zp
        ? `Supplier: ${zp["Supplier Name"] || 'N/A'} | Gate Entry: ${zp["Gate Entry Date"] || 'N/A'} (${zp["Gate Entry Person"] || 'N/A'}) | Received: ${zp["Material Received Date"] || 'N/A'} (${zp["Material Received By"] || 'N/A'})`
        : 'Zip Purchase record factory production records mein nahi mila (Pending).';
    } else if (isDoriRequested) {
      targetAttr = 'Dori Purchase Order';
      const dp = specificLotDetails.doriPurchase;
      targetVal = dp
        ? `Total Pieces: ${dp["Total Pieces"] || 'N/A'} | Fabric: ${dp["Fabric"] || 'N/A'} | Issue Date: ${dp["Issue Date"] || 'N/A'} | Supervisor: ${dp["Supervisor"] || 'N/A'}`
        : 'Dori Purchase Order record factory production records mein nahi mila (Pending).';
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
The user asked ONLY for the ${targetAttr} of Lot ${specificLotDetails.lotNumber} (Prompt: "${prompt}").
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
10. Zip Purchase & Gate Entry: ${JSON.stringify(specificLotDetails.zipPurchase, null, 2)}
11. Dori Purchase Order & Trims: ${JSON.stringify(specificLotDetails.doriPurchase, null, 2)}
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
10. Zip Procurement & Gate Entry: Supplier Name, Gate Entry Person & Date, Material Received By & Date, Material Entry Date, Approval ID.
11. Dori Purchase Order & Trims: Total Pieces, Garment Type, Style, Fabric, Issue Date, Supervisor, Dori Selections.
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
- Zip Purchase Orders & Gate Entry: ${zipPurchaseData.length} entries
- Dori Purchase Orders: ${doriPurchaseData.length} entries
- Production Activity Logs: ${lotLogsData.length} entries${historyStr}

Guidelines:
1. When asked about SS lots, state the exact 331 verified count and cut/pending breakdown.
2. When asked about Kaj-Button, Washing, Overlock, Folding, Elastic, Barcode, Packing, Zip, or Dori status for any lot, report the exact supervisor, dates, piece quantities, and status from official factory production records.
3. Keep tone respectful, industrial-grade, clear, and direct.`;

return [{
  json: {
    userPrompt: prompt,
    systemInstruction: systemInstruction,
    kpis: { totalLotsCount, totalQty }
  }
}];

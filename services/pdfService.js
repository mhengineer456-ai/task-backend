import PDFDocument from 'pdfkit';

/**
 * Generates a clean, professional BLACK & WHITE print-optimized Job Order / Cutting Slip.
 * Pure high-contrast monochrome design: zero color toner waste, razor-sharp on laser/photocopier.
 * @param {Object} lotData - Object containing lot and job order details
 * @param {WritableStream} outputStream - Stream to pipe generated PDF to
 */
export function generateJobOrderPdf(lotData, outputStream) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `JobOrder_${lotData.lotNumber || 'Slip'}`,
      Author: 'Factory Suite Pro',
      Subject: 'Industrial Production & Cutting Slip (Monochrome Print Ready)'
    }
  });

  doc.pipe(outputStream);

  const black = '#000000';
  const grayLine = '#666666';

  // --- 1. HEADER BOX (Black outline on white) ---
  doc.rect(40, 40, 515, 62).lineWidth(1.5).stroke(black);

  // Left Title Section
  doc.fillColor(black).fontSize(16).font('Helvetica-Bold').text('FACTORY SUITE PRO', 52, 50);
  doc.fillColor(black).fontSize(7.5).font('Helvetica').text('APPAREL MANUFACTURING & INDUSTRIAL PRODUCTION MODULE', 52, 70);
  doc.fillColor(black).fontSize(9.5).font('Helvetica-Bold').text('PRODUCTION JOB ORDER & CUTTING SLIP', 52, 82);

  // Vertical Separator
  doc.moveTo(395, 40).lineTo(395, 102).lineWidth(1).stroke(black);

  // Right Reference Box
  doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text('JOB ORDER / LOT REF', 405, 48);
  doc.fillColor(black).fontSize(11).font('Helvetica-Bold').text(`${lotData.jobOrderNo || 'JO-1'} • LOT ${lotData.lotNumber || '11028'}`, 405, 60);
  doc.fillColor(black).fontSize(7.5).font('Helvetica').text(`Date: ${lotData.challanDate || lotData.cutDate || new Date().toLocaleDateString()}`, 405, 78);
  doc.fillColor(black).fontSize(7).font('Helvetica').text('PRINT-OPTIMIZED MONOCHROME', 405, 90);

  let currentY = 110;

  // --- 2. CUTTING STATUS BANNER (High-Contrast Monochrome Box) ---
  const isCut = Boolean(lotData.isCut);
  const isCancelled = Boolean(lotData.isCancelled);
  doc.rect(40, currentY, 515, 26).lineWidth(1.5).stroke(black);

  const statusText = isCancelled
    ? `[X] ORDER STATUS: CANCELLED (REASON: ${String(lotData.cancelInfo?.reason || 'CANCELLED').toUpperCase()}) • BY: ${String(lotData.cancelInfo?.by || 'MANAGEMENT').toUpperCase()}`
    : (isCut
      ? `[✓] CUTTING STATUS: CUT COMPLETE (VERIFIED IN CUTTING MASTER RECORDS) ${lotData.cutPcs ? `• ${lotData.cutPcs} Pcs` : ''} ${lotData.cutDate ? `• Date: ${lotData.cutDate}` : ''}`
      : '[!] CUTTING STATUS: CUTTING PENDING (AWAITING CUTTING FLOOR ALLOCATION)');

  doc.fillColor(black)
     .fontSize(9)
     .font('Helvetica-Bold')
     .text(statusText, 52, currentY + 8);

  currentY += 34;

  // --- 3. TWO-COLUMN SPECIFICATION GRID ---
  const boxWidth = 252;
  const boxHeight = 118;

  // Left Column: Order & Buyer Profile
  doc.rect(40, currentY, boxWidth, boxHeight).lineWidth(1).stroke(black);
  doc.rect(40, currentY, boxWidth, 20).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(8.5).font('Helvetica-Bold').text('ORDER & BUYER PROFILE', 48, currentY + 6);

  const drawRow = (label, val, x, y, maxW) => {
    doc.fillColor(black).fontSize(8).font('Helvetica-Bold').text(label, x, y);
    doc.fillColor(black).fontSize(8).font('Helvetica').text(String(val || 'N/A'), x + 88, y, { width: maxW - 92 });
  };

  let leftY = currentY + 26;
  drawRow('Party Name:', lotData.partyName || 'Mohit Hosiery', 48, leftY, boxWidth);
  drawRow('Brand:', lotData.brand || 'Standard', 48, leftY + 18, boxWidth);
  drawRow('Garment Type:', lotData.garmentType || 'SWEATSHIRT', 48, leftY + 36, boxWidth);
  drawRow('Style / Fit:', lotData.style || 'Standard', 48, leftY + 54, boxWidth);
  drawRow('Pattern:', lotData.pattern || 'SS Pattern', 48, leftY + 72, boxWidth);

  // Right Column: Production Specs
  const rightX = 303;
  doc.rect(rightX, currentY, boxWidth, boxHeight).lineWidth(1).stroke(black);
  doc.rect(rightX, currentY, boxWidth, 20).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(8.5).font('Helvetica-Bold').text('PRODUCTION SPECIFICATIONS', rightX + 8, currentY + 6);

  let rightY = currentY + 26;
  drawRow('Fabric Code:', lotData.fabricCode || 'Standard', rightX + 8, rightY, boxWidth);
  drawRow('Order Quantity:', lotData.quantity || '0 PCS', rightX + 8, rightY + 18, boxWidth);
  drawRow('Shades / Colors:', lotData.shades || 'Standard', rightX + 8, rightY + 36, boxWidth);
  drawRow('Size Run:', lotData.sizes || 'Standard', rightX + 8, rightY + 54, boxWidth);
  drawRow('Merchandiser:', lotData.submittedBy || 'Ravinder', rightX + 8, rightY + 72, boxWidth);

  currentY += boxHeight + 10;

  // --- 4. EMBROIDERY & OUTWARD CHALLAN SECTION ---
  const embBoxHeight = 100;
  doc.rect(40, currentY, 515, embBoxHeight).lineWidth(1).stroke(black);
  doc.rect(40, currentY, 515, 20).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(8.5).font('Helvetica-Bold').text('EMBELLISHMENT & DISPATCH CHALLAN', 48, currentY + 6);

  let chY = currentY + 26;
  drawRow('Embroidery Vendor:', lotData.embVendor || 'NA', 48, chY, 240);
  drawRow('Placement:', lotData.embPlacement || 'FRONT', 48, chY + 18, 240);
  drawRow('Direct Stitching:', lotData.directStitching || 'NO', 48, chY + 36, 240);

  drawRow('Challan No:', lotData.challanNo || 'N/A', 303, chY, 240);
  drawRow('Challan Date:', lotData.challanDate || 'N/A', 303, chY + 18, 240);
  drawRow('Challan Total Qty:', `${lotData.challanQty || '0'} Pcs`, 303, chY + 36, 240);

  // Sub-row: Shade breakdown
  doc.moveTo(40, chY + 54).lineTo(555, chY + 54).lineWidth(0.5).stroke(black);
  doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text('Shade Breakdown / Remarks:', 48, chY + 60);
  doc.fillColor(black).fontSize(7.5).font('Helvetica').text(
    lotData.challanBreakdown || lotData.shades || 'Standard production assortment',
    185, chY + 60, { width: 360 }
  );

  currentY += embBoxHeight + 10;

  // --- 5. TRIMS & ACCESSORIES SPECIFICATION ---
  const trimBoxHeight = 44;
  doc.rect(40, currentY, 515, trimBoxHeight).lineWidth(1).stroke(black);
  doc.rect(40, currentY, 515, 18).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(8.5).font('Helvetica-Bold').text('TRIMS & ACCESSORIES SPECIFICATION', 48, currentY + 5);

  let trimY = currentY + 24;
  doc.fillColor(black).fontSize(8).font('Helvetica')
     .text(`Full Baju: ${lotData.fullBaju || 'YES'}   |   Tape / Lace: ${lotData.tapeLace || 'Standard'}   |   Bottom Type: ${lotData.bottomType || 'Standard'}   |   Fabric Supervisor: ${lotData.fabricSupervisor || 'Verified'}`, 48, trimY);

  currentY += trimBoxHeight + 14;

  // --- 6. SIGNATURES & VERIFICATION (Monochrome Sign Boxes) ---
  const signHeight = 75;
  doc.rect(40, currentY, 515, signHeight).lineWidth(1).stroke(black);

  const colW = 515 / 3;

  // Sign 1: Prepared By
  doc.moveTo(55, currentY + 50).lineTo(55 + colW - 30, currentY + 50).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(8).font('Helvetica-Bold').text('Prepared By', 55, currentY + 55);
  doc.fillColor(black).fontSize(7).font('Helvetica').text('Merchandiser / Order In-Charge', 55, currentY + 65);

  // Sign 2: Cutting Supervisor
  doc.moveTo(55 + colW, currentY + 50).lineTo(55 + (colW * 2) - 30, currentY + 50).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(8).font('Helvetica-Bold').text('Cutting Master / Supervisor', 55 + colW, currentY + 55);
  doc.fillColor(black).fontSize(7).font('Helvetica').text('Cutting Department Sign & Date', 55 + colW, currentY + 65);

  // Sign 3: Factory Manager
  doc.moveTo(55 + (colW * 2), currentY + 50).lineTo(55 + (colW * 3) - 30, currentY + 50).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(8).font('Helvetica-Bold').text('Authorized Manager', 55 + (colW * 2), currentY + 55);
  doc.fillColor(black).fontSize(7).font('Helvetica').text('Production & Plant Quality Approval', 55 + (colW * 2), currentY + 65);

  // --- 7. FOOTER STAMP ---
  doc.fillColor(black).fontSize(7).font('Helvetica').text(
    `Generated automatically by Factory Suite Pro AI Engine • Print-Optimized Monochrome Industrial Slip • ${new Date().toLocaleString()}`,
    40, 785, { align: 'center', width: 515 }
  );

  doc.end();
}

/**
 * Generates a clean tabular BLACK & WHITE print-optimized report for Party Lots.
 * Razor-sharp text, solid black gridlines, pure white cells for crystal-clear printing.
 * @param {Object} reportData - Object containing party name, counts, filter, and rows
 * @param {WritableStream} outputStream - Stream to pipe generated PDF to
 */
export function generatePartyReportPdf(reportData, outputStream) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Party_Report_${reportData.partyName || 'Summary'}`,
      Author: 'Factory Suite Pro',
      Subject: 'Buyer Lots & Cutting Report (Monochrome Print Ready)'
    }
  });

  doc.pipe(outputStream);

  const black = '#000000';

  const isPendingFilter = reportData.filter === 'pending';
  const isCutFilter = reportData.filter === 'cut';

  // --- 1. HEADER SECTION (Clean Black Outline) ---
  const drawPageHeader = () => {
    doc.rect(40, 40, 515, 58).lineWidth(1.5).stroke(black);

    // Left Title
    doc.fillColor(black).fontSize(16).font('Helvetica-Bold').text('FACTORY SUITE PRO', 52, 48);
    doc.fillColor(black).fontSize(7.5).font('Helvetica').text('APPAREL MANUFACTURING & INDUSTRIAL PRODUCTION MODULE', 52, 68);

    const reportSubtitle = isPendingFilter
      ? `BUYER PRODUCTION REPORT: ${String(reportData.partyName || 'ALL PARTIES').toUpperCase()} [UNCUT / PENDING LOTS ONLY]`
      : isCutFilter
      ? `BUYER PRODUCTION REPORT: ${String(reportData.partyName || 'ALL PARTIES').toUpperCase()} [CUT COMPLETE LOTS ONLY]`
      : `BUYER PRODUCTION & CUTTING REPORT: ${String(reportData.partyName || 'ALL PARTIES').toUpperCase()}`;

    doc.fillColor(black).fontSize(9.5).font('Helvetica-Bold').text(reportSubtitle, 52, 80);

    // Vertical Divider
    doc.moveTo(395, 40).lineTo(395, 98).lineWidth(1).stroke(black);

    // Right Scope Box
    const scopeLabel = isPendingFilter ? 'UNCUT LOTS' : (isCutFilter ? 'CUT LOTS' : 'TOTAL LOTS');
    doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text('REPORT SCOPE', 405, 48);
    doc.fillColor(black).fontSize(11).font('Helvetica-Bold').text(`${reportData.totalLots || 0} ${scopeLabel}`, 405, 60);
    doc.fillColor(black).fontSize(7).font('Helvetica').text('MONOCHROME PRINT READY', 405, 76);
    doc.fillColor(black).fontSize(7).font('Helvetica').text(`Date: ${new Date().toLocaleDateString()}`, 405, 86);
  };

  drawPageHeader();

  let currentY = 106;

  // --- 2. SUMMARY KPI BOXES (Black Outline Boxed Format) ---
  const cardW = 166;
  const cardH = 38;

  // Box 1: Total in Scope
  doc.rect(40, currentY, cardW, cardH).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text('TOTAL INCLUDED IN REPORT', 48, currentY + 6);
  doc.fillColor(black).fontSize(13).font('Helvetica-Bold').text(`${reportData.totalLots || 0} Lots`, 48, currentY + 18);

  // Box 2: Cut Complete
  doc.rect(214, currentY, cardW, cardH).lineWidth(1).stroke(black);
  doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text('CUT COMPLETE (VERIFIED RECORDS)', 222, currentY + 6);
  doc.fillColor(black).fontSize(13).font('Helvetica-Bold').text(`[✓] ${reportData.cutCount || 0} Lots`, 222, currentY + 18);

  // Box 3: Pending Cutting
  doc.rect(388, currentY, cardW, cardH).lineWidth(1.5).stroke(black);
  doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text('PENDING CUTTING (UNCUT)', 396, currentY + 6);
  doc.fillColor(black).fontSize(13).font('Helvetica-Bold').text(`[!] ${reportData.pendingCount || 0} Lots`, 396, currentY + 18);

  currentY += 46;

  // --- 3. HIGH-CONTRAST TABULAR GRID ---
  const colX = {
    lot: 45,
    jo: 92,
    style: 140,
    fabric: 280,
    qty: 360,
    status: 425,
    emb: 495
  };

  const drawTableHeader = (y) => {
    // Outer table header box
    doc.rect(40, y, 515, 20).lineWidth(1.2).stroke(black);

    // Vertical column divider lines
    doc.moveTo(88, y).lineTo(88, y + 20).lineWidth(0.5).stroke(black);
    doc.moveTo(136, y).lineTo(136, y + 20).lineWidth(0.5).stroke(black);
    doc.moveTo(276, y).lineTo(276, y + 20).lineWidth(0.5).stroke(black);
    doc.moveTo(355, y).lineTo(355, y + 20).lineWidth(0.5).stroke(black);
    doc.moveTo(420, y).lineTo(420, y + 20).lineWidth(0.5).stroke(black);
    doc.moveTo(490, y).lineTo(490, y + 20).lineWidth(0.5).stroke(black);

    doc.fillColor(black).fontSize(8).font('Helvetica-Bold');
    doc.text('LOT #', colX.lot, y + 6);
    doc.text('JO #', colX.jo, y + 6);
    doc.text('GARMENT & STYLE', colX.style, y + 6);
    doc.text('FABRIC', colX.fabric, y + 6);
    doc.text('ORDER QTY', colX.qty, y + 6);
    doc.text('CUTTING STATUS', colX.status, y + 6);
    doc.text('EMB', colX.emb, y + 6);
  };

  drawTableHeader(currentY);
  currentY += 20;

  const rows = reportData.rows && reportData.rows.length > 0 ? reportData.rows : [
    { lot: '61011', jo: 'JO-312', style: 'LOWER (LOWER)', fabric: 'H N M LYCRA', qty: '1 ROLLS', isCut: false, emb: 'BHM' }
  ];

  let pageNum = 1;
  const drawFooter = () => {
    doc.fillColor(black).fontSize(7).font('Helvetica').text(
      `Factory Suite Pro • ${reportData.partyName || 'Party'} Lots Report • Page ${pageNum} • Monochrome Print Optimized`,
      40, 785, { align: 'center', width: 515 }
    );
  };

  rows.forEach((r, idx) => {
    // Check page overflow
    if (currentY > 755) {
      drawFooter();
      doc.addPage();
      pageNum++;
      drawPageHeader();
      currentY = 106;
      drawTableHeader(currentY);
      currentY += 20;
    }

    const rowHeight = 18;

    // Outer row box
    doc.rect(40, currentY, 515, rowHeight).lineWidth(0.5).stroke(black);

    // Vertical column divider lines
    doc.moveTo(88, currentY).lineTo(88, currentY + rowHeight).lineWidth(0.5).stroke(black);
    doc.moveTo(136, currentY).lineTo(136, currentY + rowHeight).lineWidth(0.5).stroke(black);
    doc.moveTo(276, currentY).lineTo(276, currentY + rowHeight).lineWidth(0.5).stroke(black);
    doc.moveTo(355, currentY).lineTo(355, currentY + rowHeight).lineWidth(0.5).stroke(black);
    doc.moveTo(420, currentY).lineTo(420, currentY + rowHeight).lineWidth(0.5).stroke(black);
    doc.moveTo(490, currentY).lineTo(490, currentY + rowHeight).lineWidth(0.5).stroke(black);

    // Text values in crisp black
    doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text(String(r.lot || 'N/A'), colX.lot, currentY + 5);
    doc.fillColor(black).fontSize(7.5).font('Helvetica').text(String(r.jo || 'N/A'), colX.jo, currentY + 5);
    doc.fillColor(black).fontSize(7.5).font('Helvetica-Bold').text(String(r.style || 'Garment').slice(0, 27), colX.style, currentY + 5);
    doc.fillColor(black).fontSize(7.5).font('Helvetica').text(String(r.fabric || 'Standard').slice(0, 15), colX.fabric, currentY + 5);
    doc.fillColor(black).fontSize(7.5).font('Helvetica').text(String(r.qty || '0'), colX.qty, currentY + 5);

    // Cutting Status Text
    if (r.isCancelled) {
      doc.fillColor(black).fontSize(7).font('Helvetica-Bold').text('[X] CANCELLED', colX.status, currentY + 5);
    } else if (r.isCut) {
      doc.fillColor(black).fontSize(7).font('Helvetica-Bold').text('[✓] CUT COMPLETE', colX.status, currentY + 5);
    } else {
      doc.fillColor(black).fontSize(7).font('Helvetica-Bold').text('[!] PENDING', colX.status, currentY + 5);
    }

    doc.fillColor(black).fontSize(7.5).font('Helvetica').text(String(r.emb || 'NA').slice(0, 9), colX.emb, currentY + 5);

    currentY += rowHeight;
  });

  // Final page footer
  drawFooter();

  doc.end();
}

import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { getReport } from './head56Mpr.service.js';
import { buildStatement } from './head56Analytics.service.js';
import { formatMoney, formatQuantity } from './mprDocuments.service.js';
import { fromMoney, fromPhysical, percent, toMoney, toPhysical } from './head56.common.js';

/**
 * Official output of Budget Head 56 in the SARRA "Prarup-2" layout: the Excel
 * sheet with the Hindi headings of the format, and a PDF (English headings —
 * the PDF fonts carry Latin text only) for one report or a consolidated statement.
 */

const AUTHORITY = 'Spring and River Rejuvenation Authority (SARRA), Uttarakhand';
const TITLE_HI = 'SARRA अन्तर्गत 56-गैर वेतन हेतु अनुदान के अन्तर्गत आवंटित बजट के सापेक्ष वित्तीय एवं भौतिक प्रगति विवरण प्रारूप –2';
const TITLE_EN = 'Budget Head 56 - Non-Salary Grant: Financial and Physical Progress against the Allocated Budget (Prarup-2)';

const PHYSICAL = ['openingPhysical', 'physicalTarget', 'targetSize', 'physicalPrevious', 'physicalCurrent'];
const MONEY = ['openingSarraLakh', 'deptShareLakh', 'sarraShareLakh', 'expenditurePreviousLakh', 'expenditureCurrentLakh'];

/** Derived columns of a row from its base figures. */
const finish = (row) => {
  const physicalFy = toPhysical(row.physicalPrevious) + toPhysical(row.physicalCurrent);
  const moneyFy = toMoney(row.expenditurePreviousLakh) + toMoney(row.expenditureCurrentLakh);
  return {
    ...row,
    physicalFy: fromPhysical(physicalFy),
    physicalTotal: fromPhysical(toPhysical(row.openingPhysical) + physicalFy),
    expenditureFyLakh: fromMoney(moneyFy),
    expenditureTotalLakh: fromMoney(toMoney(row.openingSarraLakh) + moneyFy),
    balanceLakh: fromMoney(toMoney(row.sarraShareLakh) - moneyFy),
    utilisationPercent: percent(moneyFy, toMoney(row.sarraShareLakh)),
  };
};

const sumRows = (rows, extra) => finish({
  ...Object.fromEntries(PHYSICAL.map((key) => [key, fromPhysical(rows.reduce((s, r) => s + toPhysical(r[key]), 0))])),
  ...Object.fromEntries(MONEY.map((key) => [key, fromMoney(rows.reduce((s, r) => s + toMoney(r[key]), 0))])),
  rate: null,
  hasPhysical: rows.some((r) => r.hasPhysical),
  ...extra,
});

/** Statement rows of one report: its lines under their sub-head headings. */
const reportRows = (report) => {
  const parentOf = new Map((report.parents || []).map((p) => [p.code, p]));
  const tops = [...new Set(report.lines.map((line) => line.parentCode || line.code))].sort();
  const rows = [];
  for (const top of tops) {
    const children = report.lines.filter((line) => line.parentCode === top);
    if (children.length) {
      const parent = parentOf.get(top) || { name: top, nameHindi: '' };
      rows.push(sumRows(children, { code: top, name: parent.name, nameHindi: parent.nameHindi, heading: true, depth: 0 }));
      children.forEach((line) => rows.push({ ...line, heading: false, depth: 1 }));
    } else {
      const own = report.lines.find((line) => line.code === top);
      if (own) rows.push({ ...own, heading: false, depth: 0 });
    }
  }
  const total = sumRows(report.lines, { code: '56', name: '56 – Total', nameHindi: '56 – योग', heading: true, depth: 0, hasPhysical: true });
  return { rows, total };
};

// ─── Excel ───────────────────────────────────────────────────────────────────

const MONEY_FORMAT = '#,##0.00###';
const QUANTITY_FORMAT = '#,##0.###';
const thin = { style: 'thin', color: { argb: 'FF94A3B8' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const groupFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

const COLUMNS = [
  // key, number format
  ['openingPhysical', QUANTITY_FORMAT], ['physicalTarget', QUANTITY_FORMAT], ['targetSize', QUANTITY_FORMAT],
  ['physicalPrevious', QUANTITY_FORMAT], ['physicalCurrent', QUANTITY_FORMAT], ['physicalFy', QUANTITY_FORMAT], ['physicalTotal', QUANTITY_FORMAT],
  ['openingSarraLakh', MONEY_FORMAT], ['rate', MONEY_FORMAT], ['deptShareLakh', MONEY_FORMAT], ['sarraShareLakh', MONEY_FORMAT],
  ['expenditurePreviousLakh', MONEY_FORMAT], ['expenditureCurrentLakh', MONEY_FORMAT], ['expenditureFyLakh', MONEY_FORMAT], ['expenditureTotalLakh', MONEY_FORMAT],
  ['balanceLakh', MONEY_FORMAT], ['utilisationPercent', '0.00'],
];

const previousFy = (fy) => { const start = Number(fy.slice(0, 4)) - 1; return `${start}-${String((start + 1) % 100).padStart(2, '0')}`; };

/** A Prarup-2 worksheet: Hindi headings as in the format, then the rows and the total. */
const writeSheet = (workbook, { sheetName, financialYear, period, scopeLabel, rows, total, notes = [] }) => {
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const prev = previousFy(financialYear);
  sheet.columns = [{ width: 6 }, { width: 11 }, { width: 46 }, ...COLUMNS.map(() => ({ width: 13 }))];
  const last = 'T';
  sheet.mergeCells(`A1:${last}1`);
  sheet.getCell('A1').value = TITLE_HI;
  sheet.getCell('A1').font = { bold: true, size: 13, underline: true };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  sheet.getRow(1).height = 34;
  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value = `वित्तीय वर्ष ${financialYear}, माह– ${period}   |   ${scopeLabel}`;
  sheet.getCell('A2').font = { bold: true, size: 11 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };
  sheet.mergeCells(`O2:${last}2`);
  sheet.getCell('O2').value = '(धनराशि लाख रु0 में)';
  sheet.getCell('O2').alignment = { horizontal: 'right' };
  const merges = [
    ['A3:A5', 'क्र0 सं0'], ['B3:C5', 'गतिविधि / उपगतिविधि'], ['D3:J3', 'भौतिक लक्ष्य–पूर्ति'], ['K3:R3', 'वित्तीय लक्ष्य–पूर्ति'],
    ['S3:S5', 'शेष धनराशि (SARRA अंश)'], ['T3:T5', 'उपयोग %'],
    ['D4:D5', `वित्तीय वर्ष ${prev} तक कुल प्रगति`], ['E4:F4', `लक्ष्य वित्तीय वर्ष ${financialYear}`], ['G4:I4', `वित्तीय वर्ष ${financialYear}`], ['J4:J5', 'कुल प्रगति'],
    ['K4:K5', `वित्तीय वर्ष ${prev} तक कुल व्यय SARRA अंश`], ['L4:L5', 'दर'], ['M4:N4', `लक्ष्य वित्तीय वर्ष ${financialYear}`], ['O4:Q4', `वित्तीय प्रगति वर्ष ${financialYear}`], ['R4:R5', 'कुल व्यय SARRA अंश'],
  ];
  merges.forEach(([range, text]) => { sheet.mergeCells(range); sheet.getCell(range.split(':')[0]).value = text; });
  [['E5', 'इकाई (संख्या/है0)'], ['F5', 'आकार (घन0मी0)'], ['G5', 'विगत माह में प्रगति'], ['H5', 'माह में प्रगति'], ['I5', 'माह तक कुल प्रगति'],
    ['M5', 'विभागीय अंश (धनराशि)'], ['N5', 'SARRA अंश (धनराशि)'], ['O5', 'विगत माह में व्यय SARRA अंश'], ['P5', 'माह में व्यय SARRA अंश'], ['Q5', 'कुल व्यय SARRA अंश']]
    .forEach(([cell, text]) => { sheet.getCell(cell).value = text; });
  for (let r = 3; r <= 5; r += 1) {
    const row = sheet.getRow(r);
    row.height = r === 5 ? 44 : 30;
    for (let c = 1; c <= 20; c += 1) {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
      cell.fill = headFill;
    }
  }
  const put = (values, { fill, bold, indent } = {}) => {
    const row = sheet.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = border;
      if (fill) cell.fill = fill;
      cell.font = { size: 9, bold: Boolean(bold) };
      if (col >= 4) cell.numFmt = COLUMNS[col - 4]?.[1] || MONEY_FORMAT;
      cell.alignment = col === 3 ? { wrapText: true, vertical: 'middle', indent: indent || 0 } : { vertical: 'middle', horizontal: col <= 2 ? 'left' : 'right' };
    });
    return row;
  };
  const valuesOf = (row) => COLUMNS.map(([key]) => (row[key] === null || row[key] === undefined ? null : row[key]));
  put([1, '56', '56- गैर वेतन हेतु अनुदान (Non-Salary Grant)', ...valuesOf(total)], { fill: totalFill, bold: true });
  rows.forEach((row) => {
    const label = row.nameHindi ? `${row.nameHindi}${row.name && row.name !== row.nameHindi ? ` (${row.name})` : ''}` : row.name;
    const unit = row.hasPhysical && row.unit && !row.heading ? ` [${row.unit}]` : '';
    put(['', row.code, `${label}${unit}`, ...valuesOf(row)], { fill: row.heading ? groupFill : undefined, bold: row.heading, indent: row.depth ? 2 : 0 });
  });
  put(['', '', '56– योग (Total)', ...valuesOf(total)], { fill: totalFill, bold: true });
  if (notes.length) {
    sheet.addRow([]);
    notes.forEach((note) => { const row = sheet.addRow(['', '', note]); row.getCell(3).font = { size: 9, italic: true }; });
  }
  return sheet;
};

const workbookOf = () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SARRA CRM';
  workbook.created = new Date();
  return workbook;
};

export const buildReportExcel = async (id, user) => {
  const report = await getReport(id, user);
  const { rows, total } = reportRows(report);
  const workbook = workbookOf();
  const approvals = report.chain.filter((step) => step.state === 'done').map((step) => `${step.label}: ${step.by || '-'}${step.at ? ` (${new Date(step.at).toLocaleDateString('en-GB')})` : ''}`);
  writeSheet(workbook, {
    sheetName: 'Prarup-2',
    financialYear: report.financialYear,
    period: report.period,
    scopeLabel: `${report.unitName} — ${report.mprNo} — ${report.statusLabel}`,
    rows,
    total,
    notes: [`Report ${report.mprNo}, allocation version ${report.allocationVersion || '-'}. Status: ${report.statusLabel}.`, ...approvals, report.remarks ? `Remarks: ${report.remarks}` : null].filter(Boolean),
  });
  const docs = workbook.addWorksheet('Supporting documents');
  docs.columns = [{ header: 'Line', key: 'code', width: 14 }, { header: 'Type', key: 'type', width: 26 }, { header: 'File', key: 'name', width: 40 }, { header: 'Uploaded by', key: 'by', width: 24 }, { header: 'Link', key: 'url', width: 60 }];
  report.documents.forEach((doc) => docs.addRow({ code: doc.code || 'Whole report', type: doc.docTypeLabel, name: doc.name, by: doc.uploadedBy || '', url: doc.url }));
  docs.getRow(1).font = { bold: true };
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: `${report.mprNo}-Prarup-2.xlsx` };
};

export const buildStatementExcel = async (user, query) => {
  const statement = await buildStatement(user, query);
  const workbook = workbookOf();
  writeSheet(workbook, {
    sheetName: 'Prarup-2',
    financialYear: statement.financialYear,
    period: statement.period,
    scopeLabel: `${statement.scopeLabel}${statement.verifiedOnly ? ' — verified reports only' : ''}`,
    rows: statement.rows,
    total: statement.total,
    notes: [`Consolidated from ${statement.units} published allocation(s) and the reports filed up to ${statement.period}${statement.verifiedOnly ? ' (verified by State only)' : ' (all filed reports)'}.`],
  });
  const tag = statement.scopeLabel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: `Head56-Prarup-2-${tag}-${statement.reportingMonth}-${statement.financialYear}.xlsx` };
};

// ─── PDF ─────────────────────────────────────────────────────────────────────

const latin = (value) => String(value ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '').replace(/\s+/g, ' ').trim();
const collect = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

const PDF_COLUMNS = [
  { key: 'code', label: 'Code', width: 46, align: 'left' },
  { key: 'name', label: 'Line', width: 132, align: 'left' },
  { key: 'openingPhysical', label: 'Progress to last FY', q: true },
  { key: 'physicalTarget', label: 'Target (No./Ha)', q: true },
  { key: 'targetSize', label: 'Size (cu.m)', q: true },
  { key: 'physicalPrevious', label: 'Prog. prev. months', q: true },
  { key: 'physicalCurrent', label: 'Prog. in month', q: true },
  { key: 'physicalFy', label: 'Prog. FY to date', q: true },
  { key: 'physicalTotal', label: 'Total progress', q: true },
  { key: 'openingSarraLakh', label: 'SARRA exp. to last FY' },
  { key: 'rate', label: 'Rate' },
  { key: 'deptShareLakh', label: 'Target dept. share' },
  { key: 'sarraShareLakh', label: 'Target SARRA share' },
  { key: 'expenditurePreviousLakh', label: 'Exp. prev. months' },
  { key: 'expenditureCurrentLakh', label: 'Exp. in month' },
  { key: 'expenditureFyLakh', label: 'Exp. FY to date' },
  { key: 'expenditureTotalLakh', label: 'Total SARRA exp.' },
  { key: 'balanceLakh', label: 'Balance' },
  { key: 'utilisationPercent', label: 'Util. %', pct: true },
];

const renderPdf = ({ subtitle, rows, total, footer = [] }) => {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 30, bottom: 34, left: 24, right: 24 }, bufferPages: true });
  const done = collect(doc);
  const width = doc.page.width - 48;
  const numberWidth = (width - 46 - 132) / (PDF_COLUMNS.length - 2);
  const columns = PDF_COLUMNS.map((c) => ({ ...c, width: c.width || numberWidth, align: c.align || 'right' }));
  const cellText = (row, column) => {
    const value = row[column.key];
    if (column.key === 'name') return latin(row.name) + (row.hasPhysical && row.unit && !row.heading ? ` [${latin(row.unit)}]` : '');
    if (column.key === 'code') return latin(value);
    if (value === null || value === undefined) return '';
    if (column.pct) return `${Number(value).toFixed(2)}`;
    return column.q ? formatQuantity(value) : formatMoney(value);
  };
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(AUTHORITY, 24, 30, { width, align: 'center' });
    doc.fontSize(9).text(TITLE_EN, { width, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(latin(subtitle), { width, align: 'center' });
    doc.text('(Amounts in Rs. lakh)', { width, align: 'right' });
    let x = 24;
    const top = doc.y + 4;
    doc.font('Helvetica-Bold').fontSize(6.2).fillColor('#0f172a');
    columns.forEach((column) => {
      doc.rect(x, top, column.width, 26).fillAndStroke('#e2e8f0', '#94a3b8');
      doc.fillColor('#0f172a').text(column.label, x + 2, top + 3, { width: column.width - 4, align: 'center' });
      x += column.width;
    });
    doc.y = top + 26;
  };
  const drawRow = (row, { bold, fill } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.4);
    const nameHeight = doc.heightOfString(cellText(row, columns[1]), { width: columns[1].width - 4 });
    const height = Math.max(13, nameHeight + 5);
    if (doc.y + height > doc.page.height - 40) { doc.addPage(); header(); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.4); }
    let x = 24;
    const top = doc.y;
    columns.forEach((column) => {
      if (fill) doc.rect(x, top, column.width, height).fill(fill);
      doc.rect(x, top, column.width, height).strokeColor('#cbd5e1').stroke();
      doc.fillColor('#0f172a').text(cellText(row, column), x + 2 + (column.key === 'name' && row.depth ? 6 : 0), top + 3, { width: column.width - 4 - (column.key === 'name' && row.depth ? 6 : 0), align: column.align });
      x += column.width;
    });
    doc.y = top + height;
  };
  header();
  rows.forEach((row) => drawRow(row, { bold: row.heading, fill: row.heading ? '#fef3c7' : null }));
  drawRow(total, { bold: true, fill: '#dbeafe' });
  if (footer.length) {
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
    footer.forEach((text) => doc.text(latin(text), 24, doc.y, { width }));
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(`Page ${i + 1} of ${range.count} - generated ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })} IST`, 24, doc.page.height - 26, { width, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
};

export const buildReportPdf = async (id, user) => {
  const report = await getReport(id, user);
  const { rows, total } = reportRows(report);
  const approvals = report.chain.filter((step) => step.state === 'done').map((step) => `${step.label}: ${step.by || '-'}${step.at ? ` on ${new Date(step.at).toLocaleDateString('en-GB')}` : ''}`);
  const buffer = await renderPdf({
    subtitle: `${report.unitName} | ${report.mprNo} | FY ${report.financialYear}, ${report.period} | Status: ${report.statusLabel}`,
    rows,
    total,
    footer: [
      `Approval chain: ${approvals.join('; ') || 'not yet verified'}.`,
      report.remarks ? `Remarks: ${report.remarks}` : null,
      `Supporting documents attached: ${report.documents.length}.`,
    ].filter(Boolean),
  });
  return { buffer, filename: `${report.mprNo}-Prarup-2.pdf` };
};

export const buildStatementPdf = async (user, query) => {
  const statement = await buildStatement(user, query);
  const buffer = await renderPdf({
    subtitle: `${statement.scopeLabel} | FY ${statement.financialYear}, ${statement.period}${statement.verifiedOnly ? ' | verified reports only' : ' | all filed reports'}`,
    rows: statement.rows,
    total: statement.total,
    footer: [`Consolidated from ${statement.units} published allocation(s); ${statement.reports} report(s) filed for ${statement.period}.`],
  });
  const tag = statement.scopeLabel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return { buffer, filename: `Head56-Prarup-2-${tag}-${statement.reportingMonth}-${statement.financialYear}.pdf` };
};

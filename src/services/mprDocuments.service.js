import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import ProjectSanction from '../models/ProjectSanction.model.js';
import { getMpr } from './projectMpr.service.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Official output of project Monthly Progress Reports: a PDF and an Excel
 * sheet of one report, and an Excel register of many.
 *
 * Every figure is the stored figure. Nothing is recalculated or rounded here:
 * money is printed with every decimal that was saved (at least two), and in
 * Excel the cells hold the numbers themselves, so they can be summed.
 */

const AUTHORITY = 'Spring and River Rejuvenation Authority (SARRA), Uttarakhand';

const STATUS_LABEL = {
  [PROJECT_MPR_STATUS.SUBMITTED]: 'Submitted - awaiting district review',
  [PROJECT_MPR_STATUS.DISTRICT_APPROVED]: 'Approved by district',
  [PROJECT_MPR_STATUS.RETURNED_TO_PIA]: 'Returned for correction',
  [PROJECT_MPR_STATUS.STATE_VERIFIED]: 'Verified by State',
};

// ─── Formatting (display only; never changes a value) ────────────────────────

/** Money in Rs. lakh: at least 2 decimals, up to the 5 that are stored. */
export const formatMoney = (value) => {
  const fixed = (Number(value) || 0).toFixed(5);
  const [whole, decimals] = fixed.split('.');
  const kept = decimals.replace(/0+$/, '').padEnd(2, '0');
  return `${Number(whole).toLocaleString('en-IN')}.${kept}`.replace(/^(-?)0\./, '$10.');
};

/** Physical quantity: up to 3 decimals, no trailing zeros. */
export const formatQuantity = (value) => {
  const fixed = (Number(value) || 0).toFixed(3).replace(/\.?0+$/, '');
  const [whole, decimals] = fixed.split('.');
  return decimals ? `${Number(whole).toLocaleString('en-IN')}.${decimals}` : Number(whole).toLocaleString('en-IN');
};

const formatPercent = (value) => `${(Number(value) || 0).toFixed(2)}%`;

const IST = { timeZone: 'Asia/Kolkata' };
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { ...IST, day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const formatDateTime = (value) => (value
  ? `${formatDate(value)}, ${new Date(value).toLocaleTimeString('en-GB', { ...IST, hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}`
  : '-');

// The built-in PDF fonts cover Latin text only; anything else would print as garbage.
const latin = (value) => String(value ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '').replace(/[ \t]+/g, ' ').trim();

const place = (project) => [project.village, project.gramPanchayat, project.block, project.district].filter(Boolean).join(', ') || '-';
const safeName = (value) => String(value || 'report').replace(/[^A-Za-z0-9._-]+/g, '-');

const collect = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

// ─── PDF of one report ───────────────────────────────────────────────────────

const INK = '#0f172a';
const MUTED = '#475569';
const RULE = '#94a3b8';
const BAND = '#e2e8f0';
const NAVY = '#0a3d62';

/**
 * Columns of the progress table. Widths add up to the printable width of an
 * A4 landscape page with 28pt margins (785.89pt).
 */
const COLUMNS = [
  { key: 'serial', label: 'S.No.', width: 30, align: 'center' },
  { key: 'activity', label: 'Activity', width: 219.89, align: 'left' },
  { key: 'unit', label: 'Unit', width: 44, align: 'center' },
  { key: 'pTarget', label: 'Target', width: 56, align: 'right', group: 'Physical' },
  { key: 'pPrevious', label: 'Up to previous month', width: 60, align: 'right', group: 'Physical' },
  { key: 'pCurrent', label: 'During the month', width: 56, align: 'right', group: 'Physical' },
  { key: 'pTotal', label: 'Cumulative', width: 60, align: 'right', group: 'Physical' },
  { key: 'fTarget', label: 'Target', width: 64, align: 'right', group: 'Financial (Rs. lakh)' },
  { key: 'fPrevious', label: 'Up to previous month', width: 66, align: 'right', group: 'Financial (Rs. lakh)' },
  { key: 'fCurrent', label: 'During the month', width: 64, align: 'right', group: 'Financial (Rs. lakh)' },
  { key: 'fTotal', label: 'Cumulative', width: 66, align: 'right', group: 'Financial (Rs. lakh)' },
];

/** The rows of the progress table as text, exactly as they are printed. */
export const tableRows = (report) => (report.activities || []).map((activity, index) => ({
  serial: String(index + 1),
  activity: latin(activity.activityName),
  unit: latin(activity.unit || '-'),
  pTarget: activity.hasPhysical ? formatQuantity(activity.physicalTarget) : '-',
  pPrevious: activity.hasPhysical ? formatQuantity(activity.physicalPrevious) : '-',
  pCurrent: activity.hasPhysical ? formatQuantity(activity.physicalCurrent) : '-',
  pTotal: activity.hasPhysical ? formatQuantity(activity.physicalTotal) : '-',
  fTarget: formatMoney(activity.financialTargetLakh),
  fPrevious: formatMoney(activity.financialPreviousLakh),
  fCurrent: formatMoney(activity.financialCurrentLakh),
  fTotal: formatMoney(activity.financialTotalLakh),
}));

export const totalRow = (report) => ({
  serial: '',
  activity: 'Total',
  unit: '',
  pTarget: '', pPrevious: '', pCurrent: '', pTotal: '',
  fTarget: formatMoney(report.totals?.financialTargetLakh),
  fPrevious: formatMoney(report.totals?.financialPreviousLakh),
  fCurrent: formatMoney(report.totals?.financialCurrentLakh),
  fTotal: formatMoney(report.totals?.financialTotalLakh),
});

export const renderPdf = (report) => {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true, info: { Title: `${report.mprNo} - Monthly Progress Report`, Author: 'SARRA CRM', Subject: `${report.period} - ${report.departmentName}` } });
  const done = collect(doc);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 18;

  // Title block
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(AUTHORITY, left, 28, { width, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`Monthly Progress Report - Form ${report.formType}`, { width, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Progress for the month of ${report.period} (Financial Year ${report.financialYear})`, { width, align: 'center' });
  doc.moveDown(0.6);

  // Particulars, two columns
  const particulars = [
    ['MPR No.', report.mprNo],
    ['Status', STATUS_LABEL[report.status] || report.status],
    ['Project ID', report.project.code || '-'],
    ['Department (PIA)', report.departmentName],
    ['Project', report.project.projectName || '-'],
    ['Head', `${report.head?.code || ''} ${report.head?.name || ''}`.trim() || '-'],
    ['Location', place(report.project)],
    ['Submitted by', `${report.submittedBy?.name || '-'} on ${formatDateTime(report.submittedAt)}`],
    ['District review', report.reviewedAt && report.status !== PROJECT_MPR_STATUS.SUBMITTED ? `${report.reviewedBy?.name || '-'} on ${formatDateTime(report.reviewedAt)}` : 'Pending'],
    ['State verification', report.verifiedAt ? formatDateTime(report.verifiedAt) : 'Pending'],
  ];
  const half = width / 2;
  const labelWidth = 86;
  let y = doc.y;
  for (let i = 0; i < particulars.length; i += 2) {
    const pair = [particulars[i], particulars[i + 1]].filter(Boolean);
    doc.font('Helvetica').fontSize(8.5);
    const height = Math.max(...pair.map(([, value]) => doc.heightOfString(latin(value), { width: half - labelWidth - 12 }))) + 5;
    pair.forEach(([label, value], column) => {
      const x = left + column * half;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(`${label}:`, x, y, { width: labelWidth });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(latin(value), x + labelWidth, y, { width: half - labelWidth - 12 });
    });
    y += height;
  }
  y += 6;

  // Progress table
  const cell = (text, x, top, column, height, { bold = false, size = 8, color = INK } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
    const textHeight = doc.heightOfString(text, { width: column.width - 6 });
    doc.text(text, x + 3, top + Math.max(3, (height - textHeight) / 2), { width: column.width - 6, align: column.align });
  };
  const xOf = (index) => left + COLUMNS.slice(0, index).reduce((total, column) => total + column.width, 0);
  const grid = (top, height) => {
    doc.lineWidth(0.5).strokeColor(RULE);
    COLUMNS.forEach((column, index) => doc.rect(xOf(index), top, column.width, height).stroke());
  };

  const drawHeader = (top) => {
    const groupHeight = 15;
    const labelHeight = 34;
    doc.rect(left, top, width, groupHeight + labelHeight).fill(BAND);
    doc.lineWidth(0.5).strokeColor(RULE);
    let index = 0;
    while (index < COLUMNS.length) {
      const column = COLUMNS[index];
      if (!column.group) {
        doc.rect(xOf(index), top, column.width, groupHeight + labelHeight).stroke();
        cell(column.label, xOf(index), top, { ...column, align: 'center' }, groupHeight + labelHeight, { bold: true, size: 8 });
        index += 1;
      } else {
        let span = 0; let end = index;
        while (end < COLUMNS.length && COLUMNS[end].group === column.group) { span += COLUMNS[end].width; end += 1; }
        doc.rect(xOf(index), top, span, groupHeight).stroke();
        cell(column.group, xOf(index), top, { width: span, align: 'center' }, groupHeight, { bold: true, size: 8 });
        for (let inner = index; inner < end; inner += 1) {
          doc.rect(xOf(inner), top + groupHeight, COLUMNS[inner].width, labelHeight).stroke();
          cell(COLUMNS[inner].label, xOf(inner), top + groupHeight, { ...COLUMNS[inner], align: 'center' }, labelHeight, { bold: true, size: 7.5 });
        }
        index = end;
      }
    }
    return top + groupHeight + labelHeight;
  };

  const drawRow = (row, top, { bold = false, fill = null } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const height = Math.max(16, doc.heightOfString(row.activity, { width: COLUMNS[1].width - 6 }) + 7);
    if (top + height > bottom()) return null;
    if (fill) doc.rect(left, top, width, height).fill(fill);
    grid(top, height);
    COLUMNS.forEach((column, index) => cell(row[column.key] ?? '', xOf(index), top, column, height, { bold }));
    return top + height;
  };

  y = drawHeader(y);
  const rows = tableRows(report);
  [...rows.map((row) => ({ row })), { row: totalRow(report), bold: true, fill: '#f1f5f9' }].forEach(({ row, bold, fill }) => {
    let next = drawRow(row, y, { bold, fill });
    if (next === null) {
      doc.addPage();
      y = drawHeader(doc.page.margins.top);
      next = drawRow(row, y, { bold, fill });
    }
    y = next;
  });

  // Summary, remarks and signatures stay together; move to a new page if they do not fit.
  const need = 150;
  if (y + need > bottom()) { doc.addPage(); y = doc.page.margins.top; }
  y += 10;
  const summary = [
    ['Activities', `${report.totals?.activities ?? rows.length} (completed ${report.totals?.activitiesCompleted ?? 0}, in progress ${report.totals?.activitiesInProgress ?? 0}, not started ${report.totals?.activitiesNotStarted ?? 0})`],
    ['Physical progress', formatPercent(report.totals?.physicalPercent)],
    ['Financial progress', `${formatPercent(report.totals?.financialPercent)} (Rs. ${formatMoney(report.totals?.financialTotalLakh)} lakh of Rs. ${formatMoney(report.totals?.financialTargetLakh)} lakh)`],
    ['Balance to be spent', `Rs. ${formatMoney(report.totals?.financialRemainingLakh)} lakh`],
    ['Funds released to department', `Rs. ${formatMoney(report.funds?.releasedLakh)} lakh in ${report.funds?.installments ?? 0} installment(s); unspent Rs. ${formatMoney(report.funds?.unspentLakh)} lakh`],
  ];
  summary.forEach(([label, value]) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(`${label}:`, left, y, { width: 150 });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(latin(value), left + 150, y, { width: width - 150 });
    y = doc.y + 2;
  });
  const notes = [['Remarks of PIA officer', report.remarks], ['District remarks', report.reviewNote], ['Reason for return', report.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA ? report.returnReason : ''], ['State remarks', report.verificationNote]]
    .filter(([, value]) => latin(value));
  notes.forEach(([label, value]) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(`${label}:`, left, y, { width: 150 });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(latin(value), left + 150, y, { width: width - 150 });
    y = doc.y + 2;
  });

  const signatureTop = Math.min(Math.max(y + 34, doc.y + 34), bottom() - 26);
  [['PIA Officer', latin(report.submittedBy?.name || '')], ['District Director', report.status !== PROJECT_MPR_STATUS.SUBMITTED ? latin(report.reviewedBy?.name || '') : ''], ['State (M&E)', '']].forEach(([role, name], index) => {
    const x = left + index * (width / 3) + 20;
    const lineWidth = width / 3 - 40;
    doc.lineWidth(0.5).strokeColor(RULE).moveTo(x, signatureTop).lineTo(x + lineWidth, signatureTop).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(role, x, signatureTop + 4, { width: lineWidth, align: 'center' });
    if (name) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(name, x, signatureTop + 15, { width: lineWidth, align: 'center' });
  });

  // Footer on every page
  const generated = `Generated from SARRA CRM on ${formatDateTime(new Date())}. Figures are as recorded in the system.`;
  const range = doc.bufferedPageRange();
  for (let page = 0; page < range.count; page += 1) {
    doc.switchToPage(range.start + page);
    const footerY = doc.page.height - doc.page.margins.bottom - 8;
    doc.page.margins.bottom = 0; // let the footer sit inside the bottom margin without starting a new page
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(`${report.mprNo}  |  ${generated}`, left, footerY, { width: width - 80, lineBreak: false })
      .text(`Page ${page + 1} of ${range.count}`, left + width - 80, footerY, { width: 80, align: 'right', lineBreak: false });
    doc.page.margins.bottom = 28;
  }
  doc.end();
  return done;
};

/** PDF of one report. Access is checked the same way as opening the report. */
export const buildMprPdf = async (mprId, user) => {
  const report = await getMpr(mprId, user);
  return { buffer: await renderPdf(report), filename: `${safeName(report.mprNo)}.pdf`, report };
};

// ─── Excel ───────────────────────────────────────────────────────────────────

const MONEY_FORMAT = '#,##0.00###';
const QUANTITY_FORMAT = '#,##0.###';
const thin = { style: 'thin', color: { argb: 'FF94A3B8' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

const styleHeader = (row) => {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = headerFill;
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
};

const newWorkbook = () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SARRA CRM';
  workbook.created = new Date();
  return workbook;
};

/** Excel sheet of one report: the same particulars and table as the PDF, with numeric cells. */
export const buildMprExcel = async (mprId, user) => {
  const report = await getMpr(mprId, user);
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet('MPR', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.columns = [{ width: 7 }, { width: 44 }, { width: 10 }, { width: 13 }, { width: 15 }, { width: 13 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];

  sheet.mergeCells('A1:K1');
  sheet.getCell('A1').value = AUTHORITY;
  sheet.getCell('A1').font = { bold: true, size: 13 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  sheet.mergeCells('A2:K2');
  sheet.getCell('A2').value = `Monthly Progress Report - Form ${report.formType} - ${report.period} (FY ${report.financialYear})`;
  sheet.getCell('A2').font = { bold: true, size: 11 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  const particulars = [
    ['MPR No.', report.mprNo],
    ['Status', STATUS_LABEL[report.status] || report.status],
    ['Project ID', report.project.code || ''],
    ['Project', report.project.projectName || ''],
    ['Location', place(report.project)],
    ['Department (PIA)', report.departmentName],
    ['Head', `${report.head?.code || ''} ${report.head?.name || ''}`.trim()],
    ['Financial Year', report.financialYear],
    ['Reporting Month', report.reportingMonth],
    ['Submitted by', report.submittedBy?.name || ''],
    ['Submitted on', formatDateTime(report.submittedAt)],
    ['District review', report.reviewedAt && report.status !== PROJECT_MPR_STATUS.SUBMITTED ? `${report.reviewedBy?.name || ''} on ${formatDateTime(report.reviewedAt)}` : 'Pending'],
    ['State verification', report.verifiedAt ? formatDateTime(report.verifiedAt) : 'Pending'],
  ];
  particulars.forEach(([label, value], index) => {
    const row = sheet.getRow(4 + index);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    sheet.mergeCells(4 + index, 1, 4 + index, 2);
    sheet.mergeCells(4 + index, 3, 4 + index, 11);
    row.getCell(3).value = value;
  });

  const groupRow = 5 + particulars.length;
  const labelRow = groupRow + 1;
  sheet.getRow(groupRow).values = ['S.No.', 'Activity', 'Unit', 'Physical', null, null, null, 'Financial (Rs. lakh)', null, null, null];
  sheet.getRow(labelRow).values = [null, null, null, 'Target', 'Up to previous month', 'During the month', 'Cumulative', 'Target', 'Up to previous month', 'During the month', 'Cumulative'];
  sheet.mergeCells(groupRow, 1, labelRow, 1);
  sheet.mergeCells(groupRow, 2, labelRow, 2);
  sheet.mergeCells(groupRow, 3, labelRow, 3);
  sheet.mergeCells(groupRow, 4, groupRow, 7);
  sheet.mergeCells(groupRow, 8, groupRow, 11);
  for (let column = 1; column <= 11; column += 1) {
    [groupRow, labelRow].forEach((rowNumber) => {
      const cell = sheet.getCell(rowNumber, column);
      cell.font = { bold: true, size: 10 };
      cell.fill = headerFill;
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
  }
  sheet.getRow(labelRow).height = 30;

  (report.activities || []).forEach((activity, index) => {
    const row = sheet.addRow([
      index + 1,
      activity.activityName,
      activity.unit || '',
      activity.hasPhysical ? activity.physicalTarget : null,
      activity.hasPhysical ? activity.physicalPrevious : null,
      activity.hasPhysical ? activity.physicalCurrent : null,
      activity.hasPhysical ? activity.physicalTotal : null,
      activity.financialTargetLakh,
      activity.financialPreviousLakh,
      activity.financialCurrentLakh,
      activity.financialTotalLakh,
    ]);
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.border = border;
      if (column >= 4 && column <= 7) cell.numFmt = QUANTITY_FORMAT;
      if (column >= 8) cell.numFmt = MONEY_FORMAT;
      if (column === 2) cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });
  const total = sheet.addRow([null, 'Total', null, null, null, null, null,
    report.totals?.financialTargetLakh ?? 0, report.totals?.financialPreviousLakh ?? 0, report.totals?.financialCurrentLakh ?? 0, report.totals?.financialTotalLakh ?? 0]);
  total.eachCell({ includeEmpty: true }, (cell, column) => {
    cell.border = border;
    cell.font = { bold: true };
    if (column >= 8) cell.numFmt = MONEY_FORMAT;
  });

  sheet.addRow([]);
  const tail = [
    ['Physical progress (%)', report.totals?.physicalPercent ?? 0, '0.00'],
    ['Financial progress (%)', report.totals?.financialPercent ?? 0, '0.00'],
    ['Balance to be spent (Rs. lakh)', report.totals?.financialRemainingLakh ?? 0, MONEY_FORMAT],
    ['Funds released to department (Rs. lakh)', report.funds?.releasedLakh ?? 0, MONEY_FORMAT],
    ['Unspent out of released (Rs. lakh)', report.funds?.unspentLakh ?? 0, MONEY_FORMAT],
    ['Remarks of PIA officer', report.remarks || '', null],
    ['District remarks', report.reviewNote || '', null],
  ];
  tail.forEach(([label, value, format]) => {
    const row = sheet.addRow([label, null, null, value]);
    sheet.mergeCells(row.number, 1, row.number, 3);
    row.getCell(1).font = { bold: true };
    if (format) row.getCell(4).numFmt = format;
    else sheet.mergeCells(row.number, 4, row.number, 11);
  });
  sheet.addRow([]);
  sheet.addRow([`Generated from SARRA CRM on ${formatDateTime(new Date())}. Figures are as recorded in the system.`]).getCell(1).font = { italic: true, size: 9, color: { argb: 'FF475569' } };

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), filename: `${safeName(report.mprNo)}.xlsx`, report };
};

// ─── Register (many reports) ─────────────────────────────────────────────────

const REGISTER_LIMIT = 5000;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reports a user may export, narrowed by the filters. Scope comes from the user, never from the request. */
export const registerFilter = async (user, { status, financialYear, month, district, headCode, departmentId, projectId, search } = {}) => {
  const filter = {};
  if (user.role === USER_ROLES.PIA_OFFICER) {
    const projects = await ProjectSanction.find({ 'departmentAllocations.piaUserId': user._id }).select('departmentAllocations.departmentId departmentAllocations.piaUserId').lean();
    const pairs = projects.flatMap((project) => (project.departmentAllocations || [])
      .filter((department) => String(department.piaUserId || '') === String(user._id))
      .map((department) => ({ project: project._id, departmentId: department.departmentId })));
    if (!pairs.length) return null;
    filter.$or = pairs;
  } else if (user.role === USER_ROLES.DD_LEVEL) {
    if (!user.district) return null;
    filter.district = user.district;
  } else if (![USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to export reports.');
  }
  if (Object.values(PROJECT_MPR_STATUS).includes(status)) filter.status = status;
  if (/^\d{4}-\d{2}$/.test(financialYear || '')) filter.financialYear = financialYear;
  if (month) filter.reportingMonth = month;
  if (district && user.role !== USER_ROLES.DD_LEVEL) filter.district = district;
  if (headCode) filter['head.code'] = headCode;
  if (/^[a-f0-9]{24}$/i.test(departmentId || '')) filter.departmentId = departmentId;
  if (/^[a-f0-9]{24}$/i.test(projectId || '')) filter.project = projectId;
  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim().slice(0, 80)), 'i');
    filter.$and = [{ $or: [{ mprNo: pattern }, { projectCode: pattern }, { projectTitle: pattern }, { departmentName: pattern }] }];
  }
  return filter;
};

const REGISTER_COLUMNS = [
  ['MPR No.', 22], ['Project ID', 24], ['Project', 38], ['District', 16], ['Department', 26], ['Head', 10], ['Financial Year', 12], ['Month', 12], ['Status', 30],
  ['Activities', 10], ['Physical %', 11], ['Financial target', 16], ['Up to previous month', 16], ['During the month', 16], ['Cumulative', 16], ['Balance', 16], ['Financial %', 11],
  ['Submitted by', 22], ['Submitted on', 22], ['District review on', 22], ['State verified on', 22],
];
const ACTIVITY_COLUMNS = [
  ['MPR No.', 22], ['Project ID', 24], ['District', 16], ['Department', 26], ['Financial Year', 12], ['Month', 12], ['Activity code', 14], ['Activity', 40], ['Unit', 10],
  ['Physical target', 14], ['Physical up to previous', 16], ['Physical during month', 16], ['Physical cumulative', 16],
  ['Financial target', 16], ['Financial up to previous', 16], ['Financial during month', 16], ['Financial cumulative', 16],
];

/** Build the register workbook for a ready-made filter (also used for the monthly email). */
export const buildRegisterWorkbook = async (filter, title) => {
  const reports = filter
    ? await ProjectMPR.find(filter).populate('submittedBy', 'name').sort({ periodIndex: -1, district: 1, projectCode: 1, departmentName: 1 }).limit(REGISTER_LIMIT + 1).lean()
    : [];
  const truncated = reports.length > REGISTER_LIMIT;
  if (truncated) reports.pop();

  const workbook = newWorkbook();
  const register = workbook.addWorksheet('Register', { views: [{ state: 'frozen', ySplit: 3 }] });
  register.columns = REGISTER_COLUMNS.map(([, width]) => ({ width }));
  register.getCell('A1').value = `${AUTHORITY} - MPR Register${title ? ` - ${title}` : ''}`;
  register.getCell('A1').font = { bold: true, size: 12 };
  register.getCell('A2').value = `${reports.length} report(s). Amounts in Rs. lakh. Generated on ${formatDateTime(new Date())}.${truncated ? ` Only the first ${REGISTER_LIMIT} are listed; narrow the filters for the rest.` : ''}`;
  register.getCell('A2').font = { italic: true, size: 9 };
  styleHeader(register.addRow(REGISTER_COLUMNS.map(([label]) => label)));

  reports.forEach((report) => {
    const totals = report.totals || {};
    const row = register.addRow([
      report.mprNo, report.projectCode, report.projectTitle, report.district, report.departmentName, report.head?.code, report.financialYear, report.reportingMonth,
      STATUS_LABEL[report.status] || report.status,
      totals.activities ?? 0, totals.physicalPercent ?? 0, totals.financialTargetLakh ?? 0, totals.financialPreviousLakh ?? 0, totals.financialCurrentLakh ?? 0,
      totals.financialTotalLakh ?? 0, totals.financialRemainingLakh ?? 0, totals.financialPercent ?? 0,
      report.submittedBy?.name || '', formatDateTime(report.submittedAt),
      report.reviewedAt && report.status !== PROJECT_MPR_STATUS.SUBMITTED ? formatDateTime(report.reviewedAt) : '', report.verifiedAt ? formatDateTime(report.verifiedAt) : '',
    ]);
    [12, 13, 14, 15, 16].forEach((column) => { row.getCell(column).numFmt = MONEY_FORMAT; });
    [11, 17].forEach((column) => { row.getCell(column).numFmt = '0.00'; });
  });
  if (reports.length) {
    const units = (key) => reports.reduce((sumSoFar, report) => sumSoFar + Math.round((report.totals?.[key] || 0) * 100000), 0) / 100000;
    const row = register.addRow(['Total', null, null, null, null, null, null, null, null, null, null,
      units('financialTargetLakh'), units('financialPreviousLakh'), units('financialCurrentLakh'), units('financialTotalLakh'), units('financialRemainingLakh')]);
    row.font = { bold: true };
    [12, 13, 14, 15, 16].forEach((column) => { row.getCell(column).numFmt = MONEY_FORMAT; });
  }
  register.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: REGISTER_COLUMNS.length } };

  const activities = workbook.addWorksheet('Activity-wise', { views: [{ state: 'frozen', ySplit: 1 }] });
  activities.columns = ACTIVITY_COLUMNS.map(([, width]) => ({ width }));
  styleHeader(activities.addRow(ACTIVITY_COLUMNS.map(([label]) => label)));
  reports.forEach((report) => (report.activities || []).forEach((activity) => {
    const physical = activity.hasPhysical !== false;
    const row = activities.addRow([
      report.mprNo, report.projectCode, report.district, report.departmentName, report.financialYear, report.reportingMonth,
      activity.activityCode, activity.activityName, activity.unit || '',
      physical ? activity.physicalTarget : null, physical ? activity.physicalPrevious : null, physical ? activity.physicalCurrent : null, physical ? activity.physicalTotal : null,
      activity.financialTargetLakh, activity.financialPreviousLakh, activity.financialCurrentLakh, activity.financialTotalLakh,
    ]);
    [10, 11, 12, 13].forEach((column) => { row.getCell(column).numFmt = QUANTITY_FORMAT; });
    [14, 15, 16, 17].forEach((column) => { row.getCell(column).numFmt = MONEY_FORMAT; });
  }));
  activities.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ACTIVITY_COLUMNS.length } };

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), count: reports.length, truncated };
};

/** Excel register of every report the user may see, narrowed by the filters. */
export const buildRegisterExcel = async (user, query = {}) => {
  const filter = await registerFilter(user, query);
  const parts = [query.month, query.financialYear, user.role === USER_ROLES.DD_LEVEL ? user.district : query.district].filter(Boolean);
  const result = await buildRegisterWorkbook(filter, parts.join(' '));
  return { ...result, filename: `MPR-Register${parts.length ? `-${safeName(parts.join('-'))}` : ''}.xlsx` };
};

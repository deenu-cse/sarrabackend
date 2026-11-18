import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { COMMITTEE_TYPES, MEETING_STATUS_LABELS } from '../models/CommitteeMeeting.model.js';
import { TRAINING_LEVELS } from '../models/TrainingProgramme.model.js';
import { getMeeting, meetingsForExport } from './committeeMeeting.service.js';
import { dnssForExport, membersOf } from './dnss.service.js';
import { totalsOf, trainingsForExport } from './training.service.js';
import { buildConsolidated } from './jsa.service.js';
import { formatQuantity } from './mprDocuments.service.js';

/**
 * Official output of the field forms: the PDF of a committee meeting, the
 * registers of meetings, DNSS and training in SARRA's column layouts, and the
 * JSA Prarup-03 (Excel with the Hindi headings of the format, and PDF).
 */

const AUTHORITY = 'Spring and River Rejuvenation Authority (SARRA), Uttarakhand';
const IST = { timeZone: 'Asia/Kolkata' };
const day = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-');
const moment = (value) => (value ? `${new Date(value).toLocaleDateString('en-GB', { ...IST, day: '2-digit', month: 'short', year: 'numeric' })}, ${new Date(value).toLocaleTimeString('en-GB', { ...IST, hour: '2-digit', minute: '2-digit' })}` : '-');
const latin = (value) => String(value ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '').replace(/[ \t]+/g, ' ').trim();
const safe = (value) => String(value || 'file').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const collect = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});
const stamp = (doc, width, left) => {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // the footer sits below the text area; keep PDFKit from opening a new page for it
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(`Page ${i + 1} of ${range.count} - generated ${moment(new Date())} IST`, left, doc.page.height - 26, { width, align: 'center', lineBreak: false });
  }
};

/** An image from storage for the PDF (JPEG / PNG only), or null when it cannot be fetched quickly. */
const fetchImage = async (file) => {
  if (!/^https:\/\//.test(file.url || '') || !/jpe?g|png/.test(file.mimeType || '')) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(file.url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length < 12 * 1024 * 1024 ? buffer : null;
  } catch {
    return null;
  }
};

// ─── Committee meeting PDF ───────────────────────────────────────────────────

export const buildMeetingPdf = async (id, user) => {
  const meeting = await getMeeting(id, user);
  const committee = COMMITTEE_TYPES[meeting.type];
  const photos = (await Promise.all(meeting.photographs.slice(0, 8).map(fetchImage))).map((buffer, i) => ({ buffer, file: meeting.photographs[i] }));
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 42, right: 42 }, bufferPages: true });
  const done = collect(doc);
  const width = doc.page.width - 84;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(AUTHORITY, { width, align: 'center' });
  doc.moveDown(0.3).fontSize(13).fillColor('#0a3d62').text(`Reporting Format - ${committee.code} (${committee.name})`, { width, align: 'center' });
  doc.moveDown(0.2).font('Helvetica').fontSize(9).fillColor('#475569').text(`${meeting.refNo}${meeting.district ? ` | ${meeting.district} district` : ''} | Status: ${meeting.statusLabel}`, { width, align: 'center' });
  doc.moveDown(0.8);

  const rows = [
    ['S.No / Ref. No.', meeting.refNo],
    [`No. of ${committee.code} Meeting`, String(meeting.meetingNo)],
    [`Date of ${committee.code}`, day(meeting.meetingDate)],
    ['Place of Meeting', meeting.place],
    ['Total Members / Participants (No.)', String(meeting.participants.total)],
    ['Male Persons', String(meeting.participants.male)],
    ['Female Persons', String(meeting.participants.female)],
    ['Minutes of Meeting', meeting.minutes.length ? meeting.minutes.map((f) => f.name).join(', ') : 'Not attached'],
    ['Photographs of Meeting', `${meeting.photographs.length} attached`],
    ['Remarks', meeting.remarks || '-'],
  ];
  const labelWidth = 170;
  for (const [label, value] of rows) {
    const text = latin(value);
    const height = Math.max(20, doc.font('Helvetica').fontSize(9).heightOfString(text, { width: width - labelWidth - 12 }) + 10);
    const top = doc.y;
    doc.rect(42, top, labelWidth, height).fillAndStroke('#e2e8f0', '#94a3b8');
    doc.rect(42 + labelWidth, top, width - labelWidth, height).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(label, 48, top + 5, { width: labelWidth - 12 });
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(text, 48 + labelWidth, top + 5, { width: width - labelWidth - 12 });
    doc.y = top + height;
  }

  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor('#0a3d62').text('Approval', 42, doc.y, { width });
  doc.moveDown(0.2).font('Helvetica').fontSize(9).fillColor('#0f172a');
  doc.text(latin(`Entered by: ${meeting.createdBy || '-'}`), { width });
  doc.text(latin(`Submitted by: ${meeting.submittedBy || '-'} on ${moment(meeting.submittedAt)}`), { width });
  doc.text(latin(meeting.status === 'APPROVED' ? `Approved by HQ Approver: ${meeting.approvedBy || '-'} on ${moment(meeting.approvedAt)}${meeting.approvalNote ? ` - ${meeting.approvalNote}` : ''}` : `HQ approval: ${meeting.statusLabel}`), { width });
  if (meeting.returnReason) doc.text(latin(`Returned: ${meeting.returnReason}`), { width });

  if (meeting.minutes.length) {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor('#0a3d62').text('Minutes (files)', { width });
    doc.font('Helvetica').fontSize(8.5).fillColor('#1d4ed8');
    meeting.minutes.forEach((file) => doc.text(latin(file.name), { width, link: file.url, underline: true }));
  }

  const shown = photos.filter((p) => p.buffer);
  if (shown.length) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0a3d62').text('Photographs of Meeting', { width });
    doc.moveDown(0.5);
    const cell = (width - 16) / 2;
    let x = 42;
    let rowTop = doc.y;
    shown.forEach((photo, index) => {
      if (index % 2 === 0 && index > 0) { rowTop += 200; x = 42; }
      if (rowTop + 190 > doc.page.height - 50) { doc.addPage(); rowTop = 50; }
      try { doc.image(photo.buffer, x, rowTop, { fit: [cell, 170], align: 'center', valign: 'center' }); } catch { /* unreadable image */ }
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(latin(photo.file.name), x, rowTop + 174, { width: cell, align: 'center' });
      x += cell + 16;
    });
  }
  if (meeting.photographs.length > shown.length) {
    doc.moveDown(1).font('Helvetica').fontSize(8).fillColor('#475569').text(`${meeting.photographs.length - shown.length} more photograph(s) are available in the portal.`, 42, doc.y, { width });
  }
  stamp(doc, width, 42);
  doc.end();
  return { buffer: await done, filename: `${safe(meeting.refNo)}.pdf` };
};

// ─── Excel helpers ───────────────────────────────────────────────────────────

const thin = { style: 'thin', color: { argb: 'FF94A3B8' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
const workbookOf = () => { const wb = new ExcelJS.Workbook(); wb.creator = 'SARRA CRM'; wb.created = new Date(); return wb; };
const toBuffer = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());
const colName = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };

const styleBlock = (sheet, fromRow, toRow, cols) => {
  for (let r = fromRow; r <= toRow; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      const cell = sheet.getRow(r).getCell(c);
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
      cell.fill = headFill;
    }
  }
};
const styleRow = (row, cols, fill) => {
  for (let c = 1; c <= cols; c += 1) {
    const cell = row.getCell(c);
    cell.border = border;
    cell.font = { size: 9, bold: Boolean(fill) };
    cell.alignment = { vertical: 'middle', wrapText: true };
    if (fill) cell.fill = fill;
  }
};
const title = (sheet, text, cols, row = 1) => {
  sheet.mergeCells(row, 1, row, cols);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 12 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  sheet.getRow(row).height = 26;
};
const link = (files = []) => (files[0] ? { text: `${files.length} file${files.length === 1 ? '' : 's'}`, hyperlink: files[0].url } : 'Not attached');

// ─── Registers ───────────────────────────────────────────────────────────────

export const buildMeetingsExcel = async (user, query = {}) => {
  const meetings = await meetingsForExport(user, query);
  const wb = workbookOf();
  const types = Object.keys(COMMITTEE_TYPES).filter((type) => !query.type || type === query.type);
  for (const type of types) {
    const list = meetings.filter((m) => m.type === type);
    if (!list.length && query.type !== type) continue;
    const committee = COMMITTEE_TYPES[type];
    const sheet = wb.addWorksheet(`${type} Details`);
    const district = type === 'DLEC';
    const headers = ['S.No', ...(district ? ['District'] : []), `Date of ${type}`, 'Place of Meeting', 'Total Members/Participants (In No.)', 'Male Person', 'Female Person', 'Minute of Meeting (Upload)', 'Photographs of Meeting (Upload)', `No. of ${type} Meeting`, 'Status', 'Remarks', 'Ref. No.'];
    sheet.columns = headers.map((h) => ({ width: Math.max(12, Math.min(34, h.length + 4)) }));
    title(sheet, `Reporting Format- ${type}(${committee.name})`, headers.length, 2);
    sheet.getRow(5).values = headers;
    styleBlock(sheet, 5, 5, headers.length);
    sheet.getRow(5).height = 42;
    list.forEach((m, index) => {
      const row = sheet.addRow([index + 1, ...(district ? [m.district] : []), new Date(m.meetingDate), m.place, m.participants.male + m.participants.female, m.participants.male, m.participants.female, link(m.minutes), link(m.photographs), m.meetingNo, MEETING_STATUS_LABELS[m.status], m.remarks || '', m.refNo]);
      styleRow(row, headers.length);
      row.getCell(district ? 3 : 2).numFmt = 'dd-mmm-yyyy';
    });
  }
  if (!wb.worksheets.length) wb.addWorksheet('Meetings').addRow(['No meeting has been recorded.']);
  return { buffer: await toBuffer(wb), filename: `Committee-Meetings${query.type ? `-${query.type}` : ''}.xlsx` };
};

export const buildDnssExcel = async (user, query = {}) => {
  const list = await dnssForExport(user, query);
  const wb = workbookOf();
  const sheet = wb.addWorksheet('DNSS Details');
  const cols = 17;
  sheet.columns = [6, 16, 16, 20, 10, 10, 10, 10, 11, 11, 24, 14, 14, 16, 14, 14, 24].map((width) => ({ width }));
  title(sheet, 'Reporting Format - Dhara Naula Sanrakshan Samiti (DNSS)', cols, 2);
  const top = ['S.No', 'District Name', 'Block Name', 'Gram Panchayat Name', 'No. of Group', 'Total Members (In No.)', '', '', '', '', 'Gram Pradhan/Chairperson', 'Contact Number', 'Date of DNSS Formation', 'DNSS Formation Letter (Upload)', 'Photographs of Meeting (Upload)', 'Minute of Meeting (Upload)', 'Remarks'];
  sheet.getRow(5).values = top;
  sheet.getRow(6).values = ['', '', '', '', '', 'Total Members', 'Male Person', 'Female Person', '% of Female Person', '% of Male Person'];
  sheet.mergeCells('F5:J5');
  ['A', 'B', 'C', 'D', 'E', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'].forEach((c) => sheet.mergeCells(`${c}5:${c}6`));
  styleBlock(sheet, 5, 6, cols);
  sheet.getRow(5).height = 30; sheet.getRow(6).height = 30;
  list.forEach((d, index) => {
    const m = membersOf(d.members);
    const row = sheet.addRow([index + 1, d.district, d.block?.name, d.gramPanchayat?.name, d.groups, m.total, m.male, m.female, m.femalePercent / 100, m.malePercent / 100, d.chairperson, d.contactNumber, d.formationDate ? new Date(d.formationDate) : '', link(d.formationLetter), link(d.photographs), link(d.minutes), d.remarks || '']);
    styleRow(row, cols);
    row.getCell(9).numFmt = '0.00%'; row.getCell(10).numFmt = '0.00%'; row.getCell(13).numFmt = 'dd-mmm-yyyy';
  });
  return { buffer: await toBuffer(wb), filename: `DNSS-Register${query.district ? `-${safe(query.district)}` : ''}.xlsx` };
};

export const buildTrainingExcel = async (user, query = {}) => {
  const list = await trainingsForExport(user, query);
  const wb = workbookOf();
  const sheet = wb.addWorksheet('Training');
  const cols = 21;
  sheet.columns = [6, 16, 12, 22, 30, 28, 9, 9, 9, 9, 9, 9, 9, 13, 13, 13, 24, 26, 16, 16, 16].map((width) => ({ width }));
  title(sheet, 'Training and Capacity Development Programme', cols, 1);
  sheet.getRow(2).values = ['S.No', 'Level (Gram Panchayat, Block, District)', 'Date', 'Place of Program', 'Name/List of All Participating Departments', 'Activity/Subject Name', 'No. of Participants', '', '', '', '', '', 'Total', 'Photographs (Upload)', 'Documents (Upload)', 'Minutes of Meeting (Upload)', 'Remarks', 'Organised by', 'District', 'Block', 'Gram Panchayat'];
  sheet.getRow(3).values = ['', '', '', '', '', '', 'Officer/Staff', '', 'Public Representative', '', 'Community', ''];
  sheet.getRow(4).values = ['', '', '', '', '', '', 'Male', 'Female', 'Male', 'Female', 'Male', 'Female'];
  sheet.mergeCells('G2:L2'); sheet.mergeCells('G3:H3'); sheet.mergeCells('I3:J3'); sheet.mergeCells('K3:L3');
  ['A', 'B', 'C', 'D', 'E', 'F', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'].forEach((c) => sheet.mergeCells(`${c}2:${c}4`));
  styleBlock(sheet, 2, 4, cols);
  sheet.getRow(2).height = 34;
  list.forEach((t, index) => {
    const p = totalsOf(t.participants);
    const row = sheet.addRow([index + 1, TRAINING_LEVELS[t.level], new Date(t.date), t.place, t.departments.join(', '), t.subject,
      p.officer.male, p.officer.female, p.representative.male, p.representative.female, p.community.male, p.community.female, p.total,
      link(t.photographs), link(t.documents), link(t.minutes), t.remarks || '', t.organiser.unitName, t.district, t.block?.name || '', t.gramPanchayat?.name || '']);
    styleRow(row, cols);
    row.getCell(3).numFmt = 'dd-mmm-yyyy';
  });
  if (list.length) {
    const row = sheet.addRow(['', 'Total']);
    [7, 8, 9, 10, 11, 12, 13].forEach((c) => {
      let result = 0;
      for (let r = 5; r <= list.length + 4; r += 1) result += Number(sheet.getRow(r).getCell(c).value) || 0;
      row.getCell(c).value = { formula: `SUM(${colName(c)}5:${colName(c)}${list.length + 4})`, result };
    });
    styleRow(row, cols, totalFill);
  }
  return { buffer: await toBuffer(wb), filename: 'Training-Programmes.xlsx' };
};

// ─── JSA Prarup-03 ───────────────────────────────────────────────────────────

const JSA_COLUMNS = [
  ['cementedCheckDam', 'सीमेंटेड चैक डैम (सं०)'], ['checkDam', 'चैक डैम (सं०)'], ['contourTrench', 'कन्टूर ट्रेन्चेज (सं०)'], ['rechargePit', 'रिचार्ज पिट (सं०)'],
  ['dugoutPondShaft', 'डगआउट पौण्ड / तालाब / शॉफ्ट (सं०)'], ['plantationHa', 'वृक्षारोपण (है०)'], ['plantationNo', 'वृक्षारोपण (सं०)'], ['other', 'अन्य'],
];

export const buildJsaExcel = async (user, query = {}) => {
  const report = await buildConsolidated(user, query);
  const wb = workbookOf();
  const sheet = wb.addWorksheet('Prarup-03', { views: [{ state: 'frozen', xSplit: 2, ySplit: 8 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const cols = 3 + JSA_COLUMNS.length * 2;
  sheet.columns = [{ width: 7 }, { width: 18 }, { width: 18 }, ...JSA_COLUMNS.flatMap(() => [{ width: 10 }, { width: 10 }])];
  title(sheet, `जल संरक्षण अभियान ${report.campaign}`, cols, 1);
  title(sheet, `जनपद स्तर पर सहायक नदियों/धाराओं की उपचार योजना एवं प्रगति${report.level ? ` (${report.level === 'VILLAGE' ? 'ग्राम' : report.level === 'BLOCK' ? 'विकासखण्ड' : 'जनपद'} स्तर)` : ''}`, cols, 2);
  sheet.mergeCells(3, cols - 5, 3, cols); sheet.getCell(3, cols - 5).value = 'साप्ताहिक प्रगति प्रारूप-03'; sheet.getCell(3, cols - 5).font = { bold: true };
  sheet.mergeCells(4, cols - 3, 4, cols); sheet.getCell(4, cols - 3).value = `दिनांक: ${report.asOnLabel}`;
  sheet.mergeCells('A5:A8'); sheet.getCell('A5').value = 'क्र0सं0';
  sheet.mergeCells('B5:B8'); sheet.getCell('B5').value = 'जनपद';
  sheet.mergeCells('C5:C8'); sheet.getCell('C5').value = 'जनपद स्तर पर उपचार हेतु चिन्हित सहायक नदियों/धाराओं की संख्या';
  sheet.mergeCells(5, 4, 5, cols); sheet.getCell(5, 4).value = 'उपचार गतिविधियां';
  JSA_COLUMNS.forEach(([, label], i) => {
    const c = 4 + i * 2;
    sheet.mergeCells(6, c, 7, c + 1);
    sheet.getCell(6, c).value = label;
    sheet.getCell(8, c).value = 'लक्ष्य';
    sheet.getCell(8, c + 1).value = 'प्रगति';
  });
  styleBlock(sheet, 5, 8, cols);
  sheet.getRow(6).height = 30; sheet.getRow(5).height = 22;
  report.rows.forEach((row, index) => {
    const r = sheet.addRow([index + 1, row.districtHindi, row.streams, ...JSA_COLUMNS.flatMap(([key]) => [row.activities[key].target, row.activities[key].progress])]);
    styleRow(r, cols);
  });
  const total = sheet.addRow(['योग', '', report.total.streams, ...JSA_COLUMNS.flatMap(([key]) => [report.total.activities[key].target, report.total.activities[key].progress])]);
  sheet.mergeCells(total.number, 1, total.number, 2);
  styleRow(total, cols, totalFill);

  // Potential recharge (SARRA "potential recharge" layout).
  const rs = wb.addWorksheet('Potential Recharge');
  rs.columns = [6, 26, 14, 14, 16, 12, 22, 14, 14, 16, 12, 22].map((width) => ({ width }));
  title(rs, `Jal Sanrakshan Abhiyan ${report.campaign} - Targets and Progress of Water and Soil Conservation Activities`, 12, 1);
  rs.mergeCells('C2:G2'); rs.getCell('C2').value = 'Target';
  rs.mergeCells('H2:L2'); rs.getCell('H2').value = `Progress (As on ${report.asOnLabel})`;
  rs.getRow(3).values = ['SN', 'Activity', 'No. of Proposed Structures', 'Average Capacity unit (In Cu.Mt.)', 'Total Capacity (In Cu.Mt.)', 'No. of Refill in Monsoon months', 'Potential Recharge capacity in monsoon (Cu.Mt.)', 'Structures', 'Average Capacity unit (In Cu.Mt.)', 'Total Capacity (In Cu.Mt.)', 'No. of Refill', 'Expected Recharge (Cu.Mt.)'];
  styleBlock(rs, 2, 3, 12);
  rs.getRow(3).height = 44;
  report.recharge.rows.forEach((r, i) => styleRow(rs.addRow([i + 1, r.name, r.targetStructures, r.capacity, r.targetCapacity, r.refills, r.potentialRecharge, r.progressStructures, r.capacity, r.progressCapacity, r.refills, r.rechargeTillDate]), 12));
  const t = report.recharge.totals;
  const tr = rs.addRow(['Total', '', t.targetStructures, '', '', '', t.potentialRecharge, t.progressStructures, '', '', '', t.rechargeTillDate]);
  styleRow(tr, 12, totalFill);
  rs.addRow([]);
  rs.addRow(['', 'Targeted approx. water recharge', `${t.potentialMillion} Million Cubic m.`]);
  rs.addRow(['', `Approx. recharge (as on ${report.asOnLabel})`, `${t.tillDateMillion} Million Cubic m.`]);
  rs.addRow(['', 'Afforestation (Ha)', `Target ${formatQuantity(report.recharge.plantation.target)} Ha`, `Progress ${formatQuantity(report.recharge.plantation.progress)} Ha`]);
  rs.addRow(['', 'Plantation (plants)', `Target ${formatQuantity(report.recharge.plantation.plants.target)}`, `Progress ${formatQuantity(report.recharge.plantation.plants.progress)}`]);

  // Every place behind the totals.
  const ps = wb.addWorksheet('Village-Block-District');
  const placeHeaders = ['S.No', 'District', 'Type', 'Place', 'As on', 'Streams', ...JSA_COLUMNS.flatMap(([, label]) => [`${label} - Target`, `${label} - Progress`]), 'Other (description)'];
  ps.columns = placeHeaders.map((h, i) => ({ width: i < 6 ? [6, 16, 10, 34, 13, 9][i] : 12 }));
  ps.getRow(1).values = placeHeaders;
  styleBlock(ps, 1, 1, placeHeaders.length);
  ps.getRow(1).height = 48;
  report.places.forEach((p, i) => {
    const row = ps.addRow([i + 1, p.district, p.levelLabel, p.placeName, new Date(p.asOnDate), p.streams, ...JSA_COLUMNS.flatMap(([key]) => [p.activities?.[key]?.target || 0, p.activities?.[key]?.progress || 0]), p.otherDescription || '']);
    styleRow(row, placeHeaders.length);
    row.getCell(5).numFmt = 'dd-mmm-yyyy';
  });
  const scope = String(report.scope).replace(/[^A-Za-z0-9]+/g, '-');
  return { buffer: await toBuffer(wb), filename: `JSA-${report.campaign}-Prarup-03-${scope}-${new Date(report.asOn).toISOString().slice(0, 10)}.xlsx` };
};

export const buildJsaPdf = async (user, query = {}) => {
  const report = await buildConsolidated(user, query);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 30, bottom: 34, left: 24, right: 24 }, bufferPages: true });
  const done = collect(doc);
  const width = doc.page.width - 48;
  const head = () => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(AUTHORITY, 24, 30, { width, align: 'center' });
    doc.fontSize(10).text(`Jal Sanrakshan Abhiyan ${report.campaign} - Treatment plan and progress of tributary rivers / streams (Weekly Progress Format-03)`, { width, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`${report.scope}${report.level ? ` | ${report.level.toLowerCase()} reports` : ' | village, block and district reports'} | As on ${report.asOnLabel}`, { width, align: 'center' });
    doc.moveDown(0.4);
  };
  head();
  const labels = ['Cemented check dam', 'Check dam', 'Contour trenches', 'Recharge pit', 'Dugout pond / pond / shaft', 'Plantation (Ha)', 'Plantation (No.)', 'Other'];
  const keys = JSA_COLUMNS.map(([key]) => key);
  const first = [24, 110, 70];
  const pairWidth = (width - first.reduce((a, b) => a + b, 0)) / keys.length / 2;
  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor('#0f172a');
  let x = 24;
  [['S.No', first[0]], ['District', first[1]], ['Streams identified', first[2]]].forEach(([label, w]) => {
    doc.rect(x, top, w, 34).fillAndStroke('#e2e8f0', '#94a3b8');
    doc.fillColor('#0f172a').text(label, x + 2, top + 4, { width: w - 4, align: 'center' });
    x += w;
  });
  labels.forEach((label) => {
    doc.rect(x, top, pairWidth * 2, 20).fillAndStroke('#e2e8f0', '#94a3b8');
    doc.fillColor('#0f172a').text(label, x + 2, top + 3, { width: pairWidth * 2 - 4, align: 'center' });
    ['Target', 'Progress'].forEach((sub, i) => {
      doc.rect(x + i * pairWidth, top + 20, pairWidth, 14).fillAndStroke('#f1f5f9', '#94a3b8');
      doc.fillColor('#0f172a').text(sub, x + i * pairWidth + 1, top + 23, { width: pairWidth - 2, align: 'center' });
    });
    x += pairWidth * 2;
  });
  doc.y = top + 34;
  const line = (cells, bold, fill) => {
    const y = doc.y;
    let cx = 24;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.2);
    cells.forEach((value, i) => {
      const w = i < 3 ? first[i] : pairWidth;
      if (fill) doc.rect(cx, y, w, 15).fill(fill);
      doc.rect(cx, y, w, 15).strokeColor('#cbd5e1').stroke();
      doc.fillColor('#0f172a').text(String(value), cx + 2, y + 4, { width: w - 4, align: i === 1 ? 'left' : 'right' });
      cx += w;
    });
    doc.y = y + 15;
  };
  report.rows.forEach((row, i) => line([i + 1, latin(row.district), formatQuantity(row.streams), ...keys.flatMap((k) => [formatQuantity(row.activities[k].target), formatQuantity(row.activities[k].progress)])]));
  line(['', 'Total', formatQuantity(report.total.streams), ...keys.flatMap((k) => [formatQuantity(report.total.activities[k].target), formatQuantity(report.total.activities[k].progress)])], true, '#dbeafe');

  doc.addPage();
  head();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0a3d62').text('Targets and progress of water and soil conservation activities - potential recharge', 24, doc.y, { width });
  doc.moveDown(0.3);
  const rw = [24, 150, 90, 70, 60, 110, 90, 120];
  const rh = ['SN', 'Activity', 'Proposed structures', 'Avg. capacity (cu.m)', 'Refills', 'Potential recharge in monsoon (cu.m)', 'Structures completed', 'Recharge till date (cu.m)'];
  const rtop = doc.y;
  let rx = 24;
  doc.font('Helvetica-Bold').fontSize(7.5);
  rh.forEach((label, i) => { doc.rect(rx, rtop, rw[i], 26).fillAndStroke('#e2e8f0', '#94a3b8'); doc.fillColor('#0f172a').text(label, rx + 2, rtop + 4, { width: rw[i] - 4, align: 'center' }); rx += rw[i]; });
  doc.y = rtop + 26;
  const rline = (cells, bold, fill) => {
    const y = doc.y;
    let cx = 24;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    cells.forEach((value, i) => {
      if (fill) doc.rect(cx, y, rw[i], 16).fill(fill);
      doc.rect(cx, y, rw[i], 16).strokeColor('#cbd5e1').stroke();
      doc.fillColor('#0f172a').text(String(value), cx + 3, y + 4, { width: rw[i] - 6, align: i === 1 ? 'left' : 'right' });
      cx += rw[i];
    });
    doc.y = y + 16;
  };
  report.recharge.rows.forEach((r, i) => rline([i + 1, r.name, formatQuantity(r.targetStructures), formatQuantity(r.capacity), r.refills, formatQuantity(r.potentialRecharge), formatQuantity(r.progressStructures), formatQuantity(r.rechargeTillDate)]));
  const t = report.recharge.totals;
  rline(['', 'Total', formatQuantity(t.targetStructures), '', '', formatQuantity(t.potentialRecharge), formatQuantity(t.progressStructures), formatQuantity(t.rechargeTillDate)], true, '#dbeafe');
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(`Targeted approx. water recharge: ${t.potentialMillion} Million cubic m.`, 24, doc.y, { width });
  doc.text(`Approx. recharge (as on ${report.asOnLabel}): ${t.tillDateMillion} Million cubic m.`, { width });
  doc.font('Helvetica').fontSize(9).text(`Afforestation: target ${formatQuantity(report.recharge.plantation.target)} Ha, progress ${formatQuantity(report.recharge.plantation.progress)} Ha. Plants: target ${formatQuantity(report.recharge.plantation.plants.target)}, progress ${formatQuantity(report.recharge.plantation.plants.progress)}.`, { width });
  doc.moveDown(0.4).fontSize(7.5).fillColor('#475569').text(`Recharge = structures x average capacity of one structure x refills in the monsoon. Based on ${report.total.reports} report(s): ${report.counts.VILLAGE} village, ${report.counts.BLOCK} block, ${report.counts.DISTRICT} district.`, { width });
  stamp(doc, width, 24);
  doc.end();
  const scope = String(report.scope).replace(/[^A-Za-z0-9]+/g, '-');
  return { buffer: await done, filename: `JSA-${report.campaign}-Prarup-03-${scope}-${new Date(report.asOn).toISOString().slice(0, 10)}.pdf` };
};

import Head56Mpr, { H56_DOC_TYPES } from '../models/Head56Mpr.model.js';
import Head56Allocation from '../models/Head56Allocation.model.js';
import Head56Review from '../models/Head56Review.model.js';
import Counter from '../models/Counter.model.js';
import User from '../models/User.model.js';
import { PROJECT_MPR_STATUS, MPR_STATUS_LABELS } from '../models/ProjectMPR.model.js';
import { H56_LEVELS } from '../models/Head56Item.model.js';
import { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { actorLabel, isHq, sameId } from '../utils/access.js';
import {
  REVIEW_STAGES, WITH_MAKER, canActOnStage, chainOf, firstStageOf, queueFilterFor, stageOwner, statusQuery,
} from './mprWorkflow.js';
import { itemMap } from './head56Master.service.js';
import { findPublished, reportedByCode } from './head56Allocation.service.js';
import { deleteFile, uploadFile } from './upload.service.js';
import {
  FY_MONTHS, bad, canReadDoc, clean, conflict, forbidden, fromMoney, fromPhysical, historyEntry, isUnitMaker, isValidId, lakhText, levelLabel,
  notFound, parseAmount, percent, periodFor, periodLabel, periodOf, quantityText, readScope, recentFinancialYears, resolvePeriod, toMoney, toPhysical, unitOfUser,
} from './head56.common.js';

/**
 * Monthly Progress Reports of Budget Head 56.
 *
 * The Maker of a unit (HQ Maker, District Maker, PIA Maker) types this month's
 * physical progress and expenditure for each allocated line and attaches the
 * supporting documents. Targets come from the published allocation; progress
 * up to the previous month and every total are worked out here.
 *
 * The report then climbs the same Maker → Checker → Approver chain as project
 * MPRs: a PIA report is validated and consolidated by District Technical Staff
 * (the District Maker) and approved by the district before HQ; a District
 * SARRA Centre report starts at the District Checker; an HQ report at the HQ
 * Checker. Checker steps confirm a verification checklist. Verified reports
 * are locked; the HQ Approver can reopen the latest one with a reason.
 */

const S = PROJECT_MPR_STATUS;
const { APPROVER } = WORKFLOW_ROLES;
const byCode = (a, b) => a.code.localeCompare(b.code, 'en');

export const MAX_DOCUMENTS = 30;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// How the shared chain is named for Head 56.
const MAKER_LABEL = { PIA: 'PIA Maker — entry', DISTRICT: 'District Maker — entry', HQ: 'HQ Maker — entry' };
const STEP_LABELS = { [S.SUBMITTED_TO_DISTRICT]: 'District Technical Staff — validate', [S.SUBMITTED_TO_HQ]: 'HQ Maker — compile' };
const VERBS = {
  [S.SUBMITTED_TO_DISTRICT]: { verb: 'Validate & Consolidate', done: 'PIA data validated and consolidated by District Technical Staff' },
  [S.PENDING_DISTRICT_CHECKER]: { verb: 'Verify & Send to District Approver', done: 'Bills, expenditure and progress verified by District Checker' },
};
const verbOf = (status) => VERBS[status]?.verb || REVIEW_STAGES[status]?.verb || null;
const doneOf = (status) => VERBS[status]?.done || REVIEW_STAGES[status]?.done || '';

/** What a Checker confirms before forwarding (the workflow note's Checker duties). */
export const STAGE_CHECKS = {
  [S.PENDING_PIA_CHECKER]: [
    { key: 'DOCUMENTS', label: 'Supporting documents (bills, vouchers, work orders) verified' },
    { key: 'CALCULATIONS', label: 'Entries and calculations checked' },
  ],
  [S.SUBMITTED_TO_DISTRICT]: [
    { key: 'PIA_DATA', label: 'PIA data validated and consolidated with district records' },
  ],
  [S.PENDING_DISTRICT_CHECKER]: [
    { key: 'BILLS', label: 'Bills and vouchers verified' },
    { key: 'WITHIN_ALLOCATION', label: 'Expenditure is within the approved allocation' },
    { key: 'PROGRESS', label: 'Physical progress verified' },
  ],
  [S.PENDING_HQ_CHECKER]: [
    { key: 'CONSISTENCY', label: 'State-level reporting and data consistency checked' },
    { key: 'WITHIN_ALLOCATION', label: 'Expenditure is within the approved allocation' },
  ],
};

const MONEY_KEYS = ['sarraShareLakh', 'deptShareLakh', 'openingSarraLakh', 'expenditurePreviousLakh', 'expenditureCurrentLakh'];

/** Totals of a set of lines, in Rs. lakh. */
export const totalsOf = (lines) => {
  const sum = Object.fromEntries(MONEY_KEYS.map((key) => [key, lines.reduce((total, line) => total + toMoney(line[key]), 0)]));
  const fy = sum.expenditurePreviousLakh + sum.expenditureCurrentLakh;
  return {
    budgetLakh: fromMoney(sum.sarraShareLakh),
    deptShareLakh: fromMoney(sum.deptShareLakh),
    openingSarraLakh: fromMoney(sum.openingSarraLakh),
    expenditurePreviousLakh: fromMoney(sum.expenditurePreviousLakh),
    expenditureCurrentLakh: fromMoney(sum.expenditureCurrentLakh),
    expenditureFyLakh: fromMoney(fy),
    expenditureTotalLakh: fromMoney(sum.openingSarraLakh + fy),
    balanceLakh: fromMoney(sum.sarraShareLakh - fy),
    utilisationPercent: percent(fy, sum.sarraShareLakh),
  };
};

/** A line with its worked-out columns (Prarup-2 order). */
const withColumns = (line) => {
  const physicalFy = toPhysical(line.physicalPrevious) + toPhysical(line.physicalCurrent);
  const expenditureFy = toMoney(line.expenditurePreviousLakh) + toMoney(line.expenditureCurrentLakh);
  return {
    ...line,
    physicalFy: fromPhysical(physicalFy),
    physicalTotal: fromPhysical(toPhysical(line.openingPhysical) + physicalFy),
    physicalPercent: line.hasPhysical ? percent(physicalFy, toPhysical(line.physicalTarget)) : null,
    expenditureFyLakh: fromMoney(expenditureFy),
    expenditureTotalLakh: fromMoney(toMoney(line.openingSarraLakh) + expenditureFy),
    balanceLakh: fromMoney(toMoney(line.sarraShareLakh) - expenditureFy),
    utilisationPercent: percent(expenditureFy, toMoney(line.sarraShareLakh)),
  };
};

// ─── Maker: unit, period and form ────────────────────────────────────────────

const makerUnit = async (user) => {
  const unit = await unitOfUser(user);
  if (!unit || !isUnitMaker(user, unit)) throw forbidden('Head 56 reports are prepared by the Maker of SARRA HQ, of a District SARRA Centre or of a PIA.');
  return unit;
};

const reviewOf = (periodIndex) => Head56Review.findOne({ periodIndex, status: 'REVIEWED' }).lean();

/** Why this unit cannot file (or change) the report of this month, or null. */
const periodBlocker = async (unit, period, selfId = null) => {
  const review = await reviewOf(period.periodIndex);
  if (review) {
    return { code: 'MONTH_REVIEWED', message: `${periodLabel(period.periodIndex)} has been reviewed and closed (${review.designation || 'HQ Approver'}). Its reports can no longer be filed or changed unless HQ withdraws the review.` };
  }
  const live = await Head56Mpr.find({ unitKey: unit.unitKey, financialYear: period.financialYear, rejectedKey: null, ...(selfId ? { _id: { $ne: selfId } } : {}) })
    .select('periodIndex status mprNo').sort({ periodIndex: 1 }).lean();
  const same = live.find((report) => report.periodIndex === period.periodIndex);
  if (same) {
    const what = { [S.DRAFT]: 'saved as a draft — open it to continue', [S.RETURNED_FOR_CORRECTION]: 'returned for correction — open it to correct and resubmit' }[same.status] || 'filed';
    return { code: same.status === S.DRAFT ? 'DRAFT_EXISTS' : 'DUPLICATE', message: `The ${periodLabel(period.periodIndex)} report of ${unit.unitName} has already been ${what}. Only one report can exist for a unit and month.`, mprId: String(same._id) };
  }
  const returned = live.find((report) => report.status === S.RETURNED_FOR_CORRECTION);
  if (returned) return { code: 'RETURNED_PENDING', message: `The ${periodLabel(returned.periodIndex)} report was returned for correction. Correct and resubmit it first.`, mprId: String(returned._id) };
  const draft = live.find((report) => report.status === S.DRAFT);
  if (draft) return { code: 'DRAFT_PENDING', message: `The ${periodLabel(draft.periodIndex)} report is still a draft. Submit or discard it first.`, mprId: String(draft._id) };
  const later = live.filter((report) => report.periodIndex > period.periodIndex);
  if (later.length) return { code: 'OUT_OF_ORDER', message: `The ${periodLabel(later[later.length - 1].periodIndex)} report has already been filed, so ${periodLabel(period.periodIndex)} can no longer be reported.`, mprId: String(later[later.length - 1]._id) };
  return null;
};

/** The lines of a unit's report for a period: published targets plus progress before the month. */
const buildRows = async (unit, period, current = new Map()) => {
  const allocation = await findPublished(unit.unitKey, period.financialYear);
  if (!allocation) return { allocation: null, rows: [] };
  const [map, previous] = await Promise.all([itemMap(), reportedByCode(unit.unitKey, period.financialYear, { beforePeriod: period.periodIndex })]);
  const rows = (allocation.published.lines || [])
    .filter((line) => line.sarraShareLakh > 0 || line.physicalTarget > 0)
    .sort(byCode)
    .map((line) => {
      const item = map.get(line.code) || { name: line.code, nameHindi: '', parentCode: null, unit: '', hasPhysical: false, allowsDecimal: false };
      const before = previous.get(line.code) || { physical: 0, money: 0 };
      const entered = current.get(line.code) || {};
      return {
        code: line.code,
        name: item.name,
        nameHindi: item.nameHindi || '',
        parentCode: item.parentCode || null,
        unit: item.unit || '',
        hasPhysical: Boolean(item.hasPhysical),
        allowsDecimal: Boolean(item.allowsDecimal),
        physicalTarget: line.physicalTarget || 0,
        targetSize: line.targetSize || 0,
        rate: line.rate || 0,
        deptShareLakh: line.deptShareLakh || 0,
        sarraShareLakh: line.sarraShareLakh || 0,
        openingPhysical: line.openingPhysical || 0,
        openingSarraLakh: line.openingSarraLakh || 0,
        physicalPrevious: fromPhysical(before.physical),
        expenditurePreviousLakh: fromMoney(before.money),
        physicalCurrent: entered.physicalCurrent || 0,
        expenditureCurrentLakh: entered.expenditureCurrentLakh || 0,
        remarks: entered.remarks || '',
      };
    });
  return { allocation, rows };
};

const parentsOf = async (rows) => {
  const map = await itemMap();
  return [...new Set(rows.map((row) => row.parentCode).filter(Boolean))].sort()
    .map((code) => ({ code, name: map.get(code)?.name || code, nameHindi: map.get(code)?.nameHindi || '' }));
};

/** This month's figures from the Maker, checked against the published targets. */
const validateFigures = (rows, input) => {
  const entries = new Map();
  for (const row of Array.isArray(input) ? input : []) {
    if (!rows.some((line) => line.code === row?.code)) throw bad(`Line ${row?.code || '(blank)'} is not in this unit's published allocation.`);
    entries.set(row.code, row);
  }
  return rows.map((row) => {
    const entry = entries.get(row.code) || {};
    const label = `${row.code} ${row.name}`;
    let physicalCurrent = 0;
    if (row.hasPhysical) {
      physicalCurrent = parseAmount(entry.physicalCurrent, `${label}: progress during the month`, { decimals: row.allowsDecimal ? 3 : 0, whole: !row.allowsDecimal });
      if (physicalCurrent > 0 && !(row.physicalTarget > 0)) throw bad(`${label}: no physical target has been allocated, so no physical progress can be reported.`);
      const total = toPhysical(row.physicalPrevious) + toPhysical(physicalCurrent);
      if (row.physicalTarget > 0 && total > toPhysical(row.physicalTarget)) {
        throw bad(`${label}: progress cannot exceed the approved target without a budget revision. Remaining: ${quantityText(Math.max(0, toPhysical(row.physicalTarget) - toPhysical(row.physicalPrevious)))} ${row.unit}.`);
      }
    } else if (Number(entry.physicalCurrent) > 0) {
      throw bad(`${label} has no physical measure; enter only the expenditure.`);
    }
    const expenditureCurrentLakh = parseAmount(entry.expenditureCurrentLakh, `${label}: expenditure during the month`);
    const spent = toMoney(row.expenditurePreviousLakh) + toMoney(expenditureCurrentLakh);
    if (spent > toMoney(row.sarraShareLakh)) {
      throw bad(`${label}: expenditure cannot exceed the approved allocation without an authorised budget revision. Remaining: ${lakhText(Math.max(0, toMoney(row.sarraShareLakh) - toMoney(row.expenditurePreviousLakh)))}.`);
    }
    return { ...row, physicalCurrent, expenditureCurrentLakh, remarks: clean(entry.remarks, 500) };
  });
};

/** Rules that apply when a report is submitted (not to drafts). */
const assertSubmittable = (lines, documents, remarks) => {
  for (const line of lines) {
    if (line.expenditureCurrentLakh > 0 && !documents.some((doc) => doc.code === line.code) && line.remarks.length < 5) {
      throw bad(`${line.code} ${line.name}: attach a supporting document (bill, voucher or work order) for this month's expenditure, or explain in the line's remarks why there is none.`, { code: 'DOCUMENT_REQUIRED', line: line.code });
    }
  }
  const nil = lines.every((line) => !line.physicalCurrent && !line.expenditureCurrentLakh);
  if (nil && remarks.length < 10) throw bad('Nothing is reported for this month. Write in the remarks why (nil report), at least 10 characters.', { code: 'NIL_REMARKS' });
};

const nextNumber = async (fyStartYear) => {
  const counter = await Counter.findOneAndUpdate({ _id: `head56Mpr:${fyStartYear}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `H56-${fyStartYear}-${String(counter.seq).padStart(5, '0')}`;
};

const periodDto = (period) => ({
  financialYear: period.financialYear,
  reportingMonth: period.reportingMonth,
  periodIndex: period.periodIndex,
  label: periodLabel(period.periodIndex),
});

/** The unit of the signed-in Maker, the years that have a published allocation, and each month's state. */
export const getMakerContext = async (user) => {
  const unit = await makerUnit(user);
  const years = recentFinancialYears();
  const [allocations, reports, reviews] = await Promise.all([
    Head56Allocation.find({ unitKey: unit.unitKey, financialYear: { $in: years }, 'published.version': { $gt: 0 } }).select('financialYear published.version published.publishedAt status').lean(),
    Head56Mpr.find({ unitKey: unit.unitKey, financialYear: { $in: years }, rejectedKey: null }).select('financialYear reportingMonth periodIndex status mprNo totals').lean(),
    Head56Review.find({ financialYear: { $in: years }, status: 'REVIEWED' }).select('periodIndex').lean(),
  ]);
  const reviewed = new Set(reviews.map((review) => review.periodIndex));
  const now = periodOf();
  const financialYears = years.filter((fy) => allocations.some((a) => a.financialYear === fy)).map((fy) => {
    const fyStartYear = Number(fy.slice(0, 4));
    const allocation = allocations.find((a) => a.financialYear === fy);
    return {
      value: fy,
      allocationVersion: allocation.published.version,
      revisionPending: allocation.status !== 'PUBLISHED',
      months: FY_MONTHS.map((month, index) => ({ month, periodIndex: periodFor(fyStartYear, index) }))
        .filter((entry) => entry.periodIndex <= now)
        .map((entry) => {
          const report = reports.find((r) => r.financialYear === fy && r.periodIndex === entry.periodIndex);
          return {
            value: entry.month,
            label: periodLabel(entry.periodIndex),
            reviewed: reviewed.has(entry.periodIndex),
            report: report ? { id: String(report._id), mprNo: report.mprNo, status: report.status, statusLabel: MPR_STATUS_LABELS[report.status] } : null,
          };
        }),
    };
  });
  return {
    unit: { ...unit, departmentId: unit.departmentId ? String(unit.departmentId) : null, levelLabel: levelLabel(unit.level) },
    financialYears,
    open: reports.filter((r) => WITH_MAKER.includes(r.status)).map((r) => ({ id: String(r._id), mprNo: r.mprNo, period: periodLabel(r.periodIndex), status: r.status, statusLabel: MPR_STATUS_LABELS[r.status] })),
    docTypes: H56_DOC_TYPES,
  };
};

export const getForm = async ({ financialYear, reportingMonth }, user) => {
  const unit = await makerUnit(user);
  const period = resolvePeriod(financialYear, reportingMonth);
  const [blocker, { allocation, rows }] = await Promise.all([periodBlocker(unit, period), buildRows(unit, period)]);
  return {
    unit: { ...unit, departmentId: unit.departmentId ? String(unit.departmentId) : null, levelLabel: levelLabel(unit.level) },
    period: periodDto(period),
    allocation: allocation ? { id: String(allocation._id), version: allocation.published.version, publishedAt: allocation.published.publishedAt } : null,
    rows: rows.map(withColumns),
    parents: await parentsOf(rows),
    totals: totalsOf(rows),
    blocker: blocker || (allocation ? null : { code: 'NO_ALLOCATION', message: `HQ has not yet published the Head 56 allocation of ${unit.unitName} for ${period.financialYear}. Reports can be filed once it is published.` }),
    remarks: '',
    documents: [],
    docTypes: H56_DOC_TYPES,
  };
};

/** Save a new report as a draft (default) or submit it at once. */
export const createReport = async (body = {}, user) => {
  const unit = await makerUnit(user);
  const period = resolvePeriod(body.financialYear, body.reportingMonth);
  const blocker = await periodBlocker(unit, period);
  if (blocker) throw conflict(blocker.message, blocker.code, { mprId: blocker.mprId });
  const { allocation, rows } = await buildRows(unit, period);
  if (!allocation) throw conflict(`HQ has not yet published the Head 56 allocation of ${unit.unitName} for ${period.financialYear}.`, 'NO_ALLOCATION');
  const lines = validateFigures(rows, body.lines);
  const remarks = clean(body.remarks, 2000);
  const asDraft = body.asDraft !== false;
  if (!asDraft) assertSubmittable(lines, [], remarks);
  const status = asDraft ? S.DRAFT : firstStageOf(unit.level);
  const now = new Date();
  try {
    return await Head56Mpr.create({
      mprNo: await nextNumber(period.fyStartYear),
      financialYear: period.financialYear,
      fyStartYear: period.fyStartYear,
      reportingMonth: period.reportingMonth,
      monthIndex: period.monthIndex,
      periodIndex: period.periodIndex,
      level: unit.level,
      entryMode: unit.level,
      unitKey: unit.unitKey,
      unitName: unit.unitName,
      district: unit.district,
      departmentId: unit.departmentId,
      departmentName: unit.departmentName,
      allocationId: allocation._id,
      allocationVersion: allocation.published.version,
      lines,
      totals: totalsOf(lines),
      remarks,
      status,
      stageEnteredAt: now,
      createdBy: user._id,
      submittedBy: user._id,
      submittedAt: asDraft ? undefined : now,
      revisionHistory: [historyEntry(user, { status, action: asDraft ? 'DRAFT_SAVED' : 'SUBMITTED', level: unit.level, note: asDraft ? 'Draft saved' : 'Submitted for verification' })],
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict(`The ${periodLabel(period.periodIndex)} report of ${unit.unitName} already exists.`, 'DUPLICATE');
    throw err;
  }
};

const loadOwn = async (id, user) => {
  if (!isValidId(id)) throw notFound('Report not found.');
  const mpr = await Head56Mpr.findById(id);
  if (!mpr) throw notFound('Report not found.');
  if (!sameId(mpr.submittedBy, user._id)) throw forbidden('Only the Maker who prepared this report can change it.');
  return mpr;
};

const periodOfDoc = (mpr) => ({ financialYear: mpr.financialYear, fyStartYear: mpr.fyStartYear, reportingMonth: mpr.reportingMonth, monthIndex: mpr.monthIndex, periodIndex: mpr.periodIndex });
const unitOfDoc = (mpr) => ({ level: mpr.level, unitKey: mpr.unitKey, unitName: mpr.unitName, district: mpr.district, departmentId: mpr.departmentId, departmentName: mpr.departmentName });

/** The form of a draft or returned report, with targets and earlier progress as they are now. */
export const getEditForm = async (id, user) => {
  const mpr = await loadOwn(id, user);
  if (!WITH_MAKER.includes(mpr.status)) throw conflict('This report is in the approval chain and cannot be edited.', 'LOCKED');
  const unit = unitOfDoc(mpr);
  const period = periodOfDoc(mpr);
  const current = new Map(mpr.lines.map((line) => [line.code, line]));
  const [blocker, { allocation, rows }] = await Promise.all([periodBlocker(unit, period, mpr._id), buildRows(unit, period, current)]);
  return {
    id: String(mpr._id),
    mprNo: mpr.mprNo,
    status: mpr.status,
    statusLabel: MPR_STATUS_LABELS[mpr.status],
    returnReason: mpr.status === S.RETURNED_FOR_CORRECTION ? mpr.returnReason : null,
    returnedByRole: mpr.status === S.RETURNED_FOR_CORRECTION ? mpr.returnedByRole : null,
    unit: { ...unit, departmentId: unit.departmentId ? String(unit.departmentId) : null, levelLabel: levelLabel(unit.level) },
    period: periodDto(period),
    allocation: allocation ? { id: String(allocation._id), version: allocation.published.version, publishedAt: allocation.published.publishedAt } : null,
    rows: rows.map(withColumns),
    parents: await parentsOf(rows),
    totals: totalsOf(rows),
    blocker,
    remarks: mpr.remarks || '',
    documents: documentsDto(mpr, new Map()),
    docTypes: H56_DOC_TYPES,
  };
};

/** Save a draft or returned report; without `asDraft` it is (re)submitted to its first reviewer. */
export const saveReport = async (id, body = {}, user) => {
  const mpr = await loadOwn(id, user);
  if (!WITH_MAKER.includes(mpr.status)) throw conflict('This report is in the approval chain and cannot be edited.', 'LOCKED');
  const unit = unitOfDoc(mpr);
  const period = periodOfDoc(mpr);
  const blocker = await periodBlocker(unit, period, mpr._id);
  if (blocker) throw conflict(blocker.message, blocker.code, { mprId: blocker.mprId });
  const { allocation, rows } = await buildRows(unit, period);
  if (!allocation) throw conflict('The allocation of this unit is no longer published.', 'NO_ALLOCATION');
  const lines = validateFigures(rows, body.lines);
  const remarks = clean(body.remarks ?? mpr.remarks, 2000);
  const asDraft = body.asDraft === true;
  if (!asDraft) assertSubmittable(lines, mpr.documents, remarks);
  const wasReturned = mpr.status === S.RETURNED_FOR_CORRECTION;
  const status = asDraft ? mpr.status : firstStageOf(mpr.entryMode);
  const now = new Date();
  const set = { lines, totals: totalsOf(lines), remarks, allocationId: allocation._id, allocationVersion: allocation.published.version };
  const entry = asDraft
    ? historyEntry(user, { status, action: 'DRAFT_SAVED', level: mpr.level, note: wasReturned ? 'Correction saved, not yet resubmitted' : 'Draft updated' })
    : historyEntry(user, { status, action: wasReturned ? 'RESUBMITTED' : 'SUBMITTED', level: mpr.level, note: wasReturned ? 'Corrected and resubmitted' : 'Submitted for verification' });
  if (!asDraft) Object.assign(set, { status, stageEnteredAt: now, submittedAt: now, steps: {} });
  const updated = await Head56Mpr.findOneAndUpdate({ _id: mpr._id, status: mpr.status }, { $set: set, $push: { revisionHistory: entry } }, { new: true });
  if (!updated) throw conflict('The report changed while you were saving it. Please reload.', 'STALE');
  return { mpr: updated, resubmitted: !asDraft && wasReturned, submitted: !asDraft };
};

export const deleteDraft = async (id, user) => {
  const mpr = await loadOwn(id, user);
  if (mpr.status !== S.DRAFT) throw conflict('Only a draft can be discarded. A submitted report stays on record.', 'NOT_DRAFT');
  const removed = await Head56Mpr.findOneAndDelete({ _id: mpr._id, status: S.DRAFT });
  if (!removed) throw conflict('The report changed. Please reload.', 'STALE');
  await Promise.all((removed.documents || []).map((doc) => doc.publicId && deleteFile(doc.publicId)));
  return { id: String(removed._id), mprNo: removed.mprNo };
};

// ─── Supporting documents ────────────────────────────────────────────────────

const documentsDto = (mpr, nameOf) => (mpr.documents || []).map((doc) => ({
  id: String(doc._id),
  code: doc.code || null,
  docType: doc.docType,
  docTypeLabel: H56_DOC_TYPES[doc.docType] || 'Other',
  url: doc.url,
  name: doc.name,
  mimeType: doc.mimeType,
  size: doc.size,
  uploadedBy: nameOf.get(String(doc.uploadedBy)) || null,
  uploadedAt: doc.uploadedAt,
}));

export const addDocuments = async (id, files = [], body = {}, user) => {
  const mpr = await loadOwn(id, user);
  if (!WITH_MAKER.includes(mpr.status)) throw conflict('Documents can be changed only while the report is a draft or returned for correction.', 'LOCKED');
  if (!files.length) throw bad('Choose at least one file.');
  const room = MAX_DOCUMENTS - mpr.documents.length;
  if (files.length > room) throw bad(room <= 0 ? `A report can carry at most ${MAX_DOCUMENTS} documents.` : `Only ${room} more document${room === 1 ? '' : 's'} can be added (maximum ${MAX_DOCUMENTS}).`);
  const code = typeof body.code === 'string' && body.code ? body.code : null;
  if (code && !mpr.lines.some((line) => line.code === code)) throw bad('Choose a line of this report, or leave it for the whole report.');
  const docType = Object.keys(H56_DOC_TYPES).includes(body.docType) ? body.docType : 'OTHER';
  for (const file of files) {
    if (!FILE_TYPES.includes(file.mimetype)) throw bad(`${file.originalname}: upload a PDF or a photograph (JPG, PNG, WEBP).`);
    if (file.size > MAX_FILE_BYTES) throw bad(`${file.originalname}: the file is too large. Maximum size is 10 MB.`);
  }
  const uploaded = [];
  try {
    for (const file of files) {
      const saved = await uploadFile(file.buffer, 'head56-documents');
      uploaded.push({ code, docType, url: saved.url, publicId: saved.publicId, name: clean(file.originalname, 200) || 'Document', mimeType: file.mimetype, size: file.size, uploadedBy: user._id, uploadedAt: new Date() });
    }
    const updated = await Head56Mpr.findOneAndUpdate(
      { _id: mpr._id, status: { $in: WITH_MAKER }, $expr: { $lte: [{ $size: '$documents' }, MAX_DOCUMENTS - uploaded.length] } },
      { $push: { documents: { $each: uploaded } } },
      { new: true },
    );
    if (!updated) throw conflict('The report changed while the files were uploading. Please reload and try again.', 'STALE');
    return updated;
  } catch (err) {
    await Promise.all(uploaded.map((doc) => deleteFile(doc.publicId)));
    throw err;
  }
};

export const removeDocument = async (id, documentId, user) => {
  const mpr = await loadOwn(id, user);
  if (!WITH_MAKER.includes(mpr.status)) throw conflict('Documents can be changed only while the report is a draft or returned for correction.', 'LOCKED');
  const doc = mpr.documents.find((item) => String(item._id) === String(documentId));
  if (!doc) throw notFound('Document not found.');
  await Head56Mpr.updateOne({ _id: mpr._id, status: { $in: WITH_MAKER } }, { $pull: { documents: { _id: doc._id } } });
  if (doc.publicId) await deleteFile(doc.publicId);
  return { id: String(doc._id) };
};

// ─── Lists ───────────────────────────────────────────────────────────────────

const listDto = (mpr, nameOf = new Map()) => ({
  id: String(mpr._id),
  mprNo: mpr.mprNo,
  financialYear: mpr.financialYear,
  reportingMonth: mpr.reportingMonth,
  period: periodLabel(mpr.periodIndex),
  periodIndex: mpr.periodIndex,
  level: mpr.level,
  levelLabel: levelLabel(mpr.level),
  unitName: mpr.unitName,
  district: mpr.district,
  departmentName: mpr.departmentName,
  status: mpr.status,
  statusLabel: MPR_STATUS_LABELS[mpr.status],
  awaiting: REVIEW_STAGES[mpr.status] ? (STEP_LABELS[mpr.status] || stageOwner(mpr.status)) : null,
  budgetLakh: mpr.totals?.budgetLakh || 0,
  expenditureCurrentLakh: mpr.totals?.expenditureCurrentLakh || 0,
  expenditureFyLakh: mpr.totals?.expenditureFyLakh || 0,
  utilisationPercent: mpr.totals?.utilisationPercent || 0,
  submittedBy: nameOf.get(String(mpr.submittedBy)) || null,
  submittedAt: mpr.submittedAt || null,
  stageEnteredAt: mpr.stageEnteredAt || null,
  updatedAt: mpr.updatedAt,
});

const withNames = async (reports) => {
  const ids = [...new Set(reports.map((r) => String(r.submittedBy)))];
  const people = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean() : [];
  const nameOf = new Map(people.map((person) => [String(person._id), person.name]));
  return reports.map((report) => listDto(report, nameOf));
};

export const listReports = async (user, query = {}) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to Head 56 reports.');
  const filter = { ...scope, ...statusQuery(query.status) };
  if (typeof query.financialYear === 'string' && query.financialYear) filter.financialYear = query.financialYear;
  if (typeof query.month === 'string' && FY_MONTHS.includes(query.month)) filter.reportingMonth = query.month;
  if (typeof query.district === 'string' && query.district && !scope.district) filter.district = query.district;
  if (Object.values(H56_LEVELS).includes(query.level) && !scope.level) filter.level = query.level;
  if (query.mine === 'true') filter.submittedBy = user._id;
  // A draft belongs to its Maker until it is submitted.
  const visible = { $and: [filter, { $or: [{ status: { $ne: S.DRAFT } }, { submittedBy: user._id }] }] };
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const [items, total] = await Promise.all([
    Head56Mpr.find(visible).select('-lines -revisionHistory -documents').sort({ periodIndex: -1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Head56Mpr.countDocuments(visible),
  ]);
  return { items: await withNames(items), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
};

/** Reports waiting for the signed-in user's own step. */
export const listQueue = async (user, { limit } = {}) => {
  const filter = queueFilterFor(user);
  if (!filter) return { items: [], total: 0 };
  const candidates = await Head56Mpr.find(filter).select('-lines -revisionHistory -documents').sort({ stageEnteredAt: 1 }).lean();
  // The filter knows tier, role and scope; the engine also knows who already acted on each report.
  const mine = candidates.filter((mpr) => canActOnStage(user, mpr));
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
  return { items: await withNames(mine.slice(0, safeLimit)), total: mine.length };
};

// ─── One report ──────────────────────────────────────────────────────────────

const isLatestOfUnit = async (mpr) => !(await Head56Mpr.exists({ unitKey: mpr.unitKey, financialYear: mpr.financialYear, periodIndex: { $gt: mpr.periodIndex }, status: { $ne: S.REJECTED } }));

export const getReport = async (id, user) => {
  if (!isValidId(id)) throw notFound('Report not found.');
  const mpr = await Head56Mpr.findById(id).lean();
  if (!mpr) throw notFound('Report not found.');
  const maker = sameId(mpr.submittedBy, user._id);
  if (!maker && (!canReadDoc(user, mpr) || mpr.status === S.DRAFT)) throw notFound('Report not found.');

  const ids = new Set([String(mpr.submittedBy), ...Object.values(mpr.steps || {}).map((s) => s?.by && String(s.by)), ...(mpr.revisionHistory || []).map((h) => String(h.changedBy)), ...(mpr.documents || []).map((d) => String(d.uploadedBy))]);
  ids.delete(undefined);
  const people = await User.find({ _id: { $in: [...ids].filter(Boolean) } }).select('name designation').lean();
  const nameOf = new Map(people.map((person) => [String(person._id), person.name]));

  const [latest, review, neighbours, parents] = await Promise.all([
    isLatestOfUnit(mpr),
    reviewOf(mpr.periodIndex),
    Head56Mpr.find({ unitKey: mpr.unitKey, financialYear: mpr.financialYear, rejectedKey: null, status: { $ne: S.DRAFT }, _id: { $ne: mpr._id } }).select('periodIndex').lean(),
    parentsOf(mpr.lines || []),
  ]);
  const stage = REVIEW_STAGES[mpr.status];
  const mayAct = Boolean(stage) && canActOnStage(user, mpr);
  const verified = mpr.status === S.VERIFIED_BY_STATE;
  const hqApprover = isHq(user, APPROVER);
  const previous = neighbours.filter((r) => r.periodIndex < mpr.periodIndex).sort((a, b) => b.periodIndex - a.periodIndex)[0];
  const next = neighbours.filter((r) => r.periodIndex > mpr.periodIndex).sort((a, b) => a.periodIndex - b.periodIndex)[0];
  const laterBlock = 'A later month has already been filed for this unit, so this report can no longer be returned, rejected or reopened.';

  return {
    id: String(mpr._id),
    mprNo: mpr.mprNo,
    financialYear: mpr.financialYear,
    reportingMonth: mpr.reportingMonth,
    period: periodLabel(mpr.periodIndex),
    level: mpr.level,
    levelLabel: levelLabel(mpr.level),
    unitName: mpr.unitName,
    district: mpr.district,
    departmentName: mpr.departmentName,
    allocationVersion: mpr.allocationVersion,
    status: mpr.status,
    statusLabel: MPR_STATUS_LABELS[mpr.status],
    awaiting: stage ? (STEP_LABELS[mpr.status] || stageOwner(mpr.status)) : null,
    lines: (mpr.lines || []).map(withColumns),
    parents,
    totals: mpr.totals,
    remarks: mpr.remarks || '',
    documents: documentsDto(mpr, nameOf),
    chain: chainOf(mpr, (userId) => nameOf.get(String(userId)) || null, { MAKER: MAKER_LABEL[mpr.level], ...STEP_LABELS }),
    checksDone: Object.entries(mpr.steps || {}).filter(([, s]) => s?.checks?.length).map(([key, s]) => ({ step: key, checks: s.checks, by: nameOf.get(String(s.by)) || null, at: s.at })),
    submittedBy: nameOf.get(String(mpr.submittedBy)) || null,
    submittedAt: mpr.submittedAt || null,
    returnReason: mpr.status === S.RETURNED_FOR_CORRECTION ? mpr.returnReason : null,
    returnedByRole: mpr.status === S.RETURNED_FOR_CORRECTION ? mpr.returnedByRole : null,
    rejectionReason: mpr.status === S.REJECTED ? mpr.rejectionReason : null,
    rejectedByRole: mpr.status === S.REJECTED ? mpr.rejectedByRole : null,
    verifiedAt: mpr.verifiedAt || null,
    reopenCount: mpr.reopenCount || 0,
    review: review ? { reviewedAt: review.reviewedAt, designation: review.designation, role: review.role, remarks: review.remarks } : null,
    history: (mpr.revisionHistory || []).map((h) => ({ status: h.status, statusLabel: MPR_STATUS_LABELS[h.status] || h.status, action: h.action, level: h.level, role: h.role, designation: h.designation, by: nameOf.get(String(h.changedBy)) || null, at: h.changedAt, note: h.note })).reverse(),
    navigation: {
      previous: previous ? { id: String(previous._id), period: periodLabel(previous.periodIndex) } : null,
      next: next ? { id: String(next._id), period: periodLabel(next.periodIndex) } : null,
    },
    permissions: {
      canForward: mayAct && !review,
      forwardLabel: stage ? verbOf(mpr.status) : null,
      checks: mayAct ? (STAGE_CHECKS[mpr.status] || []) : [],
      awaiting: stage ? (STEP_LABELS[mpr.status] || stageOwner(mpr.status)) : null,
      canReturn: mayAct && latest && !review,
      canReject: mayAct && latest && !review && Boolean(stage?.canReject),
      returnBlockedReason: mayAct && !latest ? laterBlock : null,
      canEdit: maker && WITH_MAKER.includes(mpr.status) && !review,
      canDelete: maker && mpr.status === S.DRAFT,
      canManageDocuments: maker && WITH_MAKER.includes(mpr.status) && !review,
      canReopen: hqApprover && verified && latest && !review,
      reopenBlockedReason: hqApprover && verified ? (review ? 'The month has been reviewed. Withdraw the monthly review first.' : !latest ? laterBlock : null) : null,
    },
  };
};

// ─── Review chain ────────────────────────────────────────────────────────────

const loadForReview = async (id, user) => {
  if (!isValidId(id)) throw notFound('Report not found.');
  const mpr = await Head56Mpr.findById(id);
  if (!mpr) throw notFound('Report not found.');
  const stage = REVIEW_STAGES[mpr.status];
  if (!stage) {
    throw conflict({
      [S.VERIFIED_BY_STATE]: 'This report has already been verified by the State.',
      [S.REJECTED]: 'This report was rejected.',
      [S.DRAFT]: 'This report has not been submitted yet.',
      [S.RETURNED_FOR_CORRECTION]: 'This report was returned to its Maker for correction.',
    }[mpr.status] || 'This report is not awaiting review.', 'NOT_IN_REVIEW');
  }
  if (!canActOnStage(user, mpr.toObject())) {
    const where = stage.tier === TIERS.HQ ? '' : ` of ${mpr.district}${stage.tier === TIERS.PIA ? ` (${mpr.departmentName})` : ''}`;
    throw forbidden(`This report is waiting for the ${STEP_LABELS[mpr.status] || stageOwner(mpr.status)}${where}. You cannot act on it${sameId(mpr.submittedBy, user._id) ? ': a Maker cannot review their own report' : ', or you have already acted on it'}.`);
  }
  if (await reviewOf(mpr.periodIndex)) throw conflict('This month has been reviewed and closed.', 'MONTH_REVIEWED');
  return { mpr, stage };
};

/** Take the current step: verify / approve and send the report on. Checker steps confirm their checklist. */
export const forwardReport = async (id, { note, checks } = {}, user) => {
  const { mpr, stage } = await loadForReview(id, user);
  const required = STAGE_CHECKS[mpr.status] || [];
  const given = new Set(Array.isArray(checks) ? checks : []);
  const missing = required.filter((check) => !given.has(check.key));
  if (missing.length) throw bad(`Confirm before forwarding: ${missing.map((check) => check.label.toLowerCase()).join('; ')}.`, { code: 'CHECKS_REQUIRED' });
  const text = clean(note, 1000);
  const now = new Date();
  const set = {
    status: stage.next,
    stageEnteredAt: now,
    [`steps.${stage.step}`]: { by: user._id, at: now, note: text, ...(required.length ? { checks: required.map((check) => check.key) } : {}) },
  };
  if (stage.step === 'hqApprover') Object.assign(set, { verifiedBy: user._id, verifiedAt: now });
  const done = doneOf(mpr.status);
  const updated = await Head56Mpr.findOneAndUpdate(
    { _id: mpr._id, status: mpr.status },
    { $set: set, $push: { revisionHistory: historyEntry(user, { status: stage.next, action: 'FORWARDED', level: stage.level, note: text ? `${done}. ${text}` : done }) } },
    { new: true },
  );
  if (!updated) throw conflict('This report has already moved on. Please reload.', 'STALE');
  return { mpr: updated, from: mpr.status };
};

const assertLatest = async (mpr) => {
  if (!(await isLatestOfUnit(mpr))) throw conflict('A later month has already been filed for this unit, so this report can no longer be returned, rejected or reopened.', 'LATER_REPORT_EXISTS');
};

/** Return to the Maker with remarks; every sign-off is cleared and the report goes through its chain again. */
export const returnReport = async (id, reason, user) => {
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Write the remarks for the Maker (at least 5 characters). They are required to return a report.');
  const { mpr, stage } = await loadForReview(id, user);
  await assertLatest(mpr);
  const role = actorLabel(user);
  const now = new Date();
  const updated = await Head56Mpr.findOneAndUpdate(
    { _id: mpr._id, status: mpr.status },
    {
      $set: { status: S.RETURNED_FOR_CORRECTION, stageEnteredAt: now, returnReason: text, returnedByLevel: stage.level, returnedByRole: role, returnedBy: user._id, returnedAt: now, steps: {} },
      $push: { revisionHistory: historyEntry(user, { status: S.RETURNED_FOR_CORRECTION, action: 'RETURNED', level: stage.level, note: `Returned by ${role}: ${text}` }) },
    },
    { new: true },
  );
  if (!updated) throw conflict('This report has already moved on. Please reload.', 'STALE');
  return updated;
};

/** An Approver rejects the report; it is void and the month can be reported afresh. */
export const rejectReport = async (id, reason, user) => {
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Write the reason for rejection (at least 5 characters).');
  const { mpr, stage } = await loadForReview(id, user);
  if (!stage.canReject) throw forbidden(`The ${STEP_LABELS[mpr.status] || stageOwner(mpr.status)} can return this report for correction but cannot reject it. Only an Approver can reject.`);
  await assertLatest(mpr);
  const role = actorLabel(user);
  const now = new Date();
  const updated = await Head56Mpr.findOneAndUpdate(
    { _id: mpr._id, status: mpr.status },
    {
      $set: { status: S.REJECTED, stageEnteredAt: now, rejectionReason: text, rejectedBy: user._id, rejectedAt: now, rejectedByRole: role, rejectedKey: String(mpr._id) },
      $push: { revisionHistory: historyEntry(user, { status: S.REJECTED, action: 'REJECTED', level: stage.level, note: `Rejected by ${role}: ${text}` }) },
    },
    { new: true },
  );
  if (!updated) throw conflict('This report has already moved on. Please reload.', 'STALE');
  return updated;
};

/**
 * Authorised reopening of a verified (locked) report by the HQ Approver: it goes
 * back to its Maker for correction and through the whole chain again.
 */
export const reopenReport = async (id, reason, user) => {
  if (!isHq(user, APPROVER)) throw forbidden('Only the HQ Approver can reopen a verified report.');
  const text = clean(reason, 1000);
  if (text.length < 10) throw bad('Give the reason for reopening the report (at least 10 characters).');
  if (!isValidId(id)) throw notFound('Report not found.');
  const mpr = await Head56Mpr.findById(id);
  if (!mpr) throw notFound('Report not found.');
  if (mpr.status !== S.VERIFIED_BY_STATE) throw conflict('Only a report verified by the State can be reopened.', 'NOT_VERIFIED');
  if (await reviewOf(mpr.periodIndex)) throw conflict('This month has been reviewed and closed. Withdraw the monthly review before reopening a report.', 'MONTH_REVIEWED');
  await assertLatest(mpr);
  const role = actorLabel(user);
  const now = new Date();
  const updated = await Head56Mpr.findOneAndUpdate(
    { _id: mpr._id, status: S.VERIFIED_BY_STATE },
    {
      $set: { status: S.RETURNED_FOR_CORRECTION, stageEnteredAt: now, returnReason: `Reopened by HQ: ${text}`, returnedByLevel: 'STATE', returnedByRole: role, returnedBy: user._id, returnedAt: now, steps: {}, verifiedBy: null, verifiedAt: null },
      $inc: { reopenCount: 1 },
      $push: { revisionHistory: historyEntry(user, { status: S.RETURNED_FOR_CORRECTION, action: 'REOPENED', level: 'STATE', note: `Reopened by ${role}: ${text}` }) },
    },
    { new: true },
  );
  if (!updated) throw conflict('This report has already changed. Please reload.', 'STALE');
  return updated;
};

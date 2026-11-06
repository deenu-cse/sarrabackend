import Head56Allocation from '../models/Head56Allocation.model.js';
import Head56Mpr from '../models/Head56Mpr.model.js';
import Head56Review from '../models/Head56Review.model.js';
import User from '../models/User.model.js';
import { PROJECT_MPR_STATUS, MPR_STATUS_LABELS } from '../models/ProjectMPR.model.js';
import { H56_LEVELS } from '../models/Head56Item.model.js';
import { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';
import { actorLabel, isHq } from '../utils/access.js';
import { FILED, IN_REVIEW, REVIEW_STAGES, stageOwner } from './mprWorkflow.js';
import { listItems } from './head56Master.service.js';
import {
  FY_MONTHS, bad, clean, conflict, forbidden, fromMoney, fromPhysical, fyLabel, fyStartOf, isValidId, levelLabel, notFound, percent,
  periodFor, periodLabel, periodOf, readScope, resolveFy, resolvePeriod, toMoney, toPhysical,
} from './head56.common.js';

/**
 * Consolidated Head 56 figures: the HQ dashboard (budget against expenditure
 * by head, sub-head, district, PIA and month, physical target against
 * achievement), the Prarup-2 statement, and the monthly CEO / ACEO / CFO review.
 *
 * Expenditure counts every filed report (in the approval chain, returned for
 * correction, or verified); the verified share is shown alongside.
 */

const S = PROJECT_MPR_STATUS;
const { APPROVER } = WORKFLOW_ROLES;
export const REVIEW_AUTHORITIES = ['CEO', 'ACEO', 'CFO'];
const STEP_NAMES = { [S.SUBMITTED_TO_DISTRICT]: 'District Technical Staff', [S.SUBMITTED_TO_HQ]: 'HQ Maker (compile)' };

/** The selection a dashboard or statement is about, limited to what the user may see. */
const selectionOf = (user, query = {}) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to Head 56 figures.');
  const fy = resolveFy(query.financialYear || fyLabel(fyStartOf()));
  const base = { ...scope, financialYear: fy.financialYear };
  if (typeof query.district === 'string' && query.district) {
    if (!DISTRICTS.includes(query.district)) throw bad('Unknown district.');
    if (!scope.district) base.district = query.district;
  }
  if (Object.values(H56_LEVELS).includes(query.level) && !scope.level) base.level = query.level;
  if (typeof query.unitKey === 'string' && query.unitKey) base.unitKey = query.unitKey;
  const monthIndex = FY_MONTHS.indexOf(query.month);
  // Without a month, the period in focus is the last completed month of the year.
  const lastMonth = Math.min(periodFor(fy.fyStartYear, 11), Math.max(periodFor(fy.fyStartYear, 0), periodOf() - 1));
  const focus = monthIndex >= 0 ? periodFor(fy.fyStartYear, monthIndex) : lastMonth;
  return { scope, fy, base, upTo: monthIndex >= 0 ? focus : null, focus, verifiedOnly: query.verifiedOnly === 'true' };
};

const loadFigures = async ({ base, upTo, verifiedOnly }) => {
  const reportFilter = { ...base, status: { $in: verifiedOnly ? [S.VERIFIED_BY_STATE] : FILED } };
  if (upTo !== null) reportFilter.periodIndex = { $lte: upTo };
  const [allocations, reports] = await Promise.all([
    Head56Allocation.find({ ...base, 'published.version': { $gt: 0 } }).lean(),
    Head56Mpr.find(reportFilter).select('-revisionHistory -documents').lean(),
  ]);
  return { allocations, reports };
};

// ─── Prarup-2 statement ──────────────────────────────────────────────────────

const STATEMENT_KEYS = {
  physical: ['openingPhysical', 'physicalTarget', 'targetSize', 'physicalPrevious', 'physicalCurrent'],
  money: ['openingSarraLakh', 'deptShareLakh', 'sarraShareLakh', 'expenditurePreviousLakh', 'expenditureCurrentLakh'],
};
const emptyCell = () => Object.fromEntries([...STATEMENT_KEYS.physical, ...STATEMENT_KEYS.money].map((key) => [key, 0]));
const addTo = (target, source) => {
  STATEMENT_KEYS.physical.forEach((key) => { target[key] += source[key] || 0; });
  STATEMENT_KEYS.money.forEach((key) => { target[key] += source[key] || 0; });
};

/**
 * The Prarup-2 table for a selection and month: one row per Head 56 line with
 * targets, progress before and during the month, and totals; headings sum the
 * lines under them; the last row is "56 – Total".
 */
export const buildStatement = async (user, query = {}) => {
  const selection = selectionOf(user, query);
  const month = selection.focus;
  const [{ allocations, reports }, items] = await Promise.all([loadFigures({ ...selection, upTo: month }), listItems({ includeInactive: true })]);
  const cells = new Map();
  const cellOf = (code) => { if (!cells.has(code)) cells.set(code, emptyCell()); return cells.get(code); };
  const rates = new Map();
  for (const allocation of allocations) {
    for (const line of allocation.published.lines || []) {
      const cell = cellOf(line.code);
      cell.openingPhysical += toPhysical(line.openingPhysical);
      cell.physicalTarget += toPhysical(line.physicalTarget);
      cell.targetSize += toPhysical(line.targetSize);
      cell.openingSarraLakh += toMoney(line.openingSarraLakh);
      cell.deptShareLakh += toMoney(line.deptShareLakh);
      cell.sarraShareLakh += toMoney(line.sarraShareLakh);
      if (allocations.length === 1) rates.set(line.code, line.rate || 0);
    }
  }
  for (const report of reports) {
    const during = report.periodIndex === month;
    for (const line of report.lines || []) {
      const cell = cellOf(line.code);
      cell[during ? 'physicalCurrent' : 'physicalPrevious'] += toPhysical(line.physicalCurrent);
      cell[during ? 'expenditureCurrentLakh' : 'expenditurePreviousLakh'] += toMoney(line.expenditureCurrentLakh);
    }
  }
  const finish = (code, cell, item, extra = {}) => {
    const physicalFy = cell.physicalPrevious + cell.physicalCurrent;
    const moneyFy = cell.expenditurePreviousLakh + cell.expenditureCurrentLakh;
    return {
      code,
      name: item?.name || code,
      nameHindi: item?.nameHindi || '',
      hasPhysical: Boolean(item?.hasPhysical),
      unit: item?.unit || '',
      rate: rates.has(code) ? rates.get(code) : null,
      ...Object.fromEntries(STATEMENT_KEYS.physical.map((key) => [key, fromPhysical(cell[key])])),
      ...Object.fromEntries(STATEMENT_KEYS.money.map((key) => [key, fromMoney(cell[key])])),
      physicalFy: fromPhysical(physicalFy),
      physicalTotal: fromPhysical(cell.openingPhysical + physicalFy),
      expenditureFyLakh: fromMoney(moneyFy),
      expenditureTotalLakh: fromMoney(cell.openingSarraLakh + moneyFy),
      balanceLakh: fromMoney(cell.sarraShareLakh - moneyFy),
      utilisationPercent: percent(moneyFy, cell.sarraShareLakh),
      ...extra,
    };
  };
  const rows = [];
  const total = emptyCell();
  const tops = items.filter((item) => !item.parentCode);
  for (const top of tops) {
    const children = items.filter((item) => item.parentCode === top.code && (item.isActive || cells.has(item.code)));
    if (!top.isActive && !cells.has(top.code) && !children.some((child) => cells.has(child.code))) continue;
    if (children.length) {
      const sum = emptyCell();
      children.forEach((child) => addTo(sum, cells.get(child.code) || emptyCell()));
      rows.push(finish(top.code, sum, top, { heading: true, depth: 0, hasPhysical: children.some((child) => child.hasPhysical) }));
      children.forEach((child) => rows.push(finish(child.code, cells.get(child.code) || emptyCell(), child, { heading: false, depth: 1 })));
      addTo(total, sum);
    } else {
      const cell = cells.get(top.code) || emptyCell();
      rows.push(finish(top.code, cell, top, { heading: false, depth: 0 }));
      addTo(total, cell);
    }
  }
  const scopeLabel = query.unitKey && allocations[0] ? allocations[0].unitName
    : selection.base.district ? `${selection.base.district} district${selection.base.level ? ` (${levelLabel(selection.base.level)})` : ''}`
      : selection.base.level ? `All ${levelLabel(selection.base.level)} units` : 'State (all units)';
  return {
    financialYear: selection.fy.financialYear,
    reportingMonth: FY_MONTHS[((month % 12) + 9) % 12],
    period: periodLabel(month),
    scopeLabel,
    verifiedOnly: selection.verifiedOnly,
    units: allocations.length,
    reports: reports.filter((report) => report.periodIndex === month).length,
    rows,
    total: finish('56', total, { name: '56 – Total', nameHindi: '56 – योग' }, { heading: true, depth: 0, hasPhysical: true }),
  };
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

const money = (units) => fromMoney(units);
const line = (budget, spent) => ({ budgetLakh: money(budget), spentLakh: money(spent), balanceLakh: money(budget - spent), utilisationPercent: percent(spent, budget) });

export const getDashboard = async (user, query = {}) => {
  const selection = selectionOf(user, query);
  const { fy, base, focus } = selection;
  const [{ allocations, reports }, items, live, review] = await Promise.all([
    loadFigures(selection),
    listItems({ includeInactive: true }),
    Head56Mpr.find({ ...base, rejectedKey: null }).select('unitKey unitName level district departmentName periodIndex status mprNo stageEnteredAt totals').lean(),
    Head56Review.findOne({ periodIndex: focus, status: 'REVIEWED' }).lean(),
  ]);
  const itemOf = new Map(items.map((item) => [item.code, item]));
  const groupOf = (code) => itemOf.get(code)?.parentCode || code;

  // Budget and spend by unit and line (integer units).
  const units = new Map();
  for (const allocation of allocations) {
    const unit = { unitKey: allocation.unitKey, unitName: allocation.unitName, level: allocation.level, district: allocation.district, departmentName: allocation.departmentName, budget: 0, dept: 0, spent: 0, verified: 0 };
    for (const l of allocation.published.lines || []) { unit.budget += toMoney(l.sarraShareLakh); unit.dept += toMoney(l.deptShareLakh); }
    units.set(allocation.unitKey, unit);
  }
  const codes = new Map();
  const codeOf = (code) => { if (!codes.has(code)) codes.set(code, { budget: 0, spent: 0, target: 0, achieved: 0 }); return codes.get(code); };
  allocations.forEach((a) => (a.published.lines || []).forEach((l) => { const c = codeOf(l.code); c.budget += toMoney(l.sarraShareLakh); c.target += toPhysical(l.physicalTarget); }));
  const months = FY_MONTHS.map((month, index) => ({ month, periodIndex: periodFor(fy.fyStartYear, index), spent: 0, verified: 0 }));
  let focusSpent = 0;
  for (const report of reports) {
    const unit = units.get(report.unitKey);
    const verified = report.status === S.VERIFIED_BY_STATE;
    const bucket = months.find((m) => m.periodIndex === report.periodIndex);
    for (const l of report.lines || []) {
      const amount = toMoney(l.expenditureCurrentLakh);
      const c = codeOf(l.code);
      c.spent += amount;
      c.achieved += toPhysical(l.physicalCurrent);
      if (unit) { unit.spent += amount; if (verified) unit.verified += amount; }
      if (bucket) { bucket.spent += amount; if (verified) bucket.verified += amount; }
      if (report.periodIndex === focus) focusSpent += amount;
    }
  }
  const unitList = [...units.values()];
  const sum = (list, key) => list.reduce((total, entry) => total + entry[key], 0);
  const budget = sum(unitList, 'budget');
  const spent = sum(unitList, 'spent');

  // Head-wise (56-01 … 56-09) and sub-head-wise.
  const groups = new Map();
  for (const [code, c] of codes) {
    const group = groupOf(code);
    const entry = groups.get(group) || { budget: 0, spent: 0 };
    entry.budget += c.budget; entry.spent += c.spent;
    groups.set(group, entry);
  }
  const byGroup = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, g]) => ({ code, name: itemOf.get(code)?.name || code, nameHindi: itemOf.get(code)?.nameHindi || '', ...line(g.budget, g.spent) }));
  const bySubHead = [...codes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, c]) => {
    const item = itemOf.get(code);
    return {
      code, name: item?.name || code, parentCode: item?.parentCode || null, groupName: item?.parentCode ? itemOf.get(item.parentCode)?.name || '' : '',
      hasPhysical: Boolean(item?.hasPhysical), unit: item?.unit || '',
      ...line(c.budget, c.spent),
      physicalTarget: fromPhysical(c.target), physicalAchieved: fromPhysical(c.achieved), physicalPercent: percent(c.achieved, c.target),
    };
  });

  // By level, district and PIA.
  const byLevel = Object.values(H56_LEVELS).map((level) => {
    const list = unitList.filter((u) => u.level === level);
    return { level, label: levelLabel(level), units: list.length, ...line(sum(list, 'budget'), sum(list, 'spent')) };
  }).filter((entry) => entry.units);
  const districts = selection.base.district ? [selection.base.district] : DISTRICTS;
  const byDistrict = districts.map((district) => {
    const list = unitList.filter((u) => u.district === district);
    const verifiedReports = live.filter((r) => r.district === district && r.status === S.VERIFIED_BY_STATE).length;
    return {
      district, units: list.length, verifiedReports,
      dscSpentLakh: money(sum(list.filter((u) => u.level === H56_LEVELS.DISTRICT), 'spent')),
      piaSpentLakh: money(sum(list.filter((u) => u.level === H56_LEVELS.PIA), 'spent')),
      ...line(sum(list, 'budget'), sum(list, 'spent')),
    };
  }).filter((entry) => entry.units || !selection.scope.district);
  const lastOf = (unitKey) => live.filter((r) => r.unitKey === unitKey && r.status !== S.DRAFT).sort((a, b) => b.periodIndex - a.periodIndex)[0];
  const byPia = unitList.filter((u) => u.level === H56_LEVELS.PIA).map((u) => {
    const last = lastOf(u.unitKey);
    return {
      unitKey: u.unitKey, unitName: u.unitName, district: u.district, departmentName: u.departmentName,
      deptShareLakh: money(u.dept), ...line(u.budget, u.spent), verifiedLakh: money(u.verified),
      lastPeriod: last ? periodLabel(last.periodIndex) : null, lastStatus: last?.status || null, lastStatusLabel: last ? MPR_STATUS_LABELS[last.status] : null,
    };
  }).sort((a, b) => a.district.localeCompare(b.district) || a.departmentName.localeCompare(b.departmentName));

  // Monthly trend up to the current month.
  let running = 0;
  const trend = months.filter((m) => m.periodIndex <= periodOf()).map((m) => {
    running += m.spent;
    return { month: m.month, label: periodLabel(m.periodIndex), spentLakh: money(m.spent), verifiedLakh: money(m.verified), cumulativeLakh: money(running) };
  });

  // Reports in the approval chain, by step.
  const pendingByStage = IN_REVIEW.map((status) => ({
    status, label: MPR_STATUS_LABELS[status], owner: STEP_NAMES[status] || stageOwner(status), tier: REVIEW_STAGES[status].tier,
    count: live.filter((r) => r.status === status).length,
  }));

  // Reporting status of every allocated unit for the month in focus.
  const reporting = unitList.map((u) => {
    const report = live.find((r) => r.unitKey === u.unitKey && r.periodIndex === focus);
    return {
      unitKey: u.unitKey, unitName: u.unitName, level: u.level, levelLabel: levelLabel(u.level), district: u.district,
      mprId: report && report.status !== S.DRAFT ? String(report._id) : null,
      mprNo: report && report.status !== S.DRAFT ? report.mprNo : null,
      status: report ? (report.status === S.DRAFT ? 'NOT_FILED' : report.status) : 'NOT_FILED',
      statusLabel: report && report.status !== S.DRAFT ? MPR_STATUS_LABELS[report.status] : 'Not filed',
      awaiting: report && REVIEW_STAGES[report.status] ? (STEP_NAMES[report.status] || stageOwner(report.status)) : null,
      spentLakh: report && report.status !== S.DRAFT ? report.totals?.expenditureCurrentLakh || 0 : 0,
    };
  }).sort((a, b) => ['HQ', 'DISTRICT', 'PIA'].indexOf(a.level) - ['HQ', 'DISTRICT', 'PIA'].indexOf(b.level) || String(a.district).localeCompare(String(b.district)) || a.unitName.localeCompare(b.unitName));
  const filed = reporting.filter((r) => r.status !== 'NOT_FILED');
  const pendingAllocations = await Head56Allocation.countDocuments({ ...base, status: { $in: ['PENDING_CHECKER', 'PENDING_APPROVER'] } });

  let reviewer = null;
  if (review) reviewer = await User.findById(review.reviewedBy).select('name').lean();
  const inChainForFocus = live.filter((r) => r.periodIndex === focus && IN_REVIEW.includes(r.status)).length;
  const verifiedForFocus = filed.filter((r) => r.status === S.VERIFIED_BY_STATE).length;

  return {
    financialYear: fy.financialYear,
    month: selection.upTo !== null ? FY_MONTHS[((selection.upTo % 12) + 9) % 12] : null,
    focus: { reportingMonth: FY_MONTHS[((focus % 12) + 9) % 12], label: periodLabel(focus) },
    verifiedOnly: selection.verifiedOnly,
    scope: { district: selection.scope.district || null, level: selection.scope.level || null },
    kpis: {
      ...line(budget, spent),
      deptShareLakh: money(sum(unitList, 'dept')),
      verifiedLakh: money(sum(unitList, 'verified')),
      focusSpentLakh: money(focusSpent),
      units: unitList.length,
      unitsFiled: filed.length,
      unitsVerified: verifiedForFocus,
      unitsMissing: reporting.length - filed.length,
      inReview: live.filter((r) => IN_REVIEW.includes(r.status)).length,
      allocationsPending: pendingAllocations,
    },
    byLevel,
    byGroup,
    bySubHead,
    byDistrict,
    byPia,
    trend,
    physical: bySubHead.filter((row) => row.hasPhysical && row.physicalTarget > 0),
    pendingByStage,
    reporting,
    review: review ? {
      id: String(review._id), reviewedAt: review.reviewedAt, reviewedBy: reviewer?.name || null, role: review.role, designation: review.designation, remarks: review.remarks, snapshot: review.snapshot,
    } : null,
    reviewReadiness: { inChain: inChainForFocus, verified: verifiedForFocus, missing: reporting.length - filed.length },
    permissions: {
      canReview: isHq(user, APPROVER) && !review && !selection.scope.district,
      canWithdrawReview: isHq(user, APPROVER) && Boolean(review),
    },
  };
};

// ─── Monthly CEO / ACEO / CFO review ─────────────────────────────────────────

export const recordReview = async (body = {}, user) => {
  if (!isHq(user, APPROVER)) throw forbidden('The monthly review is recorded by the HQ Approver on behalf of the CEO / ACEO / CFO.');
  const period = resolvePeriod(body.financialYear, body.reportingMonth);
  const authority = REVIEW_AUTHORITIES.includes(body.authority) ? body.authority : null;
  if (!authority) throw bad('Choose who reviewed the report: CEO, ACEO or CFO.');
  const remarks = clean(body.remarks, 2000);
  if (remarks.length < 10) throw bad('Write the review remarks (at least 10 characters).');
  if (await Head56Review.exists({ periodIndex: period.periodIndex, status: 'REVIEWED' })) throw conflict(`${periodLabel(period.periodIndex)} has already been reviewed.`, 'ALREADY_REVIEWED');
  const filter = { financialYear: period.financialYear, periodIndex: period.periodIndex, rejectedKey: null };
  const [inChain, verified] = await Promise.all([
    Head56Mpr.countDocuments({ ...filter, status: { $in: IN_REVIEW } }),
    Head56Mpr.countDocuments({ ...filter, status: S.VERIFIED_BY_STATE }),
  ]);
  if (inChain) throw conflict(`${inChain} report${inChain === 1 ? ' is' : 's are'} of ${periodLabel(period.periodIndex)} still in the approval chain. Review the month once they are verified or returned.`, 'REPORTS_IN_CHAIN');
  if (!verified) throw conflict(`No report of ${periodLabel(period.periodIndex)} has been verified by the State yet.`, 'NOTHING_VERIFIED');
  const statement = await buildStatement(user, { financialYear: period.financialYear, month: period.reportingMonth });
  const units = await Head56Allocation.countDocuments({ financialYear: period.financialYear, 'published.version': { $gt: 0 } });
  const filed = await Head56Mpr.countDocuments({ ...filter, status: { $ne: S.DRAFT } });
  try {
    return await Head56Review.create({
      financialYear: period.financialYear,
      reportingMonth: period.reportingMonth,
      periodIndex: period.periodIndex,
      reviewedBy: user._id,
      role: actorLabel(user),
      designation: authority,
      remarks,
      snapshot: {
        budgetLakh: statement.total.sarraShareLakh,
        expenditureFyLakh: statement.total.expenditureFyLakh,
        expenditureMonthLakh: statement.total.expenditureCurrentLakh,
        utilisationPercent: statement.total.utilisationPercent,
        units,
        verified,
        missing: Math.max(0, units - filed),
      },
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict(`${periodLabel(period.periodIndex)} has already been reviewed.`, 'ALREADY_REVIEWED');
    throw err;
  }
};

export const withdrawReview = async (id, reason, user) => {
  if (!isHq(user, APPROVER)) throw forbidden('Only the HQ Approver can withdraw a monthly review.');
  if (!isValidId(id)) throw notFound('Review not found.');
  const text = clean(reason, 1000);
  if (text.length < 10) throw bad('Give the reason for withdrawing the review (at least 10 characters).');
  const updated = await Head56Review.findOneAndUpdate(
    { _id: id, status: 'REVIEWED' },
    { $set: { status: 'WITHDRAWN', withdrawnBy: user._id, withdrawnAt: new Date(), withdrawReason: text } },
    { new: true },
  );
  if (!updated) throw notFound('Review not found or already withdrawn.');
  return updated;
};

export const listReviews = async (user, { financialYear } = {}) => {
  if (!readScope(user)) throw forbidden('You do not have access to Head 56 figures.');
  const fy = resolveFy(financialYear || fyLabel(fyStartOf()));
  const reviews = await Head56Review.find({ financialYear: fy.financialYear }).sort({ periodIndex: -1, createdAt: -1 }).lean();
  const people = await User.find({ _id: { $in: reviews.flatMap((r) => [r.reviewedBy, r.withdrawnBy].filter(Boolean)) } }).select('name').lean();
  const nameOf = new Map(people.map((person) => [String(person._id), person.name]));
  return reviews.map((r) => ({
    id: String(r._id), period: periodLabel(r.periodIndex), reportingMonth: r.reportingMonth, status: r.status,
    authority: r.designation, reviewedBy: nameOf.get(String(r.reviewedBy)) || null, role: r.role, reviewedAt: r.reviewedAt, remarks: r.remarks, snapshot: r.snapshot,
    withdrawnBy: r.withdrawnBy ? nameOf.get(String(r.withdrawnBy)) || null : null, withdrawnAt: r.withdrawnAt || null, withdrawReason: r.withdrawReason || null,
  }));
};

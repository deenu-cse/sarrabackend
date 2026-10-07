import mongoose from 'mongoose';
import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS, MPR_FORM_TYPE } from '../models/ProjectMPR.model.js';
import BudgetHead from '../models/BudgetHead.model.js';
import Counter from '../models/Counter.model.js';
import { BudgetAllocationEntry } from '../models/BudgetAllocation.model.js';
import { runInTransaction } from '../utils/transaction.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Project Monthly Progress Reports (MPR).
 *
 * Trust model: the browser chooses a project, a department, a period and
 * types this month's progress. Everything else — who may report for which
 * department, the activity list, targets, progress up to the previous month
 * and every total — is derived here from the database.
 */

// ─── Reporting periods ───────────────────────────────────────────────────────

const FY_MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
const FY_LABEL = /^(\d{4})-(\d{2})$/;

const fyStartOf = (date) => (date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1);
const fyLabel = (startYear) => `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
const periodOf = (date) => date.getFullYear() * 12 + date.getMonth();

/** Calendar position of a reporting month within a financial year (April–March). */
const periodFor = (fyStartYear, monthIndex) => {
  const calendarMonth = (monthIndex + 3) % 12;
  const year = fyStartYear + (monthIndex >= 9 ? 1 : 0);
  return { periodIndex: year * 12 + calendarMonth, year, calendarMonth };
};

const periodLabel = (periodIndex) => {
  const year = Math.floor(periodIndex / 12);
  const calendarMonth = periodIndex % 12;
  return `${FY_MONTHS[(calendarMonth + 9) % 12]} ${year}`;
};

/** Reporting cannot start before the project existed (its earliest approval, or when it was created). */
const projectStart = (project) => {
  const dates = [project.approvalDates?.dlec, project.approvalDates?.slec, project.approvalDates?.hpc, project.makerAt, project.createdAt]
    .filter(Boolean).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()));
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
};

const bad = (message, data) => new ApiError(HTTP_STATUS.BAD_REQUEST, message, data);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const conflict = (message, code, extra = {}) => new ApiError(HTTP_STATUS.CONFLICT, message, { code, ...extra });
const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);

/** Validate a financial year + month from the client and resolve the period. */
const resolvePeriod = (project, financialYear, reportingMonth, now = new Date()) => {
  const match = typeof financialYear === 'string' ? FY_LABEL.exec(financialYear.trim()) : null;
  if (!match) throw bad('Please select a financial year.');
  const fyStartYear = Number(match[1]);
  if (fyLabel(fyStartYear) !== financialYear.trim()) throw bad('The selected financial year is not valid.');

  const monthIndex = FY_MONTHS.indexOf(typeof reportingMonth === 'string' ? reportingMonth.trim() : '');
  if (monthIndex === -1) throw bad('Please select the progress entry month.');

  const { periodIndex } = periodFor(fyStartYear, monthIndex);
  if (periodIndex > periodOf(now)) throw bad(`${periodLabel(periodIndex)} has not started yet. Progress can be reported for the current or an earlier month.`);
  if (periodIndex < periodOf(projectStart(project))) {
    throw bad(`Progress cannot be reported for ${periodLabel(periodIndex)}: it is before this project started (${periodLabel(periodOf(projectStart(project)))}).`);
  }
  return { financialYear: fyLabel(fyStartYear), fyStartYear, reportingMonth: FY_MONTHS[monthIndex], monthIndex, periodIndex };
};

// ─── Numbers ─────────────────────────────────────────────────────────────────
// Integer arithmetic: physical quantities in thousandths, money (Rs. lakh) in rupees.

const PHYSICAL_SCALE = 1000;
const MONEY_SCALE = 100000;
const toPhysical = (value) => Math.round((Number(value) || 0) * PHYSICAL_SCALE);
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY_SCALE);
const fromPhysical = (units) => units / PHYSICAL_SCALE;
const fromMoney = (units) => units / MONEY_SCALE;
const percent = (part, whole) => (whole > 0 ? Math.min(100, Math.floor((part * 10000) / whole) / 100) : 0);
const trimNumber = (value) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const lakh = (units) => `₹ ${fromMoney(units).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 5 })} Lakh`;

const parseAmount = (value, label) => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) throw bad(`${label} must be a valid number.`);
  if (number < 0) throw bad(`${label} cannot be negative.`);
  return number;
};

// ─── Access ──────────────────────────────────────────────────────────────────

const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);

const findProject = async (projectId, session) => {
  if (!isValidId(projectId)) throw notFound('Project not found.');
  const query = ProjectSanction.findById(projectId).lean();
  const project = await (session ? query.session(session) : query);
  if (!project) throw notFound('Project not found.');
  return project;
};

/** Departments of this project that the user is the assigned PIA officer for. */
const assignedDepartments = (project, user) => (project.departmentAllocations || [])
  .filter((department) => department.piaUserId && String(department.piaUserId) === String(user._id));

/**
 * The department this PIA officer may report on. The department id from the
 * browser only chooses among the officer's own assignments; it can never widen
 * them. Throws 403 for anyone else's department.
 */
const authorizeReporting = (project, user, departmentId) => {
  if (user.role !== USER_ROLES.PIA_OFFICER) throw forbidden('Only PIA officers can submit monthly progress reports.');
  const mine = assignedDepartments(project, user);
  if (!mine.length) throw forbidden('You are not assigned to this project.');

  const department = isValidId(departmentId)
    ? mine.find((item) => String(item.departmentId) === departmentId)
    : (mine.length === 1 ? mine[0] : null);
  if (!department) {
    // Either not a department of this project, or one assigned to another officer.
    throw forbidden('You are not the assigned PIA officer for this department.');
  }
  if (!department.piaAcceptedAt) throw forbidden(`Accept the project for ${department.departmentName} before reporting progress.`);
  if (project.closure?.status === 'CLOSED') throw conflict('This project is closed. Progress can no longer be reported against it.', 'PROJECT_CLOSED');
  if (['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status)) {
    throw conflict(`The completion report of ${department.departmentName} has been filed, so no further monthly report can be submitted.`, 'COMPLETION_FILED');
  }
  return department;
};

const canReadProject = (project, user) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN].includes(user.role)) return true;
  if (user.role === USER_ROLES.DD_LEVEL) return Boolean(user.district) && user.district === project.district;
  if (user.role === USER_ROLES.PIA_OFFICER) return assignedDepartments(project, user).length > 0;
  return false;
};

export const assertCanReadProject = async (projectId, user) => {
  const project = await findProject(projectId);
  if (!canReadProject(project, user)) throw forbidden('You do not have access to this project.');
  return project;
};

// ─── Form (activities, targets, previous progress) ───────────────────────────

const formTypeFor = (headCode) => (headCode === '55-04' ? MPR_FORM_TYPE.HEAD_55_4 : MPR_FORM_TYPE.HEAD_55_1_TO_3);

const loadChain = (projectId, departmentId, session) => {
  const query = ProjectMPR.find({ project: projectId, departmentId }).sort({ periodIndex: 1 }).lean();
  return session ? query.session(session) : query;
};

/** Activity master for the project's Head, keyed by code (units, whole-number rule, order). */
const loadHeadActivities = async (project, session) => {
  if (!project.head?.code) return new Map();
  const query = BudgetHead.findOne({ code: project.head.code }).lean();
  const head = await (session ? query.session(session) : query);
  return new Map((head?.activities || []).map((activity) => [activity.code, activity]));
};

/**
 * The form for one department and period: each planned activity with its
 * target and the cumulative progress of all earlier reports, plus anything
 * that stops a report being filed for this period.
 */
const buildForm = (project, department, masterByCode, chain, period, { excludeId } = {}) => {
  const others = chain.filter((mpr) => !excludeId || String(mpr._id) !== String(excludeId));
  const earlier = others.filter((mpr) => mpr.periodIndex < period.periodIndex);
  const later = others.filter((mpr) => mpr.periodIndex > period.periodIndex);
  const same = others.find((mpr) => mpr.periodIndex === period.periodIndex);
  const returned = others.find((mpr) => mpr.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA);

  // Progress up to the previous month = everything reported in earlier periods.
  const previous = new Map();
  earlier.forEach((mpr) => (mpr.activities || []).forEach((activity) => {
    const entry = previous.get(activity.activityCode) || { physical: 0, financial: 0 };
    entry.physical += toPhysical(activity.physicalCurrent);
    entry.financial += toMoney(activity.financialCurrentLakh);
    previous.set(activity.activityCode, entry);
  }));

  const activities = (department.activities || []).map((planned, index) => {
    const master = masterByCode.get(planned.activityCode);
    const before = previous.get(planned.activityCode) || { physical: 0, financial: 0 };
    const hasPhysical = master ? master.hasPhysical !== false : toPhysical(planned.physicalTarget) > 0;
    return {
      activityCode: planned.activityCode,
      activityName: planned.activityName,
      activityNameHindi: master?.nameHindi || '',
      unit: planned.unit || master?.unit || '',
      hasPhysical,
      allowsDecimal: master ? Boolean(master.allowsDecimal) : !Number.isInteger(planned.physicalTarget),
      sortOrder: master?.sortOrder ?? index + 1,
      physicalTarget: hasPhysical ? fromPhysical(toPhysical(planned.physicalTarget)) : 0,
      physicalPrevious: hasPhysical ? fromPhysical(before.physical) : 0,
      financialTargetLakh: fromMoney(toMoney(planned.financialTargetLakh)),
      financialPreviousLakh: fromMoney(before.financial),
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);

  let blocker = null;
  if (same) {
    blocker = {
      code: 'DUPLICATE',
      message: `A progress report for ${periodLabel(period.periodIndex)} has already been ${same.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA ? 'filed and returned for correction — open it to resubmit' : 'submitted'} for ${department.departmentName}.`,
      mprId: String(same._id),
    };
  } else if (returned) {
    blocker = {
      code: 'RETURNED_PENDING',
      message: `The report for ${periodLabel(returned.periodIndex)} was returned for correction. Resubmit it before filing another month.`,
      mprId: String(returned._id),
    };
  } else if (later.length) {
    const latest = later[later.length - 1];
    blocker = {
      code: 'OUT_OF_ORDER',
      message: `A report for a later month (${periodLabel(latest.periodIndex)}) has already been filed, so ${periodLabel(period.periodIndex)} can no longer be reported.`,
      mprId: String(latest._id),
    };
  } else if (!activities.length) {
    blocker = { code: 'NO_ACTIVITIES', message: `No activity targets were planned for ${department.departmentName} in this project.` };
  }

  const lastEarlier = earlier[earlier.length - 1];
  return {
    activities,
    blocker,
    previousReport: lastEarlier
      ? { id: String(lastEarlier._id), mprNo: lastEarlier.mprNo, period: periodLabel(lastEarlier.periodIndex), status: lastEarlier.status }
      : null,
    reportsBefore: earlier.length,
  };
};

/** Apply this month's entries to the form and enforce every limit. Returns the rows to store. */
const applyEntries = (form, rawEntries, departmentName) => {
  const inputs = Array.isArray(rawEntries) ? rawEntries : [];
  const known = new Map(form.activities.map((activity) => [activity.activityCode, activity]));
  const byCode = new Map();
  for (const input of inputs) {
    const code = typeof input?.activityCode === 'string' ? input.activityCode : '';
    if (!known.has(code)) throw bad(`An activity in this report is not part of ${departmentName}'s plan for this project. Reload the form and try again.`);
    if (byCode.has(code)) throw bad(`${known.get(code).activityName} appears more than once in this report.`);
    byCode.set(code, input);
  }

  const rows = form.activities.map((activity) => {
    const input = byCode.get(activity.activityCode) || {};
    const name = activity.activityName;

    const physicalCurrent = parseAmount(input.physicalCurrent, `${name}: progress during the month`);
    const currentPhysical = toPhysical(physicalCurrent);
    if (Math.abs(physicalCurrent * PHYSICAL_SCALE - currentPhysical) > 0.0001) throw bad(`${name}: progress can have at most 3 decimal places.`);
    if (!activity.hasPhysical && currentPhysical > 0) throw bad(`${name} has no physical target; only financial progress can be reported.`);
    if (!activity.allowsDecimal && !Number.isInteger(physicalCurrent)) throw bad(`${name}: progress must be a whole number (${activity.unit || 'units'}).`);

    const targetPhysical = toPhysical(activity.physicalTarget);
    const previousPhysical = toPhysical(activity.physicalPrevious);
    if (previousPhysical + currentPhysical > targetPhysical) {
      const remaining = Math.max(0, targetPhysical - previousPhysical);
      throw bad(
        `${name}: Progress cannot exceed the total target. Remaining target: ${trimNumber(fromPhysical(remaining))}${activity.unit ? ` ${activity.unit.replace(/\.$/, '')}` : ''}.`,
        { code: 'PHYSICAL_TARGET_EXCEEDED', activityCode: activity.activityCode, remaining: fromPhysical(remaining) },
      );
    }

    const financialCurrent = parseAmount(input.financialCurrentLakh, `${name}: financial progress during the month`);
    const currentMoney = toMoney(financialCurrent);
    if (Math.abs(financialCurrent * MONEY_SCALE - currentMoney) > 0.001) throw bad(`${name}: financial progress can have at most 5 decimal places.`);
    const targetMoney = toMoney(activity.financialTargetLakh);
    const previousMoney = toMoney(activity.financialPreviousLakh);
    if (previousMoney + currentMoney > targetMoney) {
      const remaining = Math.max(0, targetMoney - previousMoney);
      throw bad(
        `${name}: Financial progress cannot exceed the financial target. Remaining: ${lakh(remaining)}.`,
        { code: 'FINANCIAL_TARGET_EXCEEDED', activityCode: activity.activityCode, remainingLakh: fromMoney(remaining) },
      );
    }

    return {
      ...activity,
      physicalCurrent: fromPhysical(currentPhysical),
      physicalTotal: fromPhysical(previousPhysical + currentPhysical),
      financialCurrentLakh: fromMoney(currentMoney),
      financialTotalLakh: fromMoney(previousMoney + currentMoney),
    };
  });

  return rows;
};

const summarize = (rows) => {
  let completed = 0; let inProgress = 0; let notStarted = 0; let physicalShare = 0; let physicalCount = 0;
  let target = 0; let previous = 0; let current = 0;
  rows.forEach((row) => {
    // An activity is measured physically when it has a physical target, otherwise by money spent.
    const physical = row.hasPhysical && toPhysical(row.physicalTarget) > 0;
    const goal = physical ? toPhysical(row.physicalTarget) : toMoney(row.financialTargetLakh);
    const done = physical ? toPhysical(row.physicalTotal) : toMoney(row.financialTotalLakh);
    if (goal > 0 && done >= goal) completed += 1; else if (done > 0) inProgress += 1; else notStarted += 1;
    if (physical) { physicalShare += Math.min(1, done / goal); physicalCount += 1; }
    target += toMoney(row.financialTargetLakh);
    previous += toMoney(row.financialPreviousLakh);
    current += toMoney(row.financialCurrentLakh);
  });
  return {
    activities: rows.length,
    activitiesCompleted: completed,
    activitiesInProgress: inProgress,
    activitiesNotStarted: notStarted,
    physicalPercent: physicalCount ? Math.floor((physicalShare / physicalCount) * 10000) / 100 : 0,
    financialTargetLakh: fromMoney(target),
    financialPreviousLakh: fromMoney(previous),
    financialCurrentLakh: fromMoney(current),
    financialTotalLakh: fromMoney(previous + current),
    financialRemainingLakh: fromMoney(Math.max(0, target - previous - current)),
    financialPercent: percent(previous + current, target),
  };
};

// ─── DTOs ────────────────────────────────────────────────────────────────────

const projectDto = (project) => ({
  id: String(project._id),
  code: project.projectId || project.sanctionId || '',
  projectId: project.projectId || null,
  sanctionId: project.sanctionId || null,
  projectName: project.projectTitle || '',
  district: project.location?.district || project.district || '',
  block: project.location?.block || '',
  gramPanchayat: project.location?.gramPanchayat || '',
  village: project.location?.village || '',
  status: project.status,
});

const headDto = (project) => (project.head?.code ? {
  id: project.head.headId ? String(project.head.headId) : null,
  code: project.head.code,
  name: project.head.name || '',
  formType: formTypeFor(project.head.code),
} : null);

const listDto = (mpr) => ({
  id: String(mpr._id),
  mprNo: mpr.mprNo,
  project: { id: String(mpr.project?._id || mpr.project), code: mpr.projectCode, projectName: mpr.projectTitle },
  district: mpr.district,
  departmentId: String(mpr.departmentId),
  departmentName: mpr.departmentName,
  head: mpr.head,
  formType: mpr.formType,
  financialYear: mpr.financialYear,
  reportingMonth: mpr.reportingMonth,
  period: periodLabel(mpr.periodIndex),
  status: mpr.status,
  totals: mpr.totals,
  submittedBy: mpr.submittedBy?.name ? { name: mpr.submittedBy.name } : null,
  submittedAt: mpr.submittedAt,
  reviewedAt: mpr.reviewedAt,
  verifiedAt: mpr.verifiedAt || null,
  evidenceCount: (mpr.evidence || []).length,
  returnReason: mpr.returnReason || null,
  returnedByLevel: mpr.returnedByLevel || null,
});

// ─── PIA: workload, context, form ────────────────────────────────────────────

/** Projects (and only the departments) this PIA officer can report on. */
export const getWorkload = async (user) => {
  const projects = await ProjectSanction.find({ 'departmentAllocations.piaUserId': user._id })
    .select('projectId sanctionId projectTitle district location head status departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt departmentAllocations.completion closure')
    .sort({ updatedAt: -1 })
    .lean();

  return projects.filter((project) => project.closure?.status !== 'CLOSED').map((project) => ({
    ...projectDto(project),
    head: headDto(project),
    departments: assignedDepartments(project, user).map((department) => ({
      departmentId: String(department.departmentId),
      name: department.departmentName,
      accepted: Boolean(department.piaAcceptedAt),
      completionFiled: ['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status),
    })).filter((department) => !department.completionFiled),
  })).filter((project) => project.departments.some((department) => department.accepted));
};

/** Financial years and months that can be chosen for a department, with what is already filed. */
export const getContext = async (projectId, departmentId, user) => {
  const project = await findProject(projectId);
  const mine = assignedDepartments(project, user);
  if (user.role !== USER_ROLES.PIA_OFFICER || !mine.length) throw forbidden('You are not assigned to this project.');

  const departments = mine.map((department) => ({
    departmentId: String(department.departmentId),
    name: department.departmentName,
    accepted: Boolean(department.piaAcceptedAt),
  }));

  const selected = isValidId(departmentId) || mine.length === 1 ? authorizeReporting(project, user, departmentId) : null;
  const chain = selected ? await loadChain(project._id, selected.departmentId) : [];
  const filed = new Map(chain.map((mpr) => [mpr.periodIndex, mpr]));
  const latestFiled = chain.length ? chain[chain.length - 1].periodIndex : null;
  const hasReturned = chain.some((mpr) => mpr.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA);

  const now = new Date();
  const start = projectStart(project);
  const currentPeriod = periodOf(now);
  const startPeriod = periodOf(start);
  const financialYears = [];
  for (let fyStart = fyStartOf(start); fyStart <= fyStartOf(now); fyStart += 1) {
    const months = FY_MONTHS.map((month, monthIndex) => {
      const { periodIndex } = periodFor(fyStart, monthIndex);
      const existing = filed.get(periodIndex);
      let reason = '';
      if (periodIndex > currentPeriod) reason = 'Not started yet';
      else if (periodIndex < startPeriod) reason = 'Before the project started';
      else if (existing) reason = existing.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA ? 'Returned — resubmit' : 'Already submitted';
      else if (hasReturned) reason = 'Resubmit the returned report first';
      else if (latestFiled !== null && periodIndex < latestFiled) reason = 'A later month is already filed';
      return {
        value: month,
        label: periodLabel(periodIndex),
        selectable: !reason,
        reason,
        mprId: existing ? String(existing._id) : null,
        status: existing?.status || null,
      };
    });
    financialYears.push({ value: fyLabel(fyStart), label: fyLabel(fyStart), months });
  }

  return {
    project: projectDto(project),
    head: headDto(project),
    departments,
    selectedDepartmentId: selected ? String(selected.departmentId) : null,
    financialYears: financialYears.reverse(),
  };
};

const formResponse = (project, department, period, form, rows = null) => ({
  project: projectDto(project),
  department: { departmentId: String(department.departmentId), name: department.departmentName },
  head: headDto(project),
  formType: formTypeFor(project.head?.code),
  financialYear: period.financialYear,
  reportingMonth: period.reportingMonth,
  period: periodLabel(period.periodIndex),
  previousReport: form.previousReport,
  reportsBefore: form.reportsBefore,
  blocker: form.blocker,
  activities: rows || form.activities,
  totals: rows ? summarize(rows) : null,
});

/** The blank form for a period: activities, targets and server-calculated previous progress. */
export const getForm = async ({ projectId, departmentId, financialYear, reportingMonth }, user) => {
  const project = await findProject(projectId);
  const department = authorizeReporting(project, user, departmentId);
  if (!project.head?.code) throw bad('This project has no Head, so progress cannot be reported against it.');
  const period = resolvePeriod(project, financialYear, reportingMonth);
  const [chain, masterByCode] = await Promise.all([loadChain(project._id, department.departmentId), loadHeadActivities(project)]);
  return formResponse(project, department, period, buildForm(project, department, masterByCode, chain, period));
};

/** Preview: full validation and the exact figures Submit would save. Writes nothing. */
export const previewMpr = async (body = {}, user) => {
  const project = await findProject(body.projectId);
  const department = authorizeReporting(project, user, body.departmentId);
  if (!project.head?.code) throw bad('This project has no Head, so progress cannot be reported against it.');
  const period = resolvePeriod(project, body.financialYear, body.reportingMonth);
  const [chain, masterByCode] = await Promise.all([loadChain(project._id, department.departmentId), loadHeadActivities(project)]);
  const form = buildForm(project, department, masterByCode, chain, period);
  if (form.blocker) throw conflict(form.blocker.message, form.blocker.code, { mprId: form.blocker.mprId });
  const rows = applyEntries(form, body.entries, department.departmentName);
  return { ...formResponse(project, department, period, form, rows), remarks: String(body.remarks ?? '').trim().slice(0, 1000) };
};

/** The correction form for a returned report: same rules, pre-filled with what was submitted. */
export const getResubmitForm = async (mprId, user) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  const mpr = await ProjectMPR.findById(mprId).lean();
  if (!mpr) throw notFound('Report not found.');
  const project = await findProject(String(mpr.project));
  const department = authorizeReporting(project, user, String(mpr.departmentId));
  if (mpr.status !== PROJECT_MPR_STATUS.RETURNED_TO_PIA) throw conflict('Only a report returned for correction can be edited.', 'NOT_RETURNED');

  const period = { financialYear: mpr.financialYear, fyStartYear: mpr.fyStartYear, reportingMonth: mpr.reportingMonth, periodIndex: mpr.periodIndex };
  const [chain, masterByCode] = await Promise.all([loadChain(project._id, department.departmentId), loadHeadActivities(project)]);
  const form = buildForm(project, department, masterByCode, chain, period, { excludeId: mpr._id });
  if (form.blocker?.code === 'RETURNED_PENDING') form.blocker = null;
  return {
    ...formResponse(project, department, period, form),
    mprId: String(mpr._id),
    mprNo: mpr.mprNo,
    returnReason: mpr.returnReason || '',
    remarks: mpr.remarks || '',
    entries: (mpr.activities || []).map((a) => ({ activityCode: a.activityCode, physicalCurrent: a.physicalCurrent, financialCurrentLakh: a.financialCurrentLakh })),
  };
};

/** Preview of a correction. Writes nothing. */
export const previewResubmit = async (mprId, body = {}, user) => {
  const base = await getResubmitForm(mprId, user);
  if (base.blocker) throw conflict(base.blocker.message, base.blocker.code);
  const rows = applyEntries({ activities: base.activities }, body.entries, base.department.name);
  return { ...base, activities: rows, totals: summarize(rows), remarks: String(body.remarks ?? '').trim().slice(0, 1000) };
};

// ─── Submit / resubmit ───────────────────────────────────────────────────────

const versionFilter = (version) => (version > 0
  ? { mprVersion: version }
  : { $or: [{ mprVersion: 0 }, { mprVersion: { $exists: false } }] });

const nextMprNumber = async (project, session) => {
  const year = new Date().getFullYear();
  const districtCode = (project.projectId?.split('-')[2] || project.district.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase();
  const prefix = `MPR-${year}-${districtCode}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: `projectMpr:${prefix}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) },
  );
  return `${prefix}-${String(counter.seq).padStart(5, '0')}`;
};

const MAX_ATTEMPTS = 4;
const RETRY = Symbol('retry');

/**
 * Save a report. Re-validates everything inside one transaction and claims the
 * project's report version, so two reports for the same project cannot be
 * validated against the same "previous progress" and both be saved. The
 * unique index is the final guard against a duplicate period.
 */
export const submitMpr = async (body = {}, user) => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const saved = await runInTransaction(async (session) => {
        const options = session ? { session } : {};
        const project = await findProject(body.projectId, session);
        const department = authorizeReporting(project, user, body.departmentId);
        if (!project.head?.code) throw bad('This project has no Head, so progress cannot be reported against it.');
        const period = resolvePeriod(project, body.financialYear, body.reportingMonth);
        const [chain, masterByCode] = await Promise.all([
          loadChain(project._id, department.departmentId, session),
          loadHeadActivities(project, session),
        ]);
        const form = buildForm(project, department, masterByCode, chain, period);
        if (form.blocker) throw conflict(form.blocker.message, form.blocker.code, { mprId: form.blocker.mprId });
        const rows = applyEntries(form, body.entries, department.departmentName);

        const version = project.mprVersion || 0;
        const claimed = await ProjectSanction.updateOne(
          { _id: project._id, ...versionFilter(version) },
          { $set: { mprVersion: version + 1 } },
          options,
        );
        if (claimed.modifiedCount !== 1) return RETRY;

        const now = new Date();
        const mprNo = await nextMprNumber(project, session);
        try {
          const [created] = await ProjectMPR.create([{
            mprNo,
            project: project._id,
            projectCode: project.projectId || project.sanctionId || '',
            projectTitle: project.projectTitle,
            district: project.district,
            departmentId: department.departmentId,
            departmentName: department.departmentName,
            head: { headId: project.head.headId, code: project.head.code, name: project.head.name },
            formType: formTypeFor(project.head.code),
            financialYear: period.financialYear,
            fyStartYear: period.fyStartYear,
            reportingMonth: period.reportingMonth,
            periodIndex: period.periodIndex,
            status: PROJECT_MPR_STATUS.SUBMITTED,
            activities: rows,
            totals: summarize(rows),
            remarks: String(body.remarks ?? '').trim().slice(0, 1000),
            submittedBy: user._id,
            submittedAt: now,
            revisionHistory: [{ status: PROJECT_MPR_STATUS.SUBMITTED, changedBy: user._id, changedAt: now, note: 'Submitted to district' }],
          }], options);
          return created;
        } catch (err) {
          if (err?.code === 11000) {
            throw conflict(`A progress report for ${periodLabel(period.periodIndex)} has already been submitted for ${department.departmentName}.`, 'DUPLICATE');
          }
          throw err;
        }
      });
      if (saved === RETRY) continue;
      return saved;
    } catch (err) {
      // Lost a race for the report number or version: validate again on the new state.
      if (err?.code === 11000) continue;
      throw err;
    }
  }
  throw conflict('Another report for this project was being saved at the same time. Please try again.', 'BUSY');
};

/** Correct and resubmit a report the district returned. */
export const resubmitMpr = async (mprId, body = {}, user) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  return runInTransaction(async (session) => {
    const options = session ? { session } : {};
    const existingQuery = ProjectMPR.findById(mprId);
    const mpr = await (session ? existingQuery.session(session) : existingQuery);
    if (!mpr) throw notFound('Report not found.');
    const project = await findProject(String(mpr.project), session);
    const department = authorizeReporting(project, user, String(mpr.departmentId));
    if (mpr.status !== PROJECT_MPR_STATUS.RETURNED_TO_PIA) throw conflict('Only a report returned for correction can be resubmitted.', 'NOT_RETURNED');

    const period = { financialYear: mpr.financialYear, fyStartYear: mpr.fyStartYear, reportingMonth: mpr.reportingMonth, periodIndex: mpr.periodIndex };
    const [chain, masterByCode] = await Promise.all([
      loadChain(project._id, department.departmentId, session),
      loadHeadActivities(project, session),
    ]);
    const form = buildForm(project, department, masterByCode, chain, period, { excludeId: mpr._id });
    if (form.blocker && form.blocker.code !== 'RETURNED_PENDING') throw conflict(form.blocker.message, form.blocker.code);
    const rows = applyEntries(form, body.entries, department.departmentName);

    const now = new Date();
    mpr.activities = rows;
    mpr.totals = summarize(rows);
    mpr.remarks = String(body.remarks ?? '').trim().slice(0, 1000);
    mpr.status = PROJECT_MPR_STATUS.SUBMITTED;
    mpr.submittedBy = user._id;
    mpr.submittedAt = now;
    mpr.returnReason = undefined;
    mpr.revisionHistory.push({ status: PROJECT_MPR_STATUS.SUBMITTED, changedBy: user._id, changedAt: now, note: 'Resubmitted after correction' });
    await mpr.save(options);
    return mpr;
  });
};

// ─── Reading ─────────────────────────────────────────────────────────────────

const paginateList = async (filter, page, limit) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const [items, total] = await Promise.all([
    ProjectMPR.find(filter).select('-activities -revisionHistory').populate('submittedBy', 'name')
      .sort({ periodIndex: -1, submittedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    ProjectMPR.countDocuments(filter),
  ]);
  return { data: items.map(listDto), pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } };
};

const statusFilter = (status) => (Object.values(PROJECT_MPR_STATUS).includes(status) ? { status } : {});

/** Reports for the departments this PIA officer is currently assigned to (plus any they filed). */
export const listMine = async (user, { status, page, limit } = {}) => {
  const projects = await ProjectSanction.find({ 'departmentAllocations.piaUserId': user._id })
    .select('departmentAllocations.departmentId departmentAllocations.piaUserId').lean();
  const assigned = projects.flatMap((project) => assignedDepartments(project, user)
    .map((department) => ({ project: project._id, departmentId: department.departmentId })));
  return paginateList({ $or: [{ submittedBy: user._id }, ...assigned], ...statusFilter(status) }, page, limit);
};

export const listForDistrict = async (user, { status, page, limit } = {}) => {
  if (!user.district) throw bad('District not set for user');
  return paginateList({ district: user.district, ...statusFilter(status) }, page, limit);
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every project MPR in the State, for the State admin and the M&E admin.
 * Filters: status, financialYear ("2026-27"), district, headCode, search
 * (report number, project ID or project name).
 */
export const listAll = async ({ status, financialYear, district, headCode, search, page, limit } = {}) => {
  const filter = { ...statusFilter(status) };
  if (typeof financialYear === 'string' && FY_LABEL.test(financialYear.trim())) filter.financialYear = financialYear.trim();
  if (typeof district === 'string' && district.trim()) filter.district = district.trim();
  if (typeof headCode === 'string' && headCode.trim()) filter['head.code'] = headCode.trim();
  if (typeof search === 'string' && search.trim()) {
    const term = new RegExp(escapeRegex(search.trim().slice(0, 60)), 'i');
    filter.$or = [{ mprNo: term }, { projectCode: term }, { projectTitle: term }, { departmentName: term }];
  }
  const result = await paginateList(filter, page, limit);

  // Counts per status for the same scope (ignoring the status filter), for the summary strip.
  const { status: ignored, ...scope } = filter;
  const grouped = await ProjectMPR.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 }, spent: { $sum: '$totals.financialCurrentLakh' } } }]);
  const counts = Object.fromEntries(Object.values(PROJECT_MPR_STATUS).map((key) => [key, 0]));
  let spentLakh = 0;
  grouped.forEach((row) => { counts[row._id] = row.count; spentLakh += Math.round((row.spent || 0) * MONEY_SCALE); });
  return { ...result, summary: { counts, total: grouped.reduce((sum, row) => sum + row.count, 0), spentLakh: fromMoney(spentLakh) } };
};

export const listForProject = async (projectId, user) => {
  const project = await findProject(projectId);
  if (!canReadProject(project, user)) throw forbidden('You do not have access to this project.');
  const filter = { project: project._id };
  // A PIA officer sees only their own departments' reports.
  if (user.role === USER_ROLES.PIA_OFFICER) filter.departmentId = { $in: assignedDepartments(project, user).map((d) => d.departmentId) };
  const items = await ProjectMPR.find(filter).select('-activities -revisionHistory').populate('submittedBy', 'name')
    .sort({ periodIndex: -1, departmentName: 1 }).limit(500).lean();
  return items.map(listDto);
};

export const getMpr = async (mprId, user) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  const mpr = await ProjectMPR.findById(mprId)
    .populate('submittedBy', 'name email')
    .populate('reviewedBy', 'name')
    .populate('revisionHistory.changedBy', 'name role')
    .lean();
  if (!mpr) throw notFound('Report not found.');
  const project = await findProject(String(mpr.project));

  const mine = user.role === USER_ROLES.PIA_OFFICER
    && assignedDepartments(project, user).some((department) => String(department.departmentId) === String(mpr.departmentId));
  const allowed = user.role === USER_ROLES.PIA_OFFICER ? mine : canReadProject(project, user);
  if (!allowed) throw forbidden('You do not have access to this report.');

  const chain = await loadChain(project._id, mpr.departmentId);
  const isLatest = !chain.some((item) => item.periodIndex > mpr.periodIndex);
  const ownDistrict = user.role === USER_ROLES.DD_LEVEL && user.district === mpr.district;

  // Month-by-month series for this department (for the trend) and neighbours for navigation.
  const series = chain.map((item) => ({
    id: String(item._id),
    period: periodLabel(item.periodIndex),
    month: item.reportingMonth,
    financialYear: item.financialYear,
    status: item.status,
    spentLakh: item.totals?.financialCurrentLakh || 0,
    cumulativeLakh: item.totals?.financialTotalLakh || 0,
    financialPercent: item.totals?.financialPercent || 0,
    physicalPercent: item.totals?.physicalPercent || 0,
    current: String(item._id) === String(mpr._id),
  }));
  const position = chain.findIndex((item) => String(item._id) === String(mpr._id));
  const previous = position > 0 ? chain[position - 1] : null;
  const next = position >= 0 && position < chain.length - 1 ? chain[position + 1] : null;

  // Funds the State has released to this department, against what it reports as spent.
  const department = (project.departmentAllocations || []).find((item) => String(item.departmentId) === String(mpr.departmentId));
  const releases = await BudgetAllocationEntry.find({ project: project._id, departmentId: mpr.departmentId }).select('amountLakh').lean();
  const releasedUnits = releases.reduce((sum, entry) => sum + toMoney(entry.amountLakh), 0);
  const spentUnits = toMoney(mpr.totals?.financialTotalLakh);
  const budgetUnits = toMoney(department?.totalLakh);

  return {
    ...listDto(mpr),
    project: projectDto(project),
    submittedBy: mpr.submittedBy ? { name: mpr.submittedBy.name, email: mpr.submittedBy.email } : null,
    reviewedBy: mpr.reviewedBy ? { name: mpr.reviewedBy.name } : null,
    reviewNote: mpr.reviewNote || null,
    remarks: mpr.remarks || '',
    evidence: (mpr.evidence || []).map((item) => ({
      id: String(item._id), url: item.url, name: item.name || 'File', mimeType: item.mimeType || null, isImage: /^image\//.test(item.mimeType || ''),
      size: item.size || null, caption: item.caption || '', uploadedAt: item.uploadedAt || null,
    })),
    evidenceLimit: 6,
    activities: mpr.activities,
    revisionHistory: (mpr.revisionHistory || []).map((step) => ({ status: step.status, note: step.note, changedAt: step.changedAt, changedBy: step.changedBy?.name || null })),
    verifiedAt: mpr.verifiedAt || null,
    verificationNote: mpr.verificationNote || null,
    series,
    navigation: {
      previous: previous ? { id: String(previous._id), period: periodLabel(previous.periodIndex) } : null,
      next: next ? { id: String(next._id), period: periodLabel(next.periodIndex) } : null,
    },
    funds: {
      departmentBudgetLakh: fromMoney(budgetUnits),
      releasedLakh: fromMoney(releasedUnits),
      installments: releases.length,
      spentLakh: fromMoney(spentUnits),
      unspentLakh: fromMoney(Math.max(0, releasedUnits - spentUnits)),
      utilisationPercent: percent(Math.min(spentUnits, releasedUnits), releasedUnits),
      // Reported expenditure is more than the State has released so far.
      spentBeyondReleaseLakh: fromMoney(Math.max(0, spentUnits - releasedUnits)),
    },
    permissions: {
      canVerify: user.role === USER_ROLES.MND_SUPER_ADMIN && mpr.status === PROJECT_MPR_STATUS.DISTRICT_APPROVED,
      // The State can send a district-approved report back, under the same "latest month only" rule.
      canStateReturn: user.role === USER_ROLES.MND_SUPER_ADMIN && mpr.status === PROJECT_MPR_STATUS.DISTRICT_APPROVED && isLatest,
      stateReturnBlockedReason: user.role === USER_ROLES.MND_SUPER_ADMIN && mpr.status === PROJECT_MPR_STATUS.DISTRICT_APPROVED && !isLatest
        ? 'A later month has already been filed for this department, so this report can no longer be returned.' : null,
      canResubmit: mine && mpr.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA,
      // Evidence is optional and can be changed until the district approves the report.
      canManageEvidence: mine && [PROJECT_MPR_STATUS.SUBMITTED, PROJECT_MPR_STATUS.RETURNED_TO_PIA].includes(mpr.status),
      canApprove: ownDistrict && mpr.status === PROJECT_MPR_STATUS.SUBMITTED,
      // Returning an older report would invalidate the "previous progress" of the ones after it.
      canReturn: ownDistrict && mpr.status === PROJECT_MPR_STATUS.SUBMITTED && isLatest,
      returnBlockedReason: ownDistrict && mpr.status === PROJECT_MPR_STATUS.SUBMITTED && !isLatest
        ? 'A later month has already been filed for this department, so this report can no longer be returned.' : null,
    },
  };
};

// ─── District review ─────────────────────────────────────────────────────────

const reviewable = async (mprId, user, session) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  const query = ProjectMPR.findById(mprId);
  const mpr = await (session ? query.session(session) : query);
  if (!mpr) throw notFound('Report not found.');
  if (user.role !== USER_ROLES.DD_LEVEL || !user.district || user.district !== mpr.district) {
    throw forbidden('This report belongs to another district.');
  }
  if (mpr.status !== PROJECT_MPR_STATUS.SUBMITTED) throw conflict('This report has already been reviewed.', 'ALREADY_REVIEWED');
  return mpr;
};

export const districtApprove = async (mprId, note, user) => {
  const mpr = await reviewable(mprId, user);
  const text = String(note ?? '').trim().slice(0, 1000);
  const now = new Date();
  // Conditional update: two reviewers clicking at once cannot both act.
  const updated = await ProjectMPR.findOneAndUpdate(
    { _id: mpr._id, status: PROJECT_MPR_STATUS.SUBMITTED },
    {
      $set: { status: PROJECT_MPR_STATUS.DISTRICT_APPROVED, reviewedBy: user._id, reviewedAt: now, reviewNote: text },
      $push: { revisionHistory: { status: PROJECT_MPR_STATUS.DISTRICT_APPROVED, changedBy: user._id, changedAt: now, note: text || 'Approved by district' } },
    },
    { new: true },
  );
  if (!updated) throw conflict('This report has already been reviewed.', 'ALREADY_REVIEWED');
  return updated;
};

export const returnToPia = async (mprId, reason, user) => {
  const text = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text) throw bad('A reason is required to return the report.');
  return runInTransaction(async (session) => {
    const mpr = await reviewable(mprId, user, session);
    const laterQuery = ProjectMPR.exists({ project: mpr.project, departmentId: mpr.departmentId, periodIndex: { $gt: mpr.periodIndex } });
    if (await (session ? laterQuery.session(session) : laterQuery)) {
      throw conflict('A later month has already been filed for this department, so this report can no longer be returned.', 'LATER_REPORT_EXISTS');
    }
    const now = new Date();
    mpr.status = PROJECT_MPR_STATUS.RETURNED_TO_PIA;
    mpr.reviewedBy = user._id;
    mpr.reviewedAt = now;
    mpr.returnReason = text;
    mpr.returnedByLevel = 'DISTRICT';
    mpr.revisionHistory.push({ status: PROJECT_MPR_STATUS.RETURNED_TO_PIA, changedBy: user._id, changedAt: now, note: text });
    await mpr.save(session ? { session } : {});
    return mpr;
  });
};

/** State (M&E admin) verifies a report the district has approved. */
export const stateVerify = async (mprId, note, user) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  if (user.role !== USER_ROLES.MND_SUPER_ADMIN) throw forbidden('Only the M&E admin can verify reports for the State.');
  const text = String(note ?? '').trim().slice(0, 1000);
  const now = new Date();
  // Conditional update: only a district-approved report can be verified, and only once.
  const updated = await ProjectMPR.findOneAndUpdate(
    { _id: mprId, status: PROJECT_MPR_STATUS.DISTRICT_APPROVED },
    {
      $set: { status: PROJECT_MPR_STATUS.STATE_VERIFIED, verifiedBy: user._id, verifiedAt: now, verificationNote: text },
      $push: { revisionHistory: { status: PROJECT_MPR_STATUS.STATE_VERIFIED, changedBy: user._id, changedAt: now, note: text || 'Verified by State' } },
    },
    { new: true },
  );
  if (updated) return updated;
  const existing = await ProjectMPR.findById(mprId).select('status').lean();
  if (!existing) throw notFound('Report not found.');
  throw conflict(existing.status === PROJECT_MPR_STATUS.STATE_VERIFIED
    ? 'This report has already been verified.'
    : 'Only a report approved by the district can be verified.', 'NOT_VERIFIABLE');
};

/**
 * State (M&E admin) returns a district-approved report for correction. It goes
 * back to the PIA officer; after resubmission the district reviews it again.
 */
export const stateReturn = async (mprId, reason, user) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  if (user.role !== USER_ROLES.MND_SUPER_ADMIN) throw forbidden('Only the M&E admin can return reports for the State.');
  const text = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text) throw bad('A reason is required to return the report.');
  return runInTransaction(async (session) => {
    const query = ProjectMPR.findById(mprId);
    const mpr = await (session ? query.session(session) : query);
    if (!mpr) throw notFound('Report not found.');
    if (mpr.status !== PROJECT_MPR_STATUS.DISTRICT_APPROVED) {
      throw conflict(mpr.status === PROJECT_MPR_STATUS.STATE_VERIFIED ? 'A verified report cannot be returned.' : 'Only a report approved by the district can be returned by the State.', 'NOT_RETURNABLE');
    }
    const laterQuery = ProjectMPR.exists({ project: mpr.project, departmentId: mpr.departmentId, periodIndex: { $gt: mpr.periodIndex } });
    if (await (session ? laterQuery.session(session) : laterQuery)) {
      throw conflict('A later month has already been filed for this department, so this report can no longer be returned.', 'LATER_REPORT_EXISTS');
    }
    const owner = await findProject(String(mpr.project), session);
    const ownerDepartment = (owner.departmentAllocations || []).find((item) => String(item.departmentId) === String(mpr.departmentId));
    if (owner.closure?.status === 'CLOSED') throw conflict('This project is closed. Its reports can no longer be returned.', 'PROJECT_CLOSED');
    if (['SUBMITTED', 'DISTRICT_VERIFIED'].includes(ownerDepartment?.completion?.status)) {
      throw conflict('The completion report of this department has been filed. Ask the district to return the completion report first.', 'COMPLETION_FILED');
    }
    const now = new Date();
    mpr.status = PROJECT_MPR_STATUS.RETURNED_TO_PIA;
    mpr.returnReason = text;
    mpr.returnedByLevel = 'STATE';
    mpr.revisionHistory.push({ status: PROJECT_MPR_STATUS.RETURNED_TO_PIA, changedBy: user._id, changedAt: now, note: `Returned by State: ${text}` });
    await mpr.save(session ? { session } : {});
    return mpr;
  });
};

/** Reports waiting for district review, per project (used by project lists and detail). */
export const countAwaitingReview = (projectId) => ProjectMPR.countDocuments({ project: projectId, status: PROJECT_MPR_STATUS.SUBMITTED });

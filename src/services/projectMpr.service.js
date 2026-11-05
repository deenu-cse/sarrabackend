import mongoose from 'mongoose';
import ProjectSanction, { REPORTING_MODE } from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS, MPR_FORM_TYPE, MPR_ENTRY_MODE } from '../models/ProjectMPR.model.js';
import BudgetHead from '../models/BudgetHead.model.js';
import Counter from '../models/Counter.model.js';
import User from '../models/User.model.js';
import { runInTransaction } from '../utils/transaction.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import USER_ROLES, { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import {
  actorLabel, designationOf, escapeRegex, sameId, sameText, workflowRoleOf,
} from '../utils/access.js';
import {
  REVIEW_STAGES, IN_REVIEW, WITH_MAKER, canActOnStage, chainOf, firstStageOf, queueFilterFor, stageOwner, statusLabel, statusQuery,
} from './mprWorkflow.js';
import { deleteFile } from './upload.service.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Project Monthly Progress Reports (MPR).
 *
 * Trust model: the browser chooses a project, a department, a period and
 * types this month's progress. Everything else — who may report for which
 * department, the activity list, targets, progress up to the previous month
 * and every total — is derived here from the database.
 *
 * A report is prepared by the department's reporting Maker: the PIA Maker, or
 * District Technical Staff when the district has taken the reporting
 * responsibility. It then moves through the review chain in mprWorkflow.js.
 */

const S = PROJECT_MPR_STATUS;

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
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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

// A district can take the reporting responsibility only once it has accepted the project.
const DISTRICT_HOLDS = [SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED];

const modeOf = (department) => department.reportingMode || REPORTING_MODE.PIA;

/** The user who prepares this department's reports: its PIA Maker, or its District Technical Staff. */
export const reportingMakerOf = (department) => (modeOf(department) === REPORTING_MODE.DISTRICT ? department.districtStaffUserId : department.piaUserId);

/** Departments of this project whose reports this user prepares. */
export const reportingDepartments = (project, user) => {
  if (workflowRoleOf(user) !== WORKFLOW_ROLES.MAKER) return [];
  return (project.departmentAllocations || []).filter((department) => {
    if (!sameId(reportingMakerOf(department), user._id)) return false;
    if (modeOf(department) === REPORTING_MODE.DISTRICT) return user.role === USER_ROLES.DD_LEVEL && user.district === project.district;
    return user.role === USER_ROLES.PIA_OFFICER;
  });
};

/** Can reporting start for this department? (PIA mode: the PIA Maker accepted it. District mode: the district accepted the project.) */
const reportingReady = (project, department) => (modeOf(department) === REPORTING_MODE.DISTRICT
  ? Boolean(department.districtStaffUserId) && DISTRICT_HOLDS.includes(project.status)
  : Boolean(department.piaAcceptedAt));

/**
 * Departments of a project a PIA user may see: the PIA Maker sees what is
 * assigned to them; the PIA Checker and Approver see their own department's
 * assignments in their district.
 */
export const piaDepartmentsOf = (project, user) => {
  if (user.role !== USER_ROLES.PIA_OFFICER) return [];
  const departments = project.departmentAllocations || [];
  if (workflowRoleOf(user) === WORKFLOW_ROLES.MAKER) return departments.filter((d) => sameId(d.piaUserId, user._id));
  if (!user.district || user.district !== project.district) return [];
  return departments.filter((d) => d.piaUserId && sameText(d.departmentName, user.department));
};

/**
 * The department this user may report on. The department id from the browser
 * only chooses among the user's own reporting responsibilities; it can never
 * widen them. Throws 403 for anyone else's department.
 */
const authorizeReporting = (project, user, departmentId) => {
  if (workflowRoleOf(user) !== WORKFLOW_ROLES.MAKER || ![USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL].includes(user.role)) {
    throw forbidden('Only the reporting Maker of a department (PIA Maker or District Technical Staff) can prepare its monthly progress report.');
  }
  const mine = reportingDepartments(project, user);
  if (!mine.length) throw forbidden('You do not hold the reporting responsibility for this project.');

  const department = isValidId(departmentId)
    ? mine.find((item) => String(item.departmentId) === departmentId)
    : (mine.length === 1 ? mine[0] : null);
  if (!department) {
    // Either not a department of this project, or one reported by someone else.
    throw forbidden('You do not hold the reporting responsibility for this department.');
  }
  if (!reportingReady(project, department)) {
    throw forbidden(modeOf(department) === REPORTING_MODE.DISTRICT
      ? 'The district must accept the project before progress can be reported.'
      : `Accept the project for ${department.departmentName} before reporting progress.`);
  }
  if (project.closure?.status === 'CLOSED') throw conflict('This project is closed. Progress can no longer be reported against it.', 'PROJECT_CLOSED');
  if (['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status)) {
    throw conflict(`The completion report of ${department.departmentName} has been filed, so no further monthly report can be submitted.`, 'COMPLETION_FILED');
  }
  return department;
};

const canReadProject = (project, user) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) return true;
  if (user.role === USER_ROLES.DD_LEVEL) return Boolean(user.district) && user.district === project.district;
  if (user.role === USER_ROLES.PIA_OFFICER) return piaDepartmentsOf(project, user).length > 0;
  return false;
};

export const assertCanReadProject = async (projectId, user) => {
  const project = await findProject(projectId);
  if (!canReadProject(project, user)) throw forbidden('You do not have access to this project.');
  return project;
};

/** May this user read this report? */
const canReadReport = (project, mpr, user) => {
  if (user.role === USER_ROLES.PIA_OFFICER) {
    return sameId(mpr.submittedBy, user._id) || piaDepartmentsOf(project, user).some((d) => sameId(d.departmentId, mpr.departmentId));
  }
  return canReadProject(project, user);
};

/** Is this user the reporting Maker who may still change the report? */
const isReportingMaker = (project, mpr, user) => {
  const department = (project.departmentAllocations || []).find((d) => sameId(d.departmentId, mpr.departmentId));
  if (!department || modeOf(department) !== (mpr.entryMode || MPR_ENTRY_MODE.PIA)) return false;
  return reportingDepartments(project, user).some((d) => sameId(d.departmentId, mpr.departmentId));
};

// ─── Form (activities, targets, previous progress) ───────────────────────────

const formTypeFor = (headCode) => (headCode === '55-04' ? MPR_FORM_TYPE.HEAD_55_4 : MPR_FORM_TYPE.HEAD_55_1_TO_3);

/** Every live (not rejected) report of one department, oldest first. */
const loadChain = (projectId, departmentId, session) => {
  const query = ProjectMPR.find({ project: projectId, departmentId, status: { $ne: S.REJECTED } }).sort({ periodIndex: 1 }).lean();
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
  const returned = others.find((mpr) => mpr.status === S.RETURNED_FOR_CORRECTION);
  const draft = others.find((mpr) => mpr.status === S.DRAFT);

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
    const state = { [S.RETURNED_FOR_CORRECTION]: 'filed and returned for correction — open it to correct and resubmit', [S.DRAFT]: 'saved as a draft — open it to continue' }[same.status] || 'submitted';
    blocker = {
      code: same.status === S.DRAFT ? 'DRAFT_EXISTS' : 'DUPLICATE',
      message: `A progress report for ${periodLabel(period.periodIndex)} has already been ${state} for ${department.departmentName}. Only one report can exist for a project, department and month.`,
      mprId: String(same._id),
    };
  } else if (returned) {
    blocker = {
      code: 'RETURNED_PENDING',
      message: `The report for ${periodLabel(returned.periodIndex)} was returned for correction. Correct and resubmit it before filing another month.`,
      mprId: String(returned._id),
    };
  } else if (draft) {
    blocker = {
      code: 'DRAFT_PENDING',
      message: `The report for ${periodLabel(draft.periodIndex)} is still a draft. Submit or discard it before filing another month.`,
      mprId: String(draft._id),
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

/**
 * Apply this month's entries to the form and enforce every limit: physical
 * progress against the approved DPR target, expenditure against the sanctioned
 * financial allocation. Progress beyond a target needs an approved revision.
 */
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

  return form.activities.map((activity) => {
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
        `${name}: Progress cannot exceed the approved target without an approved target revision. Remaining target: ${trimNumber(fromPhysical(remaining))}${activity.unit ? ` ${activity.unit.replace(/\.$/, '')}` : ''}.`,
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
        `${name}: Expenditure cannot exceed the sanctioned financial allocation without an approved revision. Remaining: ${lakh(remaining)}.`,
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
  financialYear: project.financialYear || '',
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
  project: { id: String(mpr.project?._id || mpr.project), code: mpr.projectCode, sanctionId: mpr.sanctionCode || null, projectName: mpr.projectTitle },
  district: mpr.district,
  location: { block: mpr.location?.block || '', gramPanchayat: mpr.location?.gramPanchayat || '', village: mpr.location?.village || '' },
  departmentId: String(mpr.departmentId),
  departmentName: mpr.departmentName,
  pia: mpr.pia?.name ? { name: mpr.pia.name } : null,
  head: mpr.head,
  formType: mpr.formType,
  entryMode: mpr.entryMode || MPR_ENTRY_MODE.PIA,
  financialYear: mpr.financialYear,
  reportingMonth: mpr.reportingMonth,
  period: periodLabel(mpr.periodIndex),
  status: mpr.status,
  statusLabel: statusLabel(mpr.status),
  awaiting: stageOwner(mpr.status),
  stageEnteredAt: mpr.stageEnteredAt || mpr.updatedAt || null,
  totals: mpr.totals,
  submittedBy: mpr.submittedBy?.name ? { name: mpr.submittedBy.name } : null,
  submittedAt: mpr.submittedAt,
  reviewedAt: mpr.reviewedAt,
  verifiedAt: mpr.verifiedAt || null,
  evidenceCount: (mpr.evidence || []).length,
  returnReason: mpr.returnReason || null,
  returnedByLevel: mpr.returnedByLevel || null,
  returnedByRole: mpr.returnedByRole || null,
  rejectionReason: mpr.rejectionReason || null,
});

const history = (user, { status, action, level, note }) => ({
  status,
  action,
  level,
  role: actorLabel(user),
  designation: designationOf(user),
  changedBy: user._id,
  changedAt: new Date(),
  note,
});

// ─── Maker: workload, context, form ──────────────────────────────────────────

/** Projects (and only the departments) this Maker reports on. */
export const getWorkload = async (user) => {
  const filter = user.role === USER_ROLES.DD_LEVEL
    ? { district: user.district, 'departmentAllocations.districtStaffUserId': user._id }
    : { 'departmentAllocations.piaUserId': user._id };
  const projects = await ProjectSanction.find(filter)
    .select('projectId sanctionId projectTitle district location head status financialYear departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt departmentAllocations.reportingMode departmentAllocations.districtStaffUserId departmentAllocations.completion closure')
    .sort({ updatedAt: -1 })
    .lean();

  return projects.filter((project) => project.closure?.status !== 'CLOSED').map((project) => ({
    ...projectDto(project),
    head: headDto(project),
    departments: reportingDepartments(project, user).map((department) => ({
      departmentId: String(department.departmentId),
      name: department.departmentName,
      reportingMode: modeOf(department),
      accepted: reportingReady(project, department),
      completionFiled: ['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status),
    })).filter((department) => !department.completionFiled),
  })).filter((project) => project.departments.some((department) => department.accepted));
};

const MONTH_REASON = {
  [S.RETURNED_FOR_CORRECTION]: 'Returned — correct and resubmit',
  [S.DRAFT]: 'Draft saved — continue it',
};

/** Financial years and months that can be chosen for a department, with what is already filed. */
export const getContext = async (projectId, departmentId, user) => {
  const project = await findProject(projectId);
  const mine = reportingDepartments(project, user);
  if (!mine.length) throw forbidden('You do not hold the reporting responsibility for this project.');

  const departments = mine.map((department) => ({
    departmentId: String(department.departmentId),
    name: department.departmentName,
    reportingMode: modeOf(department),
    accepted: reportingReady(project, department),
  }));

  const selected = isValidId(departmentId) || mine.length === 1 ? authorizeReporting(project, user, departmentId) : null;
  const chain = selected ? await loadChain(project._id, selected.departmentId) : [];
  const filed = new Map(chain.map((mpr) => [mpr.periodIndex, mpr]));
  const latestFiled = chain.length ? chain[chain.length - 1].periodIndex : null;
  const pending = chain.find((mpr) => WITH_MAKER.includes(mpr.status));

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
      else if (existing) reason = MONTH_REASON[existing.status] || 'Already submitted';
      else if (pending) reason = pending.status === S.DRAFT ? 'Finish the saved draft first' : 'Resubmit the returned report first';
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
  reportingMode: modeOf(department),
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
  return { ...formResponse(project, department, period, form, rows), remarks: clean(body.remarks, 1000) };
};

/** A report the Maker may still change: a draft, or one returned for correction. */
const loadEditable = async (mprId, user, session) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  const query = ProjectMPR.findById(mprId);
  const mpr = await (session ? query.session(session) : query);
  if (!mpr) throw notFound('Report not found.');
  const project = await findProject(String(mpr.project), session);
  const department = authorizeReporting(project, user, String(mpr.departmentId));
  if (modeOf(department) !== (mpr.entryMode || MPR_ENTRY_MODE.PIA)) {
    throw conflict('The reporting responsibility of this department has changed since the report was made.', 'MODE_CHANGED');
  }
  if (!WITH_MAKER.includes(mpr.status)) throw conflict('Only a draft or a report returned for correction can be edited.', 'NOT_EDITABLE');
  return { mpr, project, department };
};

/** The editing form for a draft or a returned report: same rules, pre-filled with what was saved. */
export const getEditForm = async (mprId, user) => {
  const { mpr, project, department } = await loadEditable(mprId, user);
  const period = { financialYear: mpr.financialYear, fyStartYear: mpr.fyStartYear, reportingMonth: mpr.reportingMonth, periodIndex: mpr.periodIndex };
  const [chain, masterByCode] = await Promise.all([loadChain(project._id, department.departmentId), loadHeadActivities(project)]);
  const form = buildForm(project, department, masterByCode, chain, period, { excludeId: mpr._id });
  return {
    ...formResponse(project, department, period, form),
    mprId: String(mpr._id),
    mprNo: mpr.mprNo,
    status: mpr.status,
    returnReason: mpr.status === S.RETURNED_FOR_CORRECTION ? mpr.returnReason || '' : '',
    returnedByRole: mpr.status === S.RETURNED_FOR_CORRECTION ? mpr.returnedByRole || null : null,
    remarks: mpr.remarks || '',
    entries: (mpr.activities || []).map((a) => ({ activityCode: a.activityCode, physicalCurrent: a.physicalCurrent, financialCurrentLakh: a.financialCurrentLakh })),
  };
};

/** Preview of an edit. Writes nothing. */
export const previewEdit = async (mprId, body = {}, user) => {
  const base = await getEditForm(mprId, user);
  if (base.blocker) throw conflict(base.blocker.message, base.blocker.code);
  const rows = applyEntries({ activities: base.activities }, body.entries, base.department.name);
  return { ...base, activities: rows, totals: summarize(rows), remarks: clean(body.remarks, 1000) };
};

// ─── Create / save / submit ──────────────────────────────────────────────────

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

/** The status a Maker's submission goes to, and the steps it already counts as taken. */
const submission = (entryMode, user, now) => {
  const status = firstStageOf(entryMode);
  // District Technical Staff is the District Maker: the "receive at district" step is theirs.
  const steps = entryMode === MPR_ENTRY_MODE.DISTRICT ? { districtMaker: { by: user._id, at: now, note: 'Entered by District Technical Staff' } } : {};
  return { status, steps };
};

const submitNote = (entryMode) => (entryMode === MPR_ENTRY_MODE.DISTRICT
  ? 'Entered by District Technical Staff and submitted to the District Checker'
  : 'Submitted to the PIA Checker');

const MAX_ATTEMPTS = 4;
const RETRY = Symbol('retry');

/**
 * Save a new report, as a draft or submitted to the first reviewer. Re-validates
 * everything inside one transaction and claims the project's report version, so
 * two reports for the same project cannot be validated against the same
 * "previous progress" and both be saved. The unique index is the final guard
 * against a second report for the same month.
 */
export const submitMpr = async (body = {}, user) => {
  const asDraft = body.asDraft === true || body.asDraft === 'true';
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
        const entryMode = modeOf(department);
        const pia = department.piaUserId ? await User.findById(department.piaUserId).select('name').lean() : null;
        const { status, steps } = asDraft ? { status: S.DRAFT, steps: {} } : submission(entryMode, user, now);
        const mprNo = await nextMprNumber(project, session);
        try {
          const [created] = await ProjectMPR.create([{
            mprNo,
            project: project._id,
            projectCode: project.projectId || project.sanctionId || '',
            sanctionCode: project.sanctionId || '',
            projectTitle: project.projectTitle,
            district: project.district,
            location: { block: project.location?.block || '', gramPanchayat: project.location?.gramPanchayat || '', village: project.location?.village || '' },
            departmentId: department.departmentId,
            departmentName: department.departmentName,
            pia: pia ? { userId: pia._id, name: pia.name } : undefined,
            head: { headId: project.head.headId, code: project.head.code, name: project.head.name },
            formType: formTypeFor(project.head.code),
            entryMode,
            financialYear: period.financialYear,
            fyStartYear: period.fyStartYear,
            reportingMonth: period.reportingMonth,
            periodIndex: period.periodIndex,
            status,
            stageEnteredAt: now,
            steps,
            activities: rows,
            totals: summarize(rows),
            remarks: clean(body.remarks, 1000),
            submittedBy: user._id,
            submittedAt: asDraft ? undefined : now,
            revisionHistory: [history(user, {
              status,
              action: asDraft ? 'DRAFT_SAVED' : 'SUBMITTED',
              level: entryMode === MPR_ENTRY_MODE.DISTRICT ? 'DISTRICT' : 'PIA',
              note: asDraft ? 'Saved as draft' : submitNote(entryMode),
            })],
          }], options);
          return created;
        } catch (err) {
          if (err?.code === 11000 && /one_live_report_per_month|reportingMonth/.test(err.message || '')) {
            throw conflict(`A progress report for ${periodLabel(period.periodIndex)} already exists for ${department.departmentName}.`, 'DUPLICATE');
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

/**
 * Save changes to a draft or a returned report. With `asDraft` the report
 * stays with the Maker; otherwise it is (re)submitted to the first reviewer of
 * its chain — a returned report goes through the whole chain again.
 */
export const saveMpr = async (mprId, body = {}, user) => {
  const asDraft = body.asDraft === true || body.asDraft === 'true';
  return runInTransaction(async (session) => {
    const options = session ? { session } : {};
    const { mpr, project, department } = await loadEditable(mprId, user, session);
    const period = { financialYear: mpr.financialYear, fyStartYear: mpr.fyStartYear, reportingMonth: mpr.reportingMonth, periodIndex: mpr.periodIndex };
    const [chain, masterByCode] = await Promise.all([
      loadChain(project._id, department.departmentId, session),
      loadHeadActivities(project, session),
    ]);
    const form = buildForm(project, department, masterByCode, chain, period, { excludeId: mpr._id });
    if (form.blocker) throw conflict(form.blocker.message, form.blocker.code);
    const rows = applyEntries(form, body.entries, department.departmentName);

    const now = new Date();
    const wasReturned = mpr.status === S.RETURNED_FOR_CORRECTION;
    mpr.activities = rows;
    mpr.totals = summarize(rows);
    mpr.remarks = clean(body.remarks, 1000);
    const level = mpr.entryMode === MPR_ENTRY_MODE.DISTRICT ? 'DISTRICT' : 'PIA';
    if (asDraft) {
      mpr.revisionHistory.push(history(user, { status: mpr.status, action: 'DRAFT_SAVED', level, note: wasReturned ? 'Correction saved, not yet resubmitted' : 'Draft updated' }));
    } else {
      const { status, steps } = submission(mpr.entryMode, user, now);
      mpr.status = status;
      mpr.steps = steps;
      mpr.stageEnteredAt = now;
      mpr.submittedBy = user._id;
      mpr.submittedAt = now;
      mpr.revisionHistory.push(history(user, {
        status,
        action: wasReturned ? 'RESUBMITTED' : 'SUBMITTED',
        level,
        note: wasReturned ? `Corrected and resubmitted. ${submitNote(mpr.entryMode)}` : submitNote(mpr.entryMode),
      }));
    }
    await mpr.save(options);
    return mpr;
  });
};

/** Discard a draft that was never submitted. */
export const deleteDraft = async (mprId, user) => {
  const { mpr } = await loadEditable(mprId, user);
  if (mpr.status !== S.DRAFT) throw conflict('Only a draft can be discarded. A submitted report stays on record.', 'NOT_DRAFT');
  const removed = await ProjectMPR.deleteOne({ _id: mpr._id, status: S.DRAFT });
  if (removed.deletedCount !== 1) throw conflict('The draft changed while it was being discarded. Please reload.', 'STALE');
  (mpr.evidence || []).forEach((item) => { if (item.publicId) deleteFile(item.publicId); });
  return { id: String(mpr._id), mprNo: mpr.mprNo, period: periodLabel(mpr.periodIndex), departmentName: mpr.departmentName };
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

const departmentPattern = (name) => new RegExp(`^\\s*${escapeRegex(String(name).trim())}\\s*$`, 'i');

/**
 * Reports of a PIA user. The Maker sees the departments it reports on (plus
 * anything it filed); the Checker and Approver see their department's reports
 * in their district. Drafts are private to their Maker.
 */
export const listMine = async (user, { status, page, limit } = {}) => {
  let scope;
  if (workflowRoleOf(user) === WORKFLOW_ROLES.MAKER) {
    const projects = await ProjectSanction.find(user.role === USER_ROLES.DD_LEVEL
      ? { 'departmentAllocations.districtStaffUserId': user._id }
      : { 'departmentAllocations.piaUserId': user._id })
      .select('district status departmentAllocations.departmentId departmentAllocations.piaUserId departmentAllocations.districtStaffUserId departmentAllocations.reportingMode').lean();
    const assigned = projects.flatMap((project) => reportingDepartments(project, user)
      .map((department) => ({ project: project._id, departmentId: department.departmentId, status: { $ne: S.DRAFT } })));
    scope = { $or: [{ submittedBy: user._id }, ...assigned] };
  } else {
    if (!user.district || !user.department) return { data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } };
    scope = { district: user.district, departmentName: departmentPattern(user.department), status: { $ne: S.DRAFT } };
  }
  const wanted = statusQuery(status);
  return paginateList(wanted.status ? { $and: [scope, wanted] } : scope, page, limit);
};

export const listForDistrict = async (user, { status, page, limit } = {}) => {
  if (!user.district) throw bad('District not set for user');
  const wanted = statusQuery(status);
  // A district sees every report of its district except other people's drafts.
  const scope = { district: user.district, $or: [{ status: { $ne: S.DRAFT } }, { submittedBy: user._id }] };
  return paginateList(wanted.status ? { $and: [scope, wanted] } : scope, page, limit);
};

/** Reports waiting for the signed-in user's own action, oldest first. */
export const listQueue = async (user, { limit } = {}) => {
  const filter = queueFilterFor(user);
  if (!filter) return { data: [], total: 0 };
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
  const [items, total] = await Promise.all([
    ProjectMPR.find(filter).select('-activities -revisionHistory').populate('submittedBy', 'name')
      .sort({ stageEnteredAt: 1, submittedAt: 1 }).limit(safeLimit).lean(),
    ProjectMPR.countDocuments(filter),
  ]);
  return { data: items.map(listDto), total };
};

/**
 * Every project MPR in the State, for HQ and the M&E administrator.
 * Filters: status (status or group), financialYear ("2026-27"), district, headCode,
 * entryMode, search (report number, project ID or name, department).
 */
export const listAll = async ({ status, financialYear, district, headCode, entryMode, search, page, limit } = {}) => {
  const filter = { status: { $ne: S.DRAFT } };
  if (typeof financialYear === 'string' && FY_LABEL.test(financialYear.trim())) filter.financialYear = financialYear.trim();
  if (typeof district === 'string' && district.trim()) filter.district = district.trim();
  if (typeof headCode === 'string' && headCode.trim()) filter['head.code'] = headCode.trim();
  if (Object.values(MPR_ENTRY_MODE).includes(entryMode)) filter.entryMode = entryMode === MPR_ENTRY_MODE.PIA ? { $ne: MPR_ENTRY_MODE.DISTRICT } : entryMode;
  if (typeof search === 'string' && search.trim()) {
    const term = new RegExp(escapeRegex(search.trim().slice(0, 60)), 'i');
    filter.$or = [{ mprNo: term }, { projectCode: term }, { projectTitle: term }, { departmentName: term }];
  }
  const wanted = statusQuery(status);
  const result = await paginateList(wanted.status ? { ...filter, $and: [{ status: wanted.status }, { status: { $ne: S.DRAFT } }] } : filter, page, limit);

  // Counts per status for the same scope (ignoring the status filter), for the summary strip.
  const grouped = await ProjectMPR.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 }, spent: { $sum: '$totals.financialCurrentLakh' } } }]);
  const counts = Object.fromEntries(Object.values(S).filter((key) => key !== S.DRAFT).map((key) => [key, 0]));
  let spentLakh = 0;
  grouped.forEach((row) => { counts[row._id] = row.count; if (row._id !== S.REJECTED) spentLakh += Math.round((row.spent || 0) * MONEY_SCALE); });
  return { ...result, summary: { counts, total: grouped.reduce((sum, row) => sum + row.count, 0), spentLakh: fromMoney(spentLakh) } };
};

export const listForProject = async (projectId, user) => {
  const project = await findProject(projectId);
  if (!canReadProject(project, user)) throw forbidden('You do not have access to this project.');
  const filter = { project: project._id, $or: [{ status: { $ne: S.DRAFT } }, { submittedBy: user._id }] };
  // A PIA user sees only its own departments' reports.
  if (user.role === USER_ROLES.PIA_OFFICER) filter.departmentId = { $in: piaDepartmentsOf(project, user).map((d) => d.departmentId) };
  const items = await ProjectMPR.find(filter).select('-activities -revisionHistory').populate('submittedBy', 'name')
    .sort({ periodIndex: -1, departmentName: 1 }).limit(500).lean();
  return items.map(listDto);
};

/** Evidence can be changed by the Maker until the first reviewer has acted on the report. */
export const evidenceEditable = (mpr) => [S.DRAFT, S.RETURNED_FOR_CORRECTION, firstStageOf(mpr.entryMode)].includes(mpr.status);

export const getMpr = async (mprId, user) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  const mpr = await ProjectMPR.findById(mprId)
    .populate('submittedBy', 'name email designation')
    .populate('reviewedBy', 'name')
    .populate('verifiedBy', 'name')
    .populate('revisionHistory.changedBy', 'name role')
    .lean();
  if (!mpr) throw notFound('Report not found.');
  const project = await findProject(String(mpr.project));
  if (!canReadReport(project, mpr, user)) throw forbidden('You do not have access to this report.');
  if (mpr.status === S.DRAFT && !sameId(mpr.submittedBy, user._id)) throw forbidden('This report is still a draft of its Maker.');

  const chain = await loadChain(project._id, mpr.departmentId);
  const isLatest = !chain.some((item) => item.periodIndex > mpr.periodIndex);
  const maker = isReportingMaker(project, mpr, user);
  const stage = REVIEW_STAGES[mpr.status];
  const mayAct = Boolean(stage) && canActOnStage(user, mpr);
  const closed = project.closure?.status === 'CLOSED';

  // Names of everyone who took a step, for the chain display.
  const stepUserIds = Object.values(mpr.steps || {}).map((step) => step?.by).filter(Boolean);
  const people = stepUserIds.length ? await User.find({ _id: { $in: stepUserIds } }).select('name').lean() : [];
  const nameById = new Map(people.map((person) => [String(person._id), person.name]));
  nameById.set(String(mpr.submittedBy?._id || mpr.submittedBy), mpr.submittedBy?.name || '');

  // Month-by-month series for this department (for the trend) and neighbours for navigation.
  const series = chain.filter((item) => item.status !== S.DRAFT || String(item._id) === String(mpr._id)).map((item) => ({
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
  const position = series.findIndex((item) => item.current);
  const previous = position > 0 ? series[position - 1] : null;
  const next = position >= 0 && position < series.length - 1 ? series[position + 1] : null;

  // Expenditure against the department's sanctioned allocation.
  const department = (project.departmentAllocations || []).find((item) => String(item.departmentId) === String(mpr.departmentId));
  const spentUnits = toMoney(mpr.totals?.financialTotalLakh);
  const budgetUnits = toMoney(department?.totalLakh);

  const laterBlock = 'A later month has already been filed for this department, so this report can no longer be returned or rejected.';
  return {
    ...listDto(mpr),
    project: projectDto(project),
    submittedBy: mpr.submittedBy ? { name: mpr.submittedBy.name, email: mpr.submittedBy.email, designation: mpr.submittedBy.designation || '' } : null,
    reviewedBy: mpr.reviewedBy ? { name: mpr.reviewedBy.name } : null,
    reviewNote: mpr.reviewNote || null,
    verifiedBy: mpr.verifiedBy ? { name: mpr.verifiedBy.name } : null,
    remarks: mpr.remarks || '',
    evidence: (mpr.evidence || []).map((item) => ({
      id: String(item._id), url: item.url, name: item.name || 'File', mimeType: item.mimeType || null, isImage: /^image\//.test(item.mimeType || ''),
      size: item.size || null, caption: item.caption || '', uploadedAt: item.uploadedAt || null,
    })),
    evidenceLimit: 6,
    activities: mpr.activities,
    chain: chainOf(mpr, (id) => nameById.get(String(id)) || null),
    revisionHistory: (mpr.revisionHistory || []).map((step) => ({
      status: step.status, statusLabel: statusLabel(step.status), action: step.action || null, level: step.level || null,
      role: step.role || null, designation: step.designation || null, note: step.note, changedAt: step.changedAt, changedBy: step.changedBy?.name || null,
    })),
    verifiedAt: mpr.verifiedAt || null,
    verificationNote: mpr.verificationNote || null,
    returnedAt: mpr.returnedAt || null,
    rejectedAt: mpr.rejectedAt || null,
    rejectedByRole: mpr.rejectedByRole || null,
    series,
    navigation: {
      previous: previous ? { id: previous.id, period: previous.period } : null,
      next: next ? { id: next.id, period: next.period } : null,
    },
    funds: {
      departmentBudgetLakh: fromMoney(budgetUnits),
      spentLakh: fromMoney(spentUnits),
      balanceLakh: fromMoney(Math.max(0, budgetUnits - spentUnits)),
      utilisationPercent: percent(spentUnits, budgetUnits),
    },
    permissions: {
      // The review step this user may take now, and how it is called.
      canForward: mayAct && !closed,
      forwardLabel: stage ? stage.verb : null,
      awaiting: stage ? stageOwner(mpr.status) : null,
      // Returning or rejecting an older report would invalidate the "previous progress" of the ones after it.
      canReturn: mayAct && !closed && isLatest,
      canReject: mayAct && !closed && isLatest && Boolean(stage?.canReject),
      returnBlockedReason: mayAct && !isLatest ? laterBlock : null,
      canEdit: maker && WITH_MAKER.includes(mpr.status) && !closed,
      canDelete: maker && mpr.status === S.DRAFT,
      canManageEvidence: maker && evidenceEditable(mpr) && !closed,
    },
  };
};

// ─── Review chain ────────────────────────────────────────────────────────────

const loadForReview = async (mprId, user, session) => {
  if (!isValidId(mprId)) throw notFound('Report not found.');
  const query = ProjectMPR.findById(mprId);
  const mpr = await (session ? query.session(session) : query);
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
  if (!canActOnStage(user, mpr)) {
    throw forbidden(`This report is waiting for the ${stageOwner(mpr.status)}${stage.tier !== TIERS.HQ ? ` of ${mpr.district}${stage.tier === TIERS.PIA ? ` (${mpr.departmentName})` : ''}` : ''}. You cannot act on it${sameId(mpr.submittedBy, user._id) ? ': a Maker cannot review their own report' : ''}.`);
  }
  return { mpr, stage };
};

/** Take the current review step: verify / approve, and send the report to the next level. */
export const forwardMpr = async (mprId, note, user) => {
  const { mpr, stage } = await loadForReview(mprId, user);
  const project = await findProject(String(mpr.project));
  if (project.closure?.status === 'CLOSED') throw conflict('This project is closed.', 'PROJECT_CLOSED');
  const text = clean(note, 1000);
  const now = new Date();
  const set = {
    status: stage.next,
    stageEnteredAt: now,
    [`steps.${stage.step}`]: { by: user._id, at: now, note: text },
  };
  if (stage.step === 'districtApprover') Object.assign(set, { reviewedBy: user._id, reviewedAt: now, reviewNote: text });
  if (stage.step === 'hqApprover') Object.assign(set, { verifiedBy: user._id, verifiedAt: now, verificationNote: text });

  // Conditional update: two reviewers clicking at once cannot both act.
  const updated = await ProjectMPR.findOneAndUpdate(
    { _id: mpr._id, status: mpr.status },
    { $set: set, $push: { revisionHistory: history(user, { status: stage.next, action: 'FORWARDED', level: stage.level, note: text ? `${stage.done}. ${text}` : stage.done }) } },
    { new: true },
  );
  if (!updated) throw conflict('This report has already moved on. Please reload.', 'STALE');
  return { mpr: updated, from: mpr.status };
};

/** Checks shared by return and reject: only the latest month, and not after the completion report. */
const assertReversible = async (mpr, session) => {
  const laterQuery = ProjectMPR.exists({ project: mpr.project, departmentId: mpr.departmentId, periodIndex: { $gt: mpr.periodIndex }, status: { $ne: S.REJECTED } });
  if (await (session ? laterQuery.session(session) : laterQuery)) {
    throw conflict('A later month has already been filed for this department, so this report can no longer be returned or rejected.', 'LATER_REPORT_EXISTS');
  }
  const owner = await findProject(String(mpr.project), session);
  if (owner.closure?.status === 'CLOSED') throw conflict('This project is closed. Its reports can no longer be returned.', 'PROJECT_CLOSED');
  const department = (owner.departmentAllocations || []).find((item) => String(item.departmentId) === String(mpr.departmentId));
  if (['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department?.completion?.status)) {
    throw conflict('The completion report of this department has been filed. The district must return the completion report first.', 'COMPLETION_FILED');
  }
};

/** Return the report to its reporting Maker with mandatory remarks. It then goes through its whole chain again. */
export const returnMpr = async (mprId, reason, user) => {
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Write the remarks for the Maker (at least 5 characters). They are required to return a report.');
  return runInTransaction(async (session) => {
    const { mpr, stage } = await loadForReview(mprId, user, session);
    await assertReversible(mpr, session);
    const now = new Date();
    const role = actorLabel(user);
    mpr.status = S.RETURNED_FOR_CORRECTION;
    mpr.stageEnteredAt = now;
    mpr.returnReason = text;
    mpr.returnedByLevel = stage.level;
    mpr.returnedByRole = role;
    mpr.returnedBy = user._id;
    mpr.returnedAt = now;
    mpr.steps = {};
    mpr.reviewedBy = undefined;
    mpr.reviewedAt = undefined;
    mpr.reviewNote = undefined;
    mpr.revisionHistory.push(history(user, { status: S.RETURNED_FOR_CORRECTION, action: 'RETURNED', level: stage.level, note: `Returned by ${role}: ${text}` }));
    await mpr.save(session ? { session } : {});
    return mpr;
  });
};

/** An Approver rejects the report with a recorded reason. The report is void and the month can be reported afresh. */
export const rejectMpr = async (mprId, reason, user) => {
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Write the reason for rejection (at least 5 characters).');
  return runInTransaction(async (session) => {
    const { mpr, stage } = await loadForReview(mprId, user, session);
    if (!stage.canReject) throw forbidden(`The ${stageOwner(mpr.status)} can return this report for correction but cannot reject it. Only an Approver can reject.`);
    await assertReversible(mpr, session);
    const now = new Date();
    const role = actorLabel(user);
    mpr.status = S.REJECTED;
    mpr.stageEnteredAt = now;
    mpr.rejectionReason = text;
    mpr.rejectedBy = user._id;
    mpr.rejectedAt = now;
    mpr.rejectedByRole = role;
    mpr.rejectedKey = String(mpr._id);
    mpr.revisionHistory.push(history(user, { status: S.REJECTED, action: 'REJECTED', level: stage.level, note: `Rejected by ${role}: ${text}` }));
    await mpr.save(session ? { session } : {});
    return mpr;
  });
};

/** Reports of a project that are in review (used by project lists and detail). */
export const countAwaitingReview = (projectId) => ProjectMPR.countDocuments({ project: projectId, status: { $in: IN_REVIEW } });

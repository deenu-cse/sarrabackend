import ProjectSanction, { REPORTING_MODE } from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import ProjectRevision from '../models/ProjectRevision.model.js';
import User from '../models/User.model.js';
import { ProjectCompletion, ProjectOutcome, COMPLETION_STATUS } from '../models/ProjectLifecycle.model.js';
import { collectDeadlines, getSettings } from './monitoring.service.js';
import { getHomeDashboard } from './homeDashboard.service.js';
import { reportingMakerOf } from './projectMpr.service.js';
import { IN_REVIEW, queueFilterFor, stageOwner, statusLabel } from './mprWorkflow.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import USER_ROLES, { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { actorLabel, sameId, sameText, workflowRoleOf } from '../utils/access.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

/**
 * Home page of each tier and workflow role.
 *
 * Every user gets a different answer to the same three questions: what needs
 * my action now, how is my work doing, and what happened recently. All
 * figures are calculated here for exactly what the user is allowed to see.
 */

const { MAKER, CHECKER, APPROVER } = WORKFLOW_ROLES;
const MONEY = 100000;
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY);
const fromMoney = (units) => units / MONEY;
const percent = (part, whole) => (whole > 0 ? Math.min(100, Math.floor((part * 1000) / whole) / 10) : 0);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodLabel = (period) => `${FULL_MONTHS[period % 12]} ${Math.floor(period / 12)}`;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysSince = (value) => Math.max(0, Math.floor((Date.now() - new Date(value || Date.now()).getTime()) / 86400000));

const S = SANCTION_STATUS;
const R = PROJECT_MPR_STATUS;
const SANCTIONED_ON = [S.SANCTIONED, S.FORWARDED_TO_DISTRICT, S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA, S.PIA_ACCEPTED];
const isClosed = (project) => project.closure?.status === 'CLOSED';
const codeOf = (project) => project.projectId || project.sanctionId || '';
const filed = (department) => ['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status);
const counted = (report) => report.status !== R.DRAFT && report.status !== R.REJECTED;
const ready = (department) => (department.reportingMode === REPORTING_MODE.DISTRICT ? Boolean(department.districtStaffUserId) : Boolean(department.piaAcceptedAt));

const PROJECT_FIELDS = 'projectId sanctionId projectTitle district status closure head totalSanctionedBudgetLakh rejectionReason makerUserId updatedAt createdAt '
  + 'departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.totalLakh departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt '
  + 'departmentAllocations.reportingMode departmentAllocations.districtStaffUserId departmentAllocations.completion';
const REPORT_FIELDS = 'mprNo project projectCode projectTitle district departmentId departmentName periodIndex reportingMonth financialYear status entryMode stageEnteredAt totals.financialCurrentLakh totals.financialTotalLakh totals.physicalPercent totals.financialPercent submittedAt submittedBy reviewedAt updatedAt returnedByRole';

/** Projects and their reports for a scope, loaded once. */
const load = async (projectFilter = {}) => {
  const projects = await ProjectSanction.find(projectFilter).select(PROJECT_FIELDS).sort({ updatedAt: -1 }).lean();
  const ids = projects.map((project) => project._id);
  const reports = ids.length ? await ProjectMPR.find({ project: { $in: ids }, status: { $ne: R.REJECTED } }).select(REPORT_FIELDS).sort({ periodIndex: 1 }).lean() : [];
  return { projects, reports };
};

const sumMoney = (list, pick) => list.reduce((total, item) => total + toMoney(pick(item)), 0);

/** Sanctioned, spent and balance for a set of projects (drafts are not counted). */
const moneyOf = (projects, reports) => {
  const ids = new Set(projects.map((project) => String(project._id)));
  const sanctioned = sumMoney(projects, (p) => p.totalSanctionedBudgetLakh);
  const spent = sumMoney(reports.filter((r) => counted(r) && ids.has(String(r.project))), (r) => r.totals?.financialCurrentLakh);
  return {
    sanctionedLakh: fromMoney(sanctioned),
    spentLakh: fromMoney(spent),
    balanceLakh: fromMoney(Math.max(0, sanctioned - spent)),
    financialPercent: percent(spent, sanctioned),
  };
};

/** Average physical progress: the latest counted report of every reporting department. */
const physicalOf = (projects, reports) => {
  const latest = new Map();
  const ids = new Set(projects.map((project) => String(project._id)));
  reports.filter((r) => counted(r) && ids.has(String(r.project))).forEach((r) => latest.set(`${r.project}|${r.departmentId}`, r.totals?.physicalPercent || 0));
  const values = [...latest.values()];
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;
};

/** Expenditure reported and reports verified in each of the last six months. */
const trendOf = (reports, now = new Date()) => {
  const clock = new Date(now.getTime() + 330 * 60000);
  const current = clock.getUTCFullYear() * 12 + clock.getUTCMonth();
  return Array.from({ length: 6 }, (_, index) => current - 5 + index).map((period) => {
    const ofMonth = reports.filter((r) => counted(r) && r.periodIndex === period);
    return {
      label: `${MONTHS[period % 12]} ${String(Math.floor(period / 12)).slice(2)}`,
      spentLakh: fromMoney(sumMoney(ofMonth, (r) => r.totals?.financialCurrentLakh)),
      reports: ofMonth.length,
      verified: ofMonth.filter((r) => r.status === R.VERIFIED_BY_STATE).length,
    };
  });
};

/** How many reports are waiting at each review stage. */
const pendingByStage = (reports) => IN_REVIEW.map((status) => {
  const waiting = reports.filter((r) => r.status === status);
  return { status, label: statusLabel(status), owner: stageOwner(status), count: waiting.length, oldestDays: waiting.reduce((max, r) => Math.max(max, daysSince(r.stageEnteredAt || r.updatedAt)), 0) };
});

const deadlineHeader = (dl, settings) => ({
  label: periodLabel(dl.period),
  dueDate: isoDay(dl.due),
  nextLabel: periodLabel(dl.currentPeriod),
  nextDueDate: isoDay(Date.UTC(Math.floor((dl.currentPeriod + 1) / 12), (dl.currentPeriod + 1) % 12, settings.deadlines.mprDueDay)),
});

const reportRow = (report, href) => ({
  id: String(report._id),
  mprNo: report.mprNo,
  period: periodLabel(report.periodIndex),
  projectCode: report.projectCode,
  projectName: report.projectTitle,
  district: report.district,
  department: report.departmentName,
  status: report.status,
  statusLabel: statusLabel(report.status),
  awaiting: stageOwner(report.status),
  entryMode: report.entryMode || 'PIA',
  spentLakh: report.totals?.financialCurrentLakh || 0,
  submittedAt: report.submittedAt,
  daysWaiting: daysSince(report.stageEnteredAt || report.updatedAt),
  href: href ? href(String(report._id)) : null,
});

const task = (key, tone, count, title, detail, href, cta) => ({ key, tone, count, title, detail, href, cta });

/** Reports waiting for this user's own review step, oldest first. */
const myQueue = async (user) => {
  const filter = queueFilterFor(user);
  if (!filter) return [];
  return ProjectMPR.find(filter).select(REPORT_FIELDS).sort({ stageEnteredAt: 1, submittedAt: 1 }).limit(200).lean();
};

const queueTask = (queue, href, listHref) => queue.length && task(
  'mpr-queue',
  queue.some((r) => daysSince(r.stageEnteredAt || r.updatedAt) > 5) ? 'danger' : 'warning',
  queue.length,
  `${plural(queue.length, 'monthly report')} awaiting your action`,
  `Oldest has waited ${plural(daysSince(queue[0].stageEnteredAt || queue[0].updatedAt), 'day')}: ${queue[0].mprNo} (${queue[0].departmentName}, ${queue[0].projectCode}).`,
  queue.length === 1 ? href(String(queue[0]._id)) : listHref,
  'Review',
);

// ─── PIA ─────────────────────────────────────────────────────────────────────

const piaHome = async (user) => {
  const settings = await getSettings();
  const role = workflowRoleOf(user);
  const maker = role === MAKER;
  const reportHref = (id) => `/dashboard/officer/mprs/report/${id}`;
  const departmentPattern = new RegExp(`^\\s*${String(user.department || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim()}\\s*$`, 'i');
  const projectFilter = maker
    ? { 'departmentAllocations.piaUserId': user._id }
    : { district: user.district, departmentAllocations: { $elemMatch: { piaUserId: { $exists: true }, departmentName: departmentPattern } } };
  const owns = maker
    ? (department) => sameId(department.piaUserId, user._id)
    : (department) => Boolean(department.piaUserId) && sameText(department.departmentName, user.department);
  const [{ projects, reports }, dl, returnedCompletions, queue] = await Promise.all([
    load(projectFilter),
    collectDeadlines(settings, projectFilter, owns),
    maker ? ProjectCompletion.find({ submittedBy: user._id, status: COMPLETION_STATUS.RETURNED }).select('project projectCode departmentName').lean() : [],
    myQueue(user),
  ]);

  const holdings = [];
  let sanctioned = 0; let spent = 0;
  projects.forEach((project) => (project.departmentAllocations || []).filter(owns).forEach((department) => {
    const mine = reports.filter((r) => counted(r) && sameId(r.project, project._id) && sameId(r.departmentId, department.departmentId));
    const departmentSpent = mine.reduce((sum, r) => sum + toMoney(r.totals?.financialCurrentLakh), 0);
    const departmentSanctioned = toMoney(department.totalLakh);
    const last = mine[mine.length - 1] || null;
    const due = dl.items.find((item) => item.projectId === String(project._id) && item.departmentId === String(department.departmentId)) || null;
    if (!isClosed(project)) { sanctioned += departmentSanctioned; spent += departmentSpent; }
    holdings.push({
      projectId: String(project._id),
      code: codeOf(project),
      name: project.projectTitle || '',
      departmentId: String(department.departmentId),
      department: department.departmentName,
      reportingMode: department.reportingMode || REPORTING_MODE.PIA,
      accepted: Boolean(department.piaAcceptedAt),
      closed: isClosed(project),
      completion: department.completion?.status || null,
      sanctionedLakh: fromMoney(departmentSanctioned),
      spentLakh: fromMoney(departmentSpent),
      balanceLakh: fromMoney(Math.max(0, departmentSanctioned - departmentSpent)),
      physicalPercent: last?.totals?.physicalPercent || 0,
      financialPercent: percent(departmentSpent, departmentSanctioned),
      reports: mine.length,
      lastReport: last ? { id: String(last._id), period: periodLabel(last.periodIndex), status: last.status } : null,
      due: maker && (department.reportingMode || REPORTING_MODE.PIA) === REPORTING_MODE.PIA && due && ['OVERDUE', 'DUE_SOON', 'DUE'].includes(due.state)
        ? { state: due.state, period: due.period, daysOverdue: due.daysOverdue, daysLeft: due.daysLeft, financialYear: due.financialYear, reportingMonth: due.reportingMonth, draftId: due.draft ? due.mprId : null }
        : null,
      href: `/dashboard/officer/projects/${project._id}`,
    });
  }));

  const mineReports = reports.filter((r) => holdings.some((h) => h.projectId === String(r.project) && h.departmentId === String(r.departmentId)) && (maker || r.status !== R.DRAFT));
  const fileHref = (h) => (h.due.draftId ? `/dashboard/officer/forms/new?mprId=${h.due.draftId}` : `/dashboard/officer/forms/new?projectId=${h.projectId}&departmentId=${h.departmentId}&fy=${h.due.financialYear}&month=${h.due.reportingMonth}`);
  const drafts = maker ? mineReports.filter((r) => r.status === R.DRAFT && sameId(r.submittedBy, user._id)) : [];

  const tasks = maker ? [
    ...holdings.filter((h) => !h.accepted && !h.closed).map((h) => task(`accept:${h.projectId}:${h.departmentId}`, 'warning', 1, `Accept ${h.code}`, `${h.department}: you have been assigned as PIA Maker. Accept it to start implementation.`, h.href, 'Open project')),
    ...dl.corrections.map((c) => task(`fix:${c.mprId}`, 'danger', 1, `Correct the ${c.period} report`, `${c.departmentName}, ${c.projectCode}: returned by the ${c.returnedBy} ${plural(c.daysPending, 'day')} ago.`, `/dashboard/officer/mprs/report/${c.mprId}`, 'Open report')),
    ...drafts.map((r) => task(`draft:${r._id}`, 'info', 1, `Submit the ${periodLabel(r.periodIndex)} draft`, `${r.departmentName}, ${r.projectCode}: saved as a draft, not yet sent to the PIA Checker.`, `/dashboard/officer/forms/new?mprId=${r._id}`, 'Continue')),
    ...holdings.filter((h) => h.due?.state === 'OVERDUE').map((h) => task(`overdue:${h.projectId}:${h.departmentId}`, 'danger', 1, `${h.due.period} report is ${plural(h.due.daysOverdue, 'day')} overdue`, `${h.department}, ${h.code}`, fileHref(h), 'File now')),
    ...holdings.filter((h) => h.due && h.due.state !== 'OVERDUE').map((h) => task(`due:${h.projectId}:${h.departmentId}`, 'info', 1, `${h.due.period} report is due${h.due.daysLeft ? ` in ${plural(h.due.daysLeft, 'day')}` : ' today'}`, `${h.department}, ${h.code}`, fileHref(h), 'File report')),
    ...returnedCompletions.map((c) => task(`completion:${c._id}`, 'warning', 1, 'Completion report returned', `${c.departmentName}, ${c.projectCode}: correct it and file it again.`, `/dashboard/officer/projects/${c.project}#closure`, 'Open')),
  ] : [queueTask(queue, reportHref, '/dashboard/officer/mprs?view=queue')].filter(Boolean);

  const count = (statuses) => mineReports.filter((r) => statuses.includes(r.status)).length;
  return {
    role: user.role,
    workflowRole: role,
    roleLabel: actorLabel(user),
    scope: { department: user.department || holdings[0]?.department || '', district: user.district || '' },
    period: deadlineHeader(dl, settings),
    kpis: {
      departments: holdings.filter((h) => !h.closed).length,
      projects: new Set(holdings.filter((h) => !h.closed).map((h) => h.projectId)).size,
      sanctionedLakh: fromMoney(sanctioned),
      spentLakh: fromMoney(spent),
      balanceLakh: fromMoney(Math.max(0, sanctioned - spent)),
      financialPercent: percent(spent, sanctioned),
      reports: mineReports.filter(counted).length,
      drafts: drafts.length,
      inVerification: count(IN_REVIEW),
      verified: count([R.VERIFIED_BY_STATE]),
      returned: count([R.RETURNED_FOR_CORRECTION]),
      myActions: queue.length,
    },
    tasks,
    holdings,
    queue: queue.slice(0, 8).map((r) => reportRow(r, reportHref)),
    recentReports: [...mineReports].sort((a, b) => new Date(b.updatedAt || b.submittedAt) - new Date(a.updatedAt || a.submittedAt)).slice(0, 6).map((r) => reportRow(r, reportHref)),
  };
};

// ─── District SARRA Centre ───────────────────────────────────────────────────

const districtHome = async (user) => {
  if (!user.district) throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Your account has no district.');
  const settings = await getSettings();
  const role = workflowRoleOf(user);
  const reportHref = (id) => `/dashboard/dd/mpr-review/project/${id}`;
  const scope = { district: user.district, status: { $in: [S.FORWARDED_TO_DISTRICT, S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA, S.PIA_ACCEPTED] } };
  const [{ projects, reports }, dl, completions, queue] = await Promise.all([
    load(scope),
    collectDeadlines(settings, { district: user.district }),
    [CHECKER, APPROVER].includes(role) ? ProjectCompletion.find({ district: user.district, status: COMPLETION_STATUS.SUBMITTED }).select('project projectCode departmentName submittedAt').lean() : [],
    myQueue(user),
  ]);
  const visibleReports = reports.filter((r) => r.status !== R.DRAFT || sameId(r.submittedBy, user._id));
  const open = projects.filter((project) => !isClosed(project));
  const officerIds = [...new Set(projects.flatMap((p) => (p.departmentAllocations || []).map((d) => String(reportingMakerOf(d) || '')).filter(Boolean)))];
  const officers = officerIds.length ? await User.find({ _id: { $in: officerIds } }).select('name department role').lean() : [];

  const overdue = dl.items.filter((item) => item.state === 'OVERDUE');
  const expected = dl.items.filter((item) => item.state !== 'SKIPPED');
  const projectHref = (p) => `/dashboard/dd/projects/${p._id}`;
  const many = (list, single, all) => (list.length === 1 ? single(list[0]) : all);

  let tasks = [];
  if (role === MAKER) {
    const toAccept = open.filter((p) => p.status === S.FORWARDED_TO_DISTRICT);
    const toAssign = open.filter((p) => [S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA].includes(p.status) && (p.departmentAllocations || []).some((d) => !d.piaUserId && !d.districtStaffUserId));
    const notAccepted = open.filter((p) => (p.departmentAllocations || []).some((d) => d.piaUserId && !d.piaAcceptedAt && (d.reportingMode || REPORTING_MODE.PIA) === REPORTING_MODE.PIA));
    // As District Technical Staff: departments this user reports on.
    const mineDue = dl.items.filter((item) => item.officerId === String(user._id) && item.reportingMode === REPORTING_MODE.DISTRICT && ['OVERDUE', 'DUE_SOON'].includes(item.state));
    const myCorrections = dl.corrections.filter((c) => c.officer?.id === String(user._id));
    const myDrafts = reports.filter((r) => r.status === R.DRAFT && sameId(r.submittedBy, user._id));
    tasks = [
      queueTask(queue, reportHref, '/dashboard/dd/mpr-review'),
      toAccept.length && task('accept', 'warning', toAccept.length, `${plural(toAccept.length, 'project')} to receive and accept`, `Forwarded by SARRA HQ: ${toAccept.slice(0, 3).map(codeOf).join(', ')}${toAccept.length > 3 ? ' and more' : ''}.`, many(toAccept, projectHref, '/dashboard/dd/projects'), 'Review'),
      toAssign.length && task('assign', 'warning', toAssign.length, `${plural(toAssign.length, 'project')} waiting for PIA assignment`, 'A department has no PIA Maker or reporting responsibility yet, so its progress cannot be reported.', many(toAssign, projectHref, '/dashboard/dd/projects'), 'Assign'),
      ...myCorrections.map((c) => task(`fix:${c.mprId}`, 'danger', 1, `Correct the ${c.period} report`, `${c.departmentName}, ${c.projectCode}: returned by the ${c.returnedBy}.`, reportHref(c.mprId), 'Open report')),
      ...myDrafts.map((r) => task(`draft:${r._id}`, 'info', 1, `Submit the ${periodLabel(r.periodIndex)} draft`, `${r.departmentName}, ${r.projectCode}: district entry, not yet sent to the District Checker.`, `/dashboard/dd/mprs/new?mprId=${r._id}`, 'Continue')),
      mineDue.length && task('due', mineDue.some((item) => item.state === 'OVERDUE') ? 'danger' : 'info', mineDue.length, `${plural(mineDue.length, 'district-entry report')} to file for ${periodLabel(dl.period)}`, mineDue.slice(0, 3).map((item) => `${item.departmentName} (${item.projectCode})`).join(', '), '/dashboard/dd/mprs/new', 'File report'),
      notAccepted.length && task('pending-accept', 'info', notAccepted.length, `${plural(notAccepted.length, 'project')} not yet accepted by the PIA Maker`, 'The assigned PIA Maker has to accept before PIA reporting can start.', '/dashboard/dd/projects', 'View'),
    ];
  } else {
    tasks = [
      queueTask(queue, reportHref, '/dashboard/dd/mpr-review'),
      completions.length && task('completion', 'warning', completions.length, `${plural(completions.length, 'completion report')} to verify`, completions.slice(0, 3).map((c) => `${c.departmentName} (${c.projectCode})`).join(', '), `/dashboard/dd/projects/${completions[0].project}#closure`, 'Verify'),
    ];
  }
  if (overdue.length) tasks.push(task('overdue', 'danger', overdue.length, `${plural(overdue.length, 'report')} overdue for ${periodLabel(dl.period)}`, overdue.slice(0, 3).map((item) => `${item.departmentName} (${item.officer?.name || 'no reporting Maker'})`).join(', '), '/dashboard/dd/deadlines', 'Follow up'));
  tasks = tasks.filter(Boolean);

  const rows = projects.map((project) => {
    const departments = project.departmentAllocations || [];
    const money = moneyOf([project], reports);
    const due = dl.items.filter((item) => item.projectId === String(project._id));
    return {
      id: String(project._id),
      code: codeOf(project),
      name: project.projectTitle || '',
      status: project.status,
      closed: isClosed(project),
      departments: departments.length,
      assigned: departments.filter((d) => d.piaUserId || d.districtStaffUserId).length,
      accepted: departments.filter(ready).length,
      districtEntry: departments.filter((d) => d.reportingMode === REPORTING_MODE.DISTRICT).length,
      ...money,
      physicalPercent: physicalOf([project], reports),
      overdue: due.filter((item) => item.state === 'OVERDUE').length,
      inReview: visibleReports.filter((r) => sameId(r.project, project._id) && IN_REVIEW.includes(r.status)).length,
      href: projectHref(project),
    };
  });

  const officerRows = officers.map((officer) => {
    const held = open.flatMap((p) => (p.departmentAllocations || []).filter((d) => sameId(reportingMakerOf(d), officer._id) && !filed(d)));
    return {
      id: String(officer._id),
      name: officer.name,
      tier: officer.role === USER_ROLES.DD_LEVEL ? 'District Technical Staff' : 'PIA Maker',
      department: officer.department || held[0]?.departmentName || '',
      departments: held.length,
      notAccepted: held.filter((d) => !ready(d)).length,
      overdue: overdue.filter((item) => item.officer?.id === String(officer._id)).length,
      inReview: dl.reviews.filter((review) => review.officer?.id === String(officer._id)).length,
      corrections: dl.corrections.filter((item) => item.officer?.id === String(officer._id)).length,
    };
  }).filter((row) => row.departments > 0).sort((a, b) => b.overdue - a.overdue || b.departments - a.departments);

  return {
    role: user.role,
    workflowRole: role,
    roleLabel: actorLabel(user),
    scope: { district: user.district },
    period: deadlineHeader(dl, settings),
    kpis: {
      projects: projects.length,
      active: open.filter((p) => p.status === S.PIA_ACCEPTED).length,
      closed: projects.length - open.length,
      ...moneyOf(projects, reports),
      physicalPercent: physicalOf(projects, reports),
      expected: expected.length,
      filed: expected.filter((item) => item.state === 'FILED').length,
      overdue: overdue.length,
      inReview: visibleReports.filter((r) => IN_REVIEW.includes(r.status)).length,
      myActions: queue.length,
      returned: visibleReports.filter((r) => r.status === R.RETURNED_FOR_CORRECTION).length,
    },
    tasks,
    projects: rows,
    officers: officerRows,
    pendingByStage: pendingByStage(visibleReports).filter((row) => row.count > 0),
    reviewQueue: queue.slice(0, 8).map((r) => reportRow(r, reportHref)),
    trend: trendOf(reports),
  };
};

// ─── SARRA HQ: Maker, Checker, Approver, administrator ───────────────────────

const districtRows = (projects, reports, dl = null) => [...new Set(projects.map((project) => project.district))].sort().map((name) => {
  const mine = projects.filter((project) => project.district === name);
  const ids = new Set(mine.map((project) => String(project._id)));
  const owed = dl ? dl.items.filter((item) => item.district === name && item.state !== 'SKIPPED') : [];
  const mineReports = reports.filter((r) => ids.has(String(r.project)) && r.status !== R.DRAFT);
  return {
    name,
    projects: mine.length,
    ...moneyOf(mine, reports),
    physicalPercent: physicalOf(mine, reports),
    expected: owed.length,
    filed: owed.filter((item) => item.state === 'FILED').length,
    overdue: owed.filter((item) => item.state === 'OVERDUE').length,
    inReview: mineReports.filter((r) => IN_REVIEW.includes(r.status)).length,
    verified: mineReports.filter((r) => r.status === R.VERIFIED_BY_STATE).length,
    returned: mineReports.filter((r) => r.status === R.RETURNED_FOR_CORRECTION).length,
  };
});

const PIPELINE = [
  [S.PENDING_CHECKER, 'With HQ Checker'], [S.PENDING_APPROVER, 'With HQ Approver'], [S.SANCTIONED, 'Sanctioned'], [S.FORWARDED_TO_DISTRICT, 'Sent to district'],
  [S.DISTRICT_ACCEPTED, 'District accepted'], [S.FORWARDED_TO_PIA, 'Assigned to PIA'], [S.PIA_ACCEPTED, 'Active'],
];

const USER_GROUPS = [
  ['HQ Maker', (u) => u.role === USER_ROLES.SUPER_ADMIN && u.workflowRole === MAKER],
  ['HQ Checker', (u) => u.role === USER_ROLES.SUPER_ADMIN && u.workflowRole === CHECKER],
  ['HQ Approver', (u) => u.role === USER_ROLES.SUPER_ADMIN && u.workflowRole === APPROVER],
  ['HQ administrators', (u) => u.role === USER_ROLES.SUPER_ADMIN && !u.workflowRole],
  ['District Maker', (u) => u.role === USER_ROLES.DD_LEVEL && workflowRoleOf(u) === MAKER],
  ['District Checker', (u) => u.role === USER_ROLES.DD_LEVEL && u.workflowRole === CHECKER],
  ['District Approver', (u) => u.role === USER_ROLES.DD_LEVEL && u.workflowRole === APPROVER],
  ['PIA Maker', (u) => u.role === USER_ROLES.PIA_OFFICER && workflowRoleOf(u) === MAKER],
  ['PIA Checker', (u) => u.role === USER_ROLES.PIA_OFFICER && u.workflowRole === CHECKER],
  ['PIA Approver', (u) => u.role === USER_ROLES.PIA_OFFICER && u.workflowRole === APPROVER],
  ['M&E administrators', (u) => u.role === USER_ROLES.MND_SUPER_ADMIN],
  ['M&E officers', (u) => u.role === USER_ROLES.MND_OFFICER],
];

const stateHome = async (user) => {
  const role = user.workflowRole || 'ADMIN';
  const reportHref = (id) => `/dashboard/admin/projects/mpr/${id}`;
  const [{ projects, reports }, revisions, queue] = await Promise.all([
    load({}),
    ProjectRevision.find({ status: { $in: ['PENDING_CHECKER', 'PENDING_APPROVER'] } }).select('project revisionNo status proposedTotalLakh beforeTotalLakh createdAt').lean(),
    myQueue(user),
  ]);
  const filedReports = reports.filter((r) => r.status !== R.DRAFT);
  const byId = new Map(projects.map((project) => [String(project._id), project]));
  const live = projects.filter((p) => SANCTIONED_ON.includes(p.status));
  const open = live.filter((p) => !isClosed(p));
  const closed = live.filter(isClosed);
  const withStatus = (status) => projects.filter((p) => p.status === status);
  const many = (list, single, all) => (list.length === 1 ? single(list[0]) : all);
  const projectHref = (p) => `/dashboard/admin/projects/${p._id}`;
  const names = (list) => `${list.slice(0, 3).map(codeOf).join(', ')}${list.length > 3 ? ' and more' : ''}`;

  const pendingChecker = withStatus(S.PENDING_CHECKER);
  const pendingApprover = withStatus(S.PENDING_APPROVER);
  const returned = withStatus(S.REJECTED);
  const toForward = open.filter((p) => p.status === S.SANCTIONED);
  const readyToClose = open.filter((p) => (p.departmentAllocations || []).length > 0 && p.departmentAllocations.every((d) => d.completion?.status === 'DISTRICT_VERIFIED'));
  const revisionsFor = (status) => revisions.filter((r) => r.status === status && byId.has(String(r.project)));
  const revisionTask = (key, list, cta) => list.length && task(key, 'warning', list.length, `${plural(list.length, 'target revision')} to ${cta.toLowerCase()}`, list.slice(0, 3).map((r) => codeOf(byId.get(String(r.project)))).join(', '), `/dashboard/admin/projects/${list[0].project}#workflow`, cta);
  const mprQueue = queueTask(queue, reportHref, '/dashboard/admin/mprs');

  let tasks = [];
  if (role === MAKER) {
    tasks = [
      returned.length && task('returned', 'danger', returned.length, `${plural(returned.length, 'returned project')} to correct`, `${names(returned)}. Correct and resubmit under the same Project ID.`, many(returned, projectHref, '/dashboard/admin/projects'), 'Correct'),
      toForward.length && task('forward', 'warning', toForward.length, `${plural(toForward.length, 'sanctioned project')} to forward to the district`, names(toForward), many(toForward, projectHref, '/dashboard/admin/projects'), 'Forward'),
      mprQueue,
    ];
  } else if (role === CHECKER) {
    tasks = [
      pendingChecker.length && task('verify', 'warning', pendingChecker.length, `${plural(pendingChecker.length, 'project')} to verify`, names(pendingChecker), many(pendingChecker, projectHref, '/dashboard/admin/projects'), 'Verify'),
      revisionTask('revision', revisionsFor('PENDING_CHECKER'), 'Verify'),
      mprQueue,
    ];
  } else if (role === APPROVER) {
    tasks = [
      pendingApprover.length && task('approve', 'warning', pendingApprover.length, `${plural(pendingApprover.length, 'project')} to sanction`, names(pendingApprover), many(pendingApprover, projectHref, '/dashboard/admin/projects'), 'Approve'),
      revisionTask('revision', revisionsFor('PENDING_APPROVER'), 'Approve'),
      mprQueue,
      readyToClose.length && task('close', 'info', readyToClose.length, `${plural(readyToClose.length, 'project')} ready to be closed`, `Every completion report is verified by the district: ${names(readyToClose)}.`, `${projectHref(readyToClose[0])}#closure`, 'Close'),
    ];
  }
  tasks = tasks.filter(Boolean);

  let users = null;
  if (role === 'ADMIN') {
    const all = await User.find({}).select('role workflowRole accountStatus isActive createdAt name email district approval').sort({ createdAt: -1 }).lean();
    const active = (u) => (u.accountStatus ? u.accountStatus === 'ACTIVE' : u.isActive !== false);
    const districtMakers = new Set(all.filter((u) => u.role === USER_ROLES.DD_LEVEL && workflowRoleOf(u) === MAKER && active(u)).map((u) => u.district));
    const uncovered = [...new Set(open.map((p) => p.district))].filter((district) => !districtMakers.has(district)).sort();
    const pendingApproval = all.filter((u) => u.approval?.status === 'PENDING');
    users = {
      total: all.length,
      active: all.filter(active).length,
      suspended: all.filter((u) => u.accountStatus === 'SUSPENDED').length,
      deactivated: all.filter((u) => u.accountStatus === 'DEACTIVATED').length,
      pendingApproval: pendingApproval.length,
      groups: USER_GROUPS.map(([label, test]) => ({ label, count: all.filter(test).length, active: all.filter((u) => test(u) && active(u)).length })),
      recent: all.slice(0, 5).map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: actorLabel(u), status: u.accountStatus || (u.isActive === false ? 'DEACTIVATED' : 'ACTIVE'), createdAt: u.createdAt })),
      districtsWithoutDirector: uncovered,
    };
    tasks = [
      pendingApproval.length && task('user-approval', 'warning', pendingApproval.length, `${plural(pendingApproval.length, 'user request')} awaiting approval`, 'Accounts requested by a tier Maker wait for the Approver of that tier.', '/dashboard/admin/users', 'Review'),
      uncovered.length && task('no-district-maker', 'danger', uncovered.length, `${plural(uncovered.length, 'district')} with projects but no active District Maker`, uncovered.join(', '), '/dashboard/admin/users/new', 'Add user'),
      users.suspended && task('suspended', 'info', users.suspended, `${plural(users.suspended, 'account')} suspended`, 'Review whether they should be restored.', '/dashboard/admin/users', 'Review'),
    ].filter(Boolean);
  }

  return {
    role: user.role,
    workflowRole: user.workflowRole || null,
    roleLabel: actorLabel(user),
    kpis: {
      projects: projects.length,
      pendingChecker: pendingChecker.length,
      pendingApprover: pendingApprover.length,
      returned: returned.length,
      sanctioned: live.length,
      inProgress: open.filter((p) => p.status === S.PIA_ACCEPTED).length,
      closed: closed.length,
      districts: new Set(live.map((p) => p.district)).size,
      ...moneyOf(live, reports),
      physicalPercent: physicalOf(live, reports),
      mprInReview: filedReports.filter((r) => IN_REVIEW.includes(r.status)).length,
      mprVerified: filedReports.filter((r) => r.status === R.VERIFIED_BY_STATE).length,
      mprReturned: filedReports.filter((r) => r.status === R.RETURNED_FOR_CORRECTION).length,
      myActions: queue.length,
    },
    tasks,
    pipeline: [...PIPELINE.map(([status, label]) => ({ status, label, count: withStatus(status).filter((p) => !isClosed(p)).length })), { status: 'CLOSED', label: 'Closed', count: closed.length }, { status: S.REJECTED, label: 'Returned to Maker', count: returned.length }],
    pendingByStage: pendingByStage(filedReports),
    reviewQueue: queue.slice(0, 8).map((r) => reportRow(r, reportHref)),
    recentProjects: projects.slice(0, 7).map((p) => ({ id: String(p._id), code: codeOf(p), name: p.projectTitle || '', district: p.district, status: p.status, closed: isClosed(p), totalLakh: p.totalSanctionedBudgetLakh || 0, updatedAt: p.updatedAt, href: projectHref(p) })),
    districts: districtRows(live, reports),
    trend: trendOf(reports),
    users,
  };
};

// ─── M&E administrator and M&E officer (monitoring, read-only) ──────────────

const monitoringHome = async (user) => {
  const settings = await getSettings();
  const admin = user.role === USER_ROLES.MND_SUPER_ADMIN;
  const [{ projects, reports }, dl, baselines, measured] = await Promise.all([
    load({ status: { $in: SANCTIONED_ON } }),
    collectDeadlines(settings, {}),
    ProjectOutcome.distinct('project', { kind: 'BASELINE', voided: false }),
    ProjectOutcome.distinct('project', { kind: 'MEASUREMENT', voided: false }),
  ]);
  const filedReports = reports.filter((r) => r.status !== R.DRAFT);
  const open = projects.filter((p) => !isClosed(p));
  const expected = dl.items.filter((item) => item.state !== 'SKIPPED');
  const overdue = dl.items.filter((item) => item.state === 'OVERDUE');
  const stuck = dl.reviews.filter((review) => review.overdue);
  const ids = new Set(projects.map((p) => String(p._id)));
  const withBaseline = baselines.filter((id) => ids.has(String(id))).length;
  const reportHref = (id) => `/dashboard/mnd-admin/mpr/project/${id}`;

  const tasks = admin ? [
    overdue.length && task('overdue', 'danger', overdue.length, `${plural(overdue.length, 'report')} overdue for ${periodLabel(dl.period)}`, `In ${[...new Set(overdue.map((item) => item.district))].join(', ')}.`, '/dashboard/mnd-admin/deadlines', 'See list'),
    stuck.length && task('stuck', 'warning', stuck.length, `${plural(stuck.length, 'report')} waiting too long for verification`, `Beyond ${settings.deadlines.districtReviewDays} days at ${[...new Set(stuck.map((review) => review.stage))].join(', ')}.`, '/dashboard/mnd-admin/deadlines', 'See list'),
    projects.length - withBaseline > 0 && task('baseline', 'info', projects.length - withBaseline, `${plural(projects.length - withBaseline, 'project')} without an outcome baseline`, 'Their results cannot be judged later without a reading taken before the works.', '/dashboard/mnd-admin/analytics', 'Open outcomes'),
  ].filter(Boolean) : [];

  let legacy = null;
  if (!admin) {
    try {
      const old = await getHomeDashboard(user);
      legacy = { stats: old?.stats || {}, actionRequired: (old?.actionRequired || []).slice(0, 6), recentItems: (old?.recentItems || []).slice(0, 6) };
    } catch (err) {
      logger.error(`Legacy M&E dashboard failed: ${err.message}`);
    }
  }

  return {
    role: user.role,
    period: deadlineHeader(dl, settings),
    kpis: {
      projects: projects.length,
      inProgress: open.filter((p) => p.status === S.PIA_ACCEPTED).length,
      closed: projects.length - open.length,
      districts: new Set(projects.map((p) => p.district)).size,
      ...moneyOf(projects, reports),
      physicalPercent: physicalOf(projects, reports),
      reports: filedReports.filter(counted).length,
      expected: expected.length,
      filed: expected.filter((item) => item.state === 'FILED').length,
      overdue: overdue.length,
      inReview: filedReports.filter((r) => IN_REVIEW.includes(r.status)).length,
      verified: filedReports.filter((r) => r.status === R.VERIFIED_BY_STATE).length,
    },
    tasks,
    districts: districtRows(projects, reports, dl),
    trend: trendOf(reports),
    pendingByStage: pendingByStage(filedReports),
    recentReports: [...filedReports].sort((a, b) => new Date(b.submittedAt || b.updatedAt) - new Date(a.submittedAt || a.updatedAt)).slice(0, 8).map((r) => reportRow(r, admin ? reportHref : null)),
    outcomes: { projects: projects.length, withBaseline, measured: measured.filter((id) => ids.has(String(id))).length },
    legacy,
  };
};

export const getRoleHome = async (user) => {
  switch (user.role) {
    case USER_ROLES.PIA_OFFICER: return piaHome(user);
    case USER_ROLES.DD_LEVEL: return districtHome(user);
    case USER_ROLES.SUPER_ADMIN: return stateHome(user);
    case USER_ROLES.MND_SUPER_ADMIN:
    case USER_ROLES.MND_OFFICER: return monitoringHome(user);
    default: throw new ApiError(HTTP_STATUS.FORBIDDEN, 'No home page for this role.');
  }
};

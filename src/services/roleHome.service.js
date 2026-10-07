import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import ProjectRevision from '../models/ProjectRevision.model.js';
import User from '../models/User.model.js';
import { BudgetAllocationEntry } from '../models/BudgetAllocation.model.js';
import { ProjectCompletion, ProjectOutcome, COMPLETION_STATUS } from '../models/ProjectLifecycle.model.js';
import { collectDeadlines, getSettings } from './monitoring.service.js';
import { getHomeDashboard } from './homeDashboard.service.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

/**
 * Home page of each role.
 *
 * Every role gets a different answer to the same three questions: what needs
 * my action now, how is my work doing, and what happened recently. All
 * figures are calculated here for exactly what the user is allowed to see.
 */

const MONEY = 100000;
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY);
const fromMoney = (units) => units / MONEY;
const percent = (part, whole) => (whole > 0 ? Math.min(100, Math.floor((part * 1000) / whole) / 10) : 0);
const sameId = (a, b) => String(a?._id || a || '') === String(b?._id || b || '');
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodLabel = (period) => `${FULL_MONTHS[period % 12]} ${Math.floor(period / 12)}`;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const S = SANCTION_STATUS;
const SANCTIONED_ON = [S.SANCTIONED, S.FORWARDED_TO_DISTRICT, S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA, S.PIA_ACCEPTED];
const isClosed = (project) => project.closure?.status === 'CLOSED';
const codeOf = (project) => project.projectId || project.sanctionId || '';
const filed = (department) => ['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status);

const PROJECT_FIELDS = 'projectId sanctionId projectTitle district status closure head totalSanctionedBudgetLakh budgetAllocation rejectionReason makerUserId updatedAt createdAt '
  + 'departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.totalLakh departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt departmentAllocations.completion';
const REPORT_FIELDS = 'mprNo project projectCode projectTitle district departmentId departmentName periodIndex reportingMonth financialYear status totals.financialCurrentLakh totals.financialTotalLakh totals.physicalPercent totals.financialPercent submittedAt submittedBy reviewedAt updatedAt returnedByLevel';

/** Projects, their reports and their releases for a scope, loaded once. */
const load = async (projectFilter = {}) => {
  const projects = await ProjectSanction.find(projectFilter).select(PROJECT_FIELDS).sort({ updatedAt: -1 }).lean();
  const ids = projects.map((project) => project._id);
  const [reports, entries] = ids.length ? await Promise.all([
    ProjectMPR.find({ project: { $in: ids } }).select(REPORT_FIELDS).sort({ periodIndex: 1 }).lean(),
    BudgetAllocationEntry.find({ project: { $in: ids } }).select('project departmentId amountLakh allocationDate').lean(),
  ]) : [[], []];
  return { projects, reports, entries };
};

/** Money and progress of one department of one project. */
const departmentFigures = (project, department, reports, entries) => {
  const mine = reports.filter((r) => sameId(r.project, project._id) && sameId(r.departmentId, department.departmentId));
  const released = entries.filter((e) => sameId(e.project, project._id) && sameId(e.departmentId, department.departmentId)).reduce((sum, e) => sum + toMoney(e.amountLakh), 0);
  const spent = mine.reduce((sum, r) => sum + toMoney(r.totals?.financialCurrentLakh), 0);
  const last = mine[mine.length - 1] || null;
  return { reports: mine, last, sanctioned: toMoney(department.totalLakh), released, spent, physicalPercent: last?.totals?.physicalPercent || 0 };
};

const sumMoney = (list, pick) => list.reduce((total, item) => total + toMoney(pick(item)), 0);

/** Sanctioned, released and spent for a set of projects. */
const moneyOf = (projects, reports, entries) => {
  const ids = new Set(projects.map((project) => String(project._id)));
  const sanctioned = sumMoney(projects, (p) => p.totalSanctionedBudgetLakh);
  const released = sumMoney(entries.filter((e) => ids.has(String(e.project))), (e) => e.amountLakh);
  const spent = sumMoney(reports.filter((r) => ids.has(String(r.project))), (r) => r.totals?.financialCurrentLakh);
  return {
    sanctionedLakh: fromMoney(sanctioned),
    releasedLakh: fromMoney(released),
    spentLakh: fromMoney(spent),
    unspentLakh: fromMoney(Math.max(0, released - spent)),
    remainingLakh: fromMoney(Math.max(0, sanctioned - released)),
    releasePercent: percent(released, sanctioned),
    utilisationPercent: percent(spent, released),
  };
};

/** Average physical progress: the latest report of every reporting department. */
const physicalOf = (projects, reports) => {
  const latest = new Map();
  const ids = new Set(projects.map((project) => String(project._id)));
  reports.filter((r) => ids.has(String(r.project))).forEach((r) => latest.set(`${r.project}|${r.departmentId}`, r.totals?.physicalPercent || 0));
  const values = [...latest.values()];
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;
};

/** Funds released and expenditure reported in each of the last six months. */
const trendOf = (reports, entries, now = new Date()) => {
  const clock = new Date(now.getTime() + 330 * 60000);
  const current = clock.getUTCFullYear() * 12 + clock.getUTCMonth();
  return Array.from({ length: 6 }, (_, index) => current - 5 + index).map((period) => ({
    label: `${MONTHS[period % 12]} ${String(Math.floor(period / 12)).slice(2)}`,
    releasedLakh: fromMoney(sumMoney(entries.filter((e) => { const d = new Date(new Date(e.allocationDate).getTime() + 330 * 60000); return d.getUTCFullYear() * 12 + d.getUTCMonth() === period; }), (e) => e.amountLakh)),
    spentLakh: fromMoney(sumMoney(reports.filter((r) => r.periodIndex === period), (r) => r.totals?.financialCurrentLakh)),
  }));
};

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
  spentLakh: report.totals?.financialCurrentLakh || 0,
  submittedAt: report.submittedAt,
  href: href(String(report._id)),
});

const task = (key, tone, count, title, detail, href, cta) => ({ key, tone, count, title, detail, href, cta });

// ─── PIA officer ─────────────────────────────────────────────────────────────

const piaHome = async (user) => {
  const settings = await getSettings();
  const owns = (department) => sameId(department.piaUserId, user._id);
  const [{ projects, reports, entries }, dl, returnedCompletions] = await Promise.all([
    load({ 'departmentAllocations.piaUserId': user._id }),
    collectDeadlines(settings, { 'departmentAllocations.piaUserId': user._id }, owns),
    ProjectCompletion.find({ submittedBy: user._id, status: COMPLETION_STATUS.RETURNED }).select('project projectCode departmentName').lean(),
  ]);

  const holdings = [];
  let sanctioned = 0; let released = 0; let spent = 0;
  projects.forEach((project) => (project.departmentAllocations || []).filter(owns).forEach((department) => {
    const figures = departmentFigures(project, department, reports, entries);
    const due = dl.items.find((item) => item.projectId === String(project._id) && item.departmentId === String(department.departmentId)) || null;
    if (!isClosed(project)) { sanctioned += figures.sanctioned; released += figures.released; spent += figures.spent; }
    holdings.push({
      projectId: String(project._id),
      code: codeOf(project),
      name: project.projectTitle || '',
      departmentId: String(department.departmentId),
      department: department.departmentName,
      accepted: Boolean(department.piaAcceptedAt),
      closed: isClosed(project),
      completion: department.completion?.status || null,
      sanctionedLakh: fromMoney(figures.sanctioned),
      releasedLakh: fromMoney(figures.released),
      spentLakh: fromMoney(figures.spent),
      physicalPercent: figures.physicalPercent,
      financialPercent: percent(figures.spent, figures.sanctioned),
      reports: figures.reports.length,
      lastReport: figures.last ? { id: String(figures.last._id), period: periodLabel(figures.last.periodIndex), status: figures.last.status } : null,
      due: due && ['OVERDUE', 'DUE_SOON', 'DUE'].includes(due.state) ? { state: due.state, period: due.period, daysOverdue: due.daysOverdue, daysLeft: due.daysLeft, financialYear: due.financialYear, reportingMonth: due.reportingMonth } : null,
      href: `/dashboard/officer/projects/${project._id}`,
    });
  }));

  const mineReports = reports.filter((r) => holdings.some((h) => h.projectId === String(r.project) && h.departmentId === String(r.departmentId)));
  const toAccept = holdings.filter((h) => !h.accepted && !h.closed);
  const overdue = holdings.filter((h) => h.due?.state === 'OVERDUE');
  const dueSoon = holdings.filter((h) => h.due && h.due.state !== 'OVERDUE');
  const fileHref = (h) => `/dashboard/officer/forms/new?projectId=${h.projectId}&departmentId=${h.departmentId}&fy=${h.due.financialYear}&month=${h.due.reportingMonth}`;

  const tasks = [
    ...toAccept.map((h) => task(`accept:${h.projectId}:${h.departmentId}`, 'warning', 1, `Accept ${h.code}`, `${h.department}: you have been assigned as PIA officer. Accept it to start reporting.`, h.href, 'Open project')),
    ...dl.corrections.map((c) => task(`fix:${c.mprId}`, 'danger', 1, `Correct the ${c.period} report`, `${c.departmentName}, ${c.projectCode}: returned by the ${c.returnedBy.toLowerCase()} ${plural(c.daysPending, 'day')} ago.`, `/dashboard/officer/mprs/report/${c.mprId}`, 'Open report')),
    ...overdue.map((h) => task(`overdue:${h.projectId}:${h.departmentId}`, 'danger', 1, `${h.due.period} report is ${plural(h.due.daysOverdue, 'day')} overdue`, `${h.department}, ${h.code}`, fileHref(h), 'File now')),
    ...dueSoon.map((h) => task(`due:${h.projectId}:${h.departmentId}`, 'info', 1, `${h.due.period} report is due${h.due.daysLeft ? ` in ${plural(h.due.daysLeft, 'day')}` : ' today'}`, `${h.department}, ${h.code}`, fileHref(h), 'File report')),
    ...returnedCompletions.map((c) => task(`completion:${c._id}`, 'warning', 1, 'Completion report returned', `${c.departmentName}, ${c.projectCode}: correct it and file it again.`, `/dashboard/officer/projects/${c.project}#closure`, 'Open')),
  ];

  const count = (status) => mineReports.filter((r) => r.status === status).length;
  return {
    role: user.role,
    scope: { department: user.department || holdings[0]?.department || '', district: user.district || '' },
    period: deadlineHeader(dl, settings),
    kpis: {
      departments: holdings.filter((h) => !h.closed).length,
      projects: new Set(holdings.filter((h) => !h.closed).map((h) => h.projectId)).size,
      sanctionedLakh: fromMoney(sanctioned),
      releasedLakh: fromMoney(released),
      spentLakh: fromMoney(spent),
      unspentLakh: fromMoney(Math.max(0, released - spent)),
      utilisationPercent: percent(spent, released),
      reports: mineReports.length,
      awaitingDistrict: count(PROJECT_MPR_STATUS.SUBMITTED),
      approved: count(PROJECT_MPR_STATUS.DISTRICT_APPROVED) + count(PROJECT_MPR_STATUS.STATE_VERIFIED),
      returned: count(PROJECT_MPR_STATUS.RETURNED_TO_PIA),
    },
    tasks,
    holdings,
    recentReports: [...mineReports].sort((a, b) => new Date(b.submittedAt || b.updatedAt) - new Date(a.submittedAt || a.updatedAt)).slice(0, 6).map((r) => reportRow(r, (id) => `/dashboard/officer/mprs/report/${id}`)),
  };
};

// ─── District Director ───────────────────────────────────────────────────────

const districtHome = async (user) => {
  if (!user.district) throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Your account has no district.');
  const settings = await getSettings();
  const scope = { district: user.district, status: { $in: [S.FORWARDED_TO_DISTRICT, S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA, S.PIA_ACCEPTED] } };
  const [{ projects, reports, entries }, dl, completions] = await Promise.all([
    load(scope),
    collectDeadlines(settings, { district: user.district }),
    ProjectCompletion.find({ district: user.district, status: COMPLETION_STATUS.SUBMITTED }).select('project projectCode departmentName submittedAt').lean(),
  ]);
  const open = projects.filter((project) => !isClosed(project));
  const officerIds = [...new Set(projects.flatMap((p) => (p.departmentAllocations || []).map((d) => String(d.piaUserId || '')).filter(Boolean)))];
  const officers = officerIds.length ? await User.find({ _id: { $in: officerIds } }).select('name department').lean() : [];

  const toAccept = open.filter((p) => p.status === S.FORWARDED_TO_DISTRICT);
  const toAssign = open.filter((p) => [S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA].includes(p.status) && (p.departmentAllocations || []).some((d) => !d.piaUserId));
  const notAccepted = open.filter((p) => (p.departmentAllocations || []).some((d) => d.piaUserId && !d.piaAcceptedAt));
  const overdue = dl.items.filter((item) => item.state === 'OVERDUE');
  const expected = dl.items.filter((item) => item.state !== 'SKIPPED');
  const reviewsLate = dl.reviews.filter((review) => review.overdue);

  const tasks = [
    toAccept.length && task('accept', 'warning', toAccept.length, `${plural(toAccept.length, 'project')} to accept`, `Forwarded by the State: ${toAccept.slice(0, 3).map(codeOf).join(', ')}${toAccept.length > 3 ? ' and more' : ''}.`, toAccept.length === 1 ? `/dashboard/dd/projects/${toAccept[0]._id}` : '/dashboard/dd/projects', 'Review'),
    toAssign.length && task('assign', 'warning', toAssign.length, `${plural(toAssign.length, 'project')} waiting for a PIA officer`, 'A department has no officer assigned yet, so its work cannot be reported.', toAssign.length === 1 ? `/dashboard/dd/projects/${toAssign[0]._id}` : '/dashboard/dd/projects', 'Assign'),
    dl.reviews.length && task('review', reviewsLate.length ? 'danger' : 'info', dl.reviews.length, `${plural(dl.reviews.length, 'monthly report')} to review`, reviewsLate.length ? `${reviewsLate.length} waiting beyond ${settings.deadlines.districtReviewDays} days. Oldest: ${plural(dl.reviews[0].daysWaiting, 'day')}.` : (dl.reviews[0].daysWaiting ? `Oldest has waited ${plural(dl.reviews[0].daysWaiting, 'day')}.` : 'Filed today.'), dl.reviews.length === 1 ? `/dashboard/dd/mpr-review/project/${dl.reviews[0].mprId}` : '/dashboard/dd/mpr-review', 'Review'),
    completions.length && task('completion', 'warning', completions.length, `${plural(completions.length, 'completion report')} to verify`, completions.slice(0, 3).map((c) => `${c.departmentName} (${c.projectCode})`).join(', '), `/dashboard/dd/projects/${completions[0].project}#closure`, 'Verify'),
    overdue.length && task('overdue', 'danger', overdue.length, `${plural(overdue.length, 'report')} overdue for ${periodLabel(dl.period)}`, overdue.slice(0, 3).map((item) => `${item.departmentName} (${item.officer?.name || 'no officer'})`).join(', '), '/dashboard/dd/deadlines', 'Follow up'),
    notAccepted.length && task('pending-accept', 'info', notAccepted.length, `${plural(notAccepted.length, 'project')} not yet accepted by the PIA officer`, 'The assigned officer has to accept before reporting can start.', '/dashboard/dd/projects', 'View'),
  ].filter(Boolean);

  const rows = projects.map((project) => {
    const departments = project.departmentAllocations || [];
    const money = moneyOf([project], reports, entries);
    const due = dl.items.filter((item) => item.projectId === String(project._id));
    return {
      id: String(project._id),
      code: codeOf(project),
      name: project.projectTitle || '',
      status: project.status,
      closed: isClosed(project),
      departments: departments.length,
      assigned: departments.filter((d) => d.piaUserId).length,
      accepted: departments.filter((d) => d.piaAcceptedAt).length,
      ...money,
      spendPercent: percent(toMoney(money.spentLakh), toMoney(money.sanctionedLakh)),
      physicalPercent: physicalOf([project], reports),
      overdue: due.filter((item) => item.state === 'OVERDUE').length,
      awaitingReview: reports.filter((r) => sameId(r.project, project._id) && r.status === PROJECT_MPR_STATUS.SUBMITTED).length,
      href: `/dashboard/dd/projects/${project._id}`,
    };
  });

  const officerRows = officers.map((officer) => {
    const held = open.flatMap((p) => (p.departmentAllocations || []).filter((d) => sameId(d.piaUserId, officer._id) && !filed(d)));
    return {
      id: String(officer._id),
      name: officer.name,
      department: officer.department || held[0]?.departmentName || '',
      departments: held.length,
      notAccepted: held.filter((d) => !d.piaAcceptedAt).length,
      overdue: overdue.filter((item) => item.officer?.id === String(officer._id)).length,
      awaitingReview: dl.reviews.filter((review) => review.officer?.id === String(officer._id)).length,
      corrections: dl.corrections.filter((item) => item.officer?.id === String(officer._id)).length,
    };
  }).filter((row) => row.departments > 0).sort((a, b) => b.overdue - a.overdue || b.departments - a.departments);

  return {
    role: user.role,
    scope: { district: user.district },
    period: deadlineHeader(dl, settings),
    kpis: {
      projects: projects.length,
      active: open.filter((p) => p.status === S.PIA_ACCEPTED).length,
      closed: projects.length - open.length,
      ...moneyOf(projects, reports, entries),
      physicalPercent: physicalOf(projects, reports),
      expected: expected.length,
      filed: expected.filter((item) => item.state === 'FILED').length,
      overdue: overdue.length,
      awaitingReview: dl.reviews.length,
    },
    tasks,
    projects: rows,
    officers: officerRows,
    reviewQueue: dl.reviews.slice(0, 6).map((review) => ({ id: review.mprId, mprNo: review.mprNo, department: review.departmentName, period: review.period, projectCode: review.projectCode, officer: review.officer?.name || '', daysWaiting: review.daysWaiting, overdue: review.overdue, href: `/dashboard/dd/mpr-review/project/${review.mprId}` })),
    trend: trendOf(reports, entries),
  };
};

// ─── State: Maker, Checker, Approver, administrator ──────────────────────────

const districtRows = (projects, reports, entries, dl = null) => [...new Set(projects.map((project) => project.district))].sort().map((name) => {
  const mine = projects.filter((project) => project.district === name);
  const ids = new Set(mine.map((project) => String(project._id)));
  const owed = dl ? dl.items.filter((item) => item.district === name && item.state !== 'SKIPPED') : [];
  const mineReports = reports.filter((r) => ids.has(String(r.project)));
  return {
    name,
    projects: mine.length,
    ...moneyOf(mine, reports, entries),
    physicalPercent: physicalOf(mine, reports),
    expected: owed.length,
    filed: owed.filter((item) => item.state === 'FILED').length,
    overdue: owed.filter((item) => item.state === 'OVERDUE').length,
    awaitingDistrict: mineReports.filter((r) => r.status === PROJECT_MPR_STATUS.SUBMITTED).length,
    awaitingState: mineReports.filter((r) => r.status === PROJECT_MPR_STATUS.DISTRICT_APPROVED).length,
  };
});

const PIPELINE = [
  [S.PENDING_CHECKER, 'With Checker'], [S.PENDING_APPROVER, 'With Approver'], [S.SANCTIONED, 'Sanctioned'], [S.FORWARDED_TO_DISTRICT, 'Sent to district'],
  [S.DISTRICT_ACCEPTED, 'District accepted'], [S.FORWARDED_TO_PIA, 'Assigned to PIA'], [S.PIA_ACCEPTED, 'In progress'],
];

const stateHome = async (user) => {
  const role = user.workflowRole || 'ADMIN';
  const [{ projects, reports, entries }, revisions] = await Promise.all([
    load({}),
    ProjectRevision.find({ status: { $in: ['PENDING_CHECKER', 'PENDING_APPROVER'] } }).select('project revisionNo status proposedTotalLakh beforeTotalLakh createdAt').lean(),
  ]);
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
  const rejected = withStatus(S.REJECTED);
  const toForward = open.filter((p) => p.status === S.SANCTIONED);
  const toRelease = open.filter((p) => (p.departmentAllocations || []).length && (p.budgetAllocation?.status || 'NOT_ALLOCATED') !== 'FULLY_ALLOCATED');
  const neverReleased = toRelease.filter((p) => (p.budgetAllocation?.status || 'NOT_ALLOCATED') === 'NOT_ALLOCATED');
  const readyToClose = open.filter((p) => (p.departmentAllocations || []).length > 0 && p.departmentAllocations.every((d) => d.completion?.status === 'DISTRICT_VERIFIED'));
  const refunds = closed.filter((p) => p.closure?.refundStatus === 'PENDING');
  const revisionsFor = (status) => revisions.filter((r) => r.status === status && byId.has(String(r.project)));
  const revisionTask = (key, list, cta) => list.length && task(key, 'warning', list.length, `${plural(list.length, 'revised estimate')} to ${cta.toLowerCase()}`, list.slice(0, 3).map((r) => codeOf(byId.get(String(r.project)))).join(', '), `/dashboard/admin/projects/${list[0].project}#workflow`, cta);

  let tasks = [];
  if (role === 'MAKER') {
    tasks = [
      rejected.length && task('rejected', 'danger', rejected.length, `${plural(rejected.length, 'rejected project')} to correct`, `${names(rejected)}. Correct and resubmit under the same Project ID.`, many(rejected, projectHref, '/dashboard/admin/projects'), 'Correct'),
      toForward.length && task('forward', 'warning', toForward.length, `${plural(toForward.length, 'sanctioned project')} to forward to the district`, names(toForward), many(toForward, projectHref, '/dashboard/admin/projects'), 'Forward'),
      neverReleased.length && task('release', 'info', neverReleased.length, `${plural(neverReleased.length, 'project')} with no budget released yet`, names(neverReleased), '/dashboard/admin/projects/budget-allocation', 'Release budget'),
      refunds.length && task('refund', 'warning', refunds.length, `${plural(refunds.length, 'refund')} to record`, `Unspent balance of closed projects: ${names(refunds)}.`, `${projectHref(refunds[0])}#closure`, 'Record'),
    ];
  } else if (role === 'CHECKER') {
    tasks = [
      pendingChecker.length && task('verify', 'warning', pendingChecker.length, `${plural(pendingChecker.length, 'project')} to verify`, names(pendingChecker), many(pendingChecker, projectHref, '/dashboard/admin/projects'), 'Verify'),
      revisionTask('revision', revisionsFor('PENDING_CHECKER'), 'Verify'),
    ];
  } else if (role === 'APPROVER') {
    tasks = [
      pendingApprover.length && task('approve', 'warning', pendingApprover.length, `${plural(pendingApprover.length, 'project')} to approve`, names(pendingApprover), many(pendingApprover, projectHref, '/dashboard/admin/projects'), 'Approve'),
      revisionTask('revision', revisionsFor('PENDING_APPROVER'), 'Approve'),
      readyToClose.length && task('close', 'info', readyToClose.length, `${plural(readyToClose.length, 'project')} ready to be closed`, `Every completion report is verified: ${names(readyToClose)}.`, `${projectHref(readyToClose[0])}#closure`, 'Close'),
    ];
  }
  tasks = tasks.filter(Boolean);

  let users = null;
  if (role === 'ADMIN') {
    const all = await User.find({}).select('role workflowRole accountStatus isActive createdAt name email district').sort({ createdAt: -1 }).lean();
    const active = (u) => (u.accountStatus ? u.accountStatus === 'ACTIVE' : u.isActive !== false);
    const groups = [
      ['State: Maker', (u) => u.role === USER_ROLES.SUPER_ADMIN && u.workflowRole === 'MAKER'], ['State: Checker', (u) => u.role === USER_ROLES.SUPER_ADMIN && u.workflowRole === 'CHECKER'],
      ['State: Approver', (u) => u.role === USER_ROLES.SUPER_ADMIN && u.workflowRole === 'APPROVER'], ['State administrators', (u) => u.role === USER_ROLES.SUPER_ADMIN && !u.workflowRole],
      ['District Directors', (u) => u.role === USER_ROLES.DD_LEVEL], ['PIA officers', (u) => u.role === USER_ROLES.PIA_OFFICER],
      ['M&E administrators', (u) => u.role === USER_ROLES.MND_SUPER_ADMIN], ['M&E officers', (u) => u.role === USER_ROLES.MND_OFFICER],
    ];
    const directors = new Set(all.filter((u) => u.role === USER_ROLES.DD_LEVEL && active(u)).map((u) => u.district));
    const uncovered = [...new Set(open.map((p) => p.district))].filter((district) => !directors.has(district)).sort();
    users = {
      total: all.length,
      active: all.filter(active).length,
      suspended: all.filter((u) => u.accountStatus === 'SUSPENDED').length,
      deactivated: all.filter((u) => u.accountStatus === 'DEACTIVATED').length,
      groups: groups.map(([label, test]) => ({ label, count: all.filter(test).length, active: all.filter((u) => test(u) && active(u)).length })),
      recent: all.slice(0, 5).map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.workflowRole ? `${u.role} / ${u.workflowRole}` : u.role, status: u.accountStatus || (u.isActive === false ? 'DEACTIVATED' : 'ACTIVE'), createdAt: u.createdAt })),
      districtsWithoutDirector: uncovered,
    };
    tasks = [
      uncovered.length && task('no-director', 'danger', uncovered.length, `${plural(uncovered.length, 'district')} with projects but no active District Director`, uncovered.join(', '), '/dashboard/admin/users/new', 'Add user'),
      users.suspended && task('suspended', 'info', users.suspended, `${plural(users.suspended, 'account')} suspended`, 'Review whether they should be restored.', '/dashboard/admin/users', 'Review'),
    ].filter(Boolean);
  }

  return {
    role: user.role,
    workflowRole: user.workflowRole || null,
    kpis: {
      projects: projects.length,
      pendingChecker: pendingChecker.length,
      pendingApprover: pendingApprover.length,
      rejected: rejected.length,
      sanctioned: live.length,
      inProgress: open.filter((p) => p.status === S.PIA_ACCEPTED).length,
      closed: closed.length,
      districts: new Set(live.map((p) => p.district)).size,
      toRelease: toRelease.length,
      ...moneyOf(live, reports, entries),
      physicalPercent: physicalOf(live, reports),
    },
    tasks,
    pipeline: [...PIPELINE.map(([status, label]) => ({ status, label, count: withStatus(status).filter((p) => !isClosed(p)).length })), { status: 'CLOSED', label: 'Closed', count: closed.length }, { status: S.REJECTED, label: 'Rejected', count: rejected.length }],
    recentProjects: projects.slice(0, 7).map((p) => ({ id: String(p._id), code: codeOf(p), name: p.projectTitle || '', district: p.district, status: p.status, closed: isClosed(p), totalLakh: p.totalSanctionedBudgetLakh || 0, releasedLakh: p.budgetAllocation?.releasedLakh || 0, updatedAt: p.updatedAt, href: projectHref(p) })),
    districts: districtRows(live, reports, entries),
    trend: trendOf(reports, entries),
    users,
  };
};

// ─── M&E administrator and M&E officer ───────────────────────────────────────

const monitoringHome = async (user) => {
  const settings = await getSettings();
  const admin = user.role === USER_ROLES.MND_SUPER_ADMIN;
  const [{ projects, reports, entries }, dl, baselines, measured] = await Promise.all([
    load({ status: { $in: SANCTIONED_ON } }),
    collectDeadlines(settings, {}),
    ProjectOutcome.distinct('project', { kind: 'BASELINE', voided: false }),
    ProjectOutcome.distinct('project', { kind: 'MEASUREMENT', voided: false }),
  ]);
  const open = projects.filter((p) => !isClosed(p));
  const expected = dl.items.filter((item) => item.state !== 'SKIPPED');
  const overdue = dl.items.filter((item) => item.state === 'OVERDUE');
  const toVerify = reports.filter((r) => r.status === PROJECT_MPR_STATUS.DISTRICT_APPROVED).sort((a, b) => new Date(a.reviewedAt || a.updatedAt) - new Date(b.reviewedAt || b.updatedAt));
  const reviewsLate = dl.reviews.filter((review) => review.overdue);
  const lateDistricts = [...new Set(reviewsLate.map((review) => review.district))];
  const ids = new Set(projects.map((p) => String(p._id)));
  const withBaseline = baselines.filter((id) => ids.has(String(id))).length;
  const reportHref = (id) => `/dashboard/mnd-admin/mpr/project/${id}`;
  const daysSince = (value) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));

  const tasks = admin ? [
    toVerify.length && task('verify', 'warning', toVerify.length, `${plural(toVerify.length, 'report')} to verify for the State`, (daysSince(toVerify[0].reviewedAt || toVerify[0].updatedAt) ? `Approved by the district. Oldest has waited ${plural(daysSince(toVerify[0].reviewedAt || toVerify[0].updatedAt), 'day')}.` : 'Approved by the district today.'), toVerify.length === 1 ? reportHref(toVerify[0]._id) : '/dashboard/mnd-admin/mpr', 'Verify'),
    overdue.length && task('overdue', 'danger', overdue.length, `${plural(overdue.length, 'report')} overdue for ${periodLabel(dl.period)}`, `In ${[...new Set(overdue.map((item) => item.district))].join(', ')}.`, '/dashboard/mnd-admin/deadlines', 'See list'),
    reviewsLate.length && task('district-late', 'warning', reviewsLate.length, `${plural(reviewsLate.length, 'report')} stuck in district review`, `Beyond ${settings.deadlines.districtReviewDays} days in ${lateDistricts.join(', ')}.`, '/dashboard/mnd-admin/deadlines', 'See list'),
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
      ...moneyOf(projects, reports, entries),
      physicalPercent: physicalOf(projects, reports),
      reports: reports.length,
      expected: expected.length,
      filed: expected.filter((item) => item.state === 'FILED').length,
      overdue: overdue.length,
      awaitingDistrict: dl.reviews.length,
      awaitingState: toVerify.length,
      verified: reports.filter((r) => r.status === PROJECT_MPR_STATUS.STATE_VERIFIED).length,
    },
    tasks,
    districts: districtRows(projects, reports, entries, dl),
    trend: trendOf(reports, entries),
    verifyQueue: toVerify.slice(0, 6).map((r) => ({ ...reportRow(r, reportHref), daysWaiting: daysSince(r.reviewedAt || r.updatedAt) })),
    recentReports: [...reports].sort((a, b) => new Date(b.submittedAt || b.updatedAt) - new Date(a.submittedAt || a.updatedAt)).slice(0, 6).map((r) => reportRow(r, admin ? reportHref : () => null)),
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

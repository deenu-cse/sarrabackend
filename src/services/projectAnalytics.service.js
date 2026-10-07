import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import { BudgetAllocationEntry } from '../models/BudgetAllocation.model.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';

/**
 * State-wide analytics over the project workflow:
 *   projects (sanction pipeline) → budget released in installments → monthly
 *   progress reported by each department's PIA officer.
 *
 * Scope of the filters
 *   district / department / headCode / projectStatus   choose which project
 *                                                      departments are counted
 *   financialYear / month                              restrict time-based
 *                                                      figures (released,
 *                                                      spent, reports, trend)
 *   mprStatus                                          restrict reports only
 *
 * Sanctioned budget is a project-lifetime figure and is never time-filtered.
 * All money is in Rs. lakh; sums are done in whole rupees.
 */

const MONEY = 100000;
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY);
const fromMoney = (units) => units / MONEY;
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

const FY_MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
const FY_LABEL = /^(\d{4})-(\d{2})$/;
const fyLabel = (startYear) => `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
const fyStartOfPeriod = (periodIndex) => (periodIndex % 12 >= 3 ? Math.floor(periodIndex / 12) : Math.floor(periodIndex / 12) - 1);
const periodOfDate = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const periodLabel = (periodIndex) => `${FY_MONTHS[((periodIndex % 12) + 9) % 12]} ${Math.floor(periodIndex / 12)}`;
const shortPeriod = (periodIndex) => `${FY_MONTHS[((periodIndex % 12) + 9) % 12].slice(0, 3)} '${String(Math.floor(periodIndex / 12)).slice(2)}`;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const sameText = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();

const PIPELINE = [
  SANCTION_STATUS.PENDING_CHECKER, SANCTION_STATUS.PENDING_APPROVER, SANCTION_STATUS.SANCTIONED,
  SANCTION_STATUS.FORWARDED_TO_DISTRICT, SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA,
  SANCTION_STATUS.PIA_ACCEPTED, SANCTION_STATUS.REJECTED,
];

const emptyBucket = (name) => ({
  name, projects: new Set(), departments: 0, budget: 0, sarra: 0, released: 0, spent: 0,
  reports: 0, awaitingDistrict: 0, awaitingState: 0, verified: 0, returned: 0,
  physicalSum: 0, physicalCount: 0, assigned: 0, accepted: 0,
});

const finishBucket = (bucket) => ({
  name: bucket.name,
  projects: bucket.projects.size,
  departments: bucket.departments,
  budgetLakh: fromMoney(bucket.budget),
  sarraShareLakh: fromMoney(bucket.sarra),
  releasedLakh: fromMoney(bucket.released),
  spentLakh: fromMoney(bucket.spent),
  unspentLakh: fromMoney(Math.max(0, bucket.released - bucket.spent)),
  releasePercent: percent(bucket.released, bucket.budget),
  utilisationPercent: percent(bucket.spent, bucket.released),
  spendPercent: percent(bucket.spent, bucket.budget),
  physicalPercent: bucket.physicalCount ? Math.round((bucket.physicalSum / bucket.physicalCount) * 10) / 10 : 0,
  reports: bucket.reports,
  awaitingDistrict: bucket.awaitingDistrict,
  awaitingState: bucket.awaitingState,
  verified: bucket.verified,
  returned: bucket.returned,
  piaAssigned: bucket.assigned,
  piaAccepted: bucket.accepted,
});

export const getProjectAnalytics = async (query = {}) => {
  const financialYear = FY_LABEL.test(text(query.financialYear)) ? text(query.financialYear) : '';
  const fyStartYear = financialYear ? Number(financialYear.slice(0, 4)) : null;
  const month = FY_MONTHS.includes(text(query.month)) ? text(query.month) : '';
  const district = text(query.district);
  const department = text(query.department);
  const headCode = text(query.headCode);
  const projectStatus = Object.values(SANCTION_STATUS).includes(text(query.projectStatus)) ? text(query.projectStatus) : '';
  const mprStatus = Object.values(PROJECT_MPR_STATUS).includes(text(query.mprStatus)) ? text(query.mprStatus) : '';

  // Everything department-wise (the project workflow); option lists come from the unfiltered set.
  const allProjects = await ProjectSanction.find({ 'departmentAllocations.0': { $exists: true } })
    .select('projectId sanctionId projectTitle district status head isActive createdAt approverAt departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.deptShareLakh departmentAllocations.sarraShareLakh departmentAllocations.totalLakh departmentAllocations.activities departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt')
    .lean();

  const options = {
    districts: [...new Set(allProjects.map((p) => p.district).filter(Boolean))].sort(),
    departments: [...new Set(allProjects.flatMap((p) => p.departmentAllocations.map((d) => d.departmentName)))].sort(),
    heads: [...new Map(allProjects.filter((p) => p.head?.code).map((p) => [p.head.code, { code: p.head.code, name: p.head.name || '' }])).values()].sort((a, b) => a.code.localeCompare(b.code)),
    months: FY_MONTHS,
  };

  const projects = allProjects.filter((p) => (!district || p.district === district)
    && (!headCode || p.head?.code === headCode)
    && (!projectStatus || p.status === projectStatus)
    && (!department || p.departmentAllocations.some((d) => sameText(d.departmentName, department))));

  // The units everything is attributed to: one department of one project.
  const units = new Map();
  projects.forEach((project) => project.departmentAllocations.forEach((allocation) => {
    if (department && !sameText(allocation.departmentName, department)) return;
    units.set(`${project._id}:${allocation.departmentId}`, { project, allocation });
  }));
  const projectIds = projects.map((p) => p._id);

  const [entries, reports] = await Promise.all([
    BudgetAllocationEntry.find({ project: { $in: projectIds } }).select('project departmentId amountLakh allocationDate installmentNumber').lean(),
    ProjectMPR.find({ project: { $in: projectIds } }).select('-revisionHistory').populate('submittedBy', 'name').sort({ periodIndex: 1 }).lean(),
  ]);

  const inPeriod = (periodIndex) => (fyStartYear === null || fyStartOfPeriod(periodIndex) === fyStartYear)
    && (!month || FY_MONTHS[((periodIndex % 12) + 9) % 12] === month);

  const allYears = new Set();
  reports.forEach((r) => allYears.add(fyStartOfPeriod(r.periodIndex)));
  entries.forEach((e) => allYears.add(fyStartOfPeriod(periodOfDate(new Date(e.allocationDate)))));
  const now = new Date();
  allYears.add(fyStartOfPeriod(now.getFullYear() * 12 + now.getMonth()));
  options.financialYears = [...allYears].sort((a, b) => b - a).map(fyLabel);

  const scopedEntries = entries.filter((e) => units.has(`${e.project}:${e.departmentId}`) && inPeriod(periodOfDate(new Date(e.allocationDate))));
  const unitReports = reports.filter((r) => units.has(`${r.project}:${r.departmentId}`));
  const scopedReports = unitReports.filter((r) => inPeriod(r.periodIndex) && (!mprStatus || r.status === mprStatus));

  // ── Buckets ────────────────────────────────────────────────────────────────
  const total = emptyBucket('All');
  const byDistrict = new Map(); const byDepartment = new Map(); const byHead = new Map();
  const bucketOf = (map, name) => { if (!map.has(name)) map.set(name, emptyBucket(name)); return map.get(name); };
  const bucketsFor = ({ project, allocation }) => [
    total,
    bucketOf(byDistrict, project.district || 'Unknown'),
    bucketOf(byDepartment, allocation.departmentName),
    bucketOf(byHead, project.head?.code ? `${project.head.code} ${project.head.name || ''}`.trim() : 'No head'),
  ];

  const unitFigures = new Map(); // released / spent per unit, in scope
  units.forEach((unit, key) => {
    unitFigures.set(key, { released: 0, spent: 0, lifetimeReleased: 0, lifetimeSpent: 0 });
    bucketsFor(unit).forEach((bucket) => {
      bucket.projects.add(String(unit.project._id));
      bucket.departments += 1;
      bucket.budget += toMoney(unit.allocation.totalLakh);
      bucket.sarra += toMoney(unit.allocation.sarraShareLakh);
      if (unit.allocation.piaUserId) bucket.assigned += 1;
      if (unit.allocation.piaAcceptedAt) bucket.accepted += 1;
    });
  });

  entries.forEach((entry) => {
    const figures = unitFigures.get(`${entry.project}:${entry.departmentId}`);
    if (figures) figures.lifetimeReleased += toMoney(entry.amountLakh);
  });
  scopedEntries.forEach((entry) => {
    const key = `${entry.project}:${entry.departmentId}`;
    unitFigures.get(key).released += toMoney(entry.amountLakh);
    bucketsFor(units.get(key)).forEach((bucket) => { bucket.released += toMoney(entry.amountLakh); });
  });

  const latestReport = new Map(); // latest report in scope per unit (reports are sorted by period)
  unitReports.forEach((report) => {
    const figures = unitFigures.get(`${report.project}:${report.departmentId}`);
    figures.lifetimeSpent += toMoney(report.totals?.financialCurrentLakh);
  });
  scopedReports.forEach((report) => {
    const key = `${report.project}:${report.departmentId}`;
    const spent = toMoney(report.totals?.financialCurrentLakh);
    unitFigures.get(key).spent += spent;
    latestReport.set(key, report);
    bucketsFor(units.get(key)).forEach((bucket) => {
      bucket.spent += spent;
      bucket.reports += 1;
      if (report.status === PROJECT_MPR_STATUS.SUBMITTED) bucket.awaitingDistrict += 1;
      else if (report.status === PROJECT_MPR_STATUS.DISTRICT_APPROVED) bucket.awaitingState += 1;
      else if (report.status === PROJECT_MPR_STATUS.STATE_VERIFIED) bucket.verified += 1;
      else if (report.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA) bucket.returned += 1;
    });
  });
  latestReport.forEach((report, key) => {
    bucketsFor(units.get(key)).forEach((bucket) => { bucket.physicalSum += report.totals?.physicalPercent || 0; bucket.physicalCount += 1; });
  });

  // ── Pipeline (projects by stage) ───────────────────────────────────────────
  const pipeline = PIPELINE.map((status) => {
    const inStage = projects.filter((p) => p.status === status);
    return {
      status,
      projects: inStage.length,
      budgetLakh: fromMoney(inStage.reduce((sum, p) => sum + p.departmentAllocations.reduce((s, d) => s + toMoney(d.totalLakh), 0), 0)),
    };
  });

  // ── Monthly trend: released vs spent vs reports filed ──────────────────────
  const trend = new Map();
  const trendRow = (periodIndex) => { if (!trend.has(periodIndex)) trend.set(periodIndex, { periodIndex, released: 0, spent: 0, reports: 0 }); return trend.get(periodIndex); };
  scopedEntries.forEach((entry) => { trendRow(periodOfDate(new Date(entry.allocationDate))).released += toMoney(entry.amountLakh); });
  scopedReports.forEach((report) => { const row = trendRow(report.periodIndex); row.spent += toMoney(report.totals?.financialCurrentLakh); row.reports += 1; });
  const periods = [...trend.keys()].sort((a, b) => a - b);
  const monthlyTrend = [];
  if (periods.length) {
    let cumulativeReleased = 0; let cumulativeSpent = 0;
    // Fill gaps so the axis is continuous (capped to keep the chart readable).
    const first = Math.max(periods[0], periods[periods.length - 1] - 35);
    for (let periodIndex = first; periodIndex <= periods[periods.length - 1]; periodIndex += 1) {
      const row = trend.get(periodIndex) || { released: 0, spent: 0, reports: 0 };
      cumulativeReleased += row.released; cumulativeSpent += row.spent;
      monthlyTrend.push({
        period: periodLabel(periodIndex), label: shortPeriod(periodIndex),
        releasedLakh: fromMoney(row.released), spentLakh: fromMoney(row.spent), reports: row.reports,
        cumulativeReleasedLakh: fromMoney(cumulativeReleased), cumulativeSpentLakh: fromMoney(cumulativeSpent),
      });
    }
  }

  // ── Activities: planned vs reported ────────────────────────────────────────
  const activities = new Map();
  units.forEach(({ allocation }) => (allocation.activities || []).forEach((activity) => {
    const row = activities.get(activity.activityName) || { name: activity.activityName, unit: activity.unit || '', physicalTarget: 0, physicalDone: 0, financialTarget: 0, financialDone: 0, departments: 0 };
    row.physicalTarget += Math.round((activity.physicalTarget || 0) * 1000);
    row.financialTarget += toMoney(activity.financialTargetLakh);
    row.departments += 1;
    activities.set(activity.activityName, row);
  }));
  scopedReports.forEach((report) => (report.activities || []).forEach((activity) => {
    const row = activities.get(activity.activityName);
    if (!row) return;
    row.physicalDone += Math.round((activity.physicalCurrent || 0) * 1000);
    row.financialDone += toMoney(activity.financialCurrentLakh);
  }));
  const activityProgress = [...activities.values()]
    .sort((a, b) => b.financialTarget - a.financialTarget)
    .slice(0, 25)
    .map((row) => ({
      name: row.name, unit: row.unit, departments: row.departments,
      physicalTarget: row.physicalTarget / 1000, physicalDone: row.physicalDone / 1000, physicalPercent: percent(row.physicalDone, row.physicalTarget),
      financialTargetLakh: fromMoney(row.financialTarget), financialDoneLakh: fromMoney(row.financialDone), financialPercent: percent(row.financialDone, row.financialTarget),
    }));

  // ── Attention lists ────────────────────────────────────────────────────────
  const unitRow = (key) => {
    const { project, allocation } = units.get(key);
    return { projectId: String(project._id), projectCode: project.projectId || project.sanctionId || '', projectName: project.projectTitle || '', district: project.district, department: allocation.departmentName };
  };

  // Spending ahead of release is judged on lifetime figures, whatever the period filter.
  const overspent = [...unitFigures.entries()]
    .filter(([, f]) => f.lifetimeSpent > f.lifetimeReleased)
    .map(([key, f]) => ({ ...unitRow(key), releasedLakh: fromMoney(f.lifetimeReleased), spentLakh: fromMoney(f.lifetimeSpent), excessLakh: fromMoney(f.lifetimeSpent - f.lifetimeReleased) }))
    .sort((a, b) => b.excessLakh - a.excessLakh);

  const idleFunds = [...unitFigures.entries()]
    .filter(([, f]) => f.lifetimeReleased > 0 && f.lifetimeSpent * 2 < f.lifetimeReleased)
    .map(([key, f]) => ({ ...unitRow(key), releasedLakh: fromMoney(f.lifetimeReleased), spentLakh: fromMoney(f.lifetimeSpent), utilisationPercent: percent(f.lifetimeSpent, f.lifetimeReleased) }))
    .sort((a, b) => b.releasedLakh - a.releasedLakh);

  // Reporting compliance for the last completed month: accepted departments that filed for it.
  const lastCompleted = now.getFullYear() * 12 + now.getMonth() - 1;
  const filedLastMonth = new Set(unitReports.filter((r) => r.periodIndex === lastCompleted).map((r) => `${r.project}:${r.departmentId}`));
  const expected = [...units.entries()].filter(([, unit]) => unit.allocation.piaAcceptedAt && periodOfDate(new Date(unit.allocation.piaAcceptedAt)) <= lastCompleted);
  const missing = expected.filter(([key]) => !filedLastMonth.has(key)).map(([key]) => unitRow(key));

  const unassigned = [...units.entries()]
    .filter(([, unit]) => !unit.allocation.piaUserId && [SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA].includes(unit.project.status))
    .map(([key]) => unitRow(key));

  const totals = finishBucket(total);
  const sortByBudget = (list) => list.map(finishBucket).sort((a, b) => b.budgetLakh - a.budgetLakh);

  return {
    filters: { financialYear, month, district, department, headCode, projectStatus, mprStatus },
    options,
    generatedAt: now,
    kpis: {
      ...totals,
      activeProjects: projects.filter((p) => p.isActive).length,
      sanctionedProjects: projects.filter((p) => ![SANCTION_STATUS.PENDING_CHECKER, SANCTION_STATUS.PENDING_APPROVER, SANCTION_STATUS.REJECTED, SANCTION_STATUS.DRAFT].includes(p.status)).length,
      overspentDepartments: overspent.length,
      installments: scopedEntries.length,
    },
    pipeline,
    reportStatus: {
      awaitingDistrict: totals.awaitingDistrict,
      awaitingState: totals.awaitingState,
      verified: totals.verified,
      returned: totals.returned,
    },
    monthlyTrend,
    byDistrict: sortByBudget([...byDistrict.values()]),
    byDepartment: sortByBudget([...byDepartment.values()]),
    byHead: sortByBudget([...byHead.values()]),
    activityProgress,
    compliance: {
      period: periodLabel(lastCompleted),
      expected: expected.length,
      filed: expected.length - missing.length,
      percent: percent(expected.length - missing.length, expected.length),
      missing: missing.slice(0, 50),
      missingCount: missing.length,
    },
    attention: {
      overspent: overspent.slice(0, 25),
      idleFunds: idleFunds.slice(0, 25),
      unassigned: unassigned.slice(0, 25),
      unassignedCount: unassigned.length,
    },
    recentReports: [...scopedReports].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).slice(0, 12).map((r) => ({
      id: String(r._id), mprNo: r.mprNo, period: periodLabel(r.periodIndex), district: r.district, department: r.departmentName,
      projectCode: r.projectCode, status: r.status, spentLakh: r.totals?.financialCurrentLakh || 0, physicalPercent: r.totals?.physicalPercent || 0,
      submittedBy: r.submittedBy?.name || '', submittedAt: r.submittedAt,
    })),
  };
};

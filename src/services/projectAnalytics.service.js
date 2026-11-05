import ProjectSanction, { REPORTING_MODE } from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import User from '../models/User.model.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import { AT_DISTRICT, AT_HQ, AT_PIA, IN_REVIEW, statusLabel, stageOwner } from './mprWorkflow.js';

/**
 * State-wide analytics over the project workflow:
 *   projects (sanction pipeline) → monthly progress reported for each
 *   department → three-tier verification of each report.
 *
 * Scope of the filters
 *   district / department / headCode / projectStatus   choose which project
 *                                                      departments are counted
 *   financialYear / month                              restrict time-based
 *                                                      figures (spent, reports,
 *                                                      trend)
 *   mprStatus                                          restrict reports only
 *
 * Sanctioned budget is a project-lifetime figure and is never time-filtered.
 * All money is in Rs. lakh; sums are done in whole rupees. Drafts and rejected
 * reports are never counted.
 */

const MONEY = 100000;
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY);
const fromMoney = (units) => units / MONEY;
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const DAY = 86400000;

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

const COUNTED = (status) => status !== PROJECT_MPR_STATUS.DRAFT && status !== PROJECT_MPR_STATUS.REJECTED;

const emptyBucket = (name) => ({
  name, projects: new Set(), departments: 0, budget: 0, sarra: 0, spent: 0,
  reports: 0, atPia: 0, atDistrict: 0, atHq: 0, verified: 0, returned: 0, rejected: 0,
  physicalSum: 0, physicalCount: 0, assigned: 0, accepted: 0, districtEntry: 0,
});

const finishBucket = (bucket) => ({
  name: bucket.name,
  projects: bucket.projects.size,
  departments: bucket.departments,
  budgetLakh: fromMoney(bucket.budget),
  sarraShareLakh: fromMoney(bucket.sarra),
  spentLakh: fromMoney(bucket.spent),
  balanceLakh: fromMoney(Math.max(0, bucket.budget - bucket.spent)),
  spendPercent: percent(bucket.spent, bucket.budget),
  physicalPercent: bucket.physicalCount ? Math.round((bucket.physicalSum / bucket.physicalCount) * 10) / 10 : 0,
  reports: bucket.reports,
  atPia: bucket.atPia,
  atDistrict: bucket.atDistrict,
  atHq: bucket.atHq,
  verified: bucket.verified,
  returned: bucket.returned,
  rejected: bucket.rejected,
  piaAssigned: bucket.assigned,
  piaAccepted: bucket.accepted,
  districtEntry: bucket.districtEntry,
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
    .select('projectId sanctionId projectTitle district status head isActive createdAt approverAt location departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.deptShareLakh departmentAllocations.sarraShareLakh departmentAllocations.totalLakh departmentAllocations.activities departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt departmentAllocations.reportingMode departmentAllocations.districtStaffUserId departmentAllocations.reportingAssignedAt')
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
  const piaIds = [...new Set([...units.values()].map((u) => String(u.allocation.piaUserId || '')).filter(Boolean))];

  const [reports, piaUsers] = await Promise.all([
    ProjectMPR.find({ project: { $in: projectIds }, status: { $ne: PROJECT_MPR_STATUS.DRAFT } }).select('-revisionHistory').populate('submittedBy', 'name').sort({ periodIndex: 1 }).lean(),
    piaIds.length ? User.find({ _id: { $in: piaIds } }).select('name designation').lean() : [],
  ]);
  const piaName = new Map(piaUsers.map((u) => [String(u._id), u.name]));

  const inPeriod = (periodIndex) => (fyStartYear === null || fyStartOfPeriod(periodIndex) === fyStartYear)
    && (!month || FY_MONTHS[((periodIndex % 12) + 9) % 12] === month);

  const allYears = new Set();
  reports.forEach((r) => allYears.add(fyStartOfPeriod(r.periodIndex)));
  const now = new Date();
  allYears.add(fyStartOfPeriod(now.getFullYear() * 12 + now.getMonth()));
  options.financialYears = [...allYears].sort((a, b) => b - a).map(fyLabel);

  const unitReports = reports.filter((r) => units.has(`${r.project}:${r.departmentId}`));
  const scopedReports = unitReports.filter((r) => inPeriod(r.periodIndex) && (!mprStatus || r.status === mprStatus));

  // ── Buckets ────────────────────────────────────────────────────────────────
  const total = emptyBucket('All');
  const byDistrict = new Map(); const byDepartment = new Map(); const byHead = new Map(); const byPia = new Map();
  const bucketOf = (map, name) => { if (!map.has(name)) map.set(name, emptyBucket(name)); return map.get(name); };
  const piaKey = (unit) => (unit.allocation.piaUserId ? `${unit.allocation.piaUserId}|${unit.project.district}|${unit.allocation.departmentName}` : null);
  const bucketsFor = (unit) => {
    const list = [
      total,
      bucketOf(byDistrict, unit.project.district || 'Unknown'),
      bucketOf(byDepartment, unit.allocation.departmentName),
      bucketOf(byHead, unit.project.head?.code ? `${unit.project.head.code} ${unit.project.head.name || ''}`.trim() : 'No head'),
    ];
    const key = piaKey(unit);
    if (key) {
      const bucket = bucketOf(byPia, key);
      bucket.label = `${piaName.get(String(unit.allocation.piaUserId)) || 'PIA'} — ${unit.allocation.departmentName}, ${unit.project.district}`;
      list.push(bucket);
    }
    return list;
  };

  units.forEach((unit) => {
    bucketsFor(unit).forEach((bucket) => {
      bucket.projects.add(String(unit.project._id));
      bucket.departments += 1;
      bucket.budget += toMoney(unit.allocation.totalLakh);
      bucket.sarra += toMoney(unit.allocation.sarraShareLakh);
      if (unit.allocation.piaUserId) bucket.assigned += 1;
      if (unit.allocation.piaAcceptedAt) bucket.accepted += 1;
      if (unit.allocation.reportingMode === REPORTING_MODE.DISTRICT) bucket.districtEntry += 1;
    });
  });

  const latestReport = new Map(); // latest counted report in scope per unit (reports are sorted by period)
  scopedReports.forEach((report) => {
    const key = `${report.project}:${report.departmentId}`;
    const counted = COUNTED(report.status);
    const spent = counted ? toMoney(report.totals?.financialCurrentLakh) : 0;
    if (counted) latestReport.set(key, report);
    bucketsFor(units.get(key)).forEach((bucket) => {
      bucket.spent += spent;
      if (counted) bucket.reports += 1;
      if (AT_PIA.includes(report.status)) bucket.atPia += 1;
      else if (AT_DISTRICT.includes(report.status)) bucket.atDistrict += 1;
      else if (AT_HQ.includes(report.status)) bucket.atHq += 1;
      else if (report.status === PROJECT_MPR_STATUS.VERIFIED_BY_STATE) bucket.verified += 1;
      else if (report.status === PROJECT_MPR_STATUS.RETURNED_FOR_CORRECTION) bucket.returned += 1;
      else if (report.status === PROJECT_MPR_STATUS.REJECTED) bucket.rejected += 1;
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

  // ── Pending Maker / Checker / Approver actions on reports ──────────────────
  const pendingByStage = IN_REVIEW.map((status) => {
    const waiting = unitReports.filter((r) => r.status === status);
    const oldest = waiting.reduce((max, r) => Math.max(max, now - new Date(r.stageEnteredAt || r.updatedAt || now).getTime()), 0);
    return { status, label: statusLabel(status), owner: stageOwner(status), count: waiting.length, oldestDays: Math.floor(oldest / DAY) };
  });

  // ── Monthly trend: expenditure and reports filed ───────────────────────────
  const trend = new Map();
  const trendRow = (periodIndex) => { if (!trend.has(periodIndex)) trend.set(periodIndex, { periodIndex, spent: 0, reports: 0, verified: 0 }); return trend.get(periodIndex); };
  scopedReports.filter((r) => COUNTED(r.status)).forEach((report) => {
    const row = trendRow(report.periodIndex);
    row.spent += toMoney(report.totals?.financialCurrentLakh);
    row.reports += 1;
    if (report.status === PROJECT_MPR_STATUS.VERIFIED_BY_STATE) row.verified += 1;
  });
  const periods = [...trend.keys()].sort((a, b) => a - b);
  const monthlyTrend = [];
  if (periods.length) {
    let cumulativeSpent = 0;
    // Fill gaps so the axis is continuous (capped to keep the chart readable).
    const first = Math.max(periods[0], periods[periods.length - 1] - 35);
    for (let periodIndex = first; periodIndex <= periods[periods.length - 1]; periodIndex += 1) {
      const row = trend.get(periodIndex) || { spent: 0, reports: 0, verified: 0 };
      cumulativeSpent += row.spent;
      monthlyTrend.push({
        period: periodLabel(periodIndex), label: shortPeriod(periodIndex),
        spentLakh: fromMoney(row.spent), reports: row.reports, verified: row.verified,
        cumulativeSpentLakh: fromMoney(cumulativeSpent),
      });
    }
  }

  // ── Activities: approved DPR targets vs achieved ───────────────────────────
  const activities = new Map();
  units.forEach(({ allocation }) => (allocation.activities || []).forEach((activity) => {
    const row = activities.get(activity.activityName) || { name: activity.activityName, unit: activity.unit || '', physicalTarget: 0, physicalDone: 0, financialTarget: 0, financialDone: 0, departments: 0 };
    row.physicalTarget += Math.round((activity.physicalTarget || 0) * 1000);
    row.financialTarget += toMoney(activity.financialTargetLakh);
    row.departments += 1;
    activities.set(activity.activityName, row);
  }));
  scopedReports.filter((r) => COUNTED(r.status)).forEach((report) => (report.activities || []).forEach((activity) => {
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
  const readySince = (allocation) => (allocation.reportingMode === REPORTING_MODE.DISTRICT
    ? (allocation.districtStaffUserId ? allocation.reportingAssignedAt || null : null)
    : allocation.piaAcceptedAt || null);

  // Reporting compliance for the last completed month: departments ready for reporting that filed for it.
  const lastCompleted = now.getFullYear() * 12 + now.getMonth() - 1;
  const filedLastMonth = new Set(unitReports.filter((r) => r.periodIndex === lastCompleted && COUNTED(r.status)).map((r) => `${r.project}:${r.departmentId}`));
  const expected = [...units.entries()].filter(([, unit]) => readySince(unit.allocation) && periodOfDate(new Date(readySince(unit.allocation))) <= lastCompleted);
  const missing = expected.filter(([key]) => !filedLastMonth.has(key)).map(([key]) => unitRow(key));

  const unassigned = [...units.entries()]
    .filter(([, unit]) => !readySince(unit.allocation) && [SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA].includes(unit.project.status))
    .map(([key]) => unitRow(key));

  // Departments whose reported physical progress lags far behind their spending.
  const lagging = [...latestReport.entries()]
    .filter(([, r]) => (r.totals?.financialPercent || 0) - (r.totals?.physicalPercent || 0) >= 25)
    .map(([key, r]) => ({ ...unitRow(key), physicalPercent: r.totals?.physicalPercent || 0, financialPercent: r.totals?.financialPercent || 0 }))
    .sort((a, b) => (b.financialPercent - b.physicalPercent) - (a.financialPercent - a.physicalPercent));

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
      pendingActions: pendingByStage.reduce((sum, row) => sum + row.count, 0),
    },
    pipeline,
    pendingByStage,
    reportStatus: {
      atPia: totals.atPia,
      atDistrict: totals.atDistrict,
      atHq: totals.atHq,
      verified: totals.verified,
      returned: totals.returned,
      rejected: totals.rejected,
    },
    monthlyTrend,
    byDistrict: sortByBudget([...byDistrict.values()]),
    byDepartment: sortByBudget([...byDepartment.values()]),
    byHead: sortByBudget([...byHead.values()]),
    byPia: [...byPia.values()].map((bucket) => ({ ...finishBucket(bucket), name: bucket.label })).sort((a, b) => b.budgetLakh - a.budgetLakh).slice(0, 50),
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
      lagging: lagging.slice(0, 25),
      unassigned: unassigned.slice(0, 25),
      unassignedCount: unassigned.length,
    },
    recentReports: [...scopedReports].sort((a, b) => new Date(b.submittedAt || b.updatedAt) - new Date(a.submittedAt || a.updatedAt)).slice(0, 12).map((r) => ({
      id: String(r._id), mprNo: r.mprNo, period: periodLabel(r.periodIndex), district: r.district, department: r.departmentName,
      projectCode: r.projectCode, status: r.status, entryMode: r.entryMode || 'PIA', spentLakh: r.totals?.financialCurrentLakh || 0, physicalPercent: r.totals?.physicalPercent || 0,
      submittedBy: r.submittedBy?.name || '', submittedAt: r.submittedAt,
    })),
  };
};

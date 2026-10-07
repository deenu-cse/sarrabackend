import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import User from '../models/User.model.js';
import { SystemSettings, ReminderLog, ReportDispatch } from '../models/ProjectLifecycle.model.js';
import { safeNotify, activeUserQuery } from './workflowNotification.service.js';
import { buildRegisterWorkbook, formatMoney } from './mprDocuments.service.js';
import { sendEmail } from '../utils/email/sendEmail.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

/**
 * Deadlines, reminders and the monthly e-mail summary.
 *
 * The rule: the progress report for a month is due by a fixed day of the next
 * month (5th by default). A department owes that report from the month its
 * PIA officer accepted the project until its completion report is filed.
 *
 * All dates are worked out in Indian Standard Time.
 */

const bad = (message) => new ApiError(HTTP_STATUS.BAD_REQUEST, message);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 86400000;
const IST_OFFSET = 330 * 60000;
const MONEY = 100000;
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY);
const fromMoney = (units) => units / MONEY;

/** "Now" shifted so that its UTC fields read as the IST wall clock. */
const istClock = (date = new Date()) => new Date(date.getTime() + IST_OFFSET);
const dayStart = (clock) => Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
const dayKey = (clock) => clock.toISOString().slice(0, 10);
const periodOfClock = (clock) => clock.getUTCFullYear() * 12 + clock.getUTCMonth();
const periodOfDate = (date) => periodOfClock(istClock(new Date(date)));
const periodLabel = (period) => `${MONTHS[period % 12]} ${Math.floor(period / 12)}`;
const periodParts = (period) => {
  const year = Math.floor(period / 12);
  const month = period % 12;
  const fyStart = month >= 3 ? year : year - 1;
  return { reportingMonth: MONTHS[month], financialYear: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}` };
};
/** Due date (as an IST calendar day) of the report for `period`. */
const dueDayOf = (period, dueDay) => Date.UTC(Math.floor((period + 1) / 12), (period + 1) % 12, dueDay);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ─── Settings ────────────────────────────────────────────────────────────────

export const getSettings = async () => {
  let settings = await SystemSettings.findById('system');
  if (!settings) {
    try { settings = await SystemSettings.create({ _id: 'system' }); } catch (err) {
      if (err?.code !== 11000) throw err;
      settings = await SystemSettings.findById('system');
    }
  }
  return settings;
};

const settingsDto = (settings) => ({
  deadlines: {
    mprDueDay: settings.deadlines.mprDueDay,
    remindDaysBefore: settings.deadlines.remindDaysBefore,
    escalateToDistrictAfterDays: settings.deadlines.escalateToDistrictAfterDays,
    escalateToStateAfterDays: settings.deadlines.escalateToStateAfterDays,
    districtReviewDays: settings.deadlines.districtReviewDays,
    remindersEnabled: settings.deadlines.remindersEnabled,
  },
  emailReports: {
    enabled: settings.emailReports.enabled,
    dayOfMonth: settings.emailReports.dayOfMonth,
    sendToStateAdmins: settings.emailReports.sendToStateAdmins,
    sendToMneAdmins: settings.emailReports.sendToMneAdmins,
    sendToDistricts: settings.emailReports.sendToDistricts,
    extraRecipients: settings.emailReports.extraRecipients || [],
  },
  lastRun: Object.fromEntries(settings.lastRun || []),
  updatedAt: settings.updatedAt,
});

export const readSettings = async () => settingsDto(await getSettings());

const canManage = (user) => [USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN].includes(user.role);

const wholeNumber = (value, label, min, max) => {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(number) || number < min || number > max) throw bad(`${label} must be a whole number from ${min} to ${max}.`);
  return number;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const updateSettings = async (body = {}, user) => {
  if (!canManage(user)) throw forbidden('Only the State or M&E administrator can change these settings.');
  const settings = await getSettings();
  const d = body.deadlines || {};
  const e = body.emailReports || {};
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  if (has(d, 'mprDueDay')) settings.deadlines.mprDueDay = wholeNumber(d.mprDueDay, 'Due day', 1, 28);
  if (has(d, 'remindDaysBefore')) settings.deadlines.remindDaysBefore = wholeNumber(d.remindDaysBefore, 'Reminder days', 0, 15);
  if (has(d, 'escalateToDistrictAfterDays')) settings.deadlines.escalateToDistrictAfterDays = wholeNumber(d.escalateToDistrictAfterDays, 'District escalation days', 1, 30);
  if (has(d, 'escalateToStateAfterDays')) settings.deadlines.escalateToStateAfterDays = wholeNumber(d.escalateToStateAfterDays, 'State escalation days', 1, 60);
  if (has(d, 'districtReviewDays')) settings.deadlines.districtReviewDays = wholeNumber(d.districtReviewDays, 'District review days', 1, 30);
  if (has(d, 'remindersEnabled')) settings.deadlines.remindersEnabled = Boolean(d.remindersEnabled);
  if (settings.deadlines.escalateToStateAfterDays <= settings.deadlines.escalateToDistrictAfterDays) {
    throw bad('The State must be told later than the district. Increase the State escalation days.');
  }

  if (has(e, 'enabled')) settings.emailReports.enabled = Boolean(e.enabled);
  if (has(e, 'dayOfMonth')) settings.emailReports.dayOfMonth = wholeNumber(e.dayOfMonth, 'Day of month', 1, 28);
  ['sendToStateAdmins', 'sendToMneAdmins', 'sendToDistricts'].forEach((key) => { if (has(e, key)) settings.emailReports[key] = Boolean(e[key]); });
  if (has(e, 'extraRecipients')) {
    const list = [...new Set((Array.isArray(e.extraRecipients) ? e.extraRecipients : []).map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean))];
    if (list.length > 10) throw bad('At most 10 additional e-mail addresses can be added.');
    const wrong = list.find((address) => !EMAIL.test(address) || address.length > 120);
    if (wrong) throw bad(`"${wrong}" is not a valid e-mail address.`);
    settings.emailReports.extraRecipients = list;
  }
  settings.updatedBy = user._id;
  await settings.save();
  return settingsDto(settings);
};

// ─── What is due ─────────────────────────────────────────────────────────────

const REPORTING = [SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED];
const completionFiled = (department) => ['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status);

/**
 * Every department that owes (or has filed) last month's report, plus reports
 * waiting for correction and for district review, within `projectFilter`.
 */
export const collectDeadlines = async (settings, projectFilter = {}, ownsDepartment = () => true, now = new Date()) => {
  const clock = istClock(now);
  const today = dayStart(clock);
  const currentPeriod = periodOfClock(clock);
  const period = currentPeriod - 1;
  const { mprDueDay, remindDaysBefore, districtReviewDays } = settings.deadlines;
  const due = dueDayOf(period, mprDueDay);

  const projects = await ProjectSanction.find({ ...projectFilter, status: { $in: REPORTING }, 'closure.status': { $ne: 'CLOSED' } })
    .select('projectId sanctionId projectTitle district departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt departmentAllocations.completion')
    .lean();
  const reports = projects.length
    ? await ProjectMPR.find({ project: { $in: projects.map((p) => p._id) } })
      .select('project departmentId periodIndex status mprNo submittedAt updatedAt departmentName projectCode projectTitle district returnedByLevel').lean()
    : [];
  const officerIds = [...new Set(projects.flatMap((p) => (p.departmentAllocations || []).map((d) => String(d.piaUserId || '')).filter(Boolean)))];
  const officers = officerIds.length ? await User.find({ _id: { $in: officerIds } }).select('name email role isActive accountStatus').lean() : [];
  const officerById = new Map(officers.map((officer) => [String(officer._id), officer]));

  const items = [];
  const corrections = [];
  const reviews = [];
  projects.forEach((project) => (project.departmentAllocations || []).forEach((department) => {
    if (!department.piaUserId || !department.piaAcceptedAt || !ownsDepartment(department)) return;
    const chain = reports.filter((r) => String(r.project) === String(project._id) && String(r.departmentId) === String(department.departmentId));
    const officer = officerById.get(String(department.piaUserId));
    const base = {
      projectId: String(project._id),
      projectCode: project.projectId || project.sanctionId || '',
      projectName: project.projectTitle || '',
      district: project.district,
      departmentId: String(department.departmentId),
      departmentName: department.departmentName,
      officer: officer ? { id: String(officer._id), name: officer.name } : null,
    };

    chain.filter((r) => r.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA).forEach((r) => corrections.push({
      ...base, mprId: String(r._id), mprNo: r.mprNo, period: periodLabel(r.periodIndex), returnedBy: r.returnedByLevel === 'STATE' ? 'State' : 'District',
      daysPending: Math.max(0, Math.floor((today - dayStart(istClock(r.updatedAt))) / DAY)),
    }));
    chain.filter((r) => r.status === PROJECT_MPR_STATUS.SUBMITTED).forEach((r) => {
      const waiting = Math.max(0, Math.floor((today - dayStart(istClock(r.submittedAt || r.updatedAt))) / DAY));
      reviews.push({ ...base, mprId: String(r._id), mprNo: r.mprNo, period: periodLabel(r.periodIndex), submittedAt: r.submittedAt, daysWaiting: waiting, overdue: waiting > districtReviewDays, stamp: new Date(r.submittedAt || r.updatedAt).getTime() });
    });

    if (completionFiled(department)) return;
    if (period < periodOfDate(department.piaAcceptedAt)) return; // accepted this month: nothing was owed for last month
    const filed = chain.find((r) => r.periodIndex === period);
    const latest = chain.reduce((max, r) => Math.max(max, r.periodIndex), -1);
    let state;
    if (filed) state = 'FILED';
    else if (latest > period) state = 'SKIPPED'; // a later month is filed, so this one can no longer be reported
    else if (today > due) state = 'OVERDUE';
    else if ((due - today) / DAY <= remindDaysBefore) state = 'DUE_SOON';
    else state = 'DUE';
    items.push({
      ...base,
      periodIndex: period,
      period: periodLabel(period),
      ...periodParts(period),
      dueDate: isoDay(due),
      state,
      daysOverdue: state === 'OVERDUE' ? Math.floor((today - due) / DAY) : 0,
      daysLeft: state === 'DUE' || state === 'DUE_SOON' ? Math.floor((due - today) / DAY) : 0,
      mprId: filed ? String(filed._id) : null,
      mprNo: filed?.mprNo || null,
      mprStatus: filed?.status || null,
      officerId: String(department.piaUserId),
    });
  }));

  const order = { OVERDUE: 0, DUE_SOON: 1, DUE: 2, FILED: 3, SKIPPED: 4 };
  items.sort((a, b) => order[a.state] - order[b.state] || b.daysOverdue - a.daysOverdue || a.district.localeCompare(b.district) || a.projectCode.localeCompare(b.projectCode));
  reviews.sort((a, b) => b.daysWaiting - a.daysWaiting);
  corrections.sort((a, b) => b.daysPending - a.daysPending);
  return { items, corrections, reviews, period, due, today, currentPeriod, officerById };
};

/** Deadlines as seen by the signed-in user: own departments, own district, or the whole State. */
export const getDeadlines = async (user) => {
  const settings = await getSettings();
  let filter = {};
  let owns = () => true;
  if (user.role === USER_ROLES.PIA_OFFICER) {
    filter = { 'departmentAllocations.piaUserId': user._id };
    owns = (department) => String(department.piaUserId) === String(user._id);
  } else if (user.role === USER_ROLES.DD_LEVEL) {
    if (!user.district) throw forbidden('Your account has no district.');
    filter = { district: user.district };
  } else if (![USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) {
    throw forbidden('You do not have access to deadlines.');
  }
  const { items, corrections, reviews, period, due, currentPeriod } = await collect(settings, filter, owns);
  const count = (state) => items.filter((item) => item.state === state).length;
  const expected = items.filter((item) => item.state !== 'SKIPPED');

  const districts = [...new Set(items.map((item) => item.district))].sort().map((name) => {
    const mine = expected.filter((item) => item.district === name);
    return { district: name, expected: mine.length, filed: mine.filter((i) => i.state === 'FILED').length, overdue: mine.filter((i) => i.state === 'OVERDUE').length, pending: mine.filter((i) => ['DUE', 'DUE_SOON'].includes(i.state)).length };
  });

  return {
    rule: { mprDueDay: settings.deadlines.mprDueDay, districtReviewDays: settings.deadlines.districtReviewDays, remindersEnabled: settings.deadlines.remindersEnabled },
    period: { label: periodLabel(period), ...periodParts(period), dueDate: isoDay(due) },
    nextPeriod: { label: periodLabel(currentPeriod), ...periodParts(currentPeriod), dueDate: isoDay(dueDayOf(currentPeriod, settings.deadlines.mprDueDay)) },
    summary: {
      expected: expected.length,
      filed: count('FILED'),
      overdue: count('OVERDUE'),
      dueSoon: count('DUE_SOON'),
      due: count('DUE'),
      skipped: count('SKIPPED'),
      corrections: corrections.length,
      reviewsWaiting: reviews.length,
      reviewsOverdue: reviews.filter((review) => review.overdue).length,
    },
    items: items.map(({ officerId, ...item }) => item),
    corrections,
    reviews: reviews.map(({ stamp, ...review }) => review),
    districts,
  };
};

const collect = collectDeadlines;

// ─── Reminders ───────────────────────────────────────────────────────────────

/** True the first time a reminder key is seen; the unique index makes each reminder go out once. */
const claim = async (key, fields) => {
  try { await ReminderLog.create({ key, ...fields }); return true; } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
};

const reminderPayload = (extra) => ({
  actorName: 'SARRA CRM',
  actorRole: 'Automatic reminder',
  eventDate: new Date(),
  type: 'REMINDER',
  ...extra,
});

/**
 * Send whatever reminders are due today. Safe to run any number of times:
 * each reminder is keyed by project, department, month and stage.
 */
export const runReminders = async ({ now = new Date() } = {}) => {
  const settings = await getSettings();
  const result = { dueSoon: 0, overdue: 0, escalatedToDistrict: 0, escalatedToState: 0, reviewReminders: 0, skipped: !settings.deadlines.remindersEnabled };
  if (!settings.deadlines.remindersEnabled) return result;
  const { items, reviews, officerById } = await collect(settings, {}, () => true, now);
  const { escalateToDistrictAfterDays, escalateToStateAfterDays, districtReviewDays } = settings.deadlines;
  const directorsOf = new Map();
  const directors = async (district) => {
    if (!directorsOf.has(district)) directorsOf.set(district, await User.find({ ...activeUserQuery, role: USER_ROLES.DD_LEVEL, district }));
    return directorsOf.get(district);
  };
  const dueText = (item) => new Date(`${item.dueDate}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' });
  const stateQueue = [];

  for (const item of items) {
    const key = `${item.projectId}:${item.departmentId}:${item.periodIndex}`;
    const fields = { project: item.projectId, departmentId: item.departmentId, periodIndex: item.periodIndex };
    const officer = officerById.get(item.officerId);
    const common = { referenceNo: item.projectCode, projectTitle: item.projectName, relatedResource: 'ProjectSanction', relatedId: item.projectId };
    /* eslint-disable no-await-in-loop */
    if (item.state === 'DUE_SOON' && officer && await claim(`due:${key}`, { ...fields, kind: 'DUE_SOON', recipients: 1 })) {
      await safeNotify(officer, reminderPayload({
        ...common,
        title: `${item.period} progress report due on ${dueText(item)}`,
        message: `The ${item.period} report of ${item.departmentName} for ${item.projectCode} is due on ${dueText(item)}.`,
        emailDescription: `The monthly progress report for ${item.period} has not been filed yet. Please submit it on or before ${dueText(item)}.`,
        subject: `Reminder: ${item.period} MPR due on ${dueText(item)}`,
        status: 'SUBMITTED',
        primaryLabel: 'File Report',
        link: '/dashboard/officer/forms/new',
      }));
      result.dueSoon += 1;
    }
    if (item.state === 'OVERDUE') {
      if (officer && await claim(`overdue:${key}`, { ...fields, kind: 'OVERDUE', recipients: 1 })) {
        await safeNotify(officer, reminderPayload({
          ...common,
          title: `${item.period} progress report is overdue`,
          message: `The ${item.period} report of ${item.departmentName} for ${item.projectCode} was due on ${dueText(item)} and has not been filed.`,
          emailDescription: `The monthly progress report for ${item.period} was due on ${dueText(item)} and has not been filed. Please submit it today. The district will be informed if it stays pending.`,
          subject: `Overdue: ${item.period} MPR for ${item.projectCode}`,
          status: 'RETURNED_TO_PIA',
          priority: 'HIGH',
          primaryLabel: 'File Report',
          link: '/dashboard/officer/forms/new',
        }));
        result.overdue += 1;
      }
      if (item.daysOverdue >= escalateToDistrictAfterDays) {
        const list = await directors(item.district);
        if (list.length && await claim(`district:${key}`, { ...fields, kind: 'ESCALATE_DISTRICT', recipients: list.length })) {
          await safeNotify(list, reminderPayload({
            ...common,
            title: `${item.projectCode}: ${item.period} report overdue by ${item.daysOverdue} days`,
            message: `${item.departmentName}${item.officer ? ` (${item.officer.name})` : ''} has not filed the ${item.period} report, due on ${dueText(item)}.`,
            emailDescription: `A monthly progress report in your district is overdue by ${item.daysOverdue} days. Please follow up with the PIA officer.`,
            subject: `Overdue MPR in ${item.district}: ${item.projectCode}`,
            status: 'RETURNED_TO_PIA',
            priority: 'HIGH',
            primaryLabel: 'Open Project',
            link: `/dashboard/dd/projects/${item.projectId}`,
          }));
          result.escalatedToDistrict += 1;
        }
      }
      if (item.daysOverdue >= escalateToStateAfterDays && await claim(`state:${key}`, { ...fields, kind: 'ESCALATE_STATE', recipients: 0 })) {
        stateQueue.push(item);
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  // The State gets one digest, not one message per report.
  if (stateQueue.length) {
    const admins = await User.find({ ...activeUserQuery, role: USER_ROLES.MND_SUPER_ADMIN });
    const districts = [...new Set(stateQueue.map((item) => item.district))];
    const sample = stateQueue.slice(0, 5).map((item) => `${item.projectCode} (${item.departmentName}, ${item.district})`).join('; ');
    await safeNotify(admins, reminderPayload({
      title: `${stateQueue.length} progress report${stateQueue.length === 1 ? '' : 's'} overdue by more than ${escalateToStateAfterDays} days`,
      message: `${stateQueue[0].period}: ${stateQueue.length} report${stateQueue.length === 1 ? ' is' : 's are'} still not filed in ${districts.join(', ')}. ${sample}${stateQueue.length > 5 ? ' and more.' : '.'}`,
      emailDescription: `${stateQueue.length} monthly progress report(s) for ${stateQueue[0].period} are overdue by more than ${escalateToStateAfterDays} days in: ${districts.join(', ')}. Open the deadlines page for the full list.`,
      subject: `SARRA: ${stateQueue.length} overdue MPR(s) need attention`,
      referenceNo: stateQueue[0].period,
      projectTitle: `${stateQueue.length} overdue report(s)`,
      status: 'RETURNED_TO_PIA',
      priority: 'HIGH',
      primaryLabel: 'Open Deadlines',
      link: '/dashboard/mnd-admin/deadlines',
    }));
    result.escalatedToState = stateQueue.length;
  }

  for (const review of reviews.filter((entry) => entry.overdue)) {
    /* eslint-disable no-await-in-loop */
    const list = await directors(review.district);
    if (list.length && await claim(`review:${review.mprId}:${review.stamp}`, { kind: 'REVIEW_OVERDUE', project: review.projectId, departmentId: review.departmentId, recipients: list.length })) {
      await safeNotify(list, reminderPayload({
        title: `${review.mprNo} has waited ${review.daysWaiting} days for review`,
        message: `${review.departmentName} report for ${review.period} (${review.projectCode}) is waiting for district review beyond ${districtReviewDays} days.`,
        emailDescription: `A monthly progress report has been waiting for your review for ${review.daysWaiting} days. Please approve it or return it for correction.`,
        subject: `Review pending: ${review.mprNo}`,
        referenceNo: review.mprNo,
        projectTitle: review.projectName,
        status: 'SUBMITTED',
        priority: 'HIGH',
        relatedResource: 'ProjectMPR',
        relatedId: review.mprId,
        primaryLabel: 'Review MPR',
        link: `/dashboard/dd/mpr-review/project/${review.mprId}`,
      }));
      result.reviewReminders += 1;
    }
    /* eslint-enable no-await-in-loop */
  }
  return result;
};

// ─── Monthly e-mail summary ──────────────────────────────────────────────────

const SANCTIONED_ON = [SANCTION_STATUS.SANCTIONED, SANCTION_STATUS.FORWARDED_TO_DISTRICT, SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED];

/** Figures of the summary for one month, for the State or for one district. */
export const buildMonthlySummary = async ({ period, district = null, now = new Date() } = {}) => {
  const settings = await getSettings();
  const month = period ?? periodOfClock(istClock(now)) - 1;
  const scope = district ? { district } : {};
  const projects = await ProjectSanction.find({ ...scope, status: { $in: SANCTIONED_ON } })
    .select('projectId sanctionId projectTitle district totalSanctionedBudgetLakh budgetAllocation.releasedLakh closure.status').lean();
  const ids = projects.map((project) => project._id);
  const reports = ids.length
    ? await ProjectMPR.find({ project: { $in: ids }, periodIndex: { $lte: month } }).select('project district periodIndex status totals.financialCurrentLakh').lean()
    : [];
  const { items } = await collect(settings, scope, () => true, now);
  const owed = items.filter((item) => item.periodIndex === month && item.state !== 'SKIPPED');

  const figures = (subset, subsetReports, subsetOwed) => {
    const ofMonth = subsetReports.filter((report) => report.periodIndex === month);
    const units = (list, pick) => list.reduce((total, entry) => total + toMoney(pick(entry)), 0);
    const sanctioned = units(subset, (p) => p.totalSanctionedBudgetLakh);
    const released = units(subset, (p) => p.budgetAllocation?.releasedLakh);
    const spent = units(subsetReports, (r) => r.totals?.financialCurrentLakh);
    return {
      projects: subset.length,
      closed: subset.filter((p) => p.closure?.status === 'CLOSED').length,
      sanctionedLakh: fromMoney(sanctioned),
      releasedLakh: fromMoney(released),
      spentLakh: fromMoney(spent),
      spentInMonthLakh: fromMoney(units(ofMonth, (r) => r.totals?.financialCurrentLakh)),
      utilisationPercent: released > 0 ? Math.floor((Math.min(spent, released) * 10000) / released) / 100 : 0,
      reportsExpected: subsetOwed.length,
      reportsFiled: subsetOwed.filter((item) => item.state === 'FILED').length,
      reportsPending: subsetOwed.filter((item) => item.state !== 'FILED').length,
      reportsInMonth: ofMonth.length,
      awaitingDistrict: ofMonth.filter((r) => r.status === PROJECT_MPR_STATUS.SUBMITTED).length,
      approved: ofMonth.filter((r) => r.status === PROJECT_MPR_STATUS.DISTRICT_APPROVED).length,
      verified: ofMonth.filter((r) => r.status === PROJECT_MPR_STATUS.STATE_VERIFIED).length,
      returned: ofMonth.filter((r) => r.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA).length,
    };
  };

  const rows = district
    ? projects.map((project) => ({
      name: `${project.projectId || project.sanctionId || ''} ${project.projectTitle || ''}`.trim(),
      ...figures([project], reports.filter((r) => String(r.project) === String(project._id)), owed.filter((item) => item.projectId === String(project._id))),
    }))
    : [...new Set(projects.map((project) => project.district))].sort().map((name) => ({
      name,
      ...figures(projects.filter((p) => p.district === name), reports.filter((r) => r.district === name), owed.filter((item) => item.district === name)),
    }));

  return {
    period: month,
    periodLabel: periodLabel(month),
    ...periodParts(month),
    scope: district || 'State',
    totals: figures(projects, reports, owed),
    rows,
    pending: owed.filter((item) => item.state !== 'FILED').map((item) => ({ projectCode: item.projectCode, district: item.district, departmentName: item.departmentName, officer: item.officer?.name || '', state: item.state, daysOverdue: item.daysOverdue })),
  };
};

const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[{}]/g, '');

const summaryHtml = (summary) => {
  const t = summary.totals;
  const cell = 'padding:8px 10px;border:1px solid #cbd5e1;font-size:13px;';
  const num = `${cell}text-align:right;font-variant-numeric:tabular-nums;`;
  const head = `${cell}background:#e2e8f0;font-weight:bold;text-align:left;`;
  const tile = (label, value) => `<td style="padding:12px;border:1px solid #cbd5e1;background:#f8fafc;width:25%"><div style="font-size:11px;color:#475569;text-transform:uppercase">${label}</div><div style="font-size:18px;font-weight:bold;color:#0f172a;margin-top:4px">${value}</div></td>`;
  const frontend = (process.env.FRONTEND_URL || process.env.CRM_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #cbd5e1">
  <div style="background:#0a3d62;color:#ffffff;padding:18px 24px">
    <div style="font-size:12px;opacity:.85">Spring and River Rejuvenation Authority, Uttarakhand</div>
    <div style="font-size:20px;font-weight:bold;margin-top:4px">Monthly Progress Summary: ${escapeHtml(summary.periodLabel)}</div>
    <div style="font-size:13px;margin-top:2px">${escapeHtml(summary.scope === 'State' ? 'Whole State' : `${summary.scope} district`)} | Financial Year ${escapeHtml(summary.financialYear)}</div>
  </div>
  <div style="padding:20px 24px">
    <table role="presentation" style="border-collapse:collapse;width:100%"><tr>
      ${tile('Projects', t.projects)}${tile('Sanctioned (Rs. lakh)', formatMoney(t.sanctionedLakh))}${tile('Released (Rs. lakh)', formatMoney(t.releasedLakh))}${tile('Spent (Rs. lakh)', formatMoney(t.spentLakh))}
    </tr><tr>
      ${tile('Spent in the month', formatMoney(t.spentInMonthLakh))}${tile('Utilisation of releases', `${t.utilisationPercent.toFixed(2)}%`)}${tile('Reports filed', `${t.reportsFiled} of ${t.reportsExpected}`)}${tile('Reports pending', t.reportsPending)}
    </tr></table>
    <p style="font-size:13px;color:#334155;margin:16px 0 8px">Reports for ${escapeHtml(summary.periodLabel)}: ${t.awaitingDistrict} awaiting district review, ${t.approved} approved by district, ${t.verified} verified by State, ${t.returned} returned for correction.</p>
    <table style="border-collapse:collapse;width:100%;margin-top:8px">
      <tr><th style="${head}">${summary.scope === 'State' ? 'District' : 'Project'}</th><th style="${head}text-align:right">Projects</th><th style="${head}text-align:right">Sanctioned</th><th style="${head}text-align:right">Released</th><th style="${head}text-align:right">Spent</th><th style="${head}text-align:right">Reports filed</th><th style="${head}text-align:right">Pending</th></tr>
      ${summary.rows.map((row) => `<tr><td style="${cell}">${escapeHtml(row.name)}</td><td style="${num}">${row.projects}</td><td style="${num}">${formatMoney(row.sanctionedLakh)}</td><td style="${num}">${formatMoney(row.releasedLakh)}</td><td style="${num}">${formatMoney(row.spentLakh)}</td><td style="${num}">${row.reportsFiled} of ${row.reportsExpected}</td><td style="${num}">${row.reportsPending}</td></tr>`).join('') || `<tr><td style="${cell}" colspan="7">No sanctioned projects.</td></tr>`}
    </table>
    ${summary.pending.length ? `<p style="font-size:13px;font-weight:bold;margin:18px 0 6px">Reports not filed (${summary.pending.length})</p>
    <table style="border-collapse:collapse;width:100%"><tr><th style="${head}">Project</th><th style="${head}">District</th><th style="${head}">Department</th><th style="${head}">PIA officer</th><th style="${head}text-align:right">Days overdue</th></tr>
      ${summary.pending.slice(0, 25).map((item) => `<tr><td style="${cell}">${escapeHtml(item.projectCode)}</td><td style="${cell}">${escapeHtml(item.district)}</td><td style="${cell}">${escapeHtml(item.departmentName)}</td><td style="${cell}">${escapeHtml(item.officer)}</td><td style="${num}">${item.daysOverdue || '-'}</td></tr>`).join('')}
    </table>${summary.pending.length > 25 ? `<p style="font-size:12px;color:#475569">And ${summary.pending.length - 25} more. See the attached register and the deadlines page.</p>` : ''}` : ''}
    <p style="font-size:12px;color:#475569;margin-top:18px">Amounts are in Rs. lakh. The attached Excel register lists every report filed for the month. <a href="${frontend}/dashboard" style="color:#0a3d62">Open SARRA CRM</a></p>
  </div>
</div></body></html>`;
};

/**
 * Send the monthly summary: one for the State, one for each district that has
 * projects. `testEmail` sends only the State summary to that one address.
 */
export const sendMonthlyReports = async ({ trigger = 'SCHEDULED', user = null, scope = 'ALL', testEmail = '', period, now = new Date() } = {}) => {
  const settings = await getSettings();
  const month = period ?? periodOfClock(istClock(now)) - 1;
  const { reportingMonth, financialYear } = periodParts(month);
  const result = { period: periodLabel(month), emails: 0, failed: 0, dryRun: 0, dispatches: [] };

  const deliver = async (type, district, recipients) => {
    const list = [...new Set(recipients.map((address) => String(address || '').trim().toLowerCase()).filter(Boolean))];
    if (!list.length) return;
    const summary = await buildMonthlySummary({ period: month, district, now });
    const filter = { reportingMonth, financialYear, ...(district ? { district } : {}) };
    const register = await buildRegisterWorkbook(filter, `${periodLabel(month)}${district ? ` ${district}` : ''}`);
    const html = summaryHtml(summary);
    const subject = `SARRA Monthly Progress Summary: ${periodLabel(month)}${district ? ` (${district})` : ''}`;
    const attachments = [{ filename: `MPR-Register-${reportingMonth}-${financialYear}${district ? `-${district.replace(/[^A-Za-z0-9]+/g, '-')}` : ''}.xlsx`, content: register.buffer }];
    let status = 'SENT';
    let error;
    for (const to of list) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const sent = await sendEmail({ to, subject, html, attachments });
        if (!sent.success) { status = 'FAILED'; error = sent.error; result.failed += 1; } else if (sent.skipped) { if (status !== 'FAILED') status = 'DRY_RUN'; result.dryRun += 1; } else result.emails += 1;
      } catch (err) {
        status = 'FAILED'; error = err.message; result.failed += 1;
      }
    }
    const dispatch = await ReportDispatch.create({ type, period: periodLabel(month), district: district || undefined, recipients: list, trigger, status, error, sentBy: user?._id });
    result.dispatches.push({ id: String(dispatch._id), type, district: district || null, recipients: list.length, status });
  };

  if (testEmail) {
    if (!EMAIL.test(String(testEmail).trim())) throw bad('Enter a valid e-mail address for the test.');
    await deliver('STATE_MONTHLY', null, [testEmail]);
    return result;
  }

  if (scope === 'ALL' || scope === 'STATE') {
    const roles = [settings.emailReports.sendToStateAdmins && USER_ROLES.SUPER_ADMIN, settings.emailReports.sendToMneAdmins && USER_ROLES.MND_SUPER_ADMIN].filter(Boolean);
    const admins = roles.length ? await User.find({ ...activeUserQuery, role: { $in: roles } }).select('email').lean() : [];
    await deliver('STATE_MONTHLY', null, [...admins.map((admin) => admin.email), ...(settings.emailReports.extraRecipients || [])]);
  }
  if ((scope === 'ALL' || scope === 'DISTRICTS') && settings.emailReports.sendToDistricts) {
    const districts = await ProjectSanction.distinct('district', { status: { $in: SANCTIONED_ON } });
    for (const district of districts.sort()) {
      // eslint-disable-next-line no-await-in-loop
      const directors = await User.find({ ...activeUserQuery, role: USER_ROLES.DD_LEVEL, district }).select('email').lean();
      // eslint-disable-next-line no-await-in-loop
      await deliver('DISTRICT_MONTHLY', district, directors.map((director) => director.email));
    }
  }
  return result;
};

export const listDispatches = async () => (await ReportDispatch.find().sort({ sentAt: -1 }).limit(30).populate('sentBy', 'name').lean()).map((row) => ({
  id: String(row._id),
  type: row.type,
  period: row.period,
  district: row.district || null,
  recipients: row.recipients?.length || 0,
  trigger: row.trigger,
  status: row.status,
  error: row.error || null,
  sentBy: row.sentBy?.name || null,
  sentAt: row.sentAt,
}));

// Manual triggers (administrators)
export const runRemindersNow = async (user) => {
  if (!canManage(user)) throw forbidden('Only the State or M&E administrator can send reminders.');
  return runReminders();
};
export const sendMonthlyReportsNow = async (body = {}, user) => {
  if (!canManage(user)) throw forbidden('Only the State or M&E administrator can send the summary.');
  const scope = ['ALL', 'STATE', 'DISTRICTS'].includes(body.scope) ? body.scope : 'ALL';
  return sendMonthlyReports({ trigger: 'MANUAL', user, scope, testEmail: typeof body.testEmail === 'string' ? body.testEmail.trim() : '' });
};

// ─── Scheduler ───────────────────────────────────────────────────────────────

/** Atomically take today's (or this month's) turn for a job; false if another tick or server already ran it. */
const takeTurn = async (job, stamp) => {
  await getSettings();
  const taken = await SystemSettings.updateOne({ _id: 'system', [`lastRun.${job}`]: { $ne: stamp } }, { $set: { [`lastRun.${job}`]: stamp } });
  return taken.modifiedCount === 1;
};

export const schedulerTick = async (now = new Date()) => {
  const clock = istClock(now);
  if (clock.getUTCHours() < 9) return; // nothing goes out before 9 AM IST
  const settings = await getSettings();
  if (settings.deadlines.remindersEnabled && await takeTurn('reminders', dayKey(clock))) {
    const sent = await runReminders({ now });
    logger.info(`Reminders: ${JSON.stringify(sent)}`);
  }
  if (settings.emailReports.enabled && clock.getUTCDate() >= settings.emailReports.dayOfMonth && await takeTurn('emailReports', dayKey(clock).slice(0, 7))) {
    const sent = await sendMonthlyReports({ trigger: 'SCHEDULED', now });
    logger.info(`Monthly summary: ${sent.emails} sent, ${sent.dryRun} dry-run, ${sent.failed} failed for ${sent.period}`);
  }
};

let timer = null;
/** Start the in-process scheduler (once). Set DISABLE_SCHEDULER=true to turn it off. */
export const startScheduler = () => {
  if (timer || process.env.DISABLE_SCHEDULER === 'true') return;
  const safeTick = () => schedulerTick().catch((err) => logger.error(`Scheduler failed: ${err.message}`));
  setTimeout(safeTick, 60 * 1000).unref();
  timer = setInterval(safeTick, 30 * 60 * 1000);
  timer.unref();
  logger.info('Scheduler started: reminders daily and the monthly summary, after 9 AM IST');
};

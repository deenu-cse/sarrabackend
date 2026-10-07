import * as monitoring from '../services/monitoring.service.js';
import { getRoleHome } from '../services/roleHome.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const ok = (res, data, message) => res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, message));

/** GET /home - the home page of the signed-in role */
export const getHome = asyncHandler(async (req, res) => {
  ok(res, await getRoleHome(req.user), 'Home fetched');
});

/** GET /deadlines - what is due, overdue and waiting, for the signed-in user */
export const getDeadlines = asyncHandler(async (req, res) => {
  ok(res, await monitoring.getDeadlines(req.user), 'Deadlines fetched');
});

/** GET /settings */
export const getSettings = asyncHandler(async (req, res) => {
  ok(res, await monitoring.readSettings(), 'Settings fetched');
});

/** PUT /settings */
export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await monitoring.updateSettings(req.body || {}, req.user);
  res.locals.auditMetadata = { deadlines: settings.deadlines, emailReports: settings.emailReports };
  ok(res, settings, 'Settings saved');
});

/** POST /reminders/run */
export const runReminders = asyncHandler(async (req, res) => {
  const result = await monitoring.runRemindersNow(req.user);
  res.locals.auditMetadata = { kind: 'REMINDERS', ...result };
  ok(res, result, 'Reminders sent');
});

/** POST /reports/send */
export const sendReports = asyncHandler(async (req, res) => {
  const result = await monitoring.sendMonthlyReportsNow(req.body || {}, req.user);
  res.locals.auditMetadata = { kind: 'MONTHLY_SUMMARY', period: result.period, emails: result.emails, dryRun: result.dryRun, failed: result.failed };
  ok(res, result, 'Monthly summary sent');
});

/** GET /reports/preview - the figures the next summary will carry */
export const previewReport = asyncHandler(async (req, res) => {
  const district = req.user.role === 'DD_LEVEL' ? req.user.district : (typeof req.query.district === 'string' && req.query.district) || null;
  ok(res, await monitoring.buildMonthlySummary({ district }), 'Summary fetched');
});

/** GET /reports/dispatches */
export const listDispatches = asyncHandler(async (req, res) => {
  ok(res, await monitoring.listDispatches(), 'Dispatch log fetched');
});

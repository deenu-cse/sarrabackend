import mongoose from 'mongoose';
import Department from '../models/Department.model.js';
import { H56_LEVELS, H56_LEVEL_LABELS } from '../models/Head56Item.model.js';
import USER_ROLES, { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';
import { actorLabel, designationOf, escapeRegex, isHq, isSystemAdmin, sameText, workflowRoleOf } from '../utils/access.js';
import { toNameKey } from './masterData.service.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/** Shared building blocks of the Budget Head 56 module: periods, money, units and scope. */

export const bad = (message, data) => new ApiError(HTTP_STATUS.BAD_REQUEST, message, data);
export const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
export const conflict = (message, code, extra = {}) => new ApiError(HTTP_STATUS.CONFLICT, message, { code, ...extra });
export const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);
export const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);
export const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ─── Financial year and reporting month ──────────────────────────────────────

export const FY_MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
const FY_LABEL = /^(\d{4})-(\d{2})$/;

export const fyLabel = (startYear) => `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
export const fyStartOf = (date = new Date()) => (date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1);
export const periodOf = (date = new Date()) => date.getFullYear() * 12 + date.getMonth();
export const periodFor = (fyStartYear, monthIndex) => (fyStartYear + (monthIndex >= 9 ? 1 : 0)) * 12 + ((monthIndex + 3) % 12);
export const periodLabel = (periodIndex) => `${FY_MONTHS[((periodIndex % 12) + 9) % 12]} ${Math.floor(periodIndex / 12)}`;

export const resolveFy = (financialYear) => {
  const value = typeof financialYear === 'string' ? financialYear.trim() : '';
  const match = FY_LABEL.exec(value);
  if (!match || fyLabel(Number(match[1])) !== value) throw bad('Please select a valid financial year (for example 2026-27).');
  return { financialYear: value, fyStartYear: Number(match[1]) };
};

/** A reporting month of a financial year; never a month that has not started. */
export const resolvePeriod = (financialYear, reportingMonth, now = new Date()) => {
  const fy = resolveFy(financialYear);
  const monthIndex = FY_MONTHS.indexOf(typeof reportingMonth === 'string' ? reportingMonth.trim() : '');
  if (monthIndex === -1) throw bad('Please select the reporting month.');
  const periodIndex = periodFor(fy.fyStartYear, monthIndex);
  if (periodIndex > periodOf(now)) throw bad(`${periodLabel(periodIndex)} has not started yet. Progress can be reported for the current or an earlier month.`);
  return { ...fy, reportingMonth: FY_MONTHS[monthIndex], monthIndex, periodIndex };
};

/** The current financial year and the one before, newest first (selectable years). */
export const recentFinancialYears = (now = new Date(), count = 3) => Array.from({ length: count }, (_, i) => fyLabel(fyStartOf(now) - i));

// ─── Numbers: integer arithmetic (physical in thousandths, money in rupees) ──

const PHYSICAL_SCALE = 1000;
const MONEY_SCALE = 100000;
export const toPhysical = (value) => Math.round((Number(value) || 0) * PHYSICAL_SCALE);
export const toMoney = (value) => Math.round((Number(value) || 0) * MONEY_SCALE);
export const fromPhysical = (units) => units / PHYSICAL_SCALE;
export const fromMoney = (units) => units / MONEY_SCALE;
export const percent = (part, whole) => (whole > 0 ? Math.floor((part * 10000) / whole) / 100 : 0);
export const lakhText = (units) => `Rs. ${fromMoney(units).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 5 })} lakh`;
export const quantityText = (units) => fromPhysical(units).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** A non-negative number from the client, with a limited number of decimals. */
export const parseAmount = (value, label, { decimals = 5, whole = false } = {}) => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) throw bad(`${label} must be a valid number.`);
  if (number < 0) throw bad(`${label} cannot be negative.`);
  if (number > 1e9) throw bad(`${label} is too large.`);
  if (whole && !Number.isInteger(number)) throw bad(`${label} must be a whole number.`);
  const scale = 10 ** decimals;
  if (Math.abs(Math.round(number * scale) - number * scale) > 1e-6) throw bad(`${label} can have at most ${decimals} decimal places.`);
  return number;
};

// ─── Implementing units ──────────────────────────────────────────────────────

/** HQ | DISTRICT:<district> | PIA:<district>:<departmentId> */
export const unitKeyOf = ({ level, district, departmentId }) => {
  if (level === H56_LEVELS.HQ) return 'HQ';
  if (level === H56_LEVELS.DISTRICT) return `DISTRICT:${district}`;
  return `PIA:${district}:${departmentId}`;
};

export const unitNameOf = ({ level, district, departmentName }) => {
  if (level === H56_LEVELS.HQ) return 'SARRA HQ';
  if (level === H56_LEVELS.DISTRICT) return `${district} District SARRA Centre`;
  return `${departmentName} (PIA), ${district}`;
};

export const levelLabel = (level) => H56_LEVEL_LABELS[level] || level;

/** Validated unit fields from a request (level, district, department). */
export const resolveUnit = async ({ level, district, departmentId } = {}) => {
  if (!Object.values(H56_LEVELS).includes(level)) throw bad('Choose the implementing level: SARRA HQ, District SARRA Centre or PIA.');
  if (level === H56_LEVELS.HQ) return { level, district: null, departmentId: null, departmentName: null, unitKey: 'HQ', unitName: 'SARRA HQ' };
  if (!DISTRICTS.includes(district)) throw bad('Choose the district.');
  if (level === H56_LEVELS.DISTRICT) {
    const unit = { level, district, departmentId: null, departmentName: null };
    return { ...unit, unitKey: unitKeyOf(unit), unitName: unitNameOf(unit) };
  }
  if (!isValidId(departmentId)) throw bad('Choose the PIA department.');
  const department = await Department.findOne({ _id: departmentId, isActive: true }).lean();
  if (!department) throw bad('The selected department was not found.');
  const unit = { level, district, departmentId: department._id, departmentName: department.name };
  return { ...unit, unitKey: unitKeyOf(unit), unitName: unitNameOf(unit) };
};

/** The unit a signed-in officer works for, or null (M&E accounts have none). */
export const unitOfUser = async (user) => {
  if (user.role === USER_ROLES.SUPER_ADMIN) return { level: H56_LEVELS.HQ, district: null, departmentId: null, departmentName: null, unitKey: 'HQ', unitName: 'SARRA HQ' };
  if (user.role === USER_ROLES.DD_LEVEL && user.district) {
    const unit = { level: H56_LEVELS.DISTRICT, district: user.district, departmentId: null, departmentName: null };
    return { ...unit, unitKey: unitKeyOf(unit), unitName: unitNameOf(unit) };
  }
  if (user.role === USER_ROLES.PIA_OFFICER && user.district && user.department) {
    const department = await Department.findOne({ nameKey: toNameKey(user.department) }).lean();
    if (!department) return null;
    const unit = { level: H56_LEVELS.PIA, district: user.district, departmentId: department._id, departmentName: department.name };
    return { ...unit, unitKey: unitKeyOf(unit), unitName: unitNameOf(unit) };
  }
  return null;
};

/** The Maker of a unit's reports: the HQ Maker, a District Maker of the district, or a PIA Maker of the department. */
export const isUnitMaker = (user, unit) => {
  if (!unit || workflowRoleOf(user) !== WORKFLOW_ROLES.MAKER) return false;
  if (unit.level === H56_LEVELS.HQ) return isHq(user, WORKFLOW_ROLES.MAKER);
  if (unit.level === H56_LEVELS.DISTRICT) return user.role === USER_ROLES.DD_LEVEL && user.district === unit.district;
  return user.role === USER_ROLES.PIA_OFFICER && user.district === unit.district && sameText(user.department, unit.departmentName);
};

/** Mongo filter of the allocations and reports a user may read. */
export const readScope = (user) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) return {};
  if (user.role === USER_ROLES.DD_LEVEL && user.district) return { district: user.district };
  if (user.role === USER_ROLES.PIA_OFFICER && user.district && user.department) {
    return { level: H56_LEVELS.PIA, district: user.district, departmentName: new RegExp(`^\\s*${escapeRegex(String(user.department).trim())}\\s*$`, 'i') };
  }
  return null;
};

export const canReadDoc = (user, doc) => {
  const scope = readScope(user);
  if (!scope) return false;
  if (!scope.district) return true;
  if (doc.district !== user.district) return false;
  if (user.role === USER_ROLES.PIA_OFFICER) return doc.level === H56_LEVELS.PIA && sameText(doc.departmentName, user.department);
  return true;
};

/** HQ Administrator or HQ Maker: who maintains the Head 56 master. */
export const canManageMaster = (user) => isSystemAdmin(user) || isHq(user, WORKFLOW_ROLES.MAKER);

export const historyEntry = (user, { status, action, level, note }) => ({
  status,
  action,
  level,
  role: actorLabel(user),
  designation: designationOf(user),
  changedBy: user._id,
  changedAt: new Date(),
  note,
});

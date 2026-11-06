import Head56Allocation, { H56_ALLOCATION_STATUS as A, H56_ALLOCATION_STATUS_LABELS } from '../models/Head56Allocation.model.js';
import Head56Mpr from '../models/Head56Mpr.model.js';
import User from '../models/User.model.js';
import { H56_LEVELS } from '../models/Head56Item.model.js';
import { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { actorLabel, designationOf, isHq, sameId } from '../utils/access.js';
import { FILED } from './mprWorkflow.js';
import { itemMap, reportableItems } from './head56Master.service.js';
import {
  bad, canReadDoc, clean, conflict, forbidden, fromMoney, fromPhysical, fyLabel, fyStartOf, isValidId, lakhText, levelLabel,
  notFound, parseAmount, quantityText, readScope, resolveFy, resolveUnit, toMoney, toPhysical,
} from './head56.common.js';

/**
 * Approved Head 56 allocation of each implementing unit for a financial year.
 *
 *   HQ Maker     enters the allocation (and later any revision)
 *   HQ Checker   verifies it (never the Maker)
 *   HQ Approver  approves and publishes it (never the Maker or the Checker)
 *
 * Reports are checked only against the published figures. A revision keeps the
 * published figures in force until it is itself published, and can never bring
 * a budget or target below what the unit has already reported that year.
 */

const { MAKER, CHECKER, APPROVER } = WORKFLOW_ROLES;
const NUMBERS = ['physicalTarget', 'targetSize', 'rate', 'deptShareLakh', 'sarraShareLakh', 'openingPhysical', 'openingSarraLakh'];
const ZERO_LINE = Object.fromEntries(NUMBERS.map((key) => [key, 0]));
const byCode = (a, b) => a.code.localeCompare(b.code, 'en');

const step = (user, action, status, note = '') => ({
  action, status, role: actorLabel(user), designation: designationOf(user), by: user._id, at: new Date(), note,
});

const assertHq = (user, role, message) => { if (!isHq(user, role)) throw forbidden(message); };

/** Progress and expenditure a unit has filed in a year, by line (drafts and rejected reports do not count). */
export const reportedByCode = async (unitKey, financialYear, { excludeId, beforePeriod } = {}) => {
  const filter = { unitKey, financialYear, status: { $in: FILED } };
  if (excludeId) filter._id = { $ne: excludeId };
  if (beforePeriod !== undefined) filter.periodIndex = { $lt: beforePeriod };
  const reports = await Head56Mpr.find(filter).select('lines.code lines.physicalCurrent lines.expenditureCurrentLakh').lean();
  const totals = new Map();
  for (const report of reports) {
    for (const line of report.lines || []) {
      const entry = totals.get(line.code) || { physical: 0, money: 0 };
      entry.physical += toPhysical(line.physicalCurrent);
      entry.money += toMoney(line.expenditureCurrentLakh);
      totals.set(line.code, entry);
    }
  }
  return totals;
};

/** The published allocation of a unit for a year, or null. */
export const findPublished = (unitKey, financialYear) => Head56Allocation.findOne({ unitKey, financialYear, 'published.version': { $gt: 0 } }).lean();

/**
 * Checked allocation lines. `allowed` maps the codes this unit may hold;
 * `reported` (when reports exist) stops a budget or target going below them.
 */
const normaliseLines = (input, allowed, level, reported) => {
  const pia = level === H56_LEVELS.PIA;
  const seen = new Set();
  const lines = [];
  for (const row of Array.isArray(input) ? input : []) {
    const code = typeof row?.code === 'string' ? row.code : '';
    const item = allowed.get(code);
    if (!item) throw bad(`Line ${code || '(blank)'} cannot be allocated to a ${levelLabel(level)}.`);
    if (seen.has(code)) throw bad(`${code} appears more than once.`);
    seen.add(code);
    const label = `${code} ${item.name}`;
    const physical = (field, what) => (item.hasPhysical ? parseAmount(row[field], `${label}: ${what}`, { decimals: item.allowsDecimal ? 3 : 0, whole: !item.allowsDecimal }) : 0);
    const line = {
      code,
      physicalTarget: physical('physicalTarget', 'physical target'),
      openingPhysical: item.hasPhysical ? parseAmount(row.openingPhysical, `${label}: progress up to last year`, { decimals: 3 }) : 0,
      targetSize: pia && item.hasPhysical ? parseAmount(row.targetSize, `${label}: size (cubic metres)`, { decimals: 3 }) : 0,
      rate: pia ? parseAmount(row.rate, `${label}: rate`) : 0,
      deptShareLakh: pia ? parseAmount(row.deptShareLakh, `${label}: departmental share`) : 0,
      sarraShareLakh: parseAmount(row.sarraShareLakh, `${label}: ${pia ? 'SARRA share' : 'approved budget'}`),
      openingSarraLakh: parseAmount(row.openingSarraLakh, `${label}: SARRA expenditure up to last year`),
      note: clean(row.note, 300),
    };
    const done = reported?.get(code);
    if (done) {
      if (toMoney(line.sarraShareLakh) < done.money) throw bad(`${label}: the budget cannot be less than the ${lakhText(done.money)} already reported this year.`);
      if (item.hasPhysical && toPhysical(line.physicalTarget) < done.physical) throw bad(`${label}: the physical target cannot be less than the ${quantityText(done.physical)} ${item.unit} already reported this year.`);
    }
    if (NUMBERS.every((key) => !line[key]) && !line.note) continue;
    lines.push(line);
  }
  for (const [code, done] of reported || []) {
    if (!seen.has(code) && (done.money > 0 || done.physical > 0)) throw bad(`${code}: progress has already been reported this year, so the line cannot be removed.`);
  }
  return lines.sort(byCode);
};

/** Codes a unit may hold: the reportable lines of its level, plus any it already holds (even if since retired). */
const allowedFor = async (allocation) => {
  const map = await itemMap();
  const allowed = new Map((await reportableItems(allocation.level)).map((item) => [item.code, item]));
  for (const line of [...(allocation.lines || []), ...(allocation.published?.lines || [])]) {
    if (!allowed.has(line.code) && map.has(line.code)) allowed.set(line.code, map.get(line.code));
  }
  return allowed;
};

const sumOf = (lines, key) => fromMoney((lines || []).reduce((sum, line) => sum + toMoney(line[key]), 0));

// ─── Reading ─────────────────────────────────────────────────────────────────

const permissionsOf = (doc, user) => {
  const status = doc.status;
  const maker = isHq(user, MAKER);
  const isMaker = sameId(doc.makerUserId, user._id);
  const isChecker = sameId(doc.checkerUserId, user._id);
  const canVerify = isHq(user, CHECKER) && status === A.PENDING_CHECKER && !isMaker;
  const canApprove = isHq(user, APPROVER) && status === A.PENDING_APPROVER && !isMaker && !isChecker;
  return {
    canEdit: maker && [A.DRAFT, A.RETURNED].includes(status),
    canRevise: maker && status === A.PUBLISHED,
    canSubmit: maker && [A.DRAFT, A.RETURNED].includes(status),
    canDiscard: maker && [A.DRAFT, A.RETURNED].includes(status),
    canVerify,
    canApprove,
    canReturn: canVerify || canApprove,
    blockedReason: (isHq(user, CHECKER) && status === A.PENDING_CHECKER && isMaker) || (isHq(user, APPROVER) && status === A.PENDING_APPROVER && (isMaker || isChecker))
      ? 'You entered or verified this allocation, so you cannot take the next step on it.' : null,
  };
};

const listDto = (doc) => ({
  id: String(doc._id),
  financialYear: doc.financialYear,
  level: doc.level,
  levelLabel: levelLabel(doc.level),
  unitKey: doc.unitKey,
  unitName: doc.unitName,
  district: doc.district,
  departmentName: doc.departmentName,
  status: doc.status,
  statusLabel: H56_ALLOCATION_STATUS_LABELS[doc.status],
  version: doc.published?.version || 0,
  publishedAt: doc.published?.publishedAt || null,
  revisionPending: (doc.published?.version || 0) > 0 && doc.status !== A.PUBLISHED,
  budgetLakh: sumOf(doc.published?.lines, 'sarraShareLakh'),
  deptShareLakh: sumOf(doc.published?.lines, 'deptShareLakh'),
  workingBudgetLakh: sumOf(doc.lines, 'sarraShareLakh'),
  lines: (doc.lines || []).length,
  updatedAt: doc.updatedAt,
});

export const listAllocations = async (user, { financialYear, level, district } = {}) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to Head 56 allocations.');
  const fy = resolveFy(financialYear || fyLabel(fyStartOf()));
  const filter = { ...scope, financialYear: fy.financialYear };
  if (Object.values(H56_LEVELS).includes(level)) filter.level = filter.level || level;
  if (typeof district === 'string' && district && !scope.district) filter.district = district;
  const docs = await Head56Allocation.find(filter).sort({ level: 1, district: 1, departmentName: 1 }).lean();
  const items = docs.map(listDto);
  const LEVEL_ORDER = { HQ: 0, DISTRICT: 1, PIA: 2 };
  items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || String(a.district).localeCompare(String(b.district)) || String(a.departmentName).localeCompare(String(b.departmentName)));
  return {
    financialYear: fy.financialYear,
    items,
    summary: {
      units: items.length,
      published: items.filter((item) => item.version > 0).length,
      awaiting: items.filter((item) => [A.PENDING_CHECKER, A.PENDING_APPROVER].includes(item.status)).length,
      budgetLakh: fromMoney(items.reduce((sum, item) => sum + toMoney(item.budgetLakh), 0)),
      deptShareLakh: fromMoney(items.reduce((sum, item) => sum + toMoney(item.deptShareLakh), 0)),
    },
    permissions: { canCreate: isHq(user, MAKER) },
  };
};

export const getAllocation = async (id, user) => {
  if (!isValidId(id)) throw notFound('Allocation not found.');
  const doc = await Head56Allocation.findById(id).lean();
  if (!doc || !canReadDoc(user, doc)) throw notFound('Allocation not found.');
  const [map, allowed, reported] = await Promise.all([itemMap(), allowedFor(doc), reportedByCode(doc.unitKey, doc.financialYear)]);
  const working = new Map((doc.lines || []).map((line) => [line.code, line]));
  const published = new Map((doc.published?.lines || []).map((line) => [line.code, line]));
  const codes = [...new Set([...allowed.keys(), ...working.keys(), ...published.keys()])].sort();
  const rows = codes.map((code) => {
    const item = map.get(code) || { code, name: code, nameHindi: '', parentCode: null, hasPhysical: false, unit: '', allowsDecimal: false, isActive: false };
    const line = working.get(code) || ZERO_LINE;
    const done = reported.get(code);
    const live = published.get(code);
    return {
      code,
      name: item.name,
      nameHindi: item.nameHindi,
      parentCode: item.parentCode,
      hasPhysical: item.hasPhysical,
      unit: item.unit,
      allowsDecimal: item.allowsDecimal,
      available: allowed.has(code),
      ...Object.fromEntries(NUMBERS.map((key) => [key, line[key] || 0])),
      note: line.note || '',
      published: live ? Object.fromEntries(NUMBERS.map((key) => [key, live[key] || 0])) : null,
      reportedPhysical: fromPhysical(done?.physical || 0),
      reportedLakh: fromMoney(done?.money || 0),
    };
  });
  const parents = [...new Set(rows.map((row) => row.parentCode).filter(Boolean))].map((code) => ({ code, name: map.get(code)?.name || code, nameHindi: map.get(code)?.nameHindi || '' }));
  const people = await User.find({ _id: { $in: [...new Set((doc.history || []).map((entry) => String(entry.by)))] } }).select('name').lean();
  const nameOf = new Map(people.map((person) => [String(person._id), person.name]));
  return {
    ...listDto(doc),
    reason: doc.reason || '',
    returnReason: doc.status === A.RETURNED ? doc.returnReason || '' : '',
    rows,
    parents,
    totals: {
      budgetLakh: sumOf(doc.lines, 'sarraShareLakh'),
      deptShareLakh: sumOf(doc.lines, 'deptShareLakh'),
      openingSarraLakh: sumOf(doc.lines, 'openingSarraLakh'),
      publishedBudgetLakh: sumOf(doc.published?.lines, 'sarraShareLakh'),
      reportedLakh: fromMoney([...reported.values()].reduce((sum, entry) => sum + entry.money, 0)),
    },
    history: (doc.history || []).map((entry) => ({ ...entry, by: nameOf.get(String(entry.by)) || null })).reverse(),
    permissions: permissionsOf(doc, user),
  };
};

// ─── HQ Maker ────────────────────────────────────────────────────────────────

/** Opening figures for a new year: last year's opening plus what was reported in it. */
const carryForward = async (unitKey, fyStartYear) => {
  const previous = await findPublished(unitKey, fyLabel(fyStartYear - 1));
  if (!previous) return [];
  const reported = await reportedByCode(unitKey, previous.financialYear);
  return (previous.published.lines || []).map((line) => {
    const done = reported.get(line.code) || { physical: 0, money: 0 };
    return {
      ...ZERO_LINE,
      code: line.code,
      openingPhysical: fromPhysical(toPhysical(line.openingPhysical) + done.physical),
      openingSarraLakh: fromMoney(toMoney(line.openingSarraLakh) + done.money),
    };
  }).filter((line) => line.openingPhysical || line.openingSarraLakh);
};

export const createAllocation = async (body = {}, user) => {
  assertHq(user, MAKER, 'Only the HQ Maker can enter a Head 56 allocation.');
  const fy = resolveFy(body.financialYear);
  const current = fyStartOf();
  if (fy.fyStartYear < current - 1 || fy.fyStartYear > current + 1) throw bad('Allocations can be entered for the previous, current or next financial year.');
  const unit = await resolveUnit(body);
  if (await Head56Allocation.exists({ financialYear: fy.financialYear, unitKey: unit.unitKey })) {
    throw conflict(`An allocation of ${unit.unitName} for ${fy.financialYear} already exists. Open it to edit or revise it.`, 'DUPLICATE');
  }
  const allowed = new Map((await reportableItems(unit.level)).map((item) => [item.code, item]));
  const lines = (await carryForward(unit.unitKey, fy.fyStartYear)).filter((line) => allowed.has(line.code));
  try {
    const doc = await Head56Allocation.create({
      ...fy,
      ...unit,
      lines,
      status: A.DRAFT,
      createdBy: user._id,
      history: [step(user, 'CREATED', A.DRAFT, lines.length ? 'Opening figures carried forward from the previous year' : '')],
    });
    return { id: String(doc._id) };
  } catch (err) {
    if (err?.code === 11000) throw conflict(`An allocation of ${unit.unitName} for ${fy.financialYear} already exists.`, 'DUPLICATE');
    throw err;
  }
};

const loadForMaker = async (id, user) => {
  assertHq(user, MAKER, 'Only the HQ Maker can change a Head 56 allocation.');
  if (!isValidId(id)) throw notFound('Allocation not found.');
  const doc = await Head56Allocation.findById(id);
  if (!doc) throw notFound('Allocation not found.');
  return doc;
};

/** Save the working figures. Saving a published allocation starts a revision. */
export const saveAllocation = async (id, body = {}, user) => {
  const doc = await loadForMaker(id, user);
  if (![A.DRAFT, A.RETURNED, A.PUBLISHED].includes(doc.status)) throw conflict('The allocation is with the HQ Checker or Approver and cannot be changed now.', 'LOCKED');
  const reported = await reportedByCode(doc.unitKey, doc.financialYear);
  const lines = normaliseLines(body.lines, await allowedFor(doc.toObject()), doc.level, reported);
  const startsRevision = doc.status === A.PUBLISHED;
  const updated = await Head56Allocation.findOneAndUpdate(
    { _id: doc._id, status: doc.status },
    {
      $set: { lines, reason: clean(body.reason, 1000), ...(startsRevision ? { status: A.DRAFT, makerUserId: null, checkerUserId: null } : {}) },
      ...(startsRevision ? { $push: { history: step(user, 'REVISION_STARTED', A.DRAFT, clean(body.reason, 1000)) } } : {}),
    },
    { new: true },
  );
  if (!updated) throw conflict('The allocation changed while you were editing it. Please reload.', 'STALE');
  return { id: String(updated._id), status: updated.status };
};

export const submitAllocation = async (id, body = {}, user) => {
  const doc = await loadForMaker(id, user);
  if (![A.DRAFT, A.RETURNED].includes(doc.status)) throw conflict('Only a draft or returned allocation can be submitted.', 'NOT_DRAFT');
  if (!doc.lines.some((line) => line.sarraShareLakh > 0 || line.physicalTarget > 0)) throw bad('Enter the approved budget of at least one line before submitting.');
  const revision = (doc.published?.version || 0) > 0;
  const reason = clean(body.reason ?? doc.reason, 1000);
  if (revision && reason.length < 10) throw bad('Give the reason for this budget revision (at least 10 characters).');
  // Reports filed since the last save must still fit.
  normaliseLines(doc.lines.map((line) => line.toObject()), await allowedFor(doc.toObject()), doc.level, await reportedByCode(doc.unitKey, doc.financialYear));
  const updated = await Head56Allocation.findOneAndUpdate(
    { _id: doc._id, status: doc.status },
    {
      $set: { status: A.PENDING_CHECKER, makerUserId: user._id, submittedAt: new Date(), checkerUserId: null, reason, returnReason: null },
      $push: { history: step(user, revision ? 'REVISION_SUBMITTED' : 'SUBMITTED', A.PENDING_CHECKER, reason) },
    },
    { new: true },
  );
  if (!updated) throw conflict('The allocation has already moved on. Please reload.', 'STALE');
  return updated;
};

/** Discard a draft; for a revision, go back to the published figures. */
export const discardAllocation = async (id, user) => {
  const doc = await loadForMaker(id, user);
  if (![A.DRAFT, A.RETURNED].includes(doc.status)) throw conflict('Only a draft or returned allocation can be discarded.', 'NOT_DRAFT');
  if ((doc.published?.version || 0) > 0) {
    const updated = await Head56Allocation.findOneAndUpdate(
      { _id: doc._id, status: doc.status },
      { $set: { status: A.PUBLISHED, lines: doc.published.lines.map((line) => line.toObject()), reason: '', returnReason: null }, $push: { history: step(user, 'REVISION_CANCELLED', A.PUBLISHED) } },
      { new: true },
    );
    if (!updated) throw conflict('The allocation has already moved on. Please reload.', 'STALE');
    return { deleted: false, id: String(updated._id) };
  }
  await Head56Allocation.deleteOne({ _id: doc._id, status: doc.status });
  return { deleted: true };
};

// ─── HQ Checker and Approver ─────────────────────────────────────────────────

const loadAt = async (id, status) => {
  if (!isValidId(id)) throw notFound('Allocation not found.');
  const doc = await Head56Allocation.findById(id);
  if (!doc) throw notFound('Allocation not found.');
  if (doc.status !== status) throw conflict(`This allocation is ${H56_ALLOCATION_STATUS_LABELS[doc.status].toLowerCase()}, not ${H56_ALLOCATION_STATUS_LABELS[status].toLowerCase()}.`, 'WRONG_STAGE');
  return doc;
};

export const verifyAllocation = async (id, note, user) => {
  assertHq(user, CHECKER, 'Only the HQ Checker can verify a Head 56 allocation.');
  const doc = await loadAt(id, A.PENDING_CHECKER);
  if (sameId(doc.makerUserId, user._id)) throw forbidden('You entered this allocation, so you cannot verify it.');
  const text = clean(note, 1000);
  const updated = await Head56Allocation.findOneAndUpdate(
    { _id: doc._id, status: A.PENDING_CHECKER },
    { $set: { status: A.PENDING_APPROVER, checkerUserId: user._id, checkedAt: new Date(), checkerNote: text }, $push: { history: step(user, 'VERIFIED', A.PENDING_APPROVER, text) } },
    { new: true },
  );
  if (!updated) throw conflict('The allocation has already moved on. Please reload.', 'STALE');
  return updated;
};

export const approveAllocation = async (id, note, user) => {
  assertHq(user, APPROVER, 'Only the HQ Approver can approve and publish a Head 56 allocation.');
  const doc = await loadAt(id, A.PENDING_APPROVER);
  if (sameId(doc.makerUserId, user._id) || sameId(doc.checkerUserId, user._id)) throw forbidden('You entered or verified this allocation, so you cannot approve it.');
  normaliseLines(doc.lines.map((line) => line.toObject()), await allowedFor(doc.toObject()), doc.level, await reportedByCode(doc.unitKey, doc.financialYear));
  const text = clean(note, 1000);
  const version = (doc.published?.version || 0) + 1;
  const updated = await Head56Allocation.findOneAndUpdate(
    { _id: doc._id, status: A.PENDING_APPROVER },
    {
      $set: { status: A.PUBLISHED, published: { version, lines: doc.lines.map((line) => line.toObject()), publishedAt: new Date(), publishedBy: user._id } },
      $push: { history: step(user, 'PUBLISHED', A.PUBLISHED, text ? `Version ${version} published. ${text}` : `Version ${version} published`) },
    },
    { new: true },
  );
  if (!updated) throw conflict('The allocation has already moved on. Please reload.', 'STALE');
  return updated;
};

export const returnAllocation = async (id, reason, user) => {
  if (!isValidId(id)) throw notFound('Allocation not found.');
  const doc = await Head56Allocation.findById(id);
  if (!doc) throw notFound('Allocation not found.');
  const allowed = (doc.status === A.PENDING_CHECKER && isHq(user, CHECKER)) || (doc.status === A.PENDING_APPROVER && isHq(user, APPROVER));
  if (!allowed) throw forbidden('Only the HQ Checker (while it waits for verification) or the HQ Approver (while it waits for approval) can return this allocation.');
  if (sameId(doc.makerUserId, user._id)) throw forbidden('You entered this allocation, so you cannot review it.');
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Write the remarks for the HQ Maker (at least 5 characters).');
  const updated = await Head56Allocation.findOneAndUpdate(
    { _id: doc._id, status: doc.status },
    { $set: { status: A.RETURNED, returnReason: text, returnedBy: user._id, returnedAt: new Date() }, $push: { history: step(user, 'RETURNED', A.RETURNED, text) } },
    { new: true },
  );
  if (!updated) throw conflict('The allocation has already moved on. Please reload.', 'STALE');
  return updated;
};

import { DEFAULT_RECHARGE_FACTORS, JSA_ACTIVITIES, JSA_LEVELS, JsaReport, JsaSetting } from '../models/JsaReport.model.js';
import USER_ROLES, { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { LOCATION_TYPES } from '../models/Location.model.js';
import { escapeRegex, isDistrict, isHq, isSystemAdmin } from '../utils/access.js';
import {
  bad, clean, conflict, forbidden, isValidId, namesOf, notFound, parseCount, parseDay, parseDecimal, resolvePlace,
} from './forms.common.js';

/**
 * Jal Sanrakshan Abhiyan (JSA) progress — SARRA weekly progress format Prarup-03.
 *
 * The District Maker keeps one report per place and campaign year — a village,
 * a block or the whole district — and adds a dated progress statement to it
 * every week (targets and progress as on that date). HQ sees the consolidated
 * Prarup-03 by district (village, block and district reports added together)
 * and the potential recharge report.
 */

const STATE_WIDE = [USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER];
const DEPTH = { VILLAGE: LOCATION_TYPES.VILLAGE, BLOCK: LOCATION_TYPES.BLOCK, DISTRICT: LOCATION_TYPES.DISTRICT };
const ACTIVITY_KEYS = JSA_ACTIVITIES.map((a) => a.key);

/** Districts in the order of the Prarup-03 format, with their Hindi names. */
export const JSA_DISTRICT_ORDER = [
  ['Tehri Garhwal', 'टिहरी गढ़वाल'], ['Uttarkashi', 'उत्तरकाशी'], ['Chamoli', 'चमोली'], ['Rudraprayag', 'रुद्रप्रयाग'],
  ['Pauri Garhwal', 'पौड़ी गढ़वाल'], ['Dehradun', 'देहरादून'], ['Haridwar', 'हरिद्वार'], ['Almora', 'अल्मोड़ा'],
  ['Pithoragarh', 'पिथौरागढ़'], ['Bageshwar', 'बागेश्वर'], ['Champawat', 'चम्पावत'], ['Nainital', 'नैनीताल'], ['Udham Singh Nagar', 'उधम सिंह नगर'],
];

export const readScope = (user) => {
  if (STATE_WIDE.includes(user.role)) return {};
  if (user.role === USER_ROLES.DD_LEVEL && user.district) return { district: user.district };
  return null;
};
const isMaker = (user, district) => isDistrict(user, WORKFLOW_ROLES.MAKER) && Boolean(user.district) && (!district || user.district === district);

const campaignOf = (value) => {
  const year = parseInt(value, 10) || new Date().getFullYear();
  const now = new Date().getFullYear();
  if (year < now - 3 || year > now + 1) throw bad('Choose a campaign year close to the current one.');
  return year;
};

const dayText = (date) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ─── District Maker ──────────────────────────────────────────────────────────

/** A progress statement from the client: everything as on its date. */
const readStatement = (body = {}) => {
  const activities = {};
  for (const activity of JSA_ACTIVITIES) {
    const input = body.activities?.[activity.key] || {};
    const read = (value, what) => (activity.decimals ? parseDecimal(value, `${activity.name}: ${what}`, activity.decimals) : parseCount(value, `${activity.name}: ${what}`));
    activities[activity.key] = { target: read(input.target, 'target'), progress: read(input.progress, 'progress') };
  }
  return {
    asOnDate: parseDay(body.asOnDate, 'progress date ("as on")'),
    streams: parseCount(body.streams, 'Number of tributaries / streams identified for treatment', { max: 100000 }),
    activities,
    otherDescription: clean(body.otherDescription, 500),
    remarks: clean(body.remarks, 1000),
  };
};

export const createReport = async (body = {}, user) => {
  if (!isMaker(user)) throw forbidden('JSA progress is filled by the District Maker.');
  if (!JSA_LEVELS[body.level]) throw bad('Choose the report type: Village, Block or District.');
  const campaign = campaignOf(body.campaign);
  const place = await resolvePlace(body, DEPTH[body.level], { district: user.district });
  const placeKey = (place.village || place.block || place.district).id;
  const existing = await JsaReport.findOne({ campaign, level: body.level, placeKey }).select('_id').lean();
  if (existing) throw conflict(`A JSA ${campaign} ${JSA_LEVELS[body.level].toLowerCase()} report of this place already exists. Add this week's progress to it.`, 'DUPLICATE', { id: String(existing._id) });
  const first = body.asOnDate ? { ...readStatement(body), by: user._id, at: new Date() } : null;
  try {
    return await JsaReport.create({
      campaign,
      level: body.level,
      district: place.district.name,
      districtId: place.district.id,
      block: place.block,
      gramPanchayat: place.gramPanchayat,
      village: place.village,
      placeKey,
      streamNames: clean(body.streamNames, 1000),
      updates: first ? [first] : [],
      createdBy: user._id,
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict('This JSA report already exists.', 'DUPLICATE');
    throw err;
  }
};

const loadForMaker = async (id, user) => {
  if (!isValidId(id)) throw notFound('JSA report not found.');
  const doc = await JsaReport.findById(id);
  if (!doc) throw notFound('JSA report not found.');
  if (!isMaker(user, doc.district)) throw forbidden(`Only the District Maker of ${doc.district} can change this report.`);
  return doc;
};

/** Add this week's statement. Saving again for the same date replaces it; an earlier date than the latest is refused. */
export const addStatement = async (id, body = {}, user) => {
  const doc = await loadForMaker(id, user);
  const statement = { ...readStatement(body), by: user._id, at: new Date() };
  const last = doc.updates[doc.updates.length - 1];
  if (last && statement.asOnDate < last.asOnDate) {
    throw conflict(`A statement as on ${dayText(last.asOnDate)} already exists. Progress can only be added for that date or later.`, 'OUT_OF_ORDER');
  }
  if (last && statement.asOnDate.getTime() === last.asOnDate.getTime()) doc.updates.set(doc.updates.length - 1, statement);
  else doc.updates.push(statement);
  if (body.streamNames !== undefined) doc.streamNames = clean(body.streamNames, 1000);
  await doc.save();
  return doc;
};

export const updateDetails = async (id, body = {}, user) => {
  const doc = await loadForMaker(id, user);
  doc.streamNames = clean(body.streamNames, 1000);
  await doc.save();
  return doc;
};

export const deleteReport = async (id, user) => {
  const doc = await loadForMaker(id, user);
  await JsaReport.deleteOne({ _id: doc._id });
  return { id: String(doc._id) };
};

// ─── Reading ─────────────────────────────────────────────────────────────────

const placeName = (doc) => (doc.level === 'VILLAGE' ? `${doc.village?.name} (${doc.gramPanchayat?.name}, ${doc.block?.name})` : doc.level === 'BLOCK' ? `${doc.block?.name} block` : `${doc.district} district`);
const statementDto = (s, nameOf = new Map()) => (s ? {
  asOnDate: s.asOnDate, streams: s.streams, activities: s.activities, otherDescription: s.otherDescription, remarks: s.remarks, by: nameOf.get(String(s.by)) || null, at: s.at,
} : null);

const listDto = (doc) => ({
  id: String(doc._id),
  campaign: doc.campaign,
  level: doc.level,
  levelLabel: JSA_LEVELS[doc.level],
  district: doc.district,
  districtId: doc.districtId || null,
  block: doc.block || null,
  gramPanchayat: doc.gramPanchayat || null,
  village: doc.village || null,
  placeName: placeName(doc),
  streamNames: doc.streamNames,
  statements: doc.updates.length,
  latest: statementDto(doc.updates[doc.updates.length - 1]),
  updatedAt: doc.updatedAt,
});

export const listReports = async (user, query = {}) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to JSA progress.');
  const filter = { ...scope, campaign: campaignOf(query.campaign) };
  if (JSA_LEVELS[query.level]) filter.level = query.level;
  if (typeof query.district === 'string' && query.district && !scope.district) filter.district = query.district;
  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = new RegExp(escapeRegex(query.search.trim().slice(0, 60)), 'i');
    filter.$or = [{ 'village.name': pattern }, { 'block.name': pattern }, { 'gramPanchayat.name': pattern }, { streamNames: pattern }];
  }
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const [docs, count] = await Promise.all([
    JsaReport.find(filter).sort({ district: 1, level: 1, 'block.name': 1, 'village.name': 1 }).skip((page - 1) * limit).limit(limit).lean(),
    JsaReport.countDocuments(filter),
  ]);
  return {
    items: docs.map(listDto),
    pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
    permissions: { canCreate: isMaker(user), canEditSettings: canEditSettings(user) },
  };
};

export const getReport = async (id, user) => {
  if (!isValidId(id)) throw notFound('JSA report not found.');
  const doc = await JsaReport.findById(id).lean();
  const scope = readScope(user);
  if (!doc || !scope || (scope.district && scope.district !== doc.district)) throw notFound('JSA report not found.');
  const nameOf = await namesOf([doc.createdBy, ...doc.updates.map((u) => u.by)]);
  return {
    ...listDto(doc),
    latest: statementDto(doc.updates[doc.updates.length - 1], nameOf),
    history: doc.updates.map((u) => statementDto(u, nameOf)).reverse(),
    createdBy: nameOf.get(String(doc.createdBy)) || null,
    activities: JSA_ACTIVITIES,
    permissions: { canEdit: isMaker(user, doc.district), canDelete: isMaker(user, doc.district) },
  };
};

// ─── Consolidated Prarup-03 and potential recharge ───────────────────────────

export const canEditSettings = (user) => isSystemAdmin(user) || isHq(user, WORKFLOW_ROLES.MAKER);

export const getFactors = async () => {
  const setting = await JsaSetting.findById('jsa').lean();
  return { ...DEFAULT_RECHARGE_FACTORS, ...(setting?.factors || {}) };
};

export const updateSettings = async (body = {}, user) => {
  if (!canEditSettings(user)) throw forbidden('Only the HQ Administrator or the HQ Maker can change the recharge factors.');
  const factors = {};
  for (const key of Object.keys(DEFAULT_RECHARGE_FACTORS)) {
    const input = body.factors?.[key] || {};
    const name = JSA_ACTIVITIES.find((a) => a.key === key)?.name || key;
    factors[key] = { capacity: parseDecimal(input.capacity, `${name}: average capacity`, 3), refills: parseCount(input.refills, `${name}: refills in the monsoon`, { min: 1, max: 20 }) };
    if (!factors[key].capacity) throw bad(`${name}: enter the average capacity of one structure (cu.m).`);
  }
  await JsaSetting.findByIdAndUpdate('jsa', { $set: { factors, updatedBy: user._id } }, { upsert: true });
  return factors;
};

const emptyTotals = () => ({ streams: 0, reports: 0, activities: Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, { target: 0, progress: 0 }])) });
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Prarup-03 as on a date: each report's latest statement on or before that date,
 * added together by district (village, block and district reports alike).
 */
export const buildConsolidated = async (user, query = {}) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to JSA progress.');
  const campaign = campaignOf(query.campaign);
  const asOn = query.asOn ? parseDay(query.asOn, 'report date', { notFuture: false }) : new Date();
  const asOnEnd = new Date(Date.UTC(asOn.getUTCFullYear(), asOn.getUTCMonth(), asOn.getUTCDate(), 23, 59, 59));
  const filter = { ...scope, campaign };
  if (JSA_LEVELS[query.level]) filter.level = query.level;
  if (typeof query.district === 'string' && query.district && !scope.district) filter.district = query.district;
  const [docs, factors] = await Promise.all([JsaReport.find(filter).lean(), getFactors()]);

  const byDistrict = new Map(JSA_DISTRICT_ORDER.map(([name]) => [name, emptyTotals()]));
  const counts = { VILLAGE: 0, BLOCK: 0, DISTRICT: 0 };
  let latestDate = null;
  const places = [];
  for (const doc of docs) {
    const statement = [...doc.updates].reverse().find((u) => u.asOnDate <= asOnEnd);
    if (!statement) continue;
    const row = byDistrict.get(doc.district) || emptyTotals();
    byDistrict.set(doc.district, row);
    row.streams += statement.streams || 0;
    row.reports += 1;
    counts[doc.level] += 1;
    for (const key of ACTIVITY_KEYS) {
      row.activities[key].target = round(row.activities[key].target + (statement.activities?.[key]?.target || 0));
      row.activities[key].progress = round(row.activities[key].progress + (statement.activities?.[key]?.progress || 0));
    }
    if (!latestDate || statement.asOnDate > latestDate) latestDate = statement.asOnDate;
    places.push({ id: String(doc._id), district: doc.district, level: doc.level, levelLabel: JSA_LEVELS[doc.level], placeName: placeName(doc), asOnDate: statement.asOnDate, streams: statement.streams, activities: statement.activities, otherDescription: statement.otherDescription });
  }

  const hindiOf = new Map(JSA_DISTRICT_ORDER);
  const order = [...JSA_DISTRICT_ORDER.map(([name]) => name), ...[...byDistrict.keys()].filter((name) => !hindiOf.has(name))];
  const rows = order
    .filter((name) => !scope.district || name === scope.district)
    .filter((name) => !filter.district || name === filter.district)
    .map((name) => ({ district: name, districtHindi: hindiOf.get(name) || name, ...byDistrict.get(name) }));
  const total = emptyTotals();
  for (const row of rows) {
    total.streams += row.streams;
    total.reports += row.reports;
    for (const key of ACTIVITY_KEYS) {
      total.activities[key].target = round(total.activities[key].target + row.activities[key].target);
      total.activities[key].progress = round(total.activities[key].progress + row.activities[key].progress);
    }
  }

  // Potential recharge: structures × average capacity (cu.m) × refills in the monsoon.
  const recharge = Object.entries(factors).map(([key, factor]) => {
    const activity = JSA_ACTIVITIES.find((a) => a.key === key);
    const target = total.activities[key]?.target || 0;
    const progress = total.activities[key]?.progress || 0;
    return {
      key, name: activity?.name || key, capacity: factor.capacity, refills: factor.refills,
      targetStructures: target, targetCapacity: round(target * factor.capacity, 2), potentialRecharge: round(target * factor.capacity * factor.refills, 2),
      progressStructures: progress, progressCapacity: round(progress * factor.capacity, 2), rechargeTillDate: round(progress * factor.capacity * factor.refills, 2),
    };
  });
  const sum = (key) => round(recharge.reduce((s, r) => s + r[key], 0), 2);

  return {
    campaign,
    asOn,
    asOnLabel: dayText(asOn),
    latestStatementDate: latestDate,
    level: JSA_LEVELS[query.level] ? query.level : null,
    scope: scope.district || filter.district || 'State',
    activities: JSA_ACTIVITIES,
    rows,
    total,
    counts,
    places: places.sort((a, b) => order.indexOf(a.district) - order.indexOf(b.district) || a.level.localeCompare(b.level) || a.placeName.localeCompare(b.placeName)),
    recharge: {
      factors,
      rows: recharge,
      totals: {
        targetStructures: sum('targetStructures'), potentialRecharge: sum('potentialRecharge'),
        progressStructures: sum('progressStructures'), rechargeTillDate: sum('rechargeTillDate'),
        potentialMillion: round(sum('potentialRecharge') / 1e6, 2), tillDateMillion: round(sum('rechargeTillDate') / 1e6, 2),
      },
      plantation: { ...total.activities.plantationHa, plants: total.activities.plantationNo },
    },
    permissions: { canEditSettings: canEditSettings(user) },
  };
};

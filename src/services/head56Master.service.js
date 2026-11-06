import Head56Item, { H56_LEVELS } from '../models/Head56Item.model.js';
import Head56Allocation from '../models/Head56Allocation.model.js';
import Head56Mpr from '../models/Head56Mpr.model.js';
import Head56Review from '../models/Head56Review.model.js';
import { head56SeedRows } from '../constants/head56.seed.js';
import { bad, canManageMaster, clean, conflict, forbidden, notFound } from './head56.common.js';
import logger from '../config/logger.js';

/**
 * Master of Budget Head 56 (sub-heads 56-01 … 56-09 and their items), kept
 * centrally by SARRA HQ. Codes never change once created; everything else can.
 */

const CODE = /^56-\d{2}(\(\d{2}\))?$/;
const byCode = (a, b) => a.code.localeCompare(b.code, 'en');

const toDto = (item, children = []) => ({
  code: item.code,
  name: item.name,
  nameHindi: item.nameHindi || '',
  parentCode: item.parentCode || null,
  levels: item.levels?.length ? item.levels : Object.values(H56_LEVELS),
  hasPhysical: Boolean(item.hasPhysical),
  unit: item.unit || '',
  allowsDecimal: Boolean(item.allowsDecimal),
  isActive: item.isActive !== false,
  // A line with active items under it is a heading; the items are reported instead.
  reportable: !children.some((child) => child.isActive !== false),
});

/** Every master line in format order, with whether it is reportable. */
export const listItems = async ({ includeInactive = false } = {}) => {
  const all = (await Head56Item.find().lean()).sort(byCode);
  const childrenOf = (code) => all.filter((item) => item.parentCode === code);
  return all
    .filter((item) => includeInactive || item.isActive !== false)
    .map((item) => toDto(item, childrenOf(item.code)));
};

/** Reportable lines that a level may be allocated and report on. */
export const reportableItems = async (level) => (await listItems())
  .filter((item) => item.reportable && (!level || item.levels.includes(level)));

/** Lines by code (inactive ones too: old reports still name them). */
export const itemMap = async () => new Map((await listItems({ includeInactive: true })).map((item) => [item.code, item]));

const readFields = (body, existing = {}) => {
  const name = clean(body.name ?? existing.name, 200);
  if (name.length < 2) throw bad('Enter the name of the line.');
  const levels = Array.isArray(body.levels) ? [...new Set(body.levels)].filter((level) => Object.values(H56_LEVELS).includes(level)) : existing.levels;
  if (!levels?.length) throw bad('Choose at least one level (SARRA HQ, District SARRA Centre or PIA).');
  const hasPhysical = body.hasPhysical === undefined ? Boolean(existing.hasPhysical) : Boolean(body.hasPhysical);
  const unit = clean(body.unit ?? existing.unit, 40);
  if (hasPhysical && !unit) throw bad('Enter the unit of the physical measure (for example Person-months, Programmes, Works).');
  return {
    name,
    nameHindi: clean(body.nameHindi ?? existing.nameHindi, 200),
    levels,
    hasPhysical,
    unit: hasPhysical ? unit : '',
    allowsDecimal: hasPhysical && (body.allowsDecimal === undefined ? Boolean(existing.allowsDecimal) : Boolean(body.allowsDecimal)),
  };
};

export const createItem = async (body = {}, user) => {
  if (!canManageMaster(user)) throw forbidden('Only the HQ Administrator or the HQ Maker can change the Head 56 master.');
  const code = clean(body.code, 20);
  if (!CODE.test(code)) throw bad('The code must look like 56-10 for a sub-head or 56-03(08) for an item under a sub-head.');
  if (await Head56Item.exists({ code })) throw conflict(`${code} already exists.`, 'DUPLICATE');
  const parentCode = code.includes('(') ? code.slice(0, 5) : null;
  if (parentCode && !(await Head56Item.exists({ code: parentCode, isActive: true }))) throw bad(`Sub-head ${parentCode} does not exist. Add it first.`);
  const fields = readFields(body);
  const item = await Head56Item.create({ code, parentCode, ...fields, isActive: true, updatedBy: user._id });
  return toDto(item.toObject());
};

export const updateItem = async (code, body = {}, user) => {
  if (!canManageMaster(user)) throw forbidden('Only the HQ Administrator or the HQ Maker can change the Head 56 master.');
  const item = await Head56Item.findOne({ code });
  if (!item) throw notFound('Line not found.');
  Object.assign(item, readFields(body, item.toObject()));
  if (body.isActive !== undefined) item.isActive = Boolean(body.isActive);
  item.updatedBy = user._id;
  await item.save();
  return toDto(item.toObject());
};

/**
 * Adds every seeded line whose code is missing (never changes an existing line),
 * and makes sure the Head 56 unique indexes exist — production runs without
 * automatic index builds, and one-report-per-month and one-review-per-month rely on them.
 */
export const seedHead56 = async () => {
  try {
    await Promise.all([Head56Item, Head56Allocation, Head56Mpr, Head56Review].map((model) => model.createIndexes()));
    const existing = new Set((await Head56Item.find().select('code').lean()).map((item) => item.code));
    const missing = head56SeedRows().filter((row) => !existing.has(row.code));
    if (missing.length) {
      await Head56Item.insertMany(missing, { ordered: false });
      logger.info(`Head 56 master: added ${missing.length} line(s)`);
    }
  } catch (err) {
    logger.error(`Head 56 master seed failed: ${err.message}`);
  }
};

import mongoose from 'mongoose';
import Location, { LOCATION_TYPES } from '../models/Location.model.js';
import Department from '../models/Department.model.js';
import BudgetHead from '../models/BudgetHead.model.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';
import {
  SEED_DISTRICTS, SEED_BLOCKS_BY_DISTRICT, SEED_DEPARTMENTS, SEED_HEADS,
} from '../constants/masterData.seed.js';

// ─── Name handling ───────────────────────────────────────────────────────────

const NAME_MIN = 2;
const NAME_MAX = 80;
// Letters (any script), combining marks, digits, spaces and common punctuation.
const NAME_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,'()/-]*$/u;

/** Trim, collapse inner whitespace, and capitalise words typed fully in lower case. */
export const cleanName = (raw) => String(raw ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .split(' ')
  .map((word) => (word && word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word))
  .join(' ');

export const toNameKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const validateName = (raw, label) => {
  const name = cleanName(raw);
  if (!name) throw new ApiError(HTTP_STATUS.BAD_REQUEST, `${label} name is required.`);
  if (name.length < NAME_MIN) throw new ApiError(HTTP_STATUS.BAD_REQUEST, `${label} name must be at least ${NAME_MIN} characters.`);
  if (name.length > NAME_MAX) throw new ApiError(HTTP_STATUS.BAD_REQUEST, `${label} name cannot be longer than ${NAME_MAX} characters.`);
  if (!NAME_PATTERN.test(name)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, `${label} name can only contain letters, numbers, spaces and . , ' ( ) / -`);
  }
  return name;
};

export const assertObjectId = (id, label) => {
  if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, `A valid ${label} is required.`);
  }
  return id;
};

// ─── Locations ───────────────────────────────────────────────────────────────

const LOCATION_LABELS = {
  [LOCATION_TYPES.DISTRICT]: 'District',
  [LOCATION_TYPES.BLOCK]: 'Block',
  [LOCATION_TYPES.GRAM_PANCHAYAT]: 'Gram Panchayat',
  [LOCATION_TYPES.VILLAGE]: 'Village',
};

const PARENT_TYPE = {
  [LOCATION_TYPES.BLOCK]: LOCATION_TYPES.DISTRICT,
  [LOCATION_TYPES.GRAM_PANCHAYAT]: LOCATION_TYPES.BLOCK,
  [LOCATION_TYPES.VILLAGE]: LOCATION_TYPES.GRAM_PANCHAYAT,
};

const toLocationDto = (doc) => ({
  id: String(doc._id),
  name: doc.name,
  type: doc.type,
  code: doc.code || undefined,
  parentId: doc.parent ? String(doc.parent) : null,
});

export const listDistricts = async () => {
  const docs = await Location.find({ type: LOCATION_TYPES.DISTRICT, isActive: true }).sort({ name: 1 }).lean();
  return docs.map(toLocationDto);
};

const getActiveParent = async (type, parentId) => {
  const parentType = PARENT_TYPE[type];
  const parentLabel = LOCATION_LABELS[parentType];
  assertObjectId(parentId, parentLabel);
  const parent = await Location.findOne({ _id: parentId, type: parentType, isActive: true }).lean();
  if (!parent) throw new ApiError(HTTP_STATUS.NOT_FOUND, `The selected ${parentLabel} was not found.`);
  return parent;
};

/** Children of one parent only — unrelated locations are never returned. */
export const listChildLocations = async (type, parentId) => {
  const parent = await getActiveParent(type, parentId);
  const docs = await Location.find({ type, parent: parent._id, isActive: true })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1 })
    .lean();
  return docs.map(toLocationDto);
};

export const createChildLocation = async (type, parentId, rawName, user) => {
  const label = LOCATION_LABELS[type];
  const parent = await getActiveParent(type, parentId);
  const name = validateName(rawName, label);
  const nameKey = toNameKey(name);

  const existing = await Location.findOne({ type, parent: parent._id, nameKey }).lean();
  if (existing) {
    throw new ApiError(HTTP_STATUS.CONFLICT, `${label} "${existing.name}" already exists under ${parent.name}.`, {
      code: 'DUPLICATE_LOCATION',
      existing: toLocationDto(existing),
    });
  }

  try {
    const doc = await Location.create({
      type,
      name,
      nameKey,
      parent: parent._id,
      district: parent.type === LOCATION_TYPES.DISTRICT ? parent._id : parent.district,
      createdBy: user?._id,
    });
    return toLocationDto(doc);
  } catch (err) {
    // Two admins adding the same name at the same moment: the unique index decides.
    if (err?.code === 11000) {
      throw new ApiError(HTTP_STATUS.CONFLICT, `${label} "${name}" already exists under ${parent.name}.`, { code: 'DUPLICATE_LOCATION' });
    }
    throw err;
  }
};

/**
 * Resolve and verify a full District → Block → Gram Panchayat → Village chain.
 * Throws when any node is missing or does not belong to the node above it.
 */
export const resolveLocationChain = async ({ districtId, blockId, gramPanchayatId, villageId }) => {
  assertObjectId(districtId, 'District');
  assertObjectId(blockId, 'Block');
  assertObjectId(gramPanchayatId, 'Gram Panchayat');
  assertObjectId(villageId, 'Village');

  const docs = await Location.find({ _id: { $in: [districtId, blockId, gramPanchayatId, villageId] }, isActive: true }).lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const pick = (id, type) => {
    const doc = byId.get(String(id));
    if (!doc || doc.type !== type) throw new ApiError(HTTP_STATUS.BAD_REQUEST, `The selected ${LOCATION_LABELS[type]} was not found.`);
    return doc;
  };

  const district = pick(districtId, LOCATION_TYPES.DISTRICT);
  const block = pick(blockId, LOCATION_TYPES.BLOCK);
  const gramPanchayat = pick(gramPanchayatId, LOCATION_TYPES.GRAM_PANCHAYAT);
  const village = pick(villageId, LOCATION_TYPES.VILLAGE);

  if (String(block.parent) !== String(district._id)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, `Block "${block.name}" does not belong to ${district.name} district.`);
  }
  if (String(gramPanchayat.parent) !== String(block._id)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, `Gram Panchayat "${gramPanchayat.name}" does not belong to ${block.name} block.`);
  }
  if (String(village.parent) !== String(gramPanchayat._id)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, `Village "${village.name}" does not belong to ${gramPanchayat.name} Gram Panchayat.`);
  }
  return { district, block, gramPanchayat, village };
};

// ─── Departments ─────────────────────────────────────────────────────────────

const toDepartmentDto = (doc) => ({ id: String(doc._id), name: doc.name });

export const listDepartments = async () => {
  const docs = await Department.find({ isActive: true })
    .collation({ locale: 'en', strength: 2 })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return docs.map(toDepartmentDto);
};

export const createDepartment = async (rawName, user) => {
  const name = validateName(rawName, 'Department');
  const nameKey = toNameKey(name);

  const existing = await Department.findOne({ nameKey }).lean();
  if (existing) {
    throw new ApiError(HTTP_STATUS.CONFLICT, `Department "${existing.name}" already exists.`, {
      code: 'DUPLICATE_DEPARTMENT',
      existing: toDepartmentDto(existing),
    });
  }

  try {
    const doc = await Department.create({ name, nameKey, createdBy: user?._id });
    return toDepartmentDto(doc);
  } catch (err) {
    if (err?.code === 11000) {
      throw new ApiError(HTTP_STATUS.CONFLICT, `Department "${name}" already exists.`, { code: 'DUPLICATE_DEPARTMENT' });
    }
    throw err;
  }
};

// ─── Heads & activities ──────────────────────────────────────────────────────

const toHeadDto = (doc) => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  description: doc.description || '',
  activityCount: (doc.activities || []).filter((a) => a.isActive !== false).length,
});

const toActivityDto = (a) => ({
  code: a.code,
  name: a.name,
  nameHindi: a.nameHindi || '',
  unit: a.unit || '',
  sortOrder: a.sortOrder,
  hasPhysical: a.hasPhysical !== false,
  allowsDecimal: !!a.allowsDecimal,
  allowsZero: a.allowsZero !== false,
});

export const listHeads = async () => {
  const docs = await BudgetHead.find({ isActive: true }).sort({ sortOrder: 1, code: 1 }).lean();
  return docs.map(toHeadDto);
};

export const getActiveHead = async (headId) => {
  assertObjectId(headId, 'Head');
  const head = await BudgetHead.findOne({ _id: headId, isActive: true }).lean();
  if (!head) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'The selected Head was not found.');
  head.activities = (head.activities || [])
    .filter((a) => a.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return head;
};

export const getHeadActivities = async (headId) => {
  const head = await getActiveHead(headId);
  return { head: toHeadDto(head), activities: head.activities.map(toActivityDto) };
};

// ─── First-run seed ──────────────────────────────────────────────────────────

/** Seeds each master collection once, only while it is still empty. */
export const seedMasterData = async () => {
  try {
    if ((await Location.countDocuments({ type: LOCATION_TYPES.DISTRICT })) === 0) {
      const districts = await Location.insertMany(SEED_DISTRICTS.map((d) => ({
        type: LOCATION_TYPES.DISTRICT, name: d.name, nameKey: toNameKey(d.name), code: d.code,
      })));
      const blocks = districts.flatMap((district) => (SEED_BLOCKS_BY_DISTRICT[district.name] || []).map((name) => ({
        type: LOCATION_TYPES.BLOCK, name, nameKey: toNameKey(name), parent: district._id, district: district._id,
      })));
      if (blocks.length) await Location.insertMany(blocks);
      logger.info(`Master data: seeded ${districts.length} districts and ${blocks.length} blocks`);
    }

    if ((await Department.countDocuments()) === 0) {
      await Department.insertMany(SEED_DEPARTMENTS.map((name, i) => ({ name, nameKey: toNameKey(name), sortOrder: i + 1 })));
      logger.info(`Master data: seeded ${SEED_DEPARTMENTS.length} departments`);
    }

    if ((await BudgetHead.countDocuments()) === 0) {
      await BudgetHead.insertMany(SEED_HEADS);
      logger.info(`Master data: seeded ${SEED_HEADS.length} budget heads`);
    }
  } catch (err) {
    // Never block server start-up; a parallel instance may have seeded first.
    logger.error(`Master data seed failed: ${err.message}`);
  }
};

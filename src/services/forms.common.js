import Location, { LOCATION_TYPES } from '../models/Location.model.js';
import User from '../models/User.model.js';
import USER_ROLES from '../constants/roles.constants.js';
import { deleteFile, uploadFile } from './upload.service.js';
import { bad, clean, conflict, forbidden, isValidId, notFound } from './head56.common.js';
import CommitteeMeeting from '../models/CommitteeMeeting.model.js';
import DnssCommittee from '../models/DnssCommittee.model.js';
import TrainingProgramme from '../models/TrainingProgramme.model.js';
import { JsaReport } from '../models/JsaReport.model.js';
import logger from '../config/logger.js';

/**
 * Shared pieces of the field forms: committee meetings (HPC, SLEC, DLEC), DNSS,
 * JSA progress and training. Files, places, counts and dates.
 */

export { bad, clean, conflict, forbidden, isValidId, notFound };

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_TYPES = ['application/pdf', ...IMAGE_TYPES];

/** A whole number from the client (counts of people, structures, meetings…). */
export const parseCount = (value, label, { min = 0, max = 10000000 } = {}) => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || !Number.isInteger(number)) throw bad(`${label} must be a whole number.`);
  if (number < min) throw bad(`${label} must be at least ${min}.`);
  if (number > max) throw bad(`${label} is too large.`);
  return number;
};

/** A non-negative decimal (hectares, lakh …) with at most `decimals` places. */
export const parseDecimal = (value, label, decimals = 3) => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || number < 0) throw bad(`${label} must be a positive number.`);
  const scale = 10 ** decimals;
  if (Math.abs(Math.round(number * scale) - number * scale) > 1e-6) throw bad(`${label} can have at most ${decimals} decimal places.`);
  return number;
};

/** A calendar day (YYYY-MM-DD) as a UTC date; never in the future when `notFuture`. */
export const parseDay = (value, label, { required = true, notFuture = true } = {}) => {
  const text = typeof value === 'string' ? value.trim().slice(0, 10) : value instanceof Date ? value.toISOString().slice(0, 10) : '';
  if (!text) {
    if (required) throw bad(`Enter the ${label}.`);
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!date || date.getUTCDate() !== Number(match[3])) throw bad(`The ${label} is not a valid date.`);
  const now = new Date();
  if (notFuture && date.getTime() > Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) throw bad(`The ${label} cannot be in the future.`);
  if (date.getUTCFullYear() < 2000) throw bad(`The ${label} is too far in the past.`);
  return date;
};

// ─── Files ───────────────────────────────────────────────────────────────────

export { fileSchema } from '../models/fileRef.schema.js';

/**
 * Upload files to storage. `imagesOnly` for photographs; otherwise PDF or images.
 * Uploaded files are removed again if any of them fails.
 */
export const uploadFiles = async (files, { folder, imagesOnly = false, room, label = 'file', user }) => {
  if (!files?.length) throw bad('Choose at least one file.');
  if (room !== undefined && files.length > room) throw bad(room <= 0 ? `No more ${label}s can be added.` : `Only ${room} more ${label}${room === 1 ? '' : 's'} can be added.`);
  for (const file of files) {
    const allowed = imagesOnly ? IMAGE_TYPES : DOCUMENT_TYPES;
    if (!allowed.includes(file.mimetype)) throw bad(`${file.originalname}: upload ${imagesOnly ? 'a photograph (JPG, PNG or WEBP)' : 'a PDF or a photograph'}.`);
    if (file.size > MAX_FILE_BYTES) throw bad(`${file.originalname}: the file is too large. Maximum size is 10 MB.`);
  }
  const saved = [];
  try {
    for (const file of files) {
      const stored = await uploadFile(file.buffer, folder);
      saved.push({ url: stored.url, publicId: stored.publicId, name: clean(file.originalname, 200) || 'File', mimeType: file.mimetype, size: file.size, uploadedBy: user._id, uploadedAt: new Date() });
    }
    return saved;
  } catch (err) {
    await Promise.all(saved.map((file) => deleteFile(file.publicId)));
    throw err;
  }
};

export const removeStoredFiles = (files = []) => Promise.all(files.filter((file) => file?.publicId).map((file) => deleteFile(file.publicId)));

export const fileDto = (file, nameOf = new Map()) => ({
  id: String(file._id),
  url: file.url,
  name: file.name,
  mimeType: file.mimeType,
  size: file.size,
  uploadedBy: nameOf.get(String(file.uploadedBy)) || null,
  uploadedAt: file.uploadedAt,
});

/** Names of users by id. */
export const namesOf = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const people = unique.length ? await User.find({ _id: { $in: unique } }).select('name').lean() : [];
  return new Map(people.map((person) => [String(person._id), person.name]));
};

// ─── Places ──────────────────────────────────────────────────────────────────

const ORDER = [LOCATION_TYPES.DISTRICT, LOCATION_TYPES.BLOCK, LOCATION_TYPES.GRAM_PANCHAYAT, LOCATION_TYPES.VILLAGE];
const FIELD = { [LOCATION_TYPES.DISTRICT]: 'districtId', [LOCATION_TYPES.BLOCK]: 'blockId', [LOCATION_TYPES.GRAM_PANCHAYAT]: 'gramPanchayatId', [LOCATION_TYPES.VILLAGE]: 'villageId' };
const LABEL = { [LOCATION_TYPES.DISTRICT]: 'district', [LOCATION_TYPES.BLOCK]: 'block', [LOCATION_TYPES.GRAM_PANCHAYAT]: 'Gram Panchayat', [LOCATION_TYPES.VILLAGE]: 'village' };
const KEY = { [LOCATION_TYPES.DISTRICT]: 'district', [LOCATION_TYPES.BLOCK]: 'block', [LOCATION_TYPES.GRAM_PANCHAYAT]: 'gramPanchayat', [LOCATION_TYPES.VILLAGE]: 'village' };

/**
 * A place from the location master, down to `depth` (DISTRICT … VILLAGE), each
 * node checked to belong to the one above. `district` (a name) restricts it to
 * one district — a district or PIA officer's own.
 * Returns { district: {id, name}, block?, gramPanchayat?, village? }.
 */
export const resolvePlace = async (input = {}, depth, { district } = {}) => {
  const levels = ORDER.slice(0, ORDER.indexOf(depth) + 1);
  const ids = levels.map((type) => {
    const id = input[FIELD[type]];
    if (!isValidId(id)) throw bad(`Choose the ${LABEL[type]}.`);
    return id;
  });
  const docs = await Location.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  const place = {};
  let parent = null;
  levels.forEach((type, index) => {
    const doc = byId.get(String(ids[index]));
    if (!doc || doc.type !== type) throw bad(`The selected ${LABEL[type]} was not found.`);
    if (parent && String(doc.parent) !== String(parent._id)) throw bad(`${doc.name} does not belong to ${parent.name}.`);
    place[KEY[type]] = { id: String(doc._id), name: doc.name };
    parent = doc;
  });
  if (district && place.district.name !== district) throw forbidden(`You can only record places in ${district} district.`);
  return place;
};

/** District of the signed-in district or PIA officer (null for State-level users). */
export const ownDistrict = (user) => ([USER_ROLES.DD_LEVEL, USER_ROLES.PIA_OFFICER].includes(user.role) ? user.district || null : null);

export const placeLabel = (place = {}) => [place.village?.name, place.gramPanchayat?.name, place.block?.name, place.district?.name].filter(Boolean).join(', ');

/** Unique indexes of the field forms (autoIndex is off in production). */
export const ensureFormIndexes = async () => {
  try {
    await Promise.all([CommitteeMeeting, DnssCommittee, TrainingProgramme, JsaReport].map((model) => model.createIndexes()));
  } catch (err) {
    logger.error(`Field form indexes could not be created: ${err.message}`);
  }
};

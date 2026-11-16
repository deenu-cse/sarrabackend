import TrainingProgramme, { TRAINING_LEVELS } from '../models/TrainingProgramme.model.js';
import Counter from '../models/Counter.model.js';
import USER_ROLES from '../constants/roles.constants.js';
import { LOCATION_TYPES } from '../models/Location.model.js';
import { escapeRegex } from '../utils/access.js';
import { isUnitMaker, levelLabel, unitOfUser } from './head56.common.js';
import {
  bad, clean, fileDto, forbidden, isValidId, namesOf, notFound, ownDistrict, parseCount, parseDay, removeStoredFiles, resolvePlace, uploadFiles,
} from './forms.common.js';

/**
 * Training and capacity development programmes. SARRA HQ, District SARRA
 * Centres and PIAs all hold them; the Maker of the organising unit records them.
 * HQ and M&E see all; a district sees those held in or organised by it; a PIA its own.
 */

const STATE_WIDE = [USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER];
export const FILE_KINDS = {
  photographs: { max: 12, imagesOnly: true, label: 'photograph' },
  documents: { max: 10, imagesOnly: false, label: 'document' },
  minutes: { max: 5, imagesOnly: false, label: 'minutes file' },
};
const DEPTH = { GRAM_PANCHAYAT: LOCATION_TYPES.GRAM_PANCHAYAT, BLOCK: LOCATION_TYPES.BLOCK, DISTRICT: LOCATION_TYPES.DISTRICT };
const CATEGORIES = ['officer', 'representative', 'community'];

const readScope = async (user) => {
  if (STATE_WIDE.includes(user.role)) return {};
  if (user.role === USER_ROLES.DD_LEVEL && user.district) return { $or: [{ district: user.district }, { 'organiser.district': user.district }] };
  if (user.role === USER_ROLES.PIA_OFFICER) {
    const unit = await unitOfUser(user);
    return unit ? { 'organiser.unitKey': unit.unitKey } : null;
  }
  return null;
};

const makerUnit = async (user) => {
  const unit = await unitOfUser(user);
  if (!unit || !isUnitMaker(user, unit)) throw forbidden('Training programmes are recorded by the Maker of SARRA HQ, a District SARRA Centre or a PIA.');
  return unit;
};

const nextRef = async () => {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate({ _id: `training:${year}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `TRG-${year}-${String(counter.seq).padStart(5, '0')}`;
};

const readFields = async (body, user) => {
  if (!TRAINING_LEVELS[body.level]) throw bad('Choose the level: Gram Panchayat, Block or District.');
  const place = await resolvePlace(body, DEPTH[body.level], { district: ownDistrict(user) });
  const venue = clean(body.place, 300);
  if (venue.length < 2) throw bad('Enter the place of the programme.');
  const subject = clean(body.subject, 300);
  if (subject.length < 3) throw bad('Enter the activity / subject of the programme.');
  const departments = [...new Set((Array.isArray(body.departments) ? body.departments : []).map((d) => clean(d, 120)).filter(Boolean))].slice(0, 40);
  const participants = Object.fromEntries(CATEGORIES.map((category) => [category, {
    male: parseCount(body.participants?.[category]?.male, `${category} male participants`, { max: 100000 }),
    female: parseCount(body.participants?.[category]?.female, `${category} female participants`, { max: 100000 }),
  }]));
  if (CATEGORIES.every((c) => !participants[c].male && !participants[c].female)) throw bad('Enter the number of participants.');
  return {
    level: body.level,
    district: place.district.name,
    districtId: place.district.id,
    block: place.block || undefined,
    gramPanchayat: place.gramPanchayat || undefined,
    date: parseDay(body.date, 'date of the programme'),
    place: venue,
    departments,
    subject,
    participants,
    remarks: clean(body.remarks, 2000),
  };
};

export const createTraining = async (body = {}, user) => {
  const unit = await makerUnit(user);
  const fields = await readFields(body, user);
  return TrainingProgramme.create({
    refNo: await nextRef(),
    organiser: { level: unit.level, unitKey: unit.unitKey, unitName: unit.unitName, district: unit.district, departmentName: unit.departmentName },
    ...fields,
    createdBy: user._id,
    updatedBy: user._id,
  });
};

const loadForMaker = async (id, user) => {
  if (!isValidId(id)) throw notFound('Training programme not found.');
  const doc = await TrainingProgramme.findById(id);
  if (!doc) throw notFound('Training programme not found.');
  if (!isUnitMaker(user, doc.organiser)) throw forbidden(`Only the Maker of ${doc.organiser.unitName} can change this programme.`);
  return doc;
};

export const updateTraining = async (id, body = {}, user) => {
  const doc = await loadForMaker(id, user);
  const fields = await readFields(body, user);
  doc.set({ ...fields, block: fields.block || null, gramPanchayat: fields.gramPanchayat || null, updatedBy: user._id });
  await doc.save();
  return doc;
};

export const deleteTraining = async (id, user) => {
  const doc = await loadForMaker(id, user);
  await TrainingProgramme.deleteOne({ _id: doc._id });
  await removeStoredFiles([...doc.photographs, ...doc.documents, ...doc.minutes]);
  return { id: String(doc._id), refNo: doc.refNo };
};

export const addFiles = async (id, kind, files, user) => {
  const config = FILE_KINDS[kind];
  if (!config) throw bad('Choose what you are uploading: photographs, documents or minutes.');
  const doc = await loadForMaker(id, user);
  const saved = await uploadFiles(files, { folder: 'training', imagesOnly: config.imagesOnly, room: config.max - doc[kind].length, label: config.label, user });
  return TrainingProgramme.findByIdAndUpdate(doc._id, { $push: { [kind]: { $each: saved } }, $set: { updatedBy: user._id } }, { new: true });
};

export const removeFile = async (id, kind, fileId, user) => {
  if (!FILE_KINDS[kind]) throw bad('Unknown file group.');
  const doc = await loadForMaker(id, user);
  const file = doc[kind].find((item) => String(item._id) === String(fileId));
  if (!file) throw notFound('File not found.');
  await TrainingProgramme.updateOne({ _id: doc._id }, { $pull: { [kind]: { _id: file._id } } });
  await removeStoredFiles([file]);
  return { id: String(file._id) };
};

// ─── Reading ─────────────────────────────────────────────────────────────────

export const totalsOf = (participants = {}) => {
  const out = { male: 0, female: 0 };
  for (const category of CATEGORIES) {
    out[category] = { male: participants[category]?.male || 0, female: participants[category]?.female || 0 };
    out[category].total = out[category].male + out[category].female;
    out.male += out[category].male;
    out.female += out[category].female;
  }
  out.total = out.male + out.female;
  return out;
};

const listDto = (doc) => ({
  id: String(doc._id),
  refNo: doc.refNo,
  organiser: { ...doc.organiser, levelLabel: levelLabel(doc.organiser.level) },
  level: doc.level,
  levelLabel: TRAINING_LEVELS[doc.level],
  district: doc.district,
  districtId: doc.districtId || null,
  block: doc.block || null,
  gramPanchayat: doc.gramPanchayat || null,
  date: doc.date,
  place: doc.place,
  departments: doc.departments,
  subject: doc.subject,
  participants: totalsOf(doc.participants),
  photographs: doc.photographs?.length || 0,
  documents: doc.documents?.length || 0,
  minutes: doc.minutes?.length || 0,
  remarks: doc.remarks,
  updatedAt: doc.updatedAt,
});

const filterOf = async (user, query) => {
  const scope = await readScope(user);
  if (!scope) throw forbidden('You do not have access to training programmes.');
  const parts = [scope];
  if (TRAINING_LEVELS[query.level]) parts.push({ level: query.level });
  if (['HQ', 'DISTRICT', 'PIA'].includes(query.organiser)) parts.push({ 'organiser.level': query.organiser });
  if (typeof query.district === 'string' && query.district) parts.push({ district: query.district });
  const from = query.from ? parseDay(query.from, 'from date', { notFuture: false }) : null;
  const to = query.to ? parseDay(query.to, 'to date', { notFuture: false }) : null;
  if (from || to) parts.push({ date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });
  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = new RegExp(escapeRegex(query.search.trim().slice(0, 60)), 'i');
    parts.push({ $or: [{ subject: pattern }, { place: pattern }, { refNo: pattern }, { departments: pattern }] });
  }
  return parts.length === 1 ? parts[0] : { $and: parts };
};

export const listTrainings = async (user, query = {}) => {
  const filter = await filterOf(user, query);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25));
  const [docs, count, all] = await Promise.all([
    TrainingProgramme.find(filter).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    TrainingProgramme.countDocuments(filter),
    TrainingProgramme.find(filter).select('level district organiser.level participants date').lean(),
  ]);
  const sumOf = (list) => totalsOf(CATEGORIES.reduce((acc, c) => ({ ...acc, [c]: { male: list.reduce((s, d) => s + (d.participants?.[c]?.male || 0), 0), female: list.reduce((s, d) => s + (d.participants?.[c]?.female || 0), 0) } }), {}));
  const group = (keyOf, labelOf) => [...new Set(all.map(keyOf))].filter(Boolean).sort().map((key) => {
    const list = all.filter((d) => keyOf(d) === key);
    return { key, label: labelOf ? labelOf(key) : key, programmes: list.length, participants: sumOf(list).total };
  });
  let unit = null;
  try { unit = await unitOfUser(user); } catch { unit = null; }
  return {
    items: docs.map(listDto),
    pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
    summary: {
      programmes: all.length,
      participants: sumOf(all),
      byLevel: group((d) => d.level, (k) => TRAINING_LEVELS[k]),
      byOrganiser: group((d) => d.organiser?.level, levelLabel),
      byDistrict: group((d) => d.district),
      byMonth: group((d) => (d.date ? new Date(d.date).toISOString().slice(0, 7) : null)),
    },
    permissions: { canCreate: Boolean(unit && isUnitMaker(user, unit)), lockedDistrict: ownDistrict(user) },
  };
};

export const getTraining = async (id, user) => {
  if (!isValidId(id)) throw notFound('Training programme not found.');
  const scope = await readScope(user);
  const doc = scope ? await TrainingProgramme.findOne({ $and: [{ _id: id }, scope] }).lean() : null;
  if (!doc) throw notFound('Training programme not found.');
  const nameOf = await namesOf([doc.createdBy, doc.updatedBy, ...['photographs', 'documents', 'minutes'].flatMap((k) => doc[k].map((f) => f.uploadedBy))]);
  const maker = isUnitMaker(user, doc.organiser);
  return {
    ...listDto(doc),
    participantsInput: doc.participants,
    photographs: doc.photographs.map((f) => fileDto(f, nameOf)),
    documents: doc.documents.map((f) => fileDto(f, nameOf)),
    minutes: doc.minutes.map((f) => fileDto(f, nameOf)),
    createdBy: nameOf.get(String(doc.createdBy)) || null,
    createdAt: doc.createdAt,
    permissions: { canEdit: maker, canDelete: maker },
  };
};

export const trainingsForExport = async (user, query = {}) => TrainingProgramme.find(await filterOf(user, query)).sort({ date: 1 }).lean();

import DnssCommittee from '../models/DnssCommittee.model.js';
import USER_ROLES, { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { LOCATION_TYPES } from '../models/Location.model.js';
import { escapeRegex, isDistrict } from '../utils/access.js';
import {
  bad, clean, conflict, fileDto, forbidden, isValidId, namesOf, notFound, parseCount, parseDay, removeStoredFiles, resolvePlace, uploadFiles,
} from './forms.common.js';

/**
 * Dhara Naula Sanrakshan Samiti (DNSS) of each Gram Panchayat, recorded by the
 * District Maker. HQ, M&E and the district's officers see them.
 */

const STATE_WIDE = [USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER];
export const FILE_KINDS = {
  formationLetter: { max: 3, imagesOnly: false, label: 'formation letter' },
  photographs: { max: 12, imagesOnly: true, label: 'photograph' },
  minutes: { max: 5, imagesOnly: false, label: 'minutes file' },
};

export const readScope = (user) => {
  if (STATE_WIDE.includes(user.role)) return {};
  if (user.role === USER_ROLES.DD_LEVEL && user.district) return { district: user.district };
  return null;
};
const isMaker = (user, district) => isDistrict(user, WORKFLOW_ROLES.MAKER) && Boolean(user.district) && (!district || user.district === district);

const readFields = (body) => {
  const chairperson = clean(body.chairperson, 150);
  if (chairperson.length < 2) throw bad('Enter the name of the Gram Pradhan / Chairperson.');
  const phone = String(body.contactNumber ?? '').replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
  if (!/^\d{10}$/.test(phone)) throw bad('Enter a 10-digit contact number.');
  const members = { male: parseCount(body.male, 'Male members', { max: 100000 }), female: parseCount(body.female, 'Female members', { max: 100000 }) };
  if (members.male + members.female < 1) throw bad('Enter the number of members (male and female).');
  return {
    groups: parseCount(body.groups, 'Number of groups', { max: 10000 }),
    members,
    chairperson,
    contactNumber: phone,
    formationDate: parseDay(body.formationDate, 'date of DNSS formation'),
    remarks: clean(body.remarks, 2000),
  };
};

const assertUniqueGp = async (gramPanchayatId, selfId = null) => {
  const other = await DnssCommittee.findOne({ 'gramPanchayat.id': gramPanchayatId, ...(selfId ? { _id: { $ne: selfId } } : {}) }).select('_id').lean();
  if (other) throw conflict('A DNSS of this Gram Panchayat has already been recorded. Open it to update it.', 'DUPLICATE', { id: String(other._id) });
};

export const createDnss = async (body = {}, user) => {
  if (!isMaker(user)) throw forbidden('Only the District Maker records DNSS committees.');
  const place = await resolvePlace(body, LOCATION_TYPES.GRAM_PANCHAYAT, { district: user.district });
  const fields = readFields(body);
  await assertUniqueGp(place.gramPanchayat.id);
  try {
    return await DnssCommittee.create({
      district: place.district.name, districtId: place.district.id, block: place.block, gramPanchayat: place.gramPanchayat,
      ...fields, createdBy: user._id, updatedBy: user._id,
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict('A DNSS of this Gram Panchayat has already been recorded.', 'DUPLICATE');
    throw err;
  }
};

const loadForMaker = async (id, user) => {
  if (!isValidId(id)) throw notFound('DNSS record not found.');
  const doc = await DnssCommittee.findById(id);
  if (!doc) throw notFound('DNSS record not found.');
  if (!isMaker(user, doc.district)) throw forbidden(`Only the District Maker of ${doc.district} can change this record.`);
  return doc;
};

export const updateDnss = async (id, body = {}, user) => {
  const doc = await loadForMaker(id, user);
  const place = await resolvePlace(body, LOCATION_TYPES.GRAM_PANCHAYAT, { district: user.district });
  await assertUniqueGp(place.gramPanchayat.id, doc._id);
  Object.assign(doc, { block: place.block, gramPanchayat: place.gramPanchayat, ...readFields(body), updatedBy: user._id });
  await doc.save();
  return doc;
};

export const deleteDnss = async (id, user) => {
  const doc = await loadForMaker(id, user);
  await DnssCommittee.deleteOne({ _id: doc._id });
  await removeStoredFiles([...doc.formationLetter, ...doc.photographs, ...doc.minutes]);
  return { id: String(doc._id) };
};

export const addFiles = async (id, kind, files, user) => {
  const config = FILE_KINDS[kind];
  if (!config) throw bad('Choose what you are uploading: formation letter, photographs or minutes.');
  const doc = await loadForMaker(id, user);
  const saved = await uploadFiles(files, { folder: 'dnss', imagesOnly: config.imagesOnly, room: config.max - doc[kind].length, label: config.label, user });
  return DnssCommittee.findByIdAndUpdate(doc._id, { $push: { [kind]: { $each: saved } }, $set: { updatedBy: user._id } }, { new: true });
};

export const removeFile = async (id, kind, fileId, user) => {
  if (!FILE_KINDS[kind]) throw bad('Unknown file group.');
  const doc = await loadForMaker(id, user);
  const file = doc[kind].find((item) => String(item._id) === String(fileId));
  if (!file) throw notFound('File not found.');
  await DnssCommittee.updateOne({ _id: doc._id }, { $pull: { [kind]: { _id: file._id } } });
  await removeStoredFiles([file]);
  return { id: String(file._id) };
};

// ─── Reading ─────────────────────────────────────────────────────────────────

const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
export const membersOf = (members = {}) => {
  const totalMembers = (members.male || 0) + (members.female || 0);
  return { male: members.male || 0, female: members.female || 0, total: totalMembers, femalePercent: share(members.female || 0, totalMembers), malePercent: share(members.male || 0, totalMembers) };
};

const listDto = (doc) => ({
  id: String(doc._id),
  district: doc.district,
  districtId: doc.districtId || null,
  block: doc.block,
  gramPanchayat: doc.gramPanchayat,
  groups: doc.groups,
  members: membersOf(doc.members),
  chairperson: doc.chairperson,
  contactNumber: doc.contactNumber,
  formationDate: doc.formationDate,
  formationLetter: doc.formationLetter?.length || 0,
  photographs: doc.photographs?.length || 0,
  minutes: doc.minutes?.length || 0,
  remarks: doc.remarks,
  updatedAt: doc.updatedAt,
});

const filterOf = (user, query) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to DNSS records.');
  const filter = { ...scope };
  if (typeof query.district === 'string' && query.district && !scope.district) filter.district = query.district;
  if (typeof query.block === 'string' && query.block) filter['block.name'] = query.block;
  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = new RegExp(escapeRegex(query.search.trim().slice(0, 60)), 'i');
    filter.$or = [{ 'gramPanchayat.name': pattern }, { 'block.name': pattern }, { chairperson: pattern }];
  }
  return filter;
};

export const listDnss = async (user, query = {}) => {
  const filter = filterOf(user, query);
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25));
  const [docs, count, all] = await Promise.all([
    DnssCommittee.find(filter).sort({ district: 1, 'block.name': 1, 'gramPanchayat.name': 1 }).skip((page - 1) * limit).limit(limit).lean(),
    DnssCommittee.countDocuments(filter),
    DnssCommittee.find(filter).select('district groups members').lean(),
  ]);
  const members = membersOf({ male: all.reduce((s, d) => s + (d.members?.male || 0), 0), female: all.reduce((s, d) => s + (d.members?.female || 0), 0) });
  const byDistrict = [...new Set(all.map((d) => d.district))].sort().map((district) => {
    const list = all.filter((d) => d.district === district);
    return { district, committees: list.length, groups: list.reduce((s, d) => s + (d.groups || 0), 0), members: membersOf({ male: list.reduce((s, d) => s + (d.members?.male || 0), 0), female: list.reduce((s, d) => s + (d.members?.female || 0), 0) }) };
  });
  return {
    items: docs.map(listDto),
    pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
    summary: { committees: all.length, groups: all.reduce((s, d) => s + (d.groups || 0), 0), members, byDistrict },
    permissions: { canCreate: isMaker(user) },
  };
};

export const getDnss = async (id, user) => {
  if (!isValidId(id)) throw notFound('DNSS record not found.');
  const doc = await DnssCommittee.findById(id).lean();
  const scope = readScope(user);
  if (!doc || !scope || (scope.district && scope.district !== doc.district)) throw notFound('DNSS record not found.');
  const nameOf = await namesOf([doc.createdBy, doc.updatedBy, ...['formationLetter', 'photographs', 'minutes'].flatMap((k) => doc[k].map((f) => f.uploadedBy))]);
  return {
    ...listDto(doc),
    formationLetter: doc.formationLetter.map((f) => fileDto(f, nameOf)),
    photographs: doc.photographs.map((f) => fileDto(f, nameOf)),
    minutes: doc.minutes.map((f) => fileDto(f, nameOf)),
    createdBy: nameOf.get(String(doc.createdBy)) || null,
    updatedBy: nameOf.get(String(doc.updatedBy)) || null,
    createdAt: doc.createdAt,
    permissions: { canEdit: isMaker(user, doc.district), canDelete: isMaker(user, doc.district) },
  };
};

export const dnssForExport = async (user, query = {}) => DnssCommittee.find(filterOf(user, query)).sort({ district: 1, 'block.name': 1, 'gramPanchayat.name': 1 }).lean();

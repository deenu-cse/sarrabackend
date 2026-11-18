import CommitteeMeeting, { COMMITTEE_TYPES, MEETING_STATUS as M, MEETING_STATUS_LABELS } from '../models/CommitteeMeeting.model.js';
import Counter from '../models/Counter.model.js';
import USER_ROLES, { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { SEED_DISTRICTS } from '../constants/masterData.seed.js';
import { actorLabel, designationOf, isDistrict, isHq, sameId } from '../utils/access.js';
import {
  bad, clean, conflict, fileDto, forbidden, isValidId, namesOf, notFound, parseCount, parseDay, removeStoredFiles, uploadFiles,
} from './forms.common.js';

/**
 * Committee meetings — HPC (High Power Committee) and SLEC (State Level
 * Executive Committee) entered by the HQ Maker; DLEC (District Level Executive
 * Committee) entered by the District Maker. Each is submitted to the HQ
 * Approver, who approves it or returns it with remarks. Approved meetings are locked.
 */

const { MAKER, APPROVER } = WORKFLOW_ROLES;
const STATE_WIDE = [USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER];
export const FILE_KINDS = { minutes: { max: 5, imagesOnly: false, label: 'minutes file' }, photographs: { max: 12, imagesOnly: true, label: 'photograph' } };
const EDITABLE = [M.DRAFT, M.RETURNED];

const committeeOf = (type) => {
  const committee = COMMITTEE_TYPES[type];
  if (!committee) throw bad('Choose the committee: HPC, SLEC or DLEC.');
  return committee;
};

/** The Maker of a committee's meetings: HQ Maker for HPC / SLEC, the District Maker of the district for DLEC. */
const isMakerFor = (user, type, district) => (COMMITTEE_TYPES[type].level === 'HQ'
  ? isHq(user, MAKER)
  : isDistrict(user, MAKER) && Boolean(user.district) && user.district === district);

export const readScope = (user) => {
  if (STATE_WIDE.includes(user.role)) return {};
  if (user.role === USER_ROLES.DD_LEVEL && user.district) return { type: 'DLEC', district: user.district };
  return null;
};
const canRead = (user, doc) => {
  const scope = readScope(user);
  return Boolean(scope) && (!scope.type || (doc.type === scope.type && doc.district === scope.district));
};

const step = (user, action, status, note = '') => ({ action, status, role: actorLabel(user), designation: designationOf(user), by: user._id, at: new Date(), note });
const districtCode = (district) => SEED_DISTRICTS.find((d) => d.name === district)?.code || String(district).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();

const nextRef = async (type, district) => {
  const year = new Date().getFullYear();
  const prefix = type === 'DLEC' ? `DLEC-${districtCode(district)}-${year}` : `${type}-${year}`;
  const counter = await Counter.findOneAndUpdate({ _id: `meeting:${prefix}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(counter.seq).padStart(3, '0')}`;
};

const readFields = (body) => {
  const place = clean(body.place, 300);
  if (place.length < 2) throw bad('Enter the place of the meeting.');
  return {
    meetingNo: parseCount(body.meetingNo, 'Meeting number', { min: 1, max: 100000 }),
    meetingDate: parseDay(body.meetingDate, 'date of the meeting'),
    place,
    participants: {
      male: parseCount(body.male, 'Male participants', { max: 100000 }),
      female: parseCount(body.female, 'Female participants', { max: 100000 }),
    },
    remarks: clean(body.remarks, 2000),
  };
};

const assertUniqueNo = async (type, district, meetingNo, selfId = null) => {
  const other = await CommitteeMeeting.findOne({ type, district, meetingNo, ...(selfId ? { _id: { $ne: selfId } } : {}) }).select('refNo').lean();
  if (other) throw conflict(`Meeting no. ${meetingNo} of ${type}${district ? ` (${district})` : ''} has already been entered (${other.refNo}).`, 'DUPLICATE', { id: String(other._id) });
};

// ─── Maker ───────────────────────────────────────────────────────────────────

export const createMeeting = async (body = {}, user) => {
  const committee = committeeOf(body.type);
  const district = committee.level === 'DISTRICT' ? user.district || null : null;
  if (!isMakerFor(user, committee.code, district)) {
    throw forbidden(committee.level === 'HQ' ? `Only the HQ Maker enters ${committee.code} meetings.` : 'Only the District Maker enters the DLEC meetings of the district.');
  }
  const fields = readFields(body);
  await assertUniqueNo(committee.code, district, fields.meetingNo);
  try {
    return await CommitteeMeeting.create({
      refNo: await nextRef(committee.code, district),
      type: committee.code,
      district,
      ...fields,
      status: M.DRAFT,
      createdBy: user._id,
      history: [step(user, 'CREATED', M.DRAFT)],
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict(`Meeting no. ${fields.meetingNo} of ${committee.code} has already been entered.`, 'DUPLICATE');
    throw err;
  }
};

const loadForMaker = async (id, user) => {
  if (!isValidId(id)) throw notFound('Meeting not found.');
  const doc = await CommitteeMeeting.findById(id);
  if (!doc) throw notFound('Meeting not found.');
  if (!isMakerFor(user, doc.type, doc.district)) throw forbidden(`Only the ${COMMITTEE_TYPES[doc.type].level === 'HQ' ? 'HQ Maker' : `District Maker of ${doc.district}`} can change this meeting.`);
  return doc;
};
const assertEditable = (doc) => {
  if (!EDITABLE.includes(doc.status)) throw conflict(doc.status === M.APPROVED ? 'This meeting has been approved by HQ and is locked.' : 'This meeting is with the HQ Approver and cannot be changed now.', 'LOCKED');
};

export const updateMeeting = async (id, body = {}, user) => {
  const doc = await loadForMaker(id, user);
  assertEditable(doc);
  const fields = readFields(body);
  await assertUniqueNo(doc.type, doc.district, fields.meetingNo, doc._id);
  Object.assign(doc, fields);
  await doc.save();
  return doc;
};

export const deleteMeeting = async (id, user) => {
  const doc = await loadForMaker(id, user);
  if (doc.status !== M.DRAFT) throw conflict('Only a draft can be deleted. A submitted meeting stays on record.', 'NOT_DRAFT');
  await CommitteeMeeting.deleteOne({ _id: doc._id, status: M.DRAFT });
  await removeStoredFiles([...doc.minutes, ...doc.photographs]);
  return { id: String(doc._id), refNo: doc.refNo };
};

export const addFiles = async (id, kind, files, user) => {
  const config = FILE_KINDS[kind];
  if (!config) throw bad('Choose what you are uploading: minutes or photographs.');
  const doc = await loadForMaker(id, user);
  assertEditable(doc);
  const saved = await uploadFiles(files, { folder: `committee-${doc.type.toLowerCase()}`, imagesOnly: config.imagesOnly, room: config.max - doc[kind].length, label: config.label, user });
  const updated = await CommitteeMeeting.findOneAndUpdate({ _id: doc._id, status: { $in: EDITABLE } }, { $push: { [kind]: { $each: saved } } }, { new: true });
  if (!updated) { await removeStoredFiles(saved); throw conflict('The meeting changed while the files were uploading. Please reload.', 'STALE'); }
  return updated;
};

export const removeFile = async (id, kind, fileId, user) => {
  if (!FILE_KINDS[kind]) throw bad('Unknown file group.');
  const doc = await loadForMaker(id, user);
  assertEditable(doc);
  const file = doc[kind].find((item) => String(item._id) === String(fileId));
  if (!file) throw notFound('File not found.');
  await CommitteeMeeting.updateOne({ _id: doc._id }, { $pull: { [kind]: { _id: file._id } } });
  await removeStoredFiles([file]);
  return { id: String(file._id) };
};

/** Send the meeting to the HQ Approver. The minutes must be attached. */
export const submitMeeting = async (id, user) => {
  const doc = await loadForMaker(id, user);
  assertEditable(doc);
  if (doc.participants.male + doc.participants.female < 1) throw bad('Enter the number of participants (male and female).');
  if (!doc.minutes.length) throw bad('Upload the minutes of the meeting before submitting.', { code: 'MINUTES_REQUIRED' });
  const again = doc.status === M.RETURNED;
  const updated = await CommitteeMeeting.findOneAndUpdate(
    { _id: doc._id, status: doc.status },
    { $set: { status: M.PENDING_APPROVAL, submittedBy: user._id, submittedAt: new Date(), returnReason: null }, $push: { history: step(user, again ? 'RESUBMITTED' : 'SUBMITTED', M.PENDING_APPROVAL) } },
    { new: true },
  );
  if (!updated) throw conflict('The meeting has already moved on. Please reload.', 'STALE');
  return { doc: updated, again };
};

// ─── HQ Approver ─────────────────────────────────────────────────────────────

const loadPending = async (id, user) => {
  if (!isHq(user, APPROVER)) throw forbidden('Only the HQ Approver approves committee meetings.');
  if (!isValidId(id)) throw notFound('Meeting not found.');
  const doc = await CommitteeMeeting.findById(id);
  if (!doc) throw notFound('Meeting not found.');
  if (doc.status !== M.PENDING_APPROVAL) throw conflict('This meeting is not waiting for approval.', 'NOT_PENDING');
  if (sameId(doc.createdBy, user._id) || sameId(doc.submittedBy, user._id)) throw forbidden('You entered this meeting, so you cannot approve it.');
  return doc;
};

export const approveMeeting = async (id, note, user) => {
  const doc = await loadPending(id, user);
  const text = clean(note, 1000);
  const updated = await CommitteeMeeting.findOneAndUpdate(
    { _id: doc._id, status: M.PENDING_APPROVAL },
    { $set: { status: M.APPROVED, approvedBy: user._id, approvedAt: new Date(), approvalNote: text }, $push: { history: step(user, 'APPROVED', M.APPROVED, text) } },
    { new: true },
  );
  if (!updated) throw conflict('The meeting has already moved on. Please reload.', 'STALE');
  return updated;
};

export const returnMeeting = async (id, reason, user) => {
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Write the remarks for the Maker (at least 5 characters).');
  const doc = await loadPending(id, user);
  const updated = await CommitteeMeeting.findOneAndUpdate(
    { _id: doc._id, status: M.PENDING_APPROVAL },
    { $set: { status: M.RETURNED, returnedBy: user._id, returnedAt: new Date(), returnReason: text }, $push: { history: step(user, 'RETURNED', M.RETURNED, text) } },
    { new: true },
  );
  if (!updated) throw conflict('The meeting has already moved on. Please reload.', 'STALE');
  return updated;
};

// ─── Reading ─────────────────────────────────────────────────────────────────

const total = (participants) => (participants?.male || 0) + (participants?.female || 0);

const listDto = (doc) => ({
  id: String(doc._id),
  refNo: doc.refNo,
  type: doc.type,
  committee: COMMITTEE_TYPES[doc.type].name,
  district: doc.district,
  meetingNo: doc.meetingNo,
  meetingDate: doc.meetingDate,
  place: doc.place,
  participants: { ...doc.participants, total: total(doc.participants) },
  minutes: doc.minutes?.length || 0,
  photographs: doc.photographs?.length || 0,
  status: doc.status,
  statusLabel: MEETING_STATUS_LABELS[doc.status],
  remarks: doc.remarks,
  updatedAt: doc.updatedAt,
});

/** Meetings this user may see. A draft is seen only by the Maker who started it. */
export const listMeetings = async (user, query = {}) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to committee meetings.');
  const filter = { ...scope };
  if (COMMITTEE_TYPES[query.type] && !scope.type) filter.type = query.type;
  if (Object.values(M).includes(query.status)) filter.status = query.status;
  if (typeof query.district === 'string' && query.district && !scope.district) filter.district = query.district;
  const year = parseInt(query.year, 10);
  if (year > 2000 && year < 2100) filter.meetingDate = { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };
  const visible = { $and: [filter, { $or: [{ status: { $ne: M.DRAFT } }, { createdBy: user._id }] }] };
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25));
  const [docs, count, all] = await Promise.all([
    CommitteeMeeting.find(visible).sort({ meetingDate: -1, meetingNo: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CommitteeMeeting.countDocuments(visible),
    CommitteeMeeting.find(visible).select('status participants').lean(),
  ]);
  return {
    items: docs.map(listDto),
    pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
    summary: {
      meetings: all.length,
      approved: all.filter((d) => d.status === M.APPROVED).length,
      pending: all.filter((d) => d.status === M.PENDING_APPROVAL).length,
      male: all.reduce((s, d) => s + (d.participants?.male || 0), 0),
      female: all.reduce((s, d) => s + (d.participants?.female || 0), 0),
    },
    permissions: {
      canCreate: {
        HPC: isHq(user, MAKER),
        SLEC: isHq(user, MAKER),
        DLEC: isDistrict(user, MAKER) && Boolean(user.district),
      },
      canApprove: isHq(user, APPROVER),
    },
  };
};

export const getMeeting = async (id, user) => {
  if (!isValidId(id)) throw notFound('Meeting not found.');
  const doc = await CommitteeMeeting.findById(id).lean();
  if (!doc) throw notFound('Meeting not found.');
  const maker = isMakerFor(user, doc.type, doc.district);
  if (!canRead(user, doc) && !maker) throw notFound('Meeting not found.');
  if (doc.status === M.DRAFT && !maker) throw notFound('Meeting not found.');
  const nameOf = await namesOf([doc.createdBy, doc.submittedBy, doc.approvedBy, doc.returnedBy, ...(doc.history || []).map((h) => h.by), ...doc.minutes.map((f) => f.uploadedBy), ...doc.photographs.map((f) => f.uploadedBy)]);
  const approver = isHq(user, APPROVER) && !sameId(doc.createdBy, user._id) && !sameId(doc.submittedBy, user._id);
  return {
    ...listDto(doc),
    level: COMMITTEE_TYPES[doc.type].level,
    minutes: doc.minutes.map((f) => fileDto(f, nameOf)),
    photographs: doc.photographs.map((f) => fileDto(f, nameOf)),
    createdBy: nameOf.get(String(doc.createdBy)) || null,
    submittedBy: nameOf.get(String(doc.submittedBy)) || null,
    submittedAt: doc.submittedAt || null,
    approvedBy: nameOf.get(String(doc.approvedBy)) || null,
    approvedAt: doc.approvedAt || null,
    approvalNote: doc.approvalNote || '',
    returnReason: doc.status === M.RETURNED ? doc.returnReason : null,
    history: (doc.history || []).map((h) => ({ ...h, by: nameOf.get(String(h.by)) || null })).reverse(),
    permissions: {
      canEdit: maker && EDITABLE.includes(doc.status),
      canSubmit: maker && EDITABLE.includes(doc.status),
      canDelete: maker && doc.status === M.DRAFT,
      canApprove: approver && doc.status === M.PENDING_APPROVAL,
      canReturn: approver && doc.status === M.PENDING_APPROVAL,
    },
  };
};

/** Meetings waiting for this user's approval (HQ Approver), for the sidebar badge. */
export const pendingCount = async (user) => (isHq(user, APPROVER) ? CommitteeMeeting.countDocuments({ status: M.PENDING_APPROVAL, createdBy: { $ne: user._id } }) : 0);

/** All meetings in scope for an export (no paging). */
export const meetingsForExport = async (user, query = {}) => {
  const scope = readScope(user);
  if (!scope) throw forbidden('You do not have access to committee meetings.');
  const filter = { ...scope, status: { $ne: M.DRAFT } };
  if (COMMITTEE_TYPES[query.type] && !scope.type) filter.type = query.type;
  if (typeof query.district === 'string' && query.district && !scope.district) filter.district = query.district;
  const year = parseInt(query.year, 10);
  if (year > 2000 && year < 2100) filter.meetingDate = { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) };
  return CommitteeMeeting.find(filter).sort({ type: 1, district: 1, meetingDate: 1 }).lean();
};

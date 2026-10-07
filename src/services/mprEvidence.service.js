import mongoose from 'mongoose';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import ProjectSanction from '../models/ProjectSanction.model.js';
import { uploadFile, deleteFile } from './upload.service.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Optional evidence on a monthly report: site photographs and measurement
 * sheets. A report is complete without any. Files can be added or removed by
 * the reporting officer until the district approves the report.
 */

export const MAX_EVIDENCE = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EDITABLE = [PROJECT_MPR_STATUS.SUBMITTED, PROJECT_MPR_STATUS.RETURNED_TO_PIA];

const bad = (message) => new ApiError(HTTP_STATUS.BAD_REQUEST, message);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const conflict = (message, code) => new ApiError(HTTP_STATUS.CONFLICT, message, { code });
const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const evidenceDto = (item) => ({
  id: String(item._id),
  url: item.url,
  name: item.name || 'File',
  mimeType: item.mimeType || null,
  isImage: /^image\//.test(item.mimeType || ''),
  size: item.size || null,
  caption: item.caption || '',
  uploadedAt: item.uploadedAt || null,
});

/** The report, if this user is the officer currently holding its department and it can still be changed. */
const editableReport = async (mprId, user) => {
  if (typeof mprId !== 'string' || !mongoose.isValidObjectId(mprId)) throw notFound('Report not found.');
  const mpr = await ProjectMPR.findById(mprId).select('project departmentId status evidence mprNo').lean();
  if (!mpr) throw notFound('Report not found.');
  if (user.role !== USER_ROLES.PIA_OFFICER) throw forbidden('Only the reporting PIA officer can change the evidence of a report.');
  const project = await ProjectSanction.findById(mpr.project).select('departmentAllocations.departmentId departmentAllocations.piaUserId').lean();
  const holds = (project?.departmentAllocations || []).some((department) => String(department.departmentId) === String(mpr.departmentId) && String(department.piaUserId || '') === String(user._id));
  if (!holds) throw forbidden('You are not the assigned PIA officer for this department.');
  if (!EDITABLE.includes(mpr.status)) throw conflict('Evidence can be changed only until the district approves the report.', 'REPORT_LOCKED');
  return mpr;
};

/** Attach up to six files in total to a report. */
export const addEvidence = async (mprId, files = [], body = {}, user) => {
  const mpr = await editableReport(mprId, user);
  if (!files.length) throw bad('Choose at least one file.');
  const room = MAX_EVIDENCE - (mpr.evidence || []).length;
  if (files.length > room) {
    throw bad(room <= 0 ? `A report can carry at most ${MAX_EVIDENCE} files. Remove one to add another.` : `Only ${room} more file${room === 1 ? '' : 's'} can be added to this report (maximum ${MAX_EVIDENCE}).`);
  }
  files.forEach((file) => {
    if (!FILE_TYPES.includes(file.mimetype)) throw bad(`${file.originalname}: upload photographs (JPG, PNG, WEBP) or PDF files.`);
    if (file.size > MAX_FILE_BYTES) throw bad(`${file.originalname}: the file is too large. Maximum size is 10 MB.`);
  });
  // One caption per file, in order; a single caption applies to all.
  const captions = [].concat(body.captions ?? body.caption ?? []).map((caption) => clean(caption, 200));

  const stored = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      // eslint-disable-next-line no-await-in-loop
      const saved = await uploadFile(file.buffer, 'mpr-evidence');
      stored.push({
        _id: new mongoose.Types.ObjectId(),
        url: saved.url,
        publicId: saved.publicId,
        name: clean(file.originalname, 200) || 'File',
        mimeType: file.mimetype,
        size: file.size,
        caption: captions[index] ?? captions[0] ?? '',
        uploadedBy: user._id,
        uploadedAt: new Date(),
      });
    }
    // The size check is part of the write, so two uploads at once cannot go past the limit.
    const updated = await ProjectMPR.updateOne(
      { _id: mpr._id, status: { $in: EDITABLE }, [`evidence.${MAX_EVIDENCE - stored.length}`]: { $exists: false } },
      { $push: { evidence: { $each: stored } } },
    );
    if (updated.modifiedCount !== 1) throw conflict('The report changed while the files were uploading. Please reload and try again.', 'STALE');
  } catch (err) {
    stored.forEach((item) => { deleteFile(item.publicId); });
    throw err;
  }
  const fresh = await ProjectMPR.findById(mpr._id).select('evidence mprNo').lean();
  return { mprNo: fresh.mprNo, added: stored.length, evidence: (fresh.evidence || []).map(evidenceDto) };
};

/** Remove one file from a report. */
export const removeEvidence = async (mprId, evidenceId, user) => {
  const mpr = await editableReport(mprId, user);
  const item = (mpr.evidence || []).find((entry) => String(entry._id) === String(evidenceId));
  if (!item) throw notFound('File not found on this report.');
  const updated = await ProjectMPR.updateOne({ _id: mpr._id, status: { $in: EDITABLE } }, { $pull: { evidence: { _id: item._id } } });
  if (updated.modifiedCount !== 1) throw conflict('Evidence can be changed only until the district approves the report.', 'REPORT_LOCKED');
  if (item.publicId) deleteFile(item.publicId);
  const fresh = await ProjectMPR.findById(mpr._id).select('evidence mprNo').lean();
  return { mprNo: fresh.mprNo, removed: item.name, evidence: (fresh.evidence || []).map(evidenceDto) };
};

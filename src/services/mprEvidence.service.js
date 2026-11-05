import mongoose from 'mongoose';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import ProjectSanction from '../models/ProjectSanction.model.js';
import { uploadFile, deleteFile } from './upload.service.js';
import { evidenceEditable, reportingDepartments } from './projectMpr.service.js';
import { firstStageOf } from './mprWorkflow.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Evidence on a monthly report: field photographs and supporting documents.
 * Files can be added or removed by the department's reporting Maker (PIA
 * Maker or District Technical Staff) until the first reviewer acts on the
 * report, and again while it is back with the Maker for correction.
 */

export const MAX_EVIDENCE = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

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

/** The report, if this user is the reporting Maker of its department and it can still be changed. */
const editableReport = async (mprId, user) => {
  if (typeof mprId !== 'string' || !mongoose.isValidObjectId(mprId)) throw notFound('Report not found.');
  const mpr = await ProjectMPR.findById(mprId).select('project departmentId status entryMode evidence mprNo').lean();
  if (!mpr) throw notFound('Report not found.');
  const project = await ProjectSanction.findById(mpr.project)
    .select('district departmentAllocations.departmentId departmentAllocations.piaUserId departmentAllocations.districtStaffUserId departmentAllocations.reportingMode').lean();
  const holds = project && reportingDepartments(project, user).some((department) => String(department.departmentId) === String(mpr.departmentId));
  if (!holds) throw forbidden('Only the reporting Maker of this department can change the evidence of its reports.');
  if (!evidenceEditable(mpr)) throw conflict('Evidence can be changed only until the first reviewer acts on the report.', 'REPORT_LOCKED');
  return mpr;
};

/** Statuses at which a report's evidence can still change, for the conditional writes below. */
const editableStatuses = (mpr) => [PROJECT_MPR_STATUS.DRAFT, PROJECT_MPR_STATUS.RETURNED_FOR_CORRECTION, firstStageOf(mpr.entryMode)];

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
      { _id: mpr._id, status: { $in: editableStatuses(mpr) }, [`evidence.${MAX_EVIDENCE - stored.length}`]: { $exists: false } },
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
  const updated = await ProjectMPR.updateOne({ _id: mpr._id, status: { $in: editableStatuses(mpr) } }, { $pull: { evidence: { _id: item._id } } });
  if (updated.modifiedCount !== 1) throw conflict('Evidence can be changed only until the first reviewer acts on the report.', 'REPORT_LOCKED');
  if (item.publicId) deleteFile(item.publicId);
  const fresh = await ProjectMPR.findById(mpr._id).select('evidence mprNo').lean();
  return { mprNo: fresh.mprNo, removed: item.name, evidence: (fresh.evidence || []).map(evidenceDto) };
};

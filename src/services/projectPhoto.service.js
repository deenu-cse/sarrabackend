import mongoose from 'mongoose';
import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectPhoto, { PHOTO_SOURCE, PHOTO_STAGE, PHOTO_VERIFICATION } from '../models/ProjectPhoto.model.js';
import User from '../models/User.model.js';
import { uploadFile, deleteFile } from './upload.service.js';
import { piaDepartmentsOf, reportingDepartments } from './projectMpr.service.js';
import USER_ROLES, { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { actorLabel, isDistrict, isHq, sameId, workflowRoleOf } from '../utils/access.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Photographic evidence of physical progress (M&E integration).
 *
 * Field teams photograph each activity before, during and after the works,
 * from the portal or the SARRA M&E mobile application. Every photograph is
 * tied to the Project ID, the department and the activity's approved target,
 * with GPS coordinates and the capture time. District Technical Staff or an
 * authorised reviewer verifies it; HQ sees them chronologically per activity.
 */

const bad = (message) => new ApiError(HTTP_STATUS.BAD_REQUEST, message);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const conflict = (message, code) => new ApiError(HTTP_STATUS.CONFLICT, message, { code });
const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);
const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const MAX_PHOTOS_PER_UPLOAD = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTOGRAPHABLE = ['SANCTIONED', 'FORWARDED_TO_DISTRICT', 'DISTRICT_ACCEPTED', 'FORWARDED_TO_PIA', 'PIA_ACCEPTED'];

const loadProject = async (projectId) => {
  if (!isValidId(projectId)) throw notFound('Project not found.');
  const project = await ProjectSanction.findById(projectId).lean();
  if (!project) throw notFound('Project not found.');
  return project;
};

const canRead = (project, user) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) return true;
  if (user.role === USER_ROLES.DD_LEVEL) return Boolean(user.district) && user.district === project.district;
  if (user.role === USER_ROLES.PIA_OFFICER) return piaDepartmentsOf(project, user).length > 0;
  return false;
};

/**
 * Departments this user may photograph: the department's reporting Maker,
 * its PIA Maker, a District Maker of the district, or an M&E officer (the
 * mobile application's field user).
 */
const uploadableDepartments = (project, user) => {
  const departments = project.departmentAllocations || [];
  if (project.closure?.status === 'CLOSED' || !PHOTOGRAPHABLE.includes(project.status)) return [];
  if (user.role === USER_ROLES.MND_OFFICER) return departments;
  if (isDistrict(user, WORKFLOW_ROLES.MAKER) && user.district === project.district) return departments;
  if (user.role === USER_ROLES.PIA_OFFICER && workflowRoleOf(user) === WORKFLOW_ROLES.MAKER) {
    const reporting = reportingDepartments(project, user).map((d) => String(d.departmentId));
    return departments.filter((d) => sameId(d.piaUserId, user._id) || reporting.includes(String(d.departmentId)));
  }
  return [];
};

/** District Technical Staff of the department, the District Checker / Approver, or the HQ Checker. */
const canVerify = (project, photo, user) => {
  if (sameId(photo.uploadedBy, user._id)) return false;
  if (isHq(user, WORKFLOW_ROLES.CHECKER)) return true;
  if (user.role !== USER_ROLES.DD_LEVEL || user.district !== project.district) return false;
  if (isDistrict(user, WORKFLOW_ROLES.CHECKER, WORKFLOW_ROLES.APPROVER)) return true;
  const department = (project.departmentAllocations || []).find((d) => sameId(d.departmentId, photo.departmentId));
  return Boolean(department && sameId(department.districtStaffUserId, user._id));
};

const photoDto = (photo, project, user, names) => ({
  id: String(photo._id),
  url: photo.url,
  name: photo.name || 'Photograph',
  stage: photo.stage,
  caption: photo.caption || '',
  departmentId: String(photo.departmentId),
  departmentName: photo.departmentName,
  activityCode: photo.activityCode,
  activityName: photo.activityName,
  unit: photo.unit || '',
  physicalTarget: photo.physicalTarget ?? null,
  physicalProgress: photo.physicalProgress ?? null,
  gps: photo.gps?.latitude !== undefined && photo.gps?.latitude !== null
    ? { latitude: photo.gps.latitude, longitude: photo.gps.longitude, accuracy: photo.gps.accuracy ?? null }
    : null,
  capturedAt: photo.capturedAt,
  source: photo.source,
  uploadedBy: names.get(String(photo.uploadedBy)) || null,
  uploadedByRole: photo.uploadedByRole || null,
  uploadedAt: photo.createdAt,
  verification: {
    status: photo.verification?.status || PHOTO_VERIFICATION.PENDING,
    by: photo.verification?.by ? names.get(String(photo.verification.by)) || null : null,
    role: photo.verification?.role || null,
    at: photo.verification?.at || null,
    remarks: photo.verification?.remarks || '',
  },
  canVerify: project ? canVerify(project, photo, user) : false,
  canDelete: sameId(photo.uploadedBy, user._id) && (photo.verification?.status || PHOTO_VERIFICATION.PENDING) === PHOTO_VERIFICATION.PENDING,
});

const namesOf = async (photos) => {
  const ids = [...new Set(photos.flatMap((p) => [p.uploadedBy, p.verification?.by]).filter(Boolean).map(String))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean() : [];
  return new Map(users.map((u) => [String(u._id), u.name]));
};

/** Photographs of a project, oldest first, with the activities that can be photographed. */
export const listProjectPhotos = async (projectId, user, { departmentId, activityCode, stage } = {}) => {
  const project = await loadProject(projectId);
  if (!canRead(project, user)) throw forbidden('You do not have access to this project.');

  const visible = user.role === USER_ROLES.PIA_OFFICER ? piaDepartmentsOf(project, user) : (project.departmentAllocations || []);
  const filter = { project: project._id, departmentId: { $in: visible.map((d) => d.departmentId) } };
  if (isValidId(departmentId)) filter.departmentId = departmentId;
  if (typeof activityCode === 'string' && activityCode) filter.activityCode = activityCode;
  if (Object.values(PHOTO_STAGE).includes(stage)) filter.stage = stage;
  const photos = await ProjectPhoto.find(filter).sort({ capturedAt: 1, createdAt: 1 }).lean();
  const names = await namesOf(photos);
  const uploadable = new Set(uploadableDepartments(project, user).map((d) => String(d.departmentId)));
  const all = await ProjectPhoto.find({ project: project._id }).select('departmentId activityCode stage verification.status').lean();

  return {
    project: { id: String(project._id), code: project.projectId || project.sanctionId || '', sanctionId: project.sanctionId || null, name: project.projectTitle || '', district: project.district },
    departments: visible.map((department) => ({
      departmentId: String(department.departmentId),
      name: department.departmentName,
      canUpload: uploadable.has(String(department.departmentId)),
      activities: (department.activities || []).map((activity) => {
        const mine = all.filter((p) => sameId(p.departmentId, department.departmentId) && p.activityCode === activity.activityCode);
        return {
          activityCode: activity.activityCode,
          activityName: activity.activityName,
          unit: activity.unit || '',
          physicalTarget: activity.physicalTarget || 0,
          counts: Object.fromEntries(Object.values(PHOTO_STAGE).map((key) => [key, mine.filter((p) => p.stage === key).length])),
        };
      }),
    })),
    summary: {
      total: all.length,
      byStage: Object.fromEntries(Object.values(PHOTO_STAGE).map((key) => [key, all.filter((p) => p.stage === key).length])),
      pendingVerification: all.filter((p) => (p.verification?.status || PHOTO_VERIFICATION.PENDING) === PHOTO_VERIFICATION.PENDING).length,
      verified: all.filter((p) => p.verification?.status === PHOTO_VERIFICATION.VERIFIED).length,
    },
    photos: photos.map((photo) => photoDto(photo, project, user, names)),
    maxPerUpload: MAX_PHOTOS_PER_UPLOAD,
  };
};

const parseCoordinate = (value, min, max, label) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw bad(`${label} must be a number between ${min} and ${max}.`);
  return Math.round(number * 1e6) / 1e6;
};

/** Upload photographs of one activity (from the portal or the M&E mobile application). */
export const uploadPhotos = async (projectId, files = [], body = {}, user) => {
  const project = await loadProject(projectId);
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId : '';
  const department = uploadableDepartments(project, user).find((d) => String(d.departmentId) === departmentId);
  if (!department) throw forbidden('You cannot upload photographs for this department of the project.');
  const activity = (department.activities || []).find((a) => a.activityCode === body.activityCode);
  if (!activity) throw bad('Select an activity from the approved plan of this department.');
  if (!Object.values(PHOTO_STAGE).includes(body.stage)) throw bad('Select whether the photograph is pre-, mid- or post-intervention.');

  if (!files.length) throw bad('Choose at least one photograph.');
  if (files.length > MAX_PHOTOS_PER_UPLOAD) throw bad(`Upload at most ${MAX_PHOTOS_PER_UPLOAD} photographs at a time.`);
  files.forEach((file) => {
    if (!IMAGE_TYPES.includes(file.mimetype)) throw bad(`${file.originalname}: upload a photograph (JPG, PNG or WEBP).`);
    if (file.size > MAX_FILE_BYTES) throw bad(`${file.originalname}: the file is too large. Maximum size is 10 MB.`);
  });

  const capturedAt = new Date(body.capturedAt || Date.now());
  if (Number.isNaN(capturedAt.getTime())) throw bad('The capture date and time is not valid.');
  if (capturedAt.getTime() > Date.now() + 10 * 60 * 1000) throw bad('The capture date and time cannot be in the future.');
  const latitude = parseCoordinate(body.latitude, -90, 90, 'Latitude');
  const longitude = parseCoordinate(body.longitude, -180, 180, 'Longitude');
  if ((latitude === null) !== (longitude === null)) throw bad('Give both latitude and longitude, or neither.');
  const accuracy = body.accuracy === undefined || body.accuracy === '' ? null : Math.max(0, Number(body.accuracy) || 0);
  const physicalProgress = body.physicalProgress === undefined || body.physicalProgress === '' ? undefined : Math.max(0, Number(body.physicalProgress) || 0);
  const source = body.source === PHOTO_SOURCE.MOBILE ? PHOTO_SOURCE.MOBILE : PHOTO_SOURCE.PORTAL;
  const captions = [].concat(body.captions ?? body.caption ?? []).map((caption) => clean(caption, 300));
  const pia = department.piaUserId ? await User.findById(department.piaUserId).select('name').lean() : null;

  const stored = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const saved = await uploadFile(files[index].buffer, 'project-photos');
      stored.push({ ...saved, file: files[index], caption: captions[index] ?? captions[0] ?? '' });
    }
    const docs = await ProjectPhoto.insertMany(stored.map((item) => ({
      project: project._id,
      projectCode: project.projectId || project.sanctionId || '',
      sanctionCode: project.sanctionId || '',
      district: project.district,
      location: { block: project.location?.block || '', gramPanchayat: project.location?.gramPanchayat || '', village: project.location?.village || '' },
      departmentId: department.departmentId,
      departmentName: department.departmentName,
      piaName: pia?.name || '',
      activityCode: activity.activityCode,
      activityName: activity.activityName,
      unit: activity.unit || '',
      physicalTarget: activity.physicalTarget || 0,
      physicalProgress,
      stage: body.stage,
      url: item.url,
      publicId: item.publicId,
      name: clean(item.file.originalname, 200) || 'Photograph',
      mimeType: item.file.mimetype,
      size: item.file.size,
      caption: item.caption,
      gps: latitude !== null ? { latitude, longitude, accuracy } : undefined,
      capturedAt,
      source,
      uploadedBy: user._id,
      uploadedByRole: actorLabel(user),
    })));
    return { added: docs.length, project: project.projectId || project.sanctionId || '', department: department.departmentName, activity: activity.activityName, stage: body.stage };
  } catch (err) {
    stored.forEach((item) => { if (item.publicId) deleteFile(item.publicId); });
    throw err;
  }
};

/** Verify or reject a photograph. Rejection needs remarks. */
export const verifyPhoto = async (projectId, photoId, body = {}, user) => {
  const project = await loadProject(projectId);
  if (!isValidId(photoId)) throw notFound('Photograph not found.');
  const photo = await ProjectPhoto.findOne({ _id: photoId, project: project._id }).lean();
  if (!photo) throw notFound('Photograph not found.');
  if (!canVerify(project, photo, user)) {
    throw forbidden(sameId(photo.uploadedBy, user._id) ? 'You uploaded this photograph, so you cannot verify it.' : 'Only District Technical Staff, the District Checker or Approver, or the HQ Checker can verify photographs.');
  }
  const status = [PHOTO_VERIFICATION.VERIFIED, PHOTO_VERIFICATION.REJECTED].includes(body.status) ? body.status : null;
  if (!status) throw bad('Choose whether the photograph is verified or rejected.');
  const remarks = clean(body.remarks, 500);
  if (status === PHOTO_VERIFICATION.REJECTED && remarks.length < 5) throw bad('Write why the photograph is rejected.');
  const updated = await ProjectPhoto.findOneAndUpdate(
    { _id: photo._id, 'verification.status': { $ne: status } },
    { $set: { verification: { status, by: user._id, role: actorLabel(user), at: new Date(), remarks } } },
    { new: true },
  );
  if (!updated) throw conflict('This photograph already has that verification status.', 'UNCHANGED');
  return { id: String(updated._id), status, project: project.projectId || '', activity: updated.activityName, stage: updated.stage };
};

/** The uploader removes a photograph that has not been verified yet. */
export const deletePhoto = async (projectId, photoId, user) => {
  const project = await loadProject(projectId);
  if (!isValidId(photoId)) throw notFound('Photograph not found.');
  const removed = await ProjectPhoto.findOneAndDelete({ _id: photoId, project: project._id, uploadedBy: user._id, 'verification.status': PHOTO_VERIFICATION.PENDING });
  if (!removed) throw conflict('Only your own photographs that are not yet verified can be removed.', 'NOT_REMOVABLE');
  if (removed.publicId) deleteFile(removed.publicId);
  return { id: String(removed._id), activity: removed.activityName, stage: removed.stage };
};

/** Latest photographs across the user's scope, for dashboards. */
export const recentPhotos = async (user, { district, status, limit } = {}) => {
  const filter = {};
  if (user.role === USER_ROLES.DD_LEVEL) filter.district = user.district;
  else if (![USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) throw forbidden('You do not have access to this list.');
  else if (typeof district === 'string' && district.trim()) filter.district = district.trim();
  if (Object.values(PHOTO_VERIFICATION).includes(status)) filter['verification.status'] = status;
  const safeLimit = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));
  const photos = await ProjectPhoto.find(filter).sort({ capturedAt: -1 }).limit(safeLimit).lean();
  const names = await namesOf(photos);
  return photos.map((photo) => ({
    ...photoDto(photo, null, user, names),
    project: { id: String(photo.project), code: photo.projectCode, sanctionId: photo.sanctionCode || null },
    district: photo.district,
    location: photo.location || {},
  }));
};

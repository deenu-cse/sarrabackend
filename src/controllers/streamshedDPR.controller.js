import * as streamshedService from '../services/streamshedDPR.service.js';
import { uploadFile } from '../services/upload.service.js';
import { notifyDDOfficer, createNotification } from '../services/notification.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const handleFileUploads = async (req) => {
  const uploadedFiles = {};
  if (req.files) {
    for (const fieldname of Object.keys(req.files)) {
      const file = req.files[fieldname][0];
      const result = await uploadFile(file.buffer, 'dpr');
      uploadedFiles[fieldname] = result;
    }
  }
  return uploadedFiles;
};

const mapUploadedFilesToBody = (body, uploadedFiles) => {
  // Section 3: Catchment Area Map
  if (uploadedFiles.attachLandCoverMap) {
    body.section3_catchmentArea = body.section3_catchmentArea || {};
    body.section3_catchmentArea.attachLandCoverMap = uploadedFiles.attachLandCoverMap;
  }

  // Section 4: Photographs
  if (uploadedFiles.mainStreamPhoto || uploadedFiles.tributariesConfluencePhoto) {
    body.section4_photographs = body.section4_photographs || {};
    if (uploadedFiles.mainStreamPhoto) body.section4_photographs.mainStreamPhoto = uploadedFiles.mainStreamPhoto;
    if (uploadedFiles.tributariesConfluencePhoto) body.section4_photographs.tributariesConfluencePhoto = uploadedFiles.tributariesConfluencePhoto;
  }

  // Section 6: Geo Coordinates File
  if (uploadedFiles.geoCoordinatesFile) {
    body.section6_maps = body.section6_maps || {};
    body.section6_maps.geoCoordinatesFile = uploadedFiles.geoCoordinatesFile;
  }

  // Section 7: Budget & Plan Annexures
  if (uploadedFiles.detailProjectReport || uploadedFiles.otherDocuments || uploadedFiles.signatureWithStamp) {
    body.section7_budgetAndPlan = body.section7_budgetAndPlan || {};
    body.section7_budgetAndPlan.annexures = body.section7_budgetAndPlan.annexures || {};
    if (uploadedFiles.detailProjectReport) body.section7_budgetAndPlan.annexures.detailProjectReport = uploadedFiles.detailProjectReport;
    if (uploadedFiles.otherDocuments) body.section7_budgetAndPlan.annexures.otherDocuments = uploadedFiles.otherDocuments;
    if (uploadedFiles.signatureWithStamp) body.section7_budgetAndPlan.signatureWithStamp = uploadedFiles.signatureWithStamp;
  }

  // Section 8: Geo Location File
  if (uploadedFiles.geoLocationFile) {
    body.section8_geoLocation = body.section8_geoLocation || {};
    body.section8_geoLocation.geoLocationFile = uploadedFiles.geoLocationFile;
  }
};

export const saveDraft = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userDistrict = req.user.district;
  const userDept = req.user.department;
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.headers['user-agent'];

  const uploadedFiles = await handleFileUploads(req);
  mapUploadedFilesToBody(req.body, uploadedFiles);

  const draft = await streamshedService.saveDraft(userId, userDistrict, userDept, req.body, ip, ua);
  res.locals.auditTargetId = draft._id;

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { applicationNo: draft.applicationNo }, 'Draft saved successfully'));
});

export const submitForm = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userDistrict = req.user.district;
  const userDept = req.user.department;
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.headers['user-agent'];

  const uploadedFiles = await handleFileUploads(req);
  mapUploadedFilesToBody(req.body, uploadedFiles);

  const form = await streamshedService.submitForm(userId, userDistrict, userDept, req.body, ip, ua);
  res.locals.auditTargetId = form._id;

  await notifyDDOfficer(
    userDistrict,
    'New Streamshed DPR Submitted',
    `A new Streamshed DPR (${form.applicationNo}) has been submitted for your district.`,
    'StreamshedDPR',
    form._id
  );

  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, { applicationNo: form.applicationNo, status: form.status }, 'Streamshed DPR submitted successfully'));
});

export const getMyForms = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status } = req.query;
  
  const filters = {};
  if (status) filters.status = status;

  const result = await streamshedService.getMyForms(userId, filters, parseInt(page), parseInt(limit));
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Forms fetched successfully', result.pagination));
});

export const getFormById = asyncHandler(async (req, res) => {
  const form = await streamshedService.getFormById(req.params.id, req.user);
  if (!form) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Form not found or you are not authorized to view it');
  }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, form, 'Form fetched successfully'));
});

export const getDistrictPendingForms = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const districtName = req.user.district;

  const result = await streamshedService.getDistrictPendingForms(districtName, parseInt(page), parseInt(limit));
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Pending forms fetched successfully', result.pagination));
});

export const approveForm = asyncHandler(async (req, res) => {
  const form = await streamshedService.approveForm(req.params.id, req.user._id);
  res.locals.auditTargetId = form._id;

  await createNotification(
    form.submittedBy,
    'Streamshed DPR Approved',
    `Your Streamshed DPR (${form.applicationNo}) has been approved.`,
    'StreamshedDPR',
    form._id
  );

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, form, 'Form approved successfully'));
});

export const rejectForm = asyncHandler(async (req, res) => {
  const reason = req.body.reason || req.body.rejectionReason;
  if (!reason || reason.length < 20) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Rejection reason must be at least 20 characters long');
  }

  const form = await streamshedService.rejectForm(req.params.id, req.user._id, reason);
  res.locals.auditTargetId = form._id;

  await createNotification(
    form.submittedBy,
    'Streamshed DPR Returned',
    `Your Streamshed DPR (${form.applicationNo}) has been returned for corrections. Reason: ${reason}`,
    'StreamshedDPR',
    form._id
  );

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, form, 'Form returned to officer for corrections'));
});

export const resubmitForm = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const uploadedFiles = await handleFileUploads(req);
  mapUploadedFilesToBody(req.body, uploadedFiles);

  const form = await streamshedService.resubmitForm(req.params.id, userId, req.body);
  res.locals.auditTargetId = form._id;

  await notifyDDOfficer(
    req.user.district,
    'Streamshed DPR Resubmitted',
    `Streamshed DPR (${form.applicationNo}) has been resubmitted.`,
    'StreamshedDPR',
    form._id
  );

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, form, 'Form resubmitted successfully'));
});

export const deleteForm = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  await streamshedService.deleteForm(req.params.id, userId);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, 'Draft deleted successfully'));
});

export const updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['UNDER_REVIEW'];
  if (!allowed.includes(status)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid status transition');
  }
  const form = await streamshedService.updateFormStatus(req.params.id, status, req.user._id);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, form, `Status updated to ${status}`));
});

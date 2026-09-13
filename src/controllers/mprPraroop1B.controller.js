import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import mprPraroop1BService from '../services/mprPraroop1B.service.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import ApiError from '../utils/ApiError.js';

export const saveDraft = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userDistrict = req.user.district;
  const userDept = req.user.department;
  const formData = req.body;
  const ip = req.ip;
  const ua = req.get('User-Agent');

  const draft = await mprPraroop1BService.saveDraft(userId, userDistrict, userDept, formData, ip, ua);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, draft, 'Draft saved successfully'));
});

export const submitMPR = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userDistrict = req.user.district;
  const userDept = req.user.department;
  const formData = req.body;
  const ip = req.ip;
  const ua = req.get('User-Agent');

  const mpr = await mprPraroop1BService.submitMPR(userId, userDistrict, userDept, formData, ip, ua);
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, mpr, 'MPR submitted successfully'));
});

export const resubmitMPR = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const formData = req.body;
  const ip = req.ip;
  const ua = req.get('User-Agent');

  const mpr = await mprPraroop1BService.resubmitMPR(id, userId, formData, ip, ua);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'MPR resubmitted successfully'));
});


export const getMyReports = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { financialYear, status, page, limit } = req.query;
  const filters = {};
  if (financialYear) filters.financialYear = financialYear;
  if (status) filters.status = status;

  if (req.user.role === 'MND_SUPER_ADMIN' || req.user.role === 'MND_ADMIN') {
      const allMprs = await MPRPraroop1B.find(filters).sort({ createdAt: -1 });
      return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, allMprs, 'All MPRs retrieved'));
  }

  const reports = await mprPraroop1BService.getMyMPRs(userId, filters, parseInt(page) || 1, parseInt(limit) || 10);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, reports, 'Reports retrieved successfully'));
});

export const getReportById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const mpr = await mprPraroop1BService.getMPRById(id, req.user._id);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'Report retrieved successfully'));
});

export const approveReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  const mpr = await mprPraroop1BService.approveMPR(id, req.user._id, note);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'Report approved'));
});

export const rejectReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  const mpr = await mprPraroop1BService.rejectMPR(id, req.user._id, note);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'Report rejected'));
});

export const getPreviousMonthData = asyncHandler(async (req, res) => {
  const { financialYear, month } = req.query;
  const data = await mprPraroop1BService.getPreviousMonthData(req.user._id, financialYear, month);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Previous month data retrieved'));
});

export const getBaselineFromDPR = asyncHandler(async (req, res) => {
  const { financialYear } = req.query;
  const data = await mprPraroop1BService.getBaselineFromDPR(req.user._id, financialYear);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Baseline data retrieved'));
});

export const getAnnualSummary = asyncHandler(async (req, res) => {
  const { financialYear } = req.query;
  const data = await mprPraroop1BService.getAnnualSummary(financialYear);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Annual summary retrieved'));
});

/** GET /all-district — DD fetches MPRs for their district */
export const getDistrictReports = asyncHandler(async (req, res) => {
  const district = req.user.district;
  if (!district) throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'District not set for user');
  const { status, financialYear, page = 1, limit = 20 } = req.query;
  const query = { submittedByDistrict: new RegExp(`^${district}$`, 'i') };
  if (status) query.status = status;
  if (financialYear) query.financialYear = financialYear;
  const mprs = await MPRPraroop1B.find(query)
    .populate('submittedBy', 'name department')
    .populate('projectSanctionId', 'projectTitle sanctionId')
    .sort({ submittedAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mprs, 'District MPRs retrieved'));
});

/** PATCH /:id/district-approve — DD approves an MPR */
export const districtApprove = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const mpr = await MPRPraroop1B.findById(id);
  if (!mpr) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'MPR not found');
  if (req.user.role === 'DD_LEVEL') {
    if (!req.user.district || mpr.submittedByDistrict?.toLowerCase() !== req.user.district?.toLowerCase()) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Not in your district');
    }
  }
  mpr.status = 'DISTRICT_APPROVED';
  mpr.districtApprovedBy = req.user._id;
  mpr.districtApprovedAt = new Date();
  mpr.revisionHistory.push({
    status: 'DISTRICT_APPROVED',
    changedBy: req.user._id,
    note: req.body.note || 'Approved by District Officer (DD)'
  });
  await mpr.save();
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'MPR approved by district'));
});

/** PATCH /:id/return — DD returns MPR to PIA for correction */
export const returnToMaker = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const mpr = await MPRPraroop1B.findById(id);
  if (!mpr) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'MPR not found');
  if (req.user.role === 'DD_LEVEL') {
    if (!req.user.district || mpr.submittedByDistrict?.toLowerCase() !== req.user.district?.toLowerCase()) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Not in your district');
    }
  }
  mpr.status = 'RETURNED_TO_PIA';
  mpr.returnReason = req.body.reason || 'Returned for correction';
  mpr.revisionHistory.push({
    status: 'RETURNED_TO_PIA',
    changedBy: req.user._id,
    note: req.body.reason || 'Returned for correction'
  });
  await mpr.save();
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'MPR returned to PIA'));
});


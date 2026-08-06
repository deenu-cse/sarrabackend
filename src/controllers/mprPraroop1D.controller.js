import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import mprPraroop1DService from '../services/mprPraroop1D.service.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

export const saveDraft = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userDistrict = req.user.district;
  const userDept = req.user.department;
  const formData = req.body;
  const ip = req.ip;
  const ua = req.get('User-Agent');

  const draft = await mprPraroop1DService.saveDraft(userId, userDistrict, userDept, formData, ip, ua);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, draft, 'Draft saved successfully'));
});

export const submitMPR = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userDistrict = req.user.district;
  const userDept = req.user.department;
  const formData = req.body;
  const ip = req.ip;
  const ua = req.get('User-Agent');

  const mpr = await mprPraroop1DService.submitMPR(userId, userDistrict, userDept, formData, ip, ua);
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, mpr, 'MPR submitted successfully'));
});

export const resubmitMPR = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;
  const formData = req.body;
  const ip = req.ip;
  const ua = req.get('User-Agent');

  const mpr = await mprPraroop1DService.resubmitMPR(id, userId, formData, ip, ua);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'MPR resubmitted successfully'));
});

export const getMyReports = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { financialYear, status, page, limit } = req.query;
  const filters = {};
  if (financialYear) filters.financialYear = financialYear;
  if (status) filters.status = status;

  if (req.user.role === 'MND_SUPER_ADMIN' || req.user.role === 'MND_ADMIN') {
      const allMprs = await MPRPraroop1D.find(filters).sort({ createdAt: -1 });
      return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, allMprs, 'All MPRs retrieved'));
  }

  const reports = await mprPraroop1DService.getMyMPRs(userId, filters, parseInt(page) || 1, parseInt(limit) || 10);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, reports, 'Reports retrieved successfully'));
});

export const getReportById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const mpr = await mprPraroop1DService.getMPRById(id, req.user._id);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'Report retrieved successfully'));
});

export const approveReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  const mpr = await mprPraroop1DService.approveMPR(id, req.user._id, note);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'Report approved'));
});

export const rejectReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  const mpr = await mprPraroop1DService.rejectMPR(id, req.user._id, note);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, mpr, 'Report rejected'));
});

export const getPreviousMonthData = asyncHandler(async (req, res) => {
  const { financialYear, month } = req.query;
  const data = await mprPraroop1DService.getPreviousMonthData(req.user._id, financialYear, month);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Previous month data retrieved'));
});

export const getBaselineFromDPR = asyncHandler(async (req, res) => {
  const { financialYear } = req.query;
  const data = await mprPraroop1DService.getBaselineFromDPR(req.user._id, financialYear);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Baseline data retrieved'));
});

export const getAnnualSummary = asyncHandler(async (req, res) => {
  const { financialYear } = req.query;
  const data = await mprPraroop1DService.getAnnualSummary(financialYear);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Annual summary retrieved'));
});

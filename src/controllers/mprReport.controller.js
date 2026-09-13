import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import * as mprReportService from '../services/mprReport.service.js';

export const getDashboardData = asyncHandler(async (req, res) => {
  const filters = { ...req.query };

  const [
    overview,
    districtStats,
    monthlyTrend,
    formTypeStats,
    recentFormsRes,
    auditLogsRes
  ] = await Promise.all([
    mprReportService.getMPROverviewStats(filters),
    mprReportService.getMPRDistrictStats(filters),
    mprReportService.getMPRMonthlyTrend(filters),
    mprReportService.getMPRFormTypeStats(filters),
    mprReportService.getMPRFormsList(filters, 1, 15),
    mprReportService.getMPRAuditLogs({}, 1, 15)
  ]);

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(HTTP_STATUS.OK, {
      overview,
      districtStats,
      monthlyTrend,
      formTypeStats,
      recentForms: recentFormsRes.data,
      auditLogs: auditLogsRes.data
    }, 'MPR dashboard data fetched successfully')
  );
});

export const getFilteredDashboardData = asyncHandler(async (req, res) => {
  const filters = { ...req.query };

  const [
    overview,
    districtStats,
    monthlyTrend,
    formTypeStats
  ] = await Promise.all([
    mprReportService.getMPROverviewStats(filters),
    mprReportService.getMPRDistrictStats(filters),
    mprReportService.getMPRMonthlyTrend(filters),
    mprReportService.getMPRFormTypeStats(filters)
  ]);

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(HTTP_STATUS.OK, {
      overview,
      districtStats,
      monthlyTrend,
      formTypeStats
    }, 'MPR filtered dashboard data fetched successfully')
  );
});

export const getFormsList = asyncHandler(async (req, res) => {
  const filters = { ...req.query };
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const search = req.query.search || '';

  const result = await mprReportService.getMPRFormsList(filters, page, limit, search);
  
  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(HTTP_STATUS.OK, result, 'MPR forms list fetched successfully')
  );
});

export const getAuditLogs = asyncHandler(async (req, res) => {
  const filters = { ...req.query };
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const result = await mprReportService.getMPRAuditLogs(filters, page, limit);
  
  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(HTTP_STATUS.OK, result, 'MPR audit logs fetched successfully')
  );
});

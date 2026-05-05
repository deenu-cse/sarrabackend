import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import USER_ROLES from '../constants/roles.constants.js';
import { reportCache } from '../utils/cache.js';
import * as reportService from '../services/report.service.js';
import * as exportService from '../services/export.service.js';
import SpringshedDPR from '../models/SpringshedDPR.model.js';
import StreamshedDPR from '../models/StreamshedDPR.model.js';
import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';
import { createOrUpdateFlatSummary } from '../services/flatSummary.service.js';
import { createOrUpdateFlatSummary as createOrUpdateStreamshedFlatSummary } from '../services/streamshedFlatSummary.service.js';
import GroundwaterDPR from '../models/GroundwaterDPR.model.js';
import { createOrUpdateFlatSummary as gwFlatSummary } from '../services/groundwaterFlatSummary.service.js';
import logger from '../config/logger.js';

const enforceRoleFilters = (req, filters) => {
  if (req.user.role === USER_ROLES.PIA_OFFICER) {
    filters.submittedBy = req.user._id;
  } else if (req.user.role === USER_ROLES.DD_LEVEL) {
    filters.district = req.user.district;
  }
  return filters;
};

const getCacheKey = (req, endpoint) => {
  return reportCache.generateKey(`${endpoint}:${req.user.role}:${req.user.district}`, req.query);
};

const hasCompleteFlatSummaries = async () => {
  const [liveSprings, liveStreams, flatSummaries] = await Promise.all([
    SpringshedDPR.countDocuments({ isDraft: { $ne: true } }),
    StreamshedDPR.countDocuments({ isDraft: { $ne: true } }),
    DPRFlatSummary.countDocuments()
  ]);

  return flatSummaries >= (liveSprings + liveStreams);
};

export const getOverviewStats = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const cacheKey = getCacheKey(req, 'overview');

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'Overview stats fetched (cached)'));

  let data;
  if (await hasCompleteFlatSummaries()) {
    data = await reportService.getOverviewStats(filters);
  } else {
    data = await reportService.getOverviewStatsDirect(filters);
  }

  reportCache.set(cacheKey, data);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Overview stats fetched'));
});

export const getDistrictStats = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const cacheKey = getCacheKey(req, 'district');

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'District stats fetched (cached)'));

  const data = await reportService.getDistrictWiseStats(filters);
  reportCache.set(cacheKey, data);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'District stats fetched'));
});

export const getDepartmentStats = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const cacheKey = getCacheKey(req, 'department');

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'Department stats fetched (cached)'));

  const data = await reportService.getDepartmentWiseStats(filters);
  reportCache.set(cacheKey, data);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Department stats fetched'));
});

export const getMonthlyTrend = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const cacheKey = getCacheKey(req, `monthly-${year}`);

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'Monthly trend fetched (cached)'));

  let data;
  if (await hasCompleteFlatSummaries()) {
    data = await reportService.getMonthlyTrend(year, filters);
  } else {
    data = await reportService.getMonthlyTrendDirect(year, filters);
  }

  reportCache.set(cacheKey, data, 10 * 60 * 1000);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Monthly trend fetched'));
});

export const getSpringTypeStats = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const cacheKey = getCacheKey(req, 'spring');

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'Spring stats fetched (cached)'));

  const data = await reportService.getSpringTypeStats(filters);
  reportCache.set(cacheKey, data, 10 * 60 * 1000);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Spring stats fetched'));
});

export const getBudgetStats = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const cacheKey = getCacheKey(req, 'budget');

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'Budget stats fetched (cached)'));

  const data = await reportService.getBudgetStats(filters);
  reportCache.set(cacheKey, data);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Budget stats fetched'));
});

export const getFormsList = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const sort = req.query.sort || '-submittedAt';

  const cacheKey = getCacheKey(req, `list-${page}-${limit}-${sort}`);
  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'Forms list fetched (cached)'));

  let data;
  if (await hasCompleteFlatSummaries()) {
    data = await reportService.getFormsList(filters, page, limit, sort);
  } else {
    data = await reportService.getFormsListDirect(filters, page, limit, sort);
  }

  reportCache.set(cacheKey, data, 60 * 1000);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Forms list fetched'));
});

export const getApprovalTimeline = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const cacheKey = getCacheKey(req, 'approval');

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, cached, 'Approval timeline fetched (cached)'));

  const data = await reportService.getApprovalTimeline(filters);
  reportCache.set(cacheKey, data);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Approval timeline fetched'));
});

// ── Exports ──────────────────────────────────────────────────────────────────

export const exportCSV = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const type = req.query.type || 'summary';

  const dateStr = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sarra-${type}-report-${dateStr}.csv"`);

  await exportService.generateCSV(filters, type, res);
});

export const exportExcel = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const type = req.query.type || 'summary';

  const dateStr = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="sarra-${type}-report-${dateStr}.xlsx"`);

  await exportService.generateExcel(filters, type, res);
});

export const exportSingleDPRPDF = asyncHandler(async (req, res) => {
  const dprId = req.params.id;

  const dpr = await SpringshedDPR.findById(dprId).select('submittedBy submittedByDistrict').lean();
  if (!dpr) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'DPR not found');

  if (req.user.role === USER_ROLES.PIA_OFFICER && dpr.submittedBy.toString() !== req.user._id.toString()) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You can only export your own DPRs');
  }
  if (req.user.role === USER_ROLES.DD_LEVEL && dpr.submittedByDistrict !== req.user.district) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'You can only export DPRs for your district');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="DPR-${dprId}.pdf"`);

  await exportService.generateSingleDPRPDF(dprId, res);
});

export const exportSummaryPDF = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });

  const dateStr = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="sarra-summary-report-${dateStr}.pdf"`);

  await exportService.generateSummaryPDF(filters, res);
});

// ── Admin: Rebuild flat summaries ─────────────────────────────────────────────

export const rebuildFlatSummaries = asyncHandler(async (req, res) => {
  const allowedRoles = [USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN];
  if (!allowedRoles.includes(req.user.role)) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Access denied');
  }

  const cursor = SpringshedDPR.find({ isDraft: { $ne: true } }).cursor();
  let processed = 0;
  let errors = 0;

  for await (const doc of cursor) {
    try {
      await createOrUpdateFlatSummary(doc);
      processed++;
    } catch (err) {
      logger.error(`Rebuild error for ${doc._id}: ${err.message}`);
      errors++;
    }
  }

  const streamsCursor = StreamshedDPR.find({ isDraft: { $ne: true } }).cursor();

  for await (const doc of streamsCursor) {
    try {
      await createOrUpdateStreamshedFlatSummary(doc);
      processed++;
    } catch (err) {
      logger.error(`Rebuild error for ${doc._id}: ${err.message}`);
      errors++;
    }
  }

  const gwCursor = GroundwaterDPR.find({ isDraft: { $ne: true } }).cursor();
  for await (const doc of gwCursor) {
    try {
      await gwFlatSummary(doc);
      processed++;
    } catch (err) {
      logger.error(`Rebuild error for ${doc._id}: ${err.message}`);
      errors++;
    }
  }

  reportCache.clear();

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { processed, errors }, 'Flat summaries rebuilt'));
});

// ── Sync summaries (accessible to all authenticated roles via POST) ────────────

export const syncFlatSummaries = asyncHandler(async (req, res) => {
  // Any authenticated user can trigger a sync for their scope
  const matchFilter = { isDraft: { $ne: true } };

  // Scope: officers only sync their own; DD syncs their district
  if (req.user.role === USER_ROLES.PIA_OFFICER) {
    matchFilter.submittedBy = req.user._id;
  } else if (req.user.role === USER_ROLES.DD_LEVEL) {
    matchFilter.submittedByDistrict = req.user.district;
  }

  const cursor = SpringshedDPR.find(matchFilter).cursor();
  let processed = 0;
  let errors = 0;

  for await (const doc of cursor) {
    try {
      await createOrUpdateFlatSummary(doc);
      processed++;
    } catch (err) {
      logger.error(`Sync error for ${doc._id}: ${err.message}`);
      errors++;
    }
  }

  const streamMatchFilter = { isDraft: { $ne: true } };

  if (req.user.role === USER_ROLES.PIA_OFFICER) {
    streamMatchFilter.submittedBy = req.user._id;
  } else if (req.user.role === USER_ROLES.DD_LEVEL) {
    streamMatchFilter.submittedByDistrict = req.user.district;
  }

  const streamsCursor = StreamshedDPR.find(streamMatchFilter).cursor();

  for await (const doc of streamsCursor) {
    try {
      await createOrUpdateStreamshedFlatSummary(doc);
      processed++;
    } catch (err) {
      logger.error(`Sync error for ${doc._id}: ${err.message}`);
      errors++;
    }
  }

  const gwMatchFilter = { isDraft: { $ne: true } };

  if (req.user.role === USER_ROLES.PIA_OFFICER) {
    gwMatchFilter.submittedBy = req.user._id;
  } else if (req.user.role === USER_ROLES.DD_LEVEL) {
    gwMatchFilter.submittedByDistrict = req.user.district;
  }

  const gwCursor = GroundwaterDPR.find(gwMatchFilter).cursor();

  for await (const doc of gwCursor) {
    try {
      await gwFlatSummary(doc);
      processed++;
    } catch (err) {
      logger.error(`Sync error for ${doc._id}: ${err.message}`);
      errors++;
    }
  }

  reportCache.clear();

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { processed, errors }, `Sync complete: ${processed} forms processed`));
});
// ── Full District Dashboard for DD Level ─────────────────────────────────────

export const getFullDistrictDashboard = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const cacheKey = getCacheKey(req, `full-dashboard-${year}`);

  const cached = reportCache.get(cacheKey);
  if (cached) return res.status(HTTP_STATUS.OK).json(
    new ApiResponse(HTTP_STATUS.OK, cached, 'Dashboard fetched (cached)')
  );

  const [
    overview, districtStats, departmentStats,
    monthlyTrend, springTypeStats, budgetStats,
    approvalTimeline, formsList, resourceAnalytics
  ] = await Promise.all([
    reportService.getOverviewStats(filters),
    reportService.getDistrictWiseStats(filters),
    reportService.getDepartmentWiseStats(filters),
    reportService.getMonthlyTrend(year, filters),
    reportService.getSpringTypeStats(filters),
    reportService.getBudgetStats(filters),
    reportService.getApprovalTimeline(filters),
    reportService.getFormsList(filters, 1, 10, '-submittedAt'),
    reportService.getResourceAnalytics(filters)
  ]);

  const data = {
    overview, districtStats, departmentStats,
    monthlyTrend, springTypeStats, budgetStats,
    approvalTimeline, recentForms: formsList,
    resourceAnalytics
  };

  reportCache.set(cacheKey, data, 3 * 60 * 1000); // 3 min cache
  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(HTTP_STATUS.OK, data, 'Full dashboard fetched')
  );
});

// ── Filtered Analytics (for UI filter updates) ────────────────────────────────

export const getFilteredAnalytics = asyncHandler(async (req, res) => {
  const filters = enforceRoleFilters(req, { ...req.query });
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const [
    overview, 
    monthlyTrend, 
    budgetStats, 
    springTypeStats, 
    resourceAnalytics,
    districtStats,
    departmentStats,
    approvalTimeline
  ] = await Promise.all([
    reportService.getOverviewStats(filters),
    reportService.getMonthlyTrend(year, filters),
    reportService.getBudgetStats(filters),
    reportService.getSpringTypeStats(filters),
    reportService.getResourceAnalytics(filters),
    reportService.getDistrictWiseStats(filters),
    reportService.getDepartmentWiseStats(filters),
    reportService.getApprovalTimeline(filters)
  ]);

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(HTTP_STATUS.OK,
      { 
        overview, 
        monthlyTrend, 
        budgetStats, 
        springTypeStats, 
        resourceAnalytics,
        districtStats,
        departmentStats,
        approvalTimeline
      },
      'Filtered analytics fetched'
    )
  );
});

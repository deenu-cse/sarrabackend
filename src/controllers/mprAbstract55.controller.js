import {
  saveDraft, submitMPR, getMyMPRs, getMPRById,
  approveMPR, rejectMPR, getPreviousMonthData, getMPRAnalytics, getAllMPRs, resubmitMPR
} from '../services/mprAbstract55.service.js';
import MPRAbstract55 from '../models/MPRAbstract55.model.js';
import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

export const saveFormDraft = asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  const draft = await saveDraft(req.user._id, req.user.district, req.user.department, req.body, ip, userAgent);
  
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { applicationNo: draft.applicationNo }, 'Draft saved successfully'));
});

export const submitForm = asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  const form = await submitMPR(req.user._id, req.user.district, req.user.department, req.body, ip, userAgent);
  
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { applicationNo: form.applicationNo, status: form.status }, 'Form submitted successfully'));
});

export const resubmitForm = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  const form = await resubmitMPR(id, req.user._id, req.body, ip, userAgent);
  
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { applicationNo: form.applicationNo, status: form.status }, 'Form resubmitted successfully'));
});

export const getMyFormsList = asyncHandler(async (req, res) => {
  const { status, financialYear, page = 1, limit = 10 } = req.query;
  const result = await getMyMPRs(req.user, { status, financialYear }, Number(page), Number(limit));

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Forms fetched successfully', result.pagination));
});

export const getSingleForm = asyncHandler(async (req, res) => {
  const form = await getMPRById(req.params.id, req.user);
  
  if (!form) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Form not found or you are not authorized to view it');
  }

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, form, 'Form fetched successfully'));
});

export const approveFormController = asyncHandler(async (req, res) => {
  const form = await approveMPR(req.params.id, req.user._id);

  if (!form) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Form not found');

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, 'Form approved successfully'));
});

export const rejectFormController = asyncHandler(async (req, res) => {
  const { rejectionReason } = req.body;
  if (!rejectionReason) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Rejection reason is required');
  }

  const form = await rejectMPR(req.params.id, req.user._id, rejectionReason);

  if (!form) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Form not found');

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, 'Form rejected successfully'));
});

export const getPreviousMonth = asyncHandler(async (req, res) => {
  const { financialYear, month } = req.query;
  if (!financialYear || !month) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Financial year and month are required');
  }

  const data = await getPreviousMonthData(req.user._id, financialYear, month);
  
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, 'Previous month data fetched successfully'));
});

export const getSummary = asyncHandler(async (req, res) => {
  const { financialYear, month } = req.query;
  const matchObj = { isDraft: false, status: { $ne: 'REJECTED' } };
  if (financialYear) matchObj.financialYear = financialYear;
  if (month) matchObj.reportingMonth = month;

  const [abstractMprs, praroopMprs] = await Promise.all([
    MPRAbstract55.find(matchObj),
    MPRPraroop1A.find(matchObj)
  ]);
  
  let totalProposalsAllDepts = 0;
  let totalDeptShareLakh = 0;
  let totalSarraShareLakh = 0;

  abstractMprs.forEach(mpr => {
    totalProposalsAllDepts += mpr.computed.totalProposalsAllDepts || 0;
    totalDeptShareLakh += mpr.computed.totalDeptShareLakh || 0;
    totalSarraShareLakh += mpr.computed.totalSarraShareLakh || 0;
  });

  praroopMprs.forEach(mpr => {
    // For Praroop-1A, 'proposals' can be 'totalApprovedSchemes'
    totalProposalsAllDepts += mpr.totalApprovedSchemes || 0;
    totalDeptShareLakh += mpr.computed?.grandTotalTargetDeptLakh || 0;
    totalSarraShareLakh += mpr.computed?.grandTotalSarraExpend || 0;
  });

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, {
    totalProposalsAllDepts,
    totalDeptShareLakh,
    totalSarraShareLakh,
    totalMPRs: abstractMprs.length + praroopMprs.length
  }, 'Summary fetched successfully'));
});

export const getDistrictSummary = asyncHandler(async (req, res) => {
  const { financialYear } = req.query;
  const matchObj = { isDraft: false, status: { $ne: 'REJECTED' } };
  if (financialYear) matchObj.financialYear = financialYear;

  const mprs = await MPRAbstract55.find(matchObj);
  
  const districtTotals = {};
  
  mprs.forEach(mpr => {
    mpr.computed.districtTotals.forEach(dt => {
      if (!districtTotals[dt.district]) {
        districtTotals[dt.district] = { totalProposals: 0, totalDeptShare: 0, totalSarraShare: 0 };
      }
      districtTotals[dt.district].totalProposals += dt.totalProposals;
      districtTotals[dt.district].totalDeptShare += dt.totalDeptShare;
      districtTotals[dt.district].totalSarraShare += dt.totalSarraShare;
    });
  });

  const formattedData = Object.keys(districtTotals).map(district => ({
    district,
    ...districtTotals[district]
  }));

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, formattedData, 'District summary fetched successfully'));
});

export const getFullAnalytics = asyncHandler(async (req, res) => {
  const result = await getMPRAnalytics(req.query);
  
  // Aggregate Praroop-1A data into the unified analytics
  const matchObj = { isDraft: false };
  if (req.query.financialYear) matchObj.financialYear = req.query.financialYear;
  if (req.query.district) matchObj.submittedByDistrict = req.query.district;
  if (req.query.status) matchObj.status = req.query.status;
  
  const praroopMprs = await MPRPraroop1A.find(matchObj);
  
  // 1. Update overview totals & status breakdown
  result.overview.totalForms += praroopMprs.length;
  result.overview.totalApproved += praroopMprs.filter(m => m.status === 'APPROVED').length;
  result.overview.totalPending += praroopMprs.filter(m => m.status === 'SUBMITTED').length;
  result.overview.totalRejected += praroopMprs.filter(m => m.status === 'REJECTED').length;
  
  result.overview.statusBreakdown.forEach(s => {
      const count = praroopMprs.filter(m => m.status === s.status).length;
      s.count += count;
  });

  // 2. Aggregate Financials and Proposals
  praroopMprs.forEach(mpr => {
    const sarraExpend = mpr.computed?.grandTotalSarraExpend || 0;
    const deptShare = mpr.computed?.grandTotalTargetDeptLakh || 0;
    const proposals = mpr.totalApprovedSchemes || 0;

    result.overview.totalProposals += proposals;
    result.overview.totalDeptShare += deptShare;
    result.overview.totalSarraShare += sarraExpend;
    result.overview.totalBudget += (sarraExpend + deptShare);

    // 3. Update Monthly Trend
    const monthTrend = result.monthlyTrend.find(mt => mt.month === mpr.reportingMonth);
    if (monthTrend) {
      monthTrend.submitted = (monthTrend.submitted || 0) + 1;
      monthTrend.proposals = (monthTrend.proposals || 0) + proposals;
      monthTrend.budget = (monthTrend.budget || 0) + (sarraExpend + deptShare);
    }

    // 4. Update District Stats
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(ds => {
        let distStat = result.districtStats.find(d => d.name === ds.district);
        if (!distStat) {
          distStat = { name: ds.district, proposals: 0, deptShare: 0, sarraShare: 0, count: 0 };
          result.districtStats.push(distStat);
        }
        distStat.proposals += (ds.totalPhysical || 0);
        distStat.sarraShare += (ds.totalSarraExpend || 0);
        distStat.count++;
      });
    }
  });

  // ── Build dedicated Praroop-1(A) analytics section ──
  const praroop1a = {
    overview: {
      totalForms: praroopMprs.length,
      totalApproved: praroopMprs.filter(m => m.status === 'APPROVED').length,
      totalPending: praroopMprs.filter(m => m.status === 'SUBMITTED').length,
      totalRejected: praroopMprs.filter(m => m.status === 'REJECTED').length,
      totalPhysicalProgress: 0,
      totalSarraExpend: 0,
      totalSarraBudget: 0,
      totalDeptBudget: 0,
      activitiesWithProgress: 0,
      statusBreakdown: [
        { status: 'SUBMITTED', count: praroopMprs.filter(m => m.status === 'SUBMITTED').length },
        { status: 'APPROVED', count: praroopMprs.filter(m => m.status === 'APPROVED').length },
        { status: 'REJECTED', count: praroopMprs.filter(m => m.status === 'REJECTED').length }
      ]
    },
    activityStats: [],
    districtStats: [],
    recentForms: []
  };

  // Aggregate activity-wise stats across all Praroop forms
  const activityMap = {};
  const districtMap = {};

  praroopMprs.forEach(mpr => {
    praroop1a.overview.totalPhysicalProgress += (mpr.computed?.grandTotalPhysicalProgress || 0);
    praroop1a.overview.totalSarraExpend += (mpr.computed?.grandTotalSarraExpend || 0);
    praroop1a.overview.totalSarraBudget += (mpr.computed?.grandTotalTargetSarraLakh || 0);
    praroop1a.overview.totalDeptBudget += (mpr.computed?.grandTotalTargetDeptLakh || 0);
    praroop1a.overview.activitiesWithProgress += (mpr.computed?.activitiesWithProgress || 0);

    // Activity-wise aggregation
    if (mpr.activities) {
      mpr.activities.forEach(act => {
        if (act.isHeader) return;
        if (!activityMap[act.activityCode]) {
          activityMap[act.activityCode] = {
            code: act.activityCode,
            name: act.activityEnglishName,
            hindiName: act.activityName,
            unit: act.unit || '',
            totalPhysicalProgress: 0,
            totalSarraExpend: 0,
            totalSarraBudget: 0,
            totalDeptBudget: 0,
            targetUnit: 0
          };
        }
        const a = activityMap[act.activityCode];
        a.totalPhysicalProgress += (act.districtTotals?.totalPhysicalProgress || 0);
        a.totalSarraExpend += (act.districtTotals?.totalSarraExpend || 0);
        a.totalSarraBudget += (act.districtTotals?.targetSarraShareLakh || 0);
        a.totalDeptBudget += (act.districtTotals?.targetDeptShareLakh || 0);
        a.targetUnit += (act.districtTotals?.targetUnit || 0);
      });
    }

    // District-wise aggregation
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(ds => {
        if (!districtMap[ds.district]) {
          districtMap[ds.district] = { name: ds.district, totalPhysical: 0, totalSarraExpend: 0 };
        }
        districtMap[ds.district].totalPhysical += (ds.totalPhysical || 0);
        districtMap[ds.district].totalSarraExpend += (ds.totalSarraExpend || 0);
      });
    }
  });

  praroop1a.activityStats = Object.values(activityMap);
  praroop1a.districtStats = Object.values(districtMap).filter(d => d.totalPhysical > 0 || d.totalSarraExpend > 0);
  praroop1a.recentForms = praroopMprs.slice(0, 5).map(m => ({
    _id: m._id,
    applicationNo: m.applicationNo,
    reportingMonth: m.reportingMonth,
    financialYear: m.financialYear,
    status: m.status,
    submittedByDistrict: m.submittedByDistrict,
    submittedAt: m.submittedAt,
    grandTotalPhysicalProgress: m.computed?.grandTotalPhysicalProgress || 0,
    grandTotalSarraExpend: m.computed?.grandTotalSarraExpend || 0
  }));

  result.praroop1a = praroop1a;

  // ── Build dedicated Praroop-1(B) analytics section ──
  const praroopBMprs = await MPRPraroop1B.find(matchObj);

  // Merge 1B into overview totals
  result.overview.totalForms += praroopBMprs.length;
  result.overview.totalApproved += praroopBMprs.filter(m => m.status === 'APPROVED').length;
  result.overview.totalPending += praroopBMprs.filter(m => m.status === 'SUBMITTED').length;
  result.overview.totalRejected += praroopBMprs.filter(m => m.status === 'REJECTED').length;
  result.overview.statusBreakdown.forEach(s => {
    s.count += praroopBMprs.filter(m => m.status === s.status).length;
  });
  praroopBMprs.forEach(mpr => {
    const se = mpr.computed?.grandTotalSarraExpend || 0;
    const ds = mpr.computed?.grandTotalTargetDeptLakh || 0;
    const pr = mpr.totalApprovedSchemes || 0;
    result.overview.totalProposals += pr;
    result.overview.totalDeptShare += ds;
    result.overview.totalSarraShare += se;
    result.overview.totalBudget += (se + ds);
    const mt = result.monthlyTrend.find(m => m.month === mpr.reportingMonth);
    if (mt) { mt.submitted = (mt.submitted||0)+1; mt.proposals = (mt.proposals||0)+pr; mt.budget = (mt.budget||0)+(se+ds); }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        let dst = result.districtStats.find(x => x.name === d.district);
        if (!dst) { dst = { name: d.district, proposals: 0, deptShare: 0, sarraShare: 0, count: 0 }; result.districtStats.push(dst); }
        dst.proposals += (d.totalPhysical||0); dst.sarraShare += (d.totalSarraExpend||0); dst.count++;
      });
    }
  });

  const praroop1b = {
    overview: {
      totalForms: praroopBMprs.length,
      totalApproved: praroopBMprs.filter(m => m.status === 'APPROVED').length,
      totalPending: praroopBMprs.filter(m => m.status === 'SUBMITTED').length,
      totalRejected: praroopBMprs.filter(m => m.status === 'REJECTED').length,
      totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, activitiesWithProgress: 0,
      statusBreakdown: [
        { status: 'SUBMITTED', count: praroopBMprs.filter(m => m.status === 'SUBMITTED').length },
        { status: 'APPROVED', count: praroopBMprs.filter(m => m.status === 'APPROVED').length },
        { status: 'REJECTED', count: praroopBMprs.filter(m => m.status === 'REJECTED').length }
      ]
    },
    activityStats: [], districtStats: [], recentForms: []
  };
  const actMapB = {}; const distMapB = {};
  praroopBMprs.forEach(mpr => {
    praroop1b.overview.totalPhysicalProgress += (mpr.computed?.grandTotalPhysicalProgress||0);
    praroop1b.overview.totalSarraExpend += (mpr.computed?.grandTotalSarraExpend||0);
    praroop1b.overview.totalSarraBudget += (mpr.computed?.grandTotalTargetSarraLakh||0);
    praroop1b.overview.totalDeptBudget += (mpr.computed?.grandTotalTargetDeptLakh||0);
    praroop1b.overview.activitiesWithProgress += (mpr.computed?.activitiesWithProgress||0);
    if (mpr.activities) {
      mpr.activities.forEach(act => {
        if (act.isHeader) return;
        if (!actMapB[act.activityCode]) {
          actMapB[act.activityCode] = { code: act.activityCode, name: act.activityEnglishName, hindiName: act.activityName, unit: act.unit||'', totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, targetUnit: 0 };
        }
        const a = actMapB[act.activityCode];
        a.totalPhysicalProgress += (act.districtTotals?.totalPhysicalProgress||0);
        a.totalSarraExpend += (act.districtTotals?.totalSarraExpend||0);
        a.totalSarraBudget += (act.districtTotals?.targetSarraShareLakh||0);
        a.totalDeptBudget += (act.districtTotals?.targetDeptShareLakh||0);
        a.targetUnit += (act.districtTotals?.targetUnit||0);
      });
    }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        if (!distMapB[d.district]) distMapB[d.district] = { name: d.district, totalPhysical: 0, totalSarraExpend: 0 };
        distMapB[d.district].totalPhysical += (d.totalPhysical||0);
        distMapB[d.district].totalSarraExpend += (d.totalSarraExpend||0);
      });
    }
  });
  praroop1b.activityStats = Object.values(actMapB);
  praroop1b.districtStats = Object.values(distMapB).filter(d => d.totalPhysical > 0 || d.totalSarraExpend > 0);
  praroop1b.recentForms = praroopBMprs.slice(0, 5).map(m => ({
    _id: m._id, applicationNo: m.applicationNo, reportingMonth: m.reportingMonth, financialYear: m.financialYear,
    status: m.status, submittedByDistrict: m.submittedByDistrict, submittedAt: m.submittedAt,
    grandTotalPhysicalProgress: m.computed?.grandTotalPhysicalProgress||0, grandTotalSarraExpend: m.computed?.grandTotalSarraExpend||0
  }));
  result.praroop1b = praroop1b;

  // ── Build dedicated Praroop-1(C) analytics section ──
  const praroopCMprs = await MPRPraroop1C.find(matchObj);

  // Merge 1C into overview totals
  result.overview.totalForms += praroopCMprs.length;
  result.overview.totalApproved += praroopCMprs.filter(m => m.status === 'APPROVED').length;
  result.overview.totalPending += praroopCMprs.filter(m => m.status === 'SUBMITTED').length;
  result.overview.totalRejected += praroopCMprs.filter(m => m.status === 'REJECTED').length;
  result.overview.statusBreakdown.forEach(s => {
    s.count += praroopCMprs.filter(m => m.status === s.status).length;
  });
  praroopCMprs.forEach(mpr => {
    const se = mpr.computed?.grandTotalSarraExpend || 0;
    const ds = mpr.computed?.grandTotalTargetDeptLakh || 0;
    const pr = mpr.totalApprovedSchemes || 0;
    result.overview.totalProposals += pr;
    result.overview.totalDeptShare += ds;
    result.overview.totalSarraShare += se;
    result.overview.totalBudget += (se + ds);
    const mt = result.monthlyTrend.find(m => m.month === mpr.reportingMonth);
    if (mt) { mt.submitted = (mt.submitted||0)+1; mt.proposals = (mt.proposals||0)+pr; mt.budget = (mt.budget||0)+(se+ds); }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        let dst = result.districtStats.find(x => x.name === d.district);
        if (!dst) { dst = { name: d.district, proposals: 0, deptShare: 0, sarraShare: 0, count: 0 }; result.districtStats.push(dst); }
        dst.proposals += (d.totalPhysical||0); dst.sarraShare += (d.totalSarraExpend||0); dst.count++;
      });
    }
  });

  const praroop1c = {
    overview: {
      totalForms: praroopCMprs.length,
      totalApproved: praroopCMprs.filter(m => m.status === 'APPROVED').length,
      totalPending: praroopCMprs.filter(m => m.status === 'SUBMITTED').length,
      totalRejected: praroopCMprs.filter(m => m.status === 'REJECTED').length,
      totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, activitiesWithProgress: 0,
      statusBreakdown: [
        { status: 'SUBMITTED', count: praroopCMprs.filter(m => m.status === 'SUBMITTED').length },
        { status: 'APPROVED', count: praroopCMprs.filter(m => m.status === 'APPROVED').length },
        { status: 'REJECTED', count: praroopCMprs.filter(m => m.status === 'REJECTED').length }
      ]
    },
    activityStats: [], districtStats: [], recentForms: []
  };
  const actMapC = {}; const distMapC = {};
  praroopCMprs.forEach(mpr => {
    praroop1c.overview.totalPhysicalProgress += (mpr.computed?.grandTotalPhysicalProgress||0);
    praroop1c.overview.totalSarraExpend += (mpr.computed?.grandTotalSarraExpend||0);
    praroop1c.overview.totalSarraBudget += (mpr.computed?.grandTotalTargetSarraLakh||0);
    praroop1c.overview.totalDeptBudget += (mpr.computed?.grandTotalTargetDeptLakh||0);
    praroop1c.overview.activitiesWithProgress += (mpr.computed?.activitiesWithProgress||0);
    if (mpr.activities) {
      mpr.activities.forEach(act => {
        if (act.isHeader) return;
        if (!actMapC[act.activityCode]) {
          actMapC[act.activityCode] = { code: act.activityCode, name: act.activityEnglishName, hindiName: act.activityName, unit: act.unit||'', totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, targetUnit: 0 };
        }
        const a = actMapC[act.activityCode];
        a.totalPhysicalProgress += (act.districtTotals?.totalPhysicalProgress||0);
        a.totalSarraExpend += (act.districtTotals?.totalSarraExpend||0);
        a.totalSarraBudget += (act.districtTotals?.targetSarraShareLakh||0);
        a.totalDeptBudget += (act.districtTotals?.targetDeptShareLakh||0);
        a.targetUnit += (act.districtTotals?.targetUnit||0);
      });
    }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        if (!distMapC[d.district]) distMapC[d.district] = { name: d.district, totalPhysical: 0, totalSarraExpend: 0 };
        distMapC[d.district].totalPhysical += (d.totalPhysical||0);
        distMapC[d.district].totalSarraExpend += (d.totalSarraExpend||0);
      });
    }
  });
  praroop1c.activityStats = Object.values(actMapC);
  praroop1c.districtStats = Object.values(distMapC).filter(d => d.totalPhysical > 0 || d.totalSarraExpend > 0);
  praroop1c.recentForms = praroopCMprs.slice(0, 5).map(m => ({
    _id: m._id, applicationNo: m.applicationNo, reportingMonth: m.reportingMonth, financialYear: m.financialYear,
    status: m.status, submittedByDistrict: m.submittedByDistrict, submittedAt: m.submittedAt,
    grandTotalPhysicalProgress: m.computed?.grandTotalPhysicalProgress||0, grandTotalSarraExpend: m.computed?.grandTotalSarraExpend||0
  }));
  result.praroop1c = praroop1c;

  // ── Build dedicated Praroop-1(D) analytics section ──
  const praroopDMprs = await MPRPraroop1D.find(matchObj);

  // Merge 1D into overview totals
  result.overview.totalForms += praroopDMprs.length;
  result.overview.totalApproved += praroopDMprs.filter(m => m.status === 'APPROVED').length;
  result.overview.totalPending += praroopDMprs.filter(m => m.status === 'SUBMITTED').length;
  result.overview.totalRejected += praroopDMprs.filter(m => m.status === 'REJECTED').length;
  result.overview.statusBreakdown.forEach(s => {
    s.count += praroopDMprs.filter(m => m.status === s.status).length;
  });
  praroopDMprs.forEach(mpr => {
    const se = mpr.computed?.grandTotalSarraExpend || 0;
    const ds = mpr.computed?.grandTotalTargetDeptLakh || 0;
    const pr = mpr.totalApprovedSchemes || 0;
    result.overview.totalProposals += pr;
    result.overview.totalDeptShare += ds;
    result.overview.totalSarraShare += se;
    result.overview.totalBudget += (se + ds);
    const mt = result.monthlyTrend.find(m => m.month === mpr.reportingMonth);
    if (mt) { mt.submitted = (mt.submitted||0)+1; mt.proposals = (mt.proposals||0)+pr; mt.budget = (mt.budget||0)+(se+ds); }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        let dst = result.districtStats.find(x => x.name === d.district);
        if (!dst) { dst = { name: d.district, proposals: 0, deptShare: 0, sarraShare: 0, count: 0 }; result.districtStats.push(dst); }
        dst.proposals += (d.totalPhysical||0); dst.sarraShare += (d.totalSarraExpend||0); dst.count++;
      });
    }
  });

  const praroop1d = {
    overview: {
      totalForms: praroopDMprs.length,
      totalApproved: praroopDMprs.filter(m => m.status === 'APPROVED').length,
      totalPending: praroopDMprs.filter(m => m.status === 'SUBMITTED').length,
      totalRejected: praroopDMprs.filter(m => m.status === 'REJECTED').length,
      totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, activitiesWithProgress: 0,
      statusBreakdown: [
        { status: 'SUBMITTED', count: praroopDMprs.filter(m => m.status === 'SUBMITTED').length },
        { status: 'APPROVED', count: praroopDMprs.filter(m => m.status === 'APPROVED').length },
        { status: 'REJECTED', count: praroopDMprs.filter(m => m.status === 'REJECTED').length }
      ]
    },
    activityStats: [], districtStats: [], recentForms: []
  };
  const actMapD = {}; const distMapD = {};
  praroopDMprs.forEach(mpr => {
    praroop1d.overview.totalPhysicalProgress += (mpr.computed?.grandTotalPhysicalProgress||0);
    praroop1d.overview.totalSarraExpend += (mpr.computed?.grandTotalSarraExpend||0);
    praroop1d.overview.totalSarraBudget += (mpr.computed?.grandTotalTargetSarraLakh||0);
    praroop1d.overview.totalDeptBudget += (mpr.computed?.grandTotalTargetDeptLakh||0);
    praroop1d.overview.activitiesWithProgress += (mpr.computed?.activitiesWithProgress||0);
    if (mpr.activities) {
      mpr.activities.forEach(act => {
        if (act.isHeader) return;
        if (!actMapD[act.activityCode]) {
          actMapD[act.activityCode] = { code: act.activityCode, name: act.activityEnglishName, hindiName: act.activityName, unit: act.unit||'', totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, targetUnit: 0 };
        }
        const a = actMapD[act.activityCode];
        a.totalPhysicalProgress += (act.districtTotals?.totalPhysicalProgress||0);
        a.totalSarraExpend += (act.districtTotals?.totalSarraExpend||0);
        a.totalSarraBudget += (act.districtTotals?.targetSarraShareLakh||0);
        a.totalDeptBudget += (act.districtTotals?.targetDeptShareLakh||0);
        a.targetUnit += (act.districtTotals?.targetUnit||0);
      });
    }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        if (!distMapD[d.district]) distMapD[d.district] = { name: d.district, totalPhysical: 0, totalSarraExpend: 0 };
        distMapD[d.district].totalPhysical += (d.totalPhysical||0);
        distMapD[d.district].totalSarraExpend += (d.totalSarraExpend||0);
      });
    }
  });
  praroop1d.activityStats = Object.values(actMapD);
  praroop1d.districtStats = Object.values(distMapD).filter(d => d.totalPhysical > 0 || d.totalSarraExpend > 0);
  praroop1d.recentForms = praroopDMprs.slice(0, 5).map(m => ({
    _id: m._id, applicationNo: m.applicationNo, reportingMonth: m.reportingMonth, financialYear: m.financialYear,
    status: m.status, submittedByDistrict: m.submittedByDistrict, submittedAt: m.submittedAt,
    grandTotalPhysicalProgress: m.computed?.grandTotalPhysicalProgress||0, grandTotalSarraExpend: m.computed?.grandTotalSarraExpend||0
  }));
  result.praroop1d = praroop1d;


  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result, 'Full analytics fetched successfully'));
});


export const getAllFormsList = asyncHandler(async (req, res) => {
  const { status, financialYear, district, reportingMonth, page = 1, limit = 10 } = req.query;
  const result = await getAllMPRs({ status, financialYear, district, reportingMonth }, Number(page), Number(limit));

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'All forms fetched successfully', result.pagination));
});


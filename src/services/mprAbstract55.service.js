import MPRAbstract55 from '../models/MPRAbstract55.model.js';
import mongoose from 'mongoose';

const generateMPRAppNo = async (district, financialYear) => {
  const yearMatch = financialYear ? financialYear.substring(0, 4) : new Date().getFullYear();
  const districtCode = district ? district.substring(0, 3).toUpperCase() : 'MND';
  
  const prefix = `SARRA-MPR55-${yearMatch}-${districtCode}`;
  
  const lastMPR = await MPRAbstract55.findOne({
    applicationNo: new RegExp(`^${prefix}`)
  }).sort({ applicationNo: -1 });

  let nextSequence = 1;
  if (lastMPR && lastMPR.applicationNo) {
    const lastSequenceMatch = lastMPR.applicationNo.match(/-(\d{5})$/);
    if (lastSequenceMatch) {
      nextSequence = parseInt(lastSequenceMatch[1], 10) + 1;
    }
  }

  const paddedSequence = nextSequence.toString().padStart(5, '0');
  return `${prefix}-${paddedSequence}`;
};

export const saveDraft = async (userId, userDistrict, userDept, formData, ip, ua) => {
  let draft = await MPRAbstract55.findOne({
    submittedBy: userId,
    financialYear: formData.financialYear,
    reportingMonth: formData.reportingMonth,
    isDraft: true
  });

  if (draft) {
    Object.assign(draft, formData);
    draft.ipAddress = ip;
    draft.userAgent = ua;
    await draft.save();
    return draft;
  }

  const newDraft = await MPRAbstract55.create({
    ...formData,
    submittedBy: userId,
    submittedByDistrict: userDistrict,
    submittedByDepartment: userDept,
    status: 'DRAFT',
    isDraft: true,
    ipAddress: ip,
    userAgent: ua
  });

  return newDraft;
};

export const submitMPR = async (userId, userDistrict, userDept, formData, ip, ua) => {
  const applicationNo = await generateMPRAppNo(userDistrict, formData.financialYear);
  
  let form = await MPRAbstract55.findOne({
    submittedBy: userId,
    financialYear: formData.financialYear,
    reportingMonth: formData.reportingMonth,
    isDraft: true
  });

  if (form) {
    Object.assign(form, formData);
    form.applicationNo = applicationNo;
    form.status = 'SUBMITTED';
    form.isDraft = false;
    form.submittedAt = new Date();
    form.ipAddress = ip;
    form.userAgent = ua;
    await form.save();
    return form;
  }

  const newForm = await MPRAbstract55.create({
    ...formData,
    applicationNo,
    submittedBy: userId,
    submittedByDistrict: userDistrict,
    submittedByDepartment: userDept,
    status: 'SUBMITTED',
    isDraft: false,
    submittedAt: new Date(),
    ipAddress: ip,
    userAgent: ua
  });

  return newForm;
};

export const resubmitMPR = async (mprId, userId, formData, ip, ua) => {
  const { financialYear, reportingMonth, departments } = formData;
  
  let mpr = await MPRAbstract55.findOne({
    _id: mprId,
    submittedBy: userId,
    status: 'REJECTED'
  });

  if (!mpr) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Rejected form not found or unauthorized');
  }

  mpr.departments = departments;
  mpr.status = 'RESUBMITTED';
  mpr.submittedAt = new Date();
  mpr.ipAddress = ip;
  mpr.userAgent = ua;
  
  mpr.revisionHistory.push({
    status: 'RESUBMITTED',
    changedBy: userId,
    note: 'Resubmitted by MND Officer'
  });

  await mpr.save();
  return mpr;
};

export const getMyMPRs = async (user, filters, page, limit) => {
  const matchObj = { isDraft: false, submittedBy: user._id };
  
  if (filters.status) {
    matchObj.status = filters.status;
  }
  if (filters.financialYear) {
    matchObj.financialYear = filters.financialYear;
  }

  const skip = (page - 1) * limit;

  const mprs = await MPRAbstract55.find(matchObj)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await MPRAbstract55.countDocuments(matchObj);

  return {
    data: mprs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

export const getAllMPRs = async (filters, page, limit) => {
  const matchObj = { isDraft: false };
  
  if (filters.status) matchObj.status = filters.status;
  if (filters.financialYear) matchObj.financialYear = filters.financialYear;
  if (filters.district) matchObj.submittedByDistrict = filters.district;
  if (filters.reportingMonth) matchObj.reportingMonth = filters.reportingMonth;

  const skip = (page - 1) * limit;

  const mprs = await MPRAbstract55.find(matchObj)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await MPRAbstract55.countDocuments(matchObj);

  return {
    data: mprs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

export const getMPRById = async (mprId, user) => {
  const form = await MPRAbstract55.findById(mprId)
    .populate('submittedBy', 'name email department')
    .populate('reviewedBy', 'name');

  if (!form) return null;

  if (user.role === 'MND_OFFICER' && form.submittedBy._id.toString() !== user._id.toString()) {
    return null;
  }

  return form;
};

export const approveMPR = async (mprId, reviewerId) => {
  const form = await MPRAbstract55.findById(mprId);
  if (!form) return null;

  form.status = 'APPROVED';
  form.reviewedBy = reviewerId;
  form.reviewedAt = new Date();
  form.approvedAt = new Date();
  form.revisionHistory.push({
    status: 'APPROVED',
    changedBy: reviewerId,
    changedAt: new Date(),
    note: 'MPR approved'
  });

  await form.save();
  return form;
};

export const rejectMPR = async (mprId, reviewerId, reason) => {
  const form = await MPRAbstract55.findById(mprId);
  if (!form) return null;

  form.status = 'REJECTED';
  form.reviewedBy = reviewerId;
  form.reviewedAt = new Date();
  form.rejectionReason = reason;
  form.revisionHistory.push({
    status: 'REJECTED',
    changedBy: reviewerId,
    changedAt: new Date(),
    note: `MPR rejected: ${reason}`
  });

  await form.save();
  return form;
};

export const getPreviousMonthData = async (userId, financialYear, month) => {
  const monthsOrder = ['April','May','June','July','August','September','October','November','December','January','February','March'];
  const monthIndex = monthsOrder.indexOf(month);
  
  if (monthIndex === 0 || monthIndex === -1) return null;
  
  const prevMonth = monthsOrder[monthIndex - 1];
  
  const prevForm = await MPRAbstract55.findOne({
    submittedBy: userId,
    financialYear: financialYear,
    reportingMonth: prevMonth,
    isDraft: false
  });
  
  return prevForm;
};

export const getMPRAnalytics = async (query = {}) => {
  const match = { isDraft: false };
  if (query.financialYear) match.financialYear = query.financialYear;
  if (query.status) match.status = query.status;
  if (query.reportingMonth) match.reportingMonth = query.reportingMonth;
  if (query.district) match.submittedByDistrict = query.district;

  const mprs = await MPRAbstract55.find(match);

  const overview = {
    totalForms: mprs.length,
    totalApproved: mprs.filter(m => m.status === 'APPROVED').length,
    totalPending: mprs.filter(m => m.status === 'SUBMITTED').length,
    totalRejected: mprs.filter(m => m.status === 'REJECTED').length,
    totalProposals: 0,
    totalDeptShare: 0,
    totalSarraShare: 0,
    totalBudget: 0,
    statusBreakdown: [
      { status: 'APPROVED', count: 0 },
      { status: 'SUBMITTED', count: 0 },
      { status: 'REJECTED', count: 0 }
    ]
  };

  const districtStats = {};
  const departmentStats = {};
  const monthlyTrend = {};

  const months = ['April','May','June','July','August','September','October','November','December','January','February','March'];
  months.forEach(m => monthlyTrend[m] = { month: m, submitted: 0, proposals: 0, budget: 0 });

  mprs.forEach(mpr => {
    overview.totalProposals += mpr.computed.totalProposalsAllDepts || 0;
    overview.totalDeptShare += mpr.computed.totalDeptShareLakh || 0;
    overview.totalSarraShare += mpr.computed.totalSarraShareLakh || 0;
    overview.totalBudget += (mpr.computed.totalDeptShareLakh || 0) + (mpr.computed.totalSarraShareLakh || 0);

    const statusItem = overview.statusBreakdown.find(s => s.status === mpr.status);
    if (statusItem) statusItem.count++;

    if (monthlyTrend[mpr.reportingMonth]) {
      monthlyTrend[mpr.reportingMonth].submitted++;
      monthlyTrend[mpr.reportingMonth].proposals += mpr.computed.totalProposalsAllDepts || 0;
      monthlyTrend[mpr.reportingMonth].budget += (mpr.computed.totalDeptShareLakh || 0) + (mpr.computed.totalSarraShareLakh || 0);
    }

    mpr.computed.districtTotals.forEach(dt => {
      if (!districtStats[dt.district]) {
        districtStats[dt.district] = { name: dt.district, proposals: 0, deptShare: 0, sarraShare: 0, count: 0 };
      }
      districtStats[dt.district].proposals += dt.totalProposals;
      districtStats[dt.district].deptShare += dt.totalDeptShare;
      districtStats[dt.district].sarraShare += dt.totalSarraShare;
      districtStats[dt.district].count++;
    });

    mpr.computed.departmentTotals.forEach(dt => {
      if (!departmentStats[dt.department]) {
        departmentStats[dt.department] = { name: dt.department, proposals: 0, deptShare: 0, sarraShare: 0 };
      }
      departmentStats[dt.department].proposals += dt.totalProposals;
      departmentStats[dt.department].deptShare += dt.totalDeptShare;
      departmentStats[dt.department].sarraShare += dt.totalSarraShare;
    });
  });

  return {
    overview,
    monthlyTrend: Object.values(monthlyTrend),
    districtStats: Object.values(districtStats),
    departmentStats: Object.values(departmentStats),
    recentForms: mprs.sort((a,b) => b.createdAt - a.createdAt).slice(0, 10)
  };
};

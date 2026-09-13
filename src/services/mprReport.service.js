import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import MPRAbstract55 from '../models/MPRAbstract55.model.js';
import AuditLog from '../models/AuditLog.model.js';
import User from '../models/User.model.js';

const modelsMap = {
  'PRAROOP_1A': MPRPraroop1A,
  'PRAROOP_1B': MPRPraroop1B,
  'PRAROOP_1C': MPRPraroop1C,
  'PRAROOP_1D': MPRPraroop1D,
  'ABSTRACT_55': MPRAbstract55
};

const buildMatchFilter = (filters) => {
  const match = { isDraft: false };

  if (filters.district) match.submittedByDistrict = filters.district;
  if (filters.financialYear) match.financialYear = filters.financialYear;
  if (filters.reportingMonth) match.reportingMonth = filters.reportingMonth;
  
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      match.status = { $in: filters.status };
    } else {
      match.status = filters.status;
    }
  }

  if (filters.dateFrom || filters.dateTo) {
    match.submittedAt = {};
    if (filters.dateFrom) match.submittedAt.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setDate(toDate.getDate() + 1);
      match.submittedAt.$lt = toDate;
    }
  }

  return match;
};

// Overview Stats (across all 5 collections)
export const getMPROverviewStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);
  
  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalPhysicalProgress: { $sum: '$computed.grandTotalPhysicalProgress' },
        totalSarraExpend: { $sum: '$computed.grandTotalSarraExpend' },
        totalApprovedSchemes: { $sum: '$totalApprovedSchemes' },
      }
    }
  ];

  const collections = [MPRPraroop1A, MPRPraroop1B, MPRPraroop1C, MPRPraroop1D, MPRAbstract55];
  const results = await Promise.all(collections.map(col => col.aggregate(pipeline)));
  
  const aggregated = results.flat().reduce((acc, curr) => {
    if (!acc.statusBreakdown[curr._id]) acc.statusBreakdown[curr._id] = 0;
    acc.statusBreakdown[curr._id] += curr.count;
    
    acc.totalForms += curr.count;
    if (curr._id === 'APPROVED') acc.totalApproved += curr.count;
    if (curr._id === 'REJECTED') acc.totalRejected += curr.count;
    if (['SUBMITTED', 'RESUBMITTED'].includes(curr._id)) acc.totalPending += curr.count;
    
    acc.totalPhysicalProgress += (curr.totalPhysicalProgress || 0);
    acc.totalSarraExpend += (curr.totalSarraExpend || 0);
    acc.totalApprovedSchemes += (curr.totalApprovedSchemes || 0);
    
    return acc;
  }, { 
    statusBreakdown: {}, 
    totalForms: 0, 
    totalApproved: 0, 
    totalRejected: 0, 
    totalPending: 0,
    totalPhysicalProgress: 0,
    totalSarraExpend: 0,
    totalApprovedSchemes: 0
  });

  return aggregated;
};

// District Stats
export const getMPRDistrictStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);
  
  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: '$submittedByDistrict',
        totalForms: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ['$status', ['SUBMITTED', 'RESUBMITTED']] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        totalPhysicalProgress: { $sum: '$computed.grandTotalPhysicalProgress' },
        totalSarraExpend: { $sum: '$computed.grandTotalSarraExpend' },
        totalApprovedSchemes: { $sum: '$totalApprovedSchemes' }
      }
    }
  ];

  const collections = [MPRPraroop1A, MPRPraroop1B, MPRPraroop1C, MPRPraroop1D, MPRAbstract55];
  const results = await Promise.all(collections.map(col => col.aggregate(pipeline)));
  
  const districtMap = {};
  
  results.flat().forEach(curr => {
    const d = curr._id || 'Unknown';
    if (!districtMap[d]) {
      districtMap[d] = {
        district: d,
        totalForms: 0, approved: 0, pending: 0, rejected: 0,
        totalPhysicalProgress: 0, totalSarraExpend: 0, totalApprovedSchemes: 0
      };
    }
    districtMap[d].totalForms += curr.totalForms;
    districtMap[d].approved += curr.approved;
    districtMap[d].pending += curr.pending;
    districtMap[d].rejected += curr.rejected;
    districtMap[d].totalPhysicalProgress += (curr.totalPhysicalProgress || 0);
    districtMap[d].totalSarraExpend += (curr.totalSarraExpend || 0);
    districtMap[d].totalApprovedSchemes += (curr.totalApprovedSchemes || 0);
  });
  
  return Object.values(districtMap).sort((a, b) => b.totalForms - a.totalForms);
};

// Form Type Stats
export const getMPRFormTypeStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);
  
  const pipeline = [
    { $match: matchFilter },
    { $group: { _id: '$reportType', count: { $sum: 1 } } }
  ];

  const collections = [MPRPraroop1A, MPRPraroop1B, MPRPraroop1C, MPRPraroop1D, MPRAbstract55];
  const results = await Promise.all(collections.map(col => col.aggregate(pipeline)));
  
  const typeStats = {};
  results.flat().forEach(curr => {
    typeStats[curr._id] = curr.count;
  });
  
  return typeStats;
};

// Monthly Trend
export const getMPRMonthlyTrend = async (filters) => {
  const matchFilter = buildMatchFilter(filters);
  
  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: '$reportingMonth',
        submitted: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        sarraExpend: { $sum: '$computed.grandTotalSarraExpend' }
      }
    }
  ];

  const collections = [MPRPraroop1A, MPRPraroop1B, MPRPraroop1C, MPRPraroop1D, MPRAbstract55];
  const results = await Promise.all(collections.map(col => col.aggregate(pipeline)));
  
  const monthMap = {};
  results.flat().forEach(curr => {
    const m = curr._id || 'Unknown';
    if (!monthMap[m]) monthMap[m] = { month: m, submitted: 0, approved: 0, rejected: 0, sarraExpend: 0 };
    monthMap[m].submitted += curr.submitted;
    monthMap[m].approved += curr.approved;
    monthMap[m].rejected += curr.rejected;
    monthMap[m].sarraExpend += (curr.sarraExpend || 0);
  });
  
  const monthOrder = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
  
  return monthOrder.map(m => monthMap[m] || { month: m, submitted: 0, approved: 0, rejected: 0, sarraExpend: 0 });
};

// Unified Forms List
export const getMPRFormsList = async (filters, page = 1, limit = 10, search = '') => {
  const matchFilter = buildMatchFilter(filters);
  
  if (search) {
    matchFilter.applicationNo = { $regex: search, $options: 'i' };
  }
  
  let collectionsToQuery = [MPRPraroop1A, MPRPraroop1B, MPRPraroop1C, MPRPraroop1D, MPRAbstract55];
  if (filters.formType && modelsMap[filters.formType]) {
    collectionsToQuery = [modelsMap[filters.formType]];
  }

  const fetchLimit = limit * page;
  
  const fetchPromises = collectionsToQuery.map(col => col.find(matchFilter)
    .populate('submittedBy', 'name email role')
    .sort({ createdAt: -1 })
    .limit(fetchLimit)
    .lean()
  );
  
  const results = await Promise.all(fetchPromises);
  const allForms = results.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  const totalCounts = await Promise.all(collectionsToQuery.map(col => col.countDocuments(matchFilter)));
  const total = totalCounts.reduce((a, b) => a + b, 0);
  
  const startIndex = (page - 1) * limit;
  const paginatedForms = allForms.slice(startIndex, startIndex + limit);
  
  return {
    data: paginatedForms,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

export const getMPRAuditLogs = async (filters, page = 1, limit = 20) => {
  const matchFilter = {
    action: { $in: ['FORM_SUBMIT', 'FORM_APPROVE', 'FORM_REJECT', 'FORM_RESUBMIT'] }
  };
  
  if (filters.action) matchFilter.action = filters.action;
  
  const pipeline = [
    { $match: matchFilter },
    { $sort: { timestamp: -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'performedBy', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $project: { "user.password": 0 } }
  ];
  
  const data = await AuditLog.aggregate(pipeline);
  const total = await AuditLog.countDocuments(matchFilter);
  
  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

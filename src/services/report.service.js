import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';

const buildMatchFilter = (filters) => {
  const match = {};

  if (filters.district) match.district = filters.district;
  if (filters.department) match.department = filters.department;
  if (filters.formType) match.formType = filters.formType;
  if (filters.submittedBy) match.submittedBy = filters.submittedBy;

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


export const getOverviewStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);

  const pipeline = [
    { $match: matchFilter },
    {
      $facet: {
        statusBreakdown: [
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ],
        totals: [
          {
            $group: {
              _id: null,
              totalForms: { $sum: 1 },
              totalApproved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
              totalPending: {
                $sum: {
                  $cond: [{ $in: ['$status', ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW']] }, 1, 0]
                }
              },
              totalRejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
              totalProposedBudgetLakh: { $sum: '$totalBudgetLakh' },
              totalApprovedBudgetLakh: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, '$totalBudgetLakh', 0] } },
              totalPop: { $sum: { $add: ['$totalPopulationBenefited', '$totalBenefitedPopulation', '$totalDependentPopulation'] } },
              totalSprings: { $sum: '$springCount' },
              totalARS: { $sum: { $ifNull: ['$arsCount', 0] } },
              totalStreamCount: { $sum: '$streamCount' },
              totalRecharge: { $sum: '$totalRechargeAreaHa' },
              avgBudget: { $avg: '$totalBudgetLakh' }
            }
          }
        ],
        thisMonth: [
          {
            $match: {
              submittedAt: {
                $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
              }
            }
          },
          { $count: 'count' }
        ],
        thisYear: [
          {
            $match: {
              submittedAt: {
                $gte: new Date(new Date().getFullYear(), 0, 1)
              }
            }
          },
          { $count: 'count' }
        ]
      }
    }
  ];

  const result = await DPRFlatSummary.aggregate(pipeline);
  const data = result[0];

  const totals = data.totals[0] || {
    totalForms: 0, totalApproved: 0, totalPending: 0, totalRejected: 0,
    totalProposedBudgetLakh: 0, totalApprovedBudgetLakh: 0, totalPop: 0,
    totalSprings: 0, totalARS: 0, totalStreamCount: 0, totalRecharge: 0, avgBudget: 0
  };

  return {
    statusBreakdown: data.statusBreakdown.map(s => ({ status: s._id, count: s.count })),
    totalForms: totals.totalForms,
    totalApproved: totals.totalApproved,
    totalPending: totals.totalPending,
    totalRejected: totals.totalRejected,
    totalBudgetLakh: Math.round(totals.totalApprovedBudgetLakh * 100) / 100, // Keep for backward compatibility
    totalProposedBudgetLakh: Math.round(totals.totalProposedBudgetLakh * 100) / 100,
    totalApprovedBudgetLakh: Math.round(totals.totalApprovedBudgetLakh * 100) / 100,
    totalPopulationBenefited: totals.totalPop,
    totalSprings: totals.totalSprings,
    totalARS: totals.totalARS,
    totalStreamCount: totals.totalStreamCount,
    totalRechargeAreaHa: Math.round(totals.totalRecharge * 100) / 100,
    avgBudgetPerFormLakh: Math.round(totals.avgBudget * 100) / 100,
    formsSubmittedThisMonth: data.thisMonth[0]?.count || 0,
    formsSubmittedThisYear: data.thisYear[0]?.count || 0
  };
};

export const getDistrictWiseStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);

  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: '$district',
        totalForms: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        pending: {
          $sum: {
            $cond: [{ $in: ['$status', ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW']] }, 1, 0]
          }
        },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        totalBudgetLakh: { $sum: '$totalBudgetLakh' },
        totalSprings: { $sum: '$springCount' },
        totalARS: { $sum: { $ifNull: ['$arsCount', 0] } },
        totalPopulation: { $sum: '$totalPopulationBenefited' },
        totalRecharge: { $sum: '$totalRechargeAreaHa' }
      }
    },
    {
      $addFields: {
        district: '$_id',
        approvalRate: {
          $round: [
            { $multiply: [{ $divide: ['$approved', { $max: ['$totalForms', 1] }] }, 100] },
            2
          ]
        }
      }
    },
    { $project: { _id: 0 } },
    { $sort: { totalForms: -1 } }
  ];

  const results = await DPRFlatSummary.aggregate(pipeline);
  return results.map(r => ({
    ...r,
    totalBudgetLakh: Math.round(r.totalBudgetLakh * 100) / 100,
    totalRecharge: Math.round(r.totalRecharge * 100) / 100,
    avgApprovalDays: 0 // Placeholder
  }));
};

export const getDepartmentWiseStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);

  const totalBudgetPipeline = [
    { $match: matchFilter },
    { $group: { _id: null, total: { $sum: '$totalBudgetLakh' } } }
  ];
  const totalRes = await DPRFlatSummary.aggregate(totalBudgetPipeline);
  const overallBudget = totalRes[0]?.total || 0;

  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: '$department',
        totalForms: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        pending: {
          $sum: {
            $cond: [{ $in: ['$status', ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW']] }, 1, 0]
          }
        },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        totalBudgetLakh: { $sum: '$totalBudgetLakh' },
        totalSprings: { $sum: '$springCount' },
        totalARS: { $sum: { $ifNull: ['$arsCount', 0] } },
        totalPopulation: { $sum: '$totalPopulationBenefited' },
        totalRecharge: { $sum: '$totalRechargeAreaHa' }
      }
    },
    {
      $addFields: {
        department: '$_id',
        approvalRate: {
          $round: [
            { $multiply: [{ $divide: ['$approved', { $max: ['$totalForms', 1] }] }, 100] },
            2
          ]
        }
      }
    },
    { $project: { _id: 0 } },
    { $sort: { totalForms: -1 } }
  ];

  const results = await DPRFlatSummary.aggregate(pipeline);
  return results.map(r => ({
    ...r,
    totalBudgetLakh: Math.round(r.totalBudgetLakh * 100) / 100,
    totalRecharge: Math.round(r.totalRecharge * 100) / 100,
    avgApprovalDays: 0, // Placeholder
    totalDeptBudgetShare: overallBudget > 0 ? Math.round((r.totalBudgetLakh / overallBudget) * 10000) / 100 : 0
  }));
};

export const getMonthlyTrend = async (year, filters) => {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year + 1, 0, 1);

  const matchFilter = buildMatchFilter(filters);
  matchFilter.submittedAt = { $gte: startDate, $lt: endDate };

  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: { month: { $month: '$submittedAt' } },
        submitted: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
        budgetLakh: { $sum: '$totalBudgetLakh' }
      }
    },
    { $sort: { '_id.month': 1 } },
    {
      $addFields: {
        monthStr: {
          $arrayElemAt: [
            ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            '$_id.month'
          ]
        }
      }
    },
    { $project: { _id: 0, monthIndex: '$_id.month', month: '$monthStr', submitted: 1, approved: 1, rejected: 1, budgetLakh: 1 } }
  ];

  const results = await DPRFlatSummary.aggregate(pipeline);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return monthNames.map((name, index) => {
    const found = results.find(r => r.monthIndex === index + 1);
    return {
      month: name,
      submitted: found?.submitted || 0,
      approved: found?.approved || 0,
      rejected: found?.rejected || 0,
      budgetLakh: found ? Math.round(found.budgetLakh * 100) / 100 : 0
    };
  });
};

export const getSpringTypeStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);

  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        naula: { $sum: '$springTypeBreakdown.naula' },
        dhara: { $sum: '$springTypeBreakdown.dhara' },
        gadheraNala: { $sum: '$springTypeBreakdown.gadheraNala' },
        otherType: { $sum: '$springTypeBreakdown.other' },
        perennial: { $sum: '$springNatureBreakdown.perennial' },
        seasonal: { $sum: '$springNatureBreakdown.seasonal' },
        dried: { $sum: '$springNatureBreakdown.dried' },
        contact: { $sum: '$typologyBreakdown.contact' },
        depression: { $sum: '$typologyBreakdown.depression' },
        fractureFault: { $sum: '$typologyBreakdown.fractureFault' },
        karst: { $sum: '$typologyBreakdown.karst' },
        thermal: { $sum: '$typologyBreakdown.thermal' },
        publicOwn: { $sum: '$publicOwnershipCount' },
        privateOwn: { $sum: '$privateOwnershipCount' },
        highlyDecreased: { $sum: '$dischargeTrendBreakdown.highlyDecreased' },
        slightlyDecreased: { $sum: '$dischargeTrendBreakdown.slightlyDecreased' },
        noChange: { $sum: '$dischargeTrendBreakdown.noChange' },
        increased: { $sum: '$dischargeTrendBreakdown.increased' },
        threatLow: { $sum: '$threatDegreeBreakdown.low' },
        threatModerate: { $sum: '$threatDegreeBreakdown.moderate' },
        threatHigh: { $sum: '$threatDegreeBreakdown.high' },
        drinkCook: { $sum: '$waterUsageBreakdown.drinkingCooking' },
        washSanit: { $sum: '$waterUsageBreakdown.washingSanitation' },
        cattleLivestock: { $sum: '$waterUsageBreakdown.cattlesLivestock' },
        irrigation: { $sum: '$waterUsageBreakdown.irrigation' },
        industrial: { $sum: '$waterUsageBreakdown.industrial' },
        otherUsage: { $sum: '$waterUsageBreakdown.other' },
        totalDischargeLPM: { $sum: '$totalDischargeLPM' },
        totalSprings: { $sum: '$springCount' },
        totalWithPipeSupply: { $sum: '$pipeSupplyCount' },
        totalWithSamitiExists: { $sum: '$samitiExistsCount' },
        totalRechargeAreaDemarcated: { $sum: '$rechargeAreaDemarcatedCount' }
      }
    }
  ];

  const results = await DPRFlatSummary.aggregate(pipeline);
  const data = results[0] || {};

  return {
    byType: {
      naula: data.naula || 0, dhara: data.dhara || 0,
      gadheraNala: data.gadheraNala || 0, other: data.otherType || 0
    },
    byNature: {
      perennial: data.perennial || 0, seasonal: data.seasonal || 0, dried: data.dried || 0
    },
    byTypology: {
      contact: data.contact || 0, depression: data.depression || 0,
      fractureFault: data.fractureFault || 0, karst: data.karst || 0, thermal: data.thermal || 0
    },
    byOwnership: { public: data.publicOwn || 0, private: data.privateOwn || 0 },
    byDischargeTrend: {
      highlyDecreased: data.highlyDecreased || 0, slightlyDecreased: data.slightlyDecreased || 0,
      noChange: data.noChange || 0, increased: data.increased || 0
    },
    byThreatDegree: {
      low: data.threatLow || 0, moderate: data.threatModerate || 0, high: data.threatHigh || 0
    },
    byWaterUsage: {
      drinkingCooking: data.drinkCook || 0, washingSanitation: data.washSanit || 0,
      cattlesLivestock: data.cattleLivestock || 0, irrigation: data.irrigation || 0,
      industrial: data.industrial || 0, other: data.otherUsage || 0
    },
    avgDischargeLPM: data.totalSprings ? Math.round((data.totalDischargeLPM / data.totalSprings) * 100) / 100 : 0,
    totalWithPipeSupply: data.totalWithPipeSupply || 0,
    totalWithSamitiExists: data.totalWithSamitiExists || 0,
    totalRechargeAreaDemarcated: data.totalRechargeAreaDemarcated || 0
  };
};

export const getResourceAnalytics = async (filters) => {
  const matchFilter = buildMatchFilter(filters);

  const pipeline = [
    { $match: matchFilter },
    {
      $facet: {
        springs: [
          { $match: { formType: 'SPRINGSHED' } },
          {
            $group: {
              _id: null,
              total: { $sum: '$springCount' },
              perennial: { $sum: '$springNatureBreakdown.perennial' },
              seasonal: { $sum: '$springNatureBreakdown.seasonal' },
              dried: { $sum: '$springNatureBreakdown.dried' },
              avgDischarge: { $avg: '$avgDischargeLPM' }
            }
          }
        ],
        streams: [
          { $match: { formType: 'STREAMSHED' } },
          {
            $group: {
              _id: null,
              total: { $sum: '$streamCount' },
              perennial: { $sum: '$perennialStreamCount' },
              seasonal: { $sum: '$seasonalStreamCount' },
              dried: { $sum: '$driedStreamCount' },
              totalCatchmentArea: { $sum: '$totalCatchmentAreaHa' },
              totalLength: { $sum: '$totalLengthKm' }
            }
          }
        ],
        groundwater: [
          { $match: { formType: 'GROUNDWATER' } },
          {
            $group: {
              _id: null,
              totalARS: { $sum: '$arsCount' },
              avgDepthPre: { $avg: '$avgDepthPreMonsoon' },
              avgDepthPost: { $avg: '$avgDepthPostMonsoon' },
              totalRechargeArea: { $sum: '$totalRechargeAreaHa' }
            }
          }
        ],
        gwAvailability: [
          { $match: { formType: 'GROUNDWATER', groundwaterAvailabilityStatus: { $exists: true, $ne: '' } } },
          { $group: { _id: '$groundwaterAvailabilityStatus', count: { $sum: 1 } } }
        ],
        gwVulnerability: [
          { $match: { formType: 'GROUNDWATER', vulnerabilityLevel: { $exists: true, $ne: '' } } },
          { $group: { _id: '$vulnerabilityLevel', count: { $sum: 1 } } }
        ],
        gwUses: [
          { $match: { formType: 'GROUNDWATER' } },
          { $unwind: '$primaryGroundwaterUses' },
          { $group: { _id: '$primaryGroundwaterUses', count: { $sum: 1 } } }
        ],
        landBreakdown: [
          {
            $group: {
              _id: null,
              forest: { $sum: '$totalForestLandHa' },
              revenue: { $sum: '$totalRevenueLandHa' },
              private: { $sum: '$totalPrivateLandHa' },
              total: { $sum: '$totalRechargeAreaHa' }
            }
          }
        ]
      }
    }
  ];

  const result = await DPRFlatSummary.aggregate(pipeline);
  const data = result[0];

  return {
    springs: data.springs[0] || { total: 0, perennial: 0, seasonal: 0, dried: 0, avgDischarge: 0 },
    streams: data.streams[0] || { total: 0, perennial: 0, seasonal: 0, dried: 0, totalCatchmentArea: 0, totalLength: 0 },
    groundwater: {
      stats: data.groundwater[0] || { totalARS: 0, avgDepthPre: 0, avgDepthPost: 0, totalRechargeArea: 0 },
      availability: data.gwAvailability.map(i => ({ status: i._id, count: i.count })),
      vulnerability: data.gwVulnerability.map(i => ({ level: i._id, count: i.count })),
      uses: data.gwUses.map(i => ({ use: i._id, count: i.count }))
    },
    land: data.landBreakdown[0] || { forest: 0, revenue: 0, private: 0, total: 0 }
  };
};

export const getBudgetStats = async (filters) => {
  const matchFilter = buildMatchFilter(filters);

  const budgetPipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalForms: { $sum: 1 },
        totalProposedLakh: { $sum: '$totalBudgetLakh' },
        totalApprovedBudgetLakh: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, '$totalBudgetLakh', 0] } },
        totalPIAFundLakh: { $sum: '$fundFromPIADeptLakh' },
        totalOtherSourceLakh: { $sum: '$fundFromOtherSourcesLakh' },
        totalSARRAConvergenceLakh: { $sum: '$fundFromSARRAConvergenceLakh' }
      }
    }
  ];

  const distPipeline = [
    { $match: matchFilter },
    { $group: { _id: '$district', totalLakh: { $sum: '$totalBudgetLakh' }, count: { $sum: 1 } } },
    { $project: { _id: 0, district: '$_id', totalLakh: 1, count: 1 } },
    { $sort: { totalLakh: -1 } }
  ];

  const deptPipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: '$department',
        totalLakh: { $sum: '$totalBudgetLakh' },
        totalPIAFundLakh: { $sum: '$fundFromPIADeptLakh' },
        totalSARRAConvergenceLakh: { $sum: '$fundFromSARRAConvergenceLakh' },
        totalOtherSourceLakh: { $sum: '$fundFromOtherSourcesLakh' },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        department: '$_id',
        totalLakh: 1,
        totalPIAFundLakh: 1,
        totalSARRAConvergenceLakh: 1,
        totalOtherSourceLakh: 1,
        count: 1
      }
    },
    { $sort: { totalLakh: -1 } }
  ];

  const activityPipeline = [
    { $match: matchFilter },
    { $unwind: { path: '$activityTargets', preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: '$activityTargets.activityId',
        activityLabel: { $first: '$activityTargets.activityLabel' },
        totalFinancialAmountLakh: { $sum: '$activityTargets.financialAmountLakh' },
        totalPhysicalTarget: { $sum: '$activityTargets.totalPhysicalTarget' },
        formCount: { $sum: 1 }
      }
    },
    { $sort: { totalFinancialAmountLakh: -1 } },
    { $project: { _id: 0, activityId: '$_id', activityLabel: 1, totalFinancialAmountLakh: 1, totalPhysicalTarget: 1, formCount: 1 } }
  ];

  const [budgetRes, budgetByDistrict, budgetByDepartment, activityWiseBudget] = await Promise.all([
    DPRFlatSummary.aggregate(budgetPipeline),
    DPRFlatSummary.aggregate(distPipeline),
    DPRFlatSummary.aggregate(deptPipeline),
    DPRFlatSummary.aggregate(activityPipeline)
  ]);

  const bData = budgetRes[0] || {};

  const mapRounded = (list) => list.map(i => ({
    ...i,
    totalLakh: Math.round(i.totalLakh * 100) / 100,
    ...(i.totalPIAFundLakh !== undefined && { totalPIAFundLakh: Math.round(i.totalPIAFundLakh * 100) / 100 }),
    ...(i.totalSARRAConvergenceLakh !== undefined && { totalSARRAConvergenceLakh: Math.round(i.totalSARRAConvergenceLakh * 100) / 100 }),
    ...(i.totalOtherSourceLakh !== undefined && { totalOtherSourceLakh: Math.round(i.totalOtherSourceLakh * 100) / 100 }),
  }));
  const mapActRounded = (list) => list.map(i => ({
    ...i,
    totalFinancialAmountLakh: Math.round(i.totalFinancialAmountLakh * 100) / 100,
    totalPhysicalTarget: Math.round(i.totalPhysicalTarget * 100) / 100
  }));

  return {
    totalProposedLakh: Math.round((bData.totalProposedLakh || 0) * 100) / 100,
    totalApprovedBudgetLakh: Math.round((bData.totalApprovedBudgetLakh || 0) * 100) / 100,
    avgBudgetPerDPR: bData.totalForms ? Math.round(((bData.totalProposedLakh || 0) / bData.totalForms) * 100) / 100 : 0,
    totalPIAFundLakh: Math.round((bData.totalPIAFundLakh || 0) * 100) / 100,
    totalOtherSourceLakh: Math.round((bData.totalOtherSourceLakh || 0) * 100) / 100,
    totalSARRAConvergenceLakh: Math.round((bData.totalSARRAConvergenceLakh || 0) * 100) / 100,
    budgetByDistrict: mapRounded(budgetByDistrict),
    budgetByDepartment: mapRounded(budgetByDepartment),
    activityWiseBudget: mapActRounded(activityWiseBudget)
  };
};

export const getFormsList = async (filters, page = 1, limit = 20, sortParam = '-submittedAt') => {
  const matchFilter = buildMatchFilter(filters);
  const skip = (page - 1) * limit;

  let sortField = sortParam;
  let sortOrder = 1;
  if (sortParam.startsWith('-')) {
    sortField = sortParam.substring(1);
    sortOrder = -1;
  }

  const pipeline = [
    { $match: matchFilter },
    {
      $facet: {
        data: [
          { $sort: { [sortField]: sortOrder } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              dprId: 1,
              applicationNo: 1, district: 1, department: 1, block: 1,
              springCount: 1, streamCount: 1, arsCount: 1, status: 1, totalBudgetLakh: 1,
              totalPopulationBenefited: 1, submittedAt: 1,
              submittedByName: 1, approvedAt: 1, formType: 1
            }
          }
        ],
        totalCount: [{ $count: 'count' }]
      }
    }
  ];

  const result = await DPRFlatSummary.aggregate(pipeline);
  const data = result[0].data;
  const totalItems = result[0].totalCount[0]?.count || 0;

  return {
    data,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit)
    }
  };
};

export const getPendingFormsForDD = async (districtName, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const matchFilter = {
    district: districtName,
    status: { $in: ['SUBMITTED', 'RESUBMITTED'] }
  };

  const pipeline = [
    { $match: matchFilter },
    {
      $facet: {
        data: [
          { $sort: { submittedAt: 1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $addFields: {
              daysWaiting: {
                $floor: {
                  $divide: [
                    { $subtract: [new Date(), '$submittedAt'] },
                    1000 * 60 * 60 * 24
                  ]
                }
              }
            }
          },
          {
            $project: {
              applicationNo: 1, department: 1, block: 1,
              springCount: 1, streamCount: 1, arsCount: 1, status: 1, totalBudgetLakh: 1,
              submittedAt: 1, submittedByName: 1, daysWaiting: 1
            }
          }
        ],
        totalCount: [{ $count: 'count' }]
      }
    }
  ];

  const result = await DPRFlatSummary.aggregate(pipeline);
  const data = result[0].data;
  const totalItems = result[0].totalCount[0]?.count || 0;

  return {
    data,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit)
    }
  };
};

export const getApprovalTimeline = async (filters) => {
  const matchFilter = buildMatchFilter(filters);

  const pipeline = [
    { $match: { ...matchFilter, status: 'APPROVED', approvedAt: { $exists: true } } },
    {
      $addFields: {
        daysToApprove: {
          $divide: [
            { $subtract: ['$approvedAt', '$submittedAt'] },
            1000 * 60 * 60 * 24
          ]
        }
      }
    },
    {
      $group: {
        _id: null,
        avgDaysSubmitToApprove: { $avg: '$daysToApprove' },
        formsWaitingOver7Days: { $sum: { $cond: [{ $gt: ['$daysToApprove', 7] }, 1, 0] } },
        formsWaitingOver14Days: { $sum: { $cond: [{ $gt: ['$daysToApprove', 14] }, 1, 0] } }
      }
    }
  ];

  const distPipeline = [
    { $match: { ...matchFilter, status: 'APPROVED', approvedAt: { $exists: true } } },
    {
      $group: {
        _id: '$district',
        avgDays: {
          $avg: {
            $divide: [
              { $subtract: ['$approvedAt', '$submittedAt'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      }
    },
    { $project: { _id: 0, district: '$_id', avgDays: 1 } },
    { $sort: { avgDays: -1 } }
  ];

  const [res, distRes] = await Promise.all([
    DPRFlatSummary.aggregate(pipeline),
    DPRFlatSummary.aggregate(distPipeline)
  ]);

  const data = res[0] || {};
  const mappedDist = distRes.map(d => ({ ...d, avgDays: Math.round(d.avgDays * 10) / 10 }));

  return {
    avgDaysToFirstReview: 0, // Need audit logs for exact metrics
    avgDaysDraftToSubmit: 0,
    avgDaysSubmitToApprove: Math.round((data.avgDaysSubmitToApprove || 0) * 10) / 10,
    slowestDistricts: mappedDist.slice(0, 5),
    fastestDistricts: mappedDist.slice(-5).reverse(),
    formsWaitingOver7Days: data.formsWaitingOver7Days || 0,
    formsWaitingOver14Days: data.formsWaitingOver14Days || 0
  };
};

export const buildFilterHelper = buildMatchFilter;

// ─────────────────────────────────────────────────────────────────────────────
// DIRECT FALLBACK QUERIES (used when DPRFlatSummary is empty)
// Queries SpringshedDPR directly — less fields but always has data.
// ─────────────────────────────────────────────────────────────────────────────

const buildDirectMatchFilter = (filters) => {
  const match = { isDraft: { $ne: true } };
  if (filters.formType) match.formType = filters.formType;
  if (filters.district) match.submittedByDistrict = filters.district;
  if (filters.department) match.submittedByDepartment = filters.department;
  if (filters.status) {
    const raw = filters.status;
    const statuses = typeof raw === 'string' && raw.includes(',') ? raw.split(',') : raw;
    match.status = Array.isArray(statuses) ? { $in: statuses } : statuses;
  }
  if (filters.dateFrom || filters.dateTo) {
    match.submittedAt = {};
    if (filters.dateFrom) match.submittedAt.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const d = new Date(filters.dateTo);
      d.setDate(d.getDate() + 1);
      match.submittedAt.$lt = d;
    }
  }
  return match;
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const mergeStatusBreakdown = (...breakdowns) => {
  const counts = new Map();

  breakdowns.flat().forEach((item) => {
    if (!item?._id) return;
    counts.set(item._id, (counts.get(item._id) || 0) + (item.count || 0));
  });

  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
};

const sumTotals = (...totalsList) => totalsList.reduce((acc, totals) => ({
  totalForms: acc.totalForms + (totals?.totalForms || 0),
  totalApproved: acc.totalApproved + (totals?.totalApproved || 0),
  totalPending: acc.totalPending + (totals?.totalPending || 0),
  totalRejected: acc.totalRejected + (totals?.totalRejected || 0),
  totalBudgetApproved: acc.totalBudgetApproved + (totals?.totalBudgetApproved || 0),
  totalPopulationBenefited: acc.totalPopulationBenefited + (totals?.totalPopulationBenefited || 0),
  totalSprings: acc.totalSprings + (totals?.totalSprings || 0),
  totalRechargeAreaHa: acc.totalRechargeAreaHa + (totals?.totalRechargeAreaHa || 0),
  totalBudgetAllForms: acc.totalBudgetAllForms + (totals?.totalBudgetAllForms || 0),
}), {
  totalForms: 0,
  totalApproved: 0,
  totalPending: 0,
  totalRejected: 0,
  totalBudgetApproved: 0,
  totalPopulationBenefited: 0,
  totalSprings: 0,
  totalRechargeAreaHa: 0,
  totalBudgetAllForms: 0,
});

const buildUnifiedFormListItem = (form) => {
  const isSpring = form.formType === 'SPRINGSHED';
  const isGw = form.formType === 'GROUNDWATER';
  const springTable = form.section2_springIdentification?.springs || [];
  const streamTable = form.section2_streamIdentification?.table21 || [];
  const streamUsage = form.section2_streamIdentification?.table23 || [];
  const streamRecharge = form.section5_rechargeAreas?.table51 || [];
  const gwTable = form.section2_aquiferIdentification?.arsDetails || [];

  return {
    dprId: form._id,
    applicationNo: form.applicationNo,
    district: form.submittedByDistrict || form.section1_deptDetails?.district || '',
    department: form.submittedByDepartment || form.section1_deptDetails?.department || '',
    block: form.section1_deptDetails?.block
      || form.section2_springIdentification?.springBlock
      || form.section2_streamIdentification?.blockTown
      || form.section2_aquiferIdentification?.blockTown
      || '',
    springCount: isSpring ? springTable.length : 0,
    streamCount: isGw ? 0 : isSpring ? 0 : streamTable.length,
    arsCount: isGw ? gwTable.length : 0,
    status: form.status,
    totalBudgetLakh: isGw
      ? round2(form.section5_budgetAndPlan?.table51?.totalBudgetLakh)
      : isSpring
        ? round2(form.section10_budgetAndPlan?.table101?.totalBudgetLakh)
        : round2(form.section7_budgetAndPlan?.table71?.totalBudgetLakh),
    totalPopulationBenefited: isGw ? 0 : isSpring
      ? (form.section3_springDescription?.table32 || []).reduce((sum, item) => sum + (Number(item.populationBenefited) || 0), 0)
      : streamUsage.reduce((sum, item) => sum + (Number(item.benefitedPopulation) || 0), 0),
    totalRechargeAreaHa: isGw
      ? round2(gwTable.reduce((sum, item) => sum + (Number(item.approxRechargeAreaHa) || 0), 0))
      : isSpring
        ? round2((form.section8_rechargeArea?.table81 || []).reduce((sum, item) => sum + (Number(item.totalRechargeAreaHa) || 0), 0))
        : round2(streamRecharge.reduce((sum, item) => sum + (Number(item.totalRechargeAreaHa) || 0), 0)),
    submittedAt: form.submittedAt,
    submittedByName: form.section10_budgetAndPlan?.submittedByName
      || form.section7_budgetAndPlan?.submittedByName
      || form.section5_budgetAndPlan?.submittedByName
      || '',
    approvedAt: form.approvedAt,
    formType: form.formType,
  };
};

export const getOverviewStatsDirect = async (filters) => {
  const matchFilter = buildDirectMatchFilter(filters);
  const [springForms, streamForms, gwForms] = await Promise.all([
    Promise.resolve([]),
    Promise.resolve([]),
    Promise.resolve([])
  ]);
  const allForms = [...springForms, ...streamForms, ...gwForms];
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  const pendingStatuses = new Set(['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW']);
  const breakdownMap = new Map();

  const totals = allForms.reduce((acc, form) => {
    const isSpring = form.formType === 'SPRINGSHED';
    const isGw = form.formType === 'GROUNDWATER';
    const budget = isGw ? Number(form.section5_budgetAndPlan?.table51?.totalBudgetLakh) || 0 : isSpring
      ? Number(form.section10_budgetAndPlan?.table101?.totalBudgetLakh) || 0
      : Number(form.section7_budgetAndPlan?.table71?.totalBudgetLakh) || 0;
    const population = isGw ? 0 : isSpring
      ? (form.section3_springDescription?.table32 || []).reduce((sum, item) => sum + (Number(item.populationBenefited) || 0), 0)
      : (form.section2_streamIdentification?.table23 || []).reduce((sum, item) => sum + (Number(item.benefitedPopulation) || 0), 0);
    const springs = isSpring ? (form.section2_springIdentification?.springs || []).length : 0;
    const ars = isGw ? (form.section2_aquiferIdentification?.arsDetails || []).length : 0;
    const recharge = isGw
      ? (form.section2_aquiferIdentification?.arsDetails || []).reduce((sum, item) => sum + (Number(item.approxRechargeAreaHa) || 0), 0)
      : isSpring
        ? (form.section8_rechargeArea?.table81 || []).reduce((sum, item) => sum + (Number(item.totalRechargeAreaHa) || 0), 0)
        : (form.section5_rechargeAreas?.table51 || []).reduce((sum, item) => sum + (Number(item.totalRechargeAreaHa) || 0), 0);

    breakdownMap.set(form.status, (breakdownMap.get(form.status) || 0) + 1);

    acc.totalForms += 1;
    acc.totalApproved += form.status === 'APPROVED' ? 1 : 0;
    acc.totalPending += pendingStatuses.has(form.status) ? 1 : 0;
    acc.totalRejected += form.status === 'REJECTED' ? 1 : 0;
    acc.totalBudgetApproved += form.status === 'APPROVED' ? budget : 0;
    acc.totalPopulationBenefited += population;
    acc.totalSprings += springs;
    acc.totalARS += ars;
    acc.totalRechargeAreaHa += recharge;
    acc.totalBudgetAllForms += budget;
    acc.formsSubmittedThisMonth += form.submittedAt && new Date(form.submittedAt) >= startOfMonth ? 1 : 0;
    acc.formsSubmittedThisYear += form.submittedAt && new Date(form.submittedAt) >= startOfYear ? 1 : 0;
    return acc;
  }, {
    totalForms: 0,
    totalApproved: 0,
    totalPending: 0,
    totalRejected: 0,
    totalBudgetApproved: 0,
    totalPopulationBenefited: 0,
    totalSprings: 0,
    totalARS: 0,
    totalRechargeAreaHa: 0,
    totalBudgetAllForms: 0,
    formsSubmittedThisMonth: 0,
    formsSubmittedThisYear: 0
  });

  return {
    statusBreakdown: Array.from(breakdownMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    totalForms: totals.totalForms,
    totalApproved: totals.totalApproved,
    totalPending: totals.totalPending,
    totalRejected: totals.totalRejected,
    totalBudgetLakh: round2(totals.totalBudgetApproved),
    totalPopulationBenefited: totals.totalPopulationBenefited,
    totalSprings: totals.totalSprings,
    totalARS: totals.totalARS,
    totalRechargeAreaHa: round2(totals.totalRechargeAreaHa),
    avgBudgetPerFormLakh: totals.totalForms ? round2(totals.totalBudgetAllForms / totals.totalForms) : 0,
    avgApprovalDaysCount: 0,
    formsSubmittedThisMonth: totals.formsSubmittedThisMonth,
    formsSubmittedThisYear: totals.formsSubmittedThisYear
  };
};

export const getMonthlyTrendDirect = async (year, filters) => {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year + 1, 0, 1);
  const matchFilter = buildDirectMatchFilter(filters);
  matchFilter.submittedAt = { $gte: startDate, $lt: endDate };

  const pipeline = [
    { $match: matchFilter },
    {
      $group: {
        _id: { month: { $month: '$submittedAt' } },
        submitted: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
      }
    },
    { $sort: { '_id.month': 1 } },
    {
      $addFields: {
        monthStr: {
          $arrayElemAt: [
            ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            '$_id.month'
          ]
        }
      }
    },
    { $project: { _id: 0, monthIndex: '$_id.month', month: '$monthStr', submitted: 1, approved: 1, rejected: 1 } }
  ];

  const [springResults, streamResults, gwResults] = await Promise.all([
    Promise.resolve([]),
    Promise.resolve([]),
    Promise.resolve([])
  ]);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return monthNames.map((name, index) => {
    const spring = springResults.find(r => r.monthIndex === index + 1);
    const stream = streamResults.find(r => r.monthIndex === index + 1);
    const gw = gwResults.find(r => r.monthIndex === index + 1);
    return {
      month: name,
      submitted: (spring?.submitted || 0) + (stream?.submitted || 0) + (gw?.submitted || 0),
      approved: (spring?.approved || 0) + (stream?.approved || 0) + (gw?.approved || 0),
      rejected: (spring?.rejected || 0) + (stream?.rejected || 0) + (gw?.rejected || 0),
      budgetLakh: 0
    };
  });
};

export const getFormsListDirect = async (filters, page = 1, limit = 20, sortParam = '-submittedAt') => {
  const matchFilter = buildDirectMatchFilter(filters);
  const sortField = sortParam.startsWith('-') ? sortParam.substring(1) : sortParam;
  const sortOrder = sortParam.startsWith('-') ? -1 : 1;
  const skip = (page - 1) * limit;

  const [springForms, streamForms, gwForms] = await Promise.all([
    Promise.resolve([]),
    Promise.resolve([]),
    Promise.resolve([])
  ]);

  const combined = [...springForms, ...streamForms, ...gwForms]
    .map(buildUnifiedFormListItem)
    .sort((a, b) => {
      const aValue = a?.[sortField];
      const bValue = b?.[sortField];

      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      if (aValue instanceof Date || bValue instanceof Date) {
        return (new Date(aValue).getTime() - new Date(bValue).getTime()) * sortOrder;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return aValue.localeCompare(bValue) * sortOrder;
      }

      return ((aValue > bValue) - (aValue < bValue)) * sortOrder;
    });

  const data = combined.slice(skip, skip + limit);
  const totalItems = combined.length;

  return {
    data,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit)
    }
  };
};


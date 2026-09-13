import ProjectSanction from '../models/ProjectSanction.model.js';
import generateSanctionId from '../utils/generateSanctionId.js';
import paginate from '../utils/paginate.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';



/**
 * Create a sanction from an approved DPR (State Maker)
 */
export const createSanction = async (data, makerUser) => {
  const { 
    projectTitle, 
    projectType, 
    financialYear, 
    district, 
    department, 
    sanctionedTargets, 
    totalSanctionedBudgetLakh, 
    deptShareLakh, 
    sarraShareLakh 
  } = data;

  if (!projectTitle) throw new Error('Project Title is required');
  if (!projectType) throw new Error('Project Type is required');
  if (!district) throw new Error('District is required');
  if (!financialYear) throw new Error('Financial Year is required');

  const targets = sanctionedTargets || [];

  const sanction = await ProjectSanction.create({
    projectTitle,
    projectType,
    dprType: projectType, // For compatibility
    financialYear,
    district,
    department,
    status: SANCTION_STATUS.PENDING_CHECKER,
    sanctionedTargets: targets,
    totalSanctionedBudgetLakh: totalSanctionedBudgetLakh || targets.reduce((s, t) => s + (t.financialAmountLakh || 0), 0),
    deptShareLakh: deptShareLakh || 0,
    sarraShareLakh: sarraShareLakh || 0,
    makerUserId: makerUser._id,
    makerNote: data.makerNote || '',
    makerAt: new Date(),
    workflowHistory: [{
      action: 'CREATED',
      performedBy: makerUser._id,
      performedAt: new Date(),
      note: data.makerNote || 'Project created by Maker',
    }],
  });

  return sanction;
};

/**
 * Checker verifies sanction
 */
export const checkerVerify = async (sanctionId, checkerUser, note) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.PENDING_CHECKER) {
    throw new Error('Sanction is not pending checker verification');
  }

  sanction.status = SANCTION_STATUS.PENDING_APPROVER;
  sanction.checkerUserId = checkerUser._id;
  sanction.checkerNote = note || '';
  sanction.checkerAt = new Date();
  sanction.workflowHistory.push({
    action: 'CHECKER_VERIFIED',
    performedBy: checkerUser._id,
    performedAt: new Date(),
    note: note || 'Verified by Checker',
  });

  await sanction.save();
  return sanction;
};

/**
 * Approver approves sanction — generates Sanction ID
 */
export const approverApprove = async (sanctionId, approverUser, note, documents) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.PENDING_APPROVER) {
    throw new Error('Sanction is not pending approver approval');
  }

  // Generate unique Sanction ID
  const generatedSanctionId = await generateSanctionId(sanction.district);

  sanction.sanctionId = generatedSanctionId;
  sanction.status = SANCTION_STATUS.SANCTIONED;
  sanction.approverUserId = approverUser._id;
  sanction.approverNote = note || '';
  sanction.approverAt = new Date();

  if (documents?.secretariatApprovalOrder) {
    sanction.secretariatApprovalOrder = documents.secretariatApprovalOrder;
  }
  if (documents?.stateSanctionOrder) {
    sanction.stateSanctionOrder = documents.stateSanctionOrder;
  }

  sanction.workflowHistory.push({
    action: 'APPROVED',
    performedBy: approverUser._id,
    performedAt: new Date(),
    note: note || `Approved. Sanction ID: ${generatedSanctionId}`,
  });

  await sanction.save();
  return sanction;
};

/**
 * Reject sanction at any tier
 */
export const rejectSanction = async (sanctionId, user, reason) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;

  if (![SANCTION_STATUS.PENDING_CHECKER, SANCTION_STATUS.PENDING_APPROVER].includes(sanction.status)) {
    throw new Error('Sanction cannot be rejected at this stage');
  }

  sanction.status = SANCTION_STATUS.REJECTED;
  sanction.rejectionReason = reason;
  sanction.rejectedBy = user._id;
  sanction.rejectedAt = new Date();
  sanction.workflowHistory.push({
    action: 'REJECTED',
    performedBy: user._id,
    performedAt: new Date(),
    note: `Rejected: ${reason}`,
  });

  await sanction.save();
  return sanction;
};

/**
 * Forward sanctioned project to District
 */
export const forwardToDistrict = async (sanctionId, stateUser) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.SANCTIONED) {
    throw new Error('Only sanctioned projects can be forwarded to district');
  }

  sanction.status = SANCTION_STATUS.FORWARDED_TO_DISTRICT;
  sanction.forwardedToDistrict = sanction.district;
  sanction.forwardedToDistrictAt = new Date();
  sanction.forwardedToDistrictBy = stateUser._id;
  sanction.workflowHistory.push({
    action: 'FORWARDED_TO_DISTRICT',
    performedBy: stateUser._id,
    performedAt: new Date(),
    note: `Forwarded to ${sanction.district} district`,
  });

  await sanction.save();
  return sanction;
};

/**
 * District accepts sanction
 */
export const districtAccept = async (sanctionId, ddUser, fundAllocationOrder, allocatedAmountLakh) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.FORWARDED_TO_DISTRICT) {
    throw new Error('Sanction is not forwarded to district');
  }
  if (ddUser.district !== sanction.district) {
    throw new Error('You can only accept sanctions for your own district');
  }

  sanction.status = SANCTION_STATUS.DISTRICT_ACCEPTED;
  sanction.districtAcceptedBy = ddUser._id;
  sanction.districtAcceptedAt = new Date();
  if (fundAllocationOrder) {
    sanction.fundAllocationOrder = fundAllocationOrder;
  }
  sanction.allocatedAmountLakh = allocatedAmountLakh || sanction.totalSanctionedBudgetLakh;
  sanction.workflowHistory.push({
    action: 'DISTRICT_ACCEPTED',
    performedBy: ddUser._id,
    performedAt: new Date(),
    note: `Accepted by ${sanction.district} district`,
  });

  await sanction.save();
  return sanction;
};

/**
 * District forwards sanction to PIA
 */
export const forwardToPIA = async (sanctionId, ddUser, piaUserId) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.DISTRICT_ACCEPTED) {
    throw new Error('Sanction must be accepted by district before forwarding to PIA');
  }

  sanction.status = SANCTION_STATUS.FORWARDED_TO_PIA;
  sanction.forwardedToPIA = piaUserId;
  sanction.piaForwardedAt = new Date();
  sanction.piaForwardedBy = ddUser._id;
  sanction.workflowHistory.push({
    action: 'FORWARDED_TO_PIA',
    performedBy: ddUser._id,
    performedAt: new Date(),
    note: `Forwarded to PIA`,
  });

  await sanction.save();
  return sanction;
};

/**
 * PIA accepts sanction — Project becomes active
 */
export const piaAccept = async (sanctionId, piaUser) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.FORWARDED_TO_PIA) {
    throw new Error('Sanction is not forwarded to PIA');
  }
  if (sanction.forwardedToPIA.toString() !== piaUser._id.toString()) {
    throw new Error('This sanction is not assigned to you');
  }

  sanction.status = SANCTION_STATUS.PIA_ACCEPTED;
  sanction.isActive = true;
  sanction.piaAcceptedBy = piaUser._id;
  sanction.piaAcceptedAt = new Date();
  sanction.workflowHistory.push({
    action: 'PIA_ACCEPTED',
    performedBy: piaUser._id,
    performedAt: new Date(),
    note: 'PIA accepted. Project activated.',
  });

  await sanction.save();
  return sanction;
};

/**
 * Get active sanctions for PIA (for MPR entry)
 */
export const getActiveSanctionsForPIA = async (piaUserId) => {
  // Include FORWARDED_TO_PIA (pending acceptance) and PIA_ACCEPTED (active)
  return await ProjectSanction.find({
    forwardedToPIA: piaUserId,
    status: { $in: [SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED] },
  }).sort({ piaForwardedAt: -1 });
};

/**
 * Get sanctions list with filters
 */
export const getSanctions = async (filters, page = 1, limit = 10) => {
  const matchObj = {};
  if (filters.status) matchObj.status = filters.status;
  if (filters.district) matchObj.district = filters.district;
  if (filters.financialYear) matchObj.financialYear = filters.financialYear;
  if (filters.isActive !== undefined) matchObj.isActive = filters.isActive === 'true';

  const pipeline = [
    { $match: matchObj },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users', localField: 'makerUserId', foreignField: '_id', as: 'maker'
      }
    },
    { $unwind: { path: '$maker', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        sanctionId: 1, dprApplicationNo: 1, dprType: 1, projectTitle: 1,
        financialYear: 1, district: 1, department: 1, status: 1, isActive: 1,
        totalSanctionedBudgetLakh: 1, sarraShareLakh: 1, deptShareLakh: 1,
        createdAt: 1, approverAt: 1, piaAcceptedAt: 1,
        'maker.name': 1,
      }
    }
  ];

  return await paginate(ProjectSanction, pipeline, page, limit);
};

/**
 * Get sanctions for a specific district
 */
export const getSanctionsForDistrict = async (district, filters, page = 1, limit = 10) => {
  const matchObj = { district };
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      matchObj.status = { $in: filters.status };
    } else {
      matchObj.status = filters.status;
    }
  }

  const pipeline = [
    { $match: matchObj },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        sanctionId: 1, dprApplicationNo: 1, dprType: 1, projectTitle: 1,
        financialYear: 1, district: 1, department: 1, status: 1, isActive: 1,
        totalSanctionedBudgetLakh: 1, allocatedAmountLakh: 1,
        forwardedToDistrictAt: 1, districtAcceptedAt: 1, piaAcceptedAt: 1,
        forwardedToPIA: 1, createdAt: 1,
      }
    }
  ];

  const result = await paginate(ProjectSanction, pipeline, page, limit);

  for (const sanction of result.data) {
    const counts = await Promise.all([
      MPRPraroop1A.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1B.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1C.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1D.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' })
    ]);
    sanction.unreviewedMprCount = counts.reduce((a, b) => a + b, 0);
  }

  return result;
};

/**
 * Get sanction by ID with populated refs
 */
export const getSanctionById = async (id) => {
  const sanction = await ProjectSanction.findById(id)
    .populate('makerUserId', 'name email')
    .populate('checkerUserId', 'name email')
    .populate('approverUserId', 'name email')
    .populate('districtAcceptedBy', 'name email district')
    .populate('forwardedToPIA', 'name email department district')
    .populate('piaAcceptedBy', 'name email')
    .populate('workflowHistory.performedBy', 'name')
    .lean();
    
  if (sanction) {
    const counts = await Promise.all([
      MPRPraroop1A.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1B.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1C.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1D.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' })
    ]);
    sanction.unreviewedMprCount = counts.reduce((a, b) => a + b, 0);
  }
  
  return sanction;
};

/**
 * Get approved DPRs that don't have sanctions yet (for create sanction dropdown)
 */
export const getApprovedDPRsWithoutSanction = async (filters) => {
  return [];
};

/**
 * Get sanction analytics for dashboard
 */
export const getSanctionAnalytics = async (filters = {}) => {
  const matchObj = {};
  if (filters.financialYear) matchObj.financialYear = filters.financialYear;
  if (filters.district) matchObj.district = filters.district;

  const result = await ProjectSanction.aggregate([
    { $match: matchObj },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byDistrict: [
          {
            $group: {
              _id: '$district',
              total: { $sum: 1 },
              active: { $sum: { $cond: ['$isActive', 1, 0] } },
              totalBudget: { $sum: '$totalSanctionedBudgetLakh' },
            }
          }
        ],
        totals: [
          {
            $group: {
              _id: null,
              totalSanctions: { $sum: 1 },
              activeSanctions: { $sum: { $cond: ['$isActive', 1, 0] } },
              totalBudgetLakh: { $sum: '$totalSanctionedBudgetLakh' },
              totalSarraShareLakh: { $sum: '$sarraShareLakh' },
              totalDeptShareLakh: { $sum: '$deptShareLakh' },
            }
          }
        ],
      }
    }
  ]);

  return result[0];
};

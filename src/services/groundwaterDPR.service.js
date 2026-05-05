import GroundwaterDPR from '../models/GroundwaterDPR.model.js';
import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';
import paginate from '../utils/paginate.js';
import { createOrUpdateFlatSummary } from './groundwaterFlatSummary.service.js';
import mongoose from 'mongoose';

const generateGWAppNo = async (district) => {
  const currentYear = new Date().getFullYear();
  const districtCode = district.substring(0, 3).toUpperCase();
  
  const prefix = `SARRA-GW-${currentYear}-${districtCode}`;
  
  const lastDPR = await GroundwaterDPR.findOne({
    applicationNo: new RegExp(`^${prefix}`)
  }).sort({ applicationNo: -1 });

  let nextSequence = 1;
  if (lastDPR && lastDPR.applicationNo) {
    const lastSequenceMatch = lastDPR.applicationNo.match(/-(\d{5})$/);
    if (lastSequenceMatch) {
      nextSequence = parseInt(lastSequenceMatch[1], 10) + 1;
    }
  }

  const paddedSequence = nextSequence.toString().padStart(5, '0');
  return `${prefix}-${paddedSequence}`;
};

export const saveDraft = async (data, user, ip, userAgent) => {
  let draft = await GroundwaterDPR.findOne({
    submittedBy: user._id,
    status: 'DRAFT',
    isDraft: true
  });

  if (draft) {
    Object.assign(draft, data);
    draft.draftSavedAt = new Date();
    draft.ipAddress = ip;
    draft.userAgent = userAgent;
    await draft.save();
    return draft;
  }

  const newDraft = await GroundwaterDPR.create({
    ...data,
    submittedBy: user._id,
    submittedByDistrict: user.district,
    submittedByDepartment: user.department,
    status: 'DRAFT',
    isDraft: true,
    draftSavedAt: new Date(),
    ipAddress: ip,
    userAgent: userAgent
  });

  return newDraft;
};

export const submitForm = async (data, user, ip, userAgent) => {
  const applicationNo = await generateGWAppNo(user.district);
  
  let form = await GroundwaterDPR.findOne({
    submittedBy: user._id,
    status: 'DRAFT',
    isDraft: true
  });

  if (form) {
    Object.assign(form, data);
    form.applicationNo = applicationNo;
    form.status = 'SUBMITTED';
    form.isDraft = false;
    form.submittedAt = new Date();
    form.ipAddress = ip;
    form.userAgent = userAgent;
    await form.save();

    await createOrUpdateFlatSummary(form);

    return form;
  }

  const newForm = await GroundwaterDPR.create({
    ...data,
    applicationNo,
    submittedBy: user._id,
    submittedByDistrict: user.district,
    submittedByDepartment: user.department,
    status: 'SUBMITTED',
    isDraft: false,
    submittedAt: new Date(),
    ipAddress: ip,
    userAgent: userAgent
  });

  await createOrUpdateFlatSummary(newForm);

  return newForm;
};

export const getMyForms = async (userId, filters, page, limit) => {
  const matchObj = { submittedBy: userId };
  
  if (filters.status) {
    matchObj.status = filters.status;
  }

  const pipeline = [
    { $match: matchObj },
    { $sort: { createdAt: -1 } },
    { $project: {
        applicationNo: 1,
        status: 1,
        submittedAt: 1,
        draftSavedAt: 1,
        isDraft: 1,
        "section2_aquiferIdentification.district": 1,
        "section2_aquiferIdentification.blockTown": 1,
        "section2_aquiferIdentification.villages": 1,
        "section5_budgetAndPlan.table51.totalBudgetLakh": 1,
        createdAt: 1
      }
    }
  ];

  return await paginate(GroundwaterDPR, pipeline, page, limit);
};

export const getFormById = async (id, user) => {
  let resolvedId = id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    const summaryByAppNo = await DPRFlatSummary.findOne({
      applicationNo: id,
      formType: 'GROUNDWATER'
    }).select('dprId').lean();

    resolvedId = summaryByAppNo?.dprId || id;
  } else {
    const summaryMatch = await DPRFlatSummary.findOne({
      $or: [{ _id: id }, { dprId: id }],
      formType: 'GROUNDWATER'
    }).select('dprId').lean();

    resolvedId = summaryMatch?.dprId || id;
  }

  const form = await GroundwaterDPR.findById(resolvedId)
    .populate('submittedBy', 'name email department')
    .populate('reviewedBy', 'name');

  if (!form) return null;

  if (user.role === 'PIA_OFFICER' && form.submittedBy._id.toString() !== user._id.toString()) {
    return null;
  }

  if (user.role === 'DD_LEVEL' && form.submittedByDistrict !== user.district) {
    return null;
  }

  return form;
};

export const resubmitForm = async (id, user, updateData) => {
  const form = await GroundwaterDPR.findById(id);
  
  if (!form) return null;
  if (form.submittedBy.toString() !== user._id.toString()) return false;
  if (form.status !== 'REJECTED') return false;

  Object.assign(form, updateData);
  form.status = 'RESUBMITTED';
  form.rejectionCount += 1;
  form.revisionHistory.push({
    status: 'RESUBMITTED',
    changedBy: user._id,
    changedAt: new Date(),
    note: 'Form resubmitted'
  });

  await form.save();
  await createOrUpdateFlatSummary(form);
  return form;
};

export const getPendingFormsForDD = async (districtName, page, limit) => {
  const pipeline = [
    { 
      $match: { 
        submittedByDistrict: districtName, 
        status: { $in: ["SUBMITTED", "RESUBMITTED"] } 
      } 
    },
    { 
      $lookup: { 
        from: "users", 
        localField: "submittedBy", 
        foreignField: "_id", 
        as: "officerInfo" 
      } 
    },
    { $unwind: "$officerInfo" },
    { 
      $addFields: { 
        daysWaiting: { 
          $divide: [{ $subtract: [new Date(), "$submittedAt"] }, 86400000] 
        }
      }
    },
    { $sort: { daysWaiting: -1 } },
    {
      $project: {
        applicationNo: 1,
        status: 1,
        submittedAt: 1,
        daysWaiting: 1,
        "section1_deptDetails.department": 1,
        "section2_aquiferIdentification.blockTown": 1,
        "officerInfo.name": 1,
        "officerInfo.email": 1,
        "officerInfo.phone": 1
      }
    }
  ];

  return await paginate(GroundwaterDPR, pipeline, page, limit);
};

export const getAnalyticsOverview = async () => {
  const result = await GroundwaterDPR.aggregate([
    {
      $facet: {
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        byDistrict: [
          { 
            $group: { 
              _id: "$submittedByDistrict", 
              total: { $sum: 1 },
              approved: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } },
              rejected: { $sum: { $cond: [{ $eq: ["$status", "REJECTED"] }, 1, 0] } }
            }
          }
        ],
        byDepartment: [
          { $group: { _id: "$submittedByDepartment", count: { $sum: 1 } } }
        ],
        byMonth: [
          { $match: { createdAt: { $gte: new Date(Date.now() - 365 * 86400000) } } },
          { 
            $group: { 
              _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              count: { $sum: 1 } 
            } 
          },
          { $sort: { _id: 1 } }
        ],
        avgApprovalTime: [
          { $match: { status: "APPROVED", approvedAt: { $exists: true } } },
          { 
            $project: { 
              days: { $divide: [{ $subtract: ["$approvedAt", "$submittedAt"] }, 86400000] }
            }
          },
          { $group: { _id: null, avg: { $avg: "$days" } } }
        ],
        pendingOlderThan7Days: [
          { 
            $match: { 
              status: { $in: ["SUBMITTED", "RESUBMITTED"] },
              submittedAt: { $lte: new Date(Date.now() - 7 * 86400000) }
            } 
          },
          { $count: "count" }
        ]
      }
    }
  ]);

  return result[0];
};

export const approveForm = async (id, user) => {
  const form = await GroundwaterDPR.findById(id);
  if (!form) return null;
  if (user.role === 'DD_LEVEL' && form.submittedByDistrict !== user.district) return false;

  form.status = 'APPROVED';
  form.reviewedBy = user._id;
  form.reviewedAt = new Date();
  form.approvedAt = new Date();
  form.revisionHistory.push({
    status: 'APPROVED',
    changedBy: user._id,
    changedAt: new Date(),
    note: 'Form approved'
  });

  await form.save();
  await createOrUpdateFlatSummary(form);
  return form;
};

export const rejectForm = async (id, user, rejectionReason) => {
  const form = await GroundwaterDPR.findById(id);
  if (!form) return null;
  if (user.role === 'DD_LEVEL' && form.submittedByDistrict !== user.district) return false;

  form.status = 'REJECTED';
  form.reviewedBy = user._id;
  form.reviewedAt = new Date();
  form.rejectionReason = rejectionReason;
  form.revisionHistory.push({
    status: 'REJECTED',
    changedBy: user._id,
    changedAt: new Date(),
    note: `Form rejected: ${rejectionReason}`
  });

  await form.save();
  await createOrUpdateFlatSummary(form);
  return form;
};

export const updateStatus = async (id, user, status) => {
  const form = await GroundwaterDPR.findById(id);
  if (!form) return null;
  if (user.role === 'DD_LEVEL' && form.submittedByDistrict !== user.district) return false;

  form.status = status;
  await form.save();
  return form;
};

export const deleteForm = async (id, user) => {
  const form = await GroundwaterDPR.findById(id);
  if (!form) return null;
  if (form.submittedBy.toString() !== user._id.toString()) return false;
  if (form.status !== 'DRAFT') return false;

  await form.deleteOne();
  return true;
};

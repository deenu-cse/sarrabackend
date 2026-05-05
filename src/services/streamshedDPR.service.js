import StreamshedDPR from '../models/StreamshedDPR.model.js';
import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';
import { validateStreamshedDPR } from '../validators/streamshedDPR.validator.js';
import { DPR_STATUS } from '../constants/status.constants.js';
import { createOrUpdateFlatSummary } from './streamshedFlatSummary.service.js';
import mongoose from 'mongoose';

const generateAppNo = async (district) => {
  const year = new Date().getFullYear();
  const districtCode = district ? district.substring(0, 3).toUpperCase() : 'UNK';
  const prefix = `SARRA-STR-${year}-${districtCode}-`;

  const lastDpr = await StreamshedDPR.findOne(
    { applicationNo: new RegExp(`^${prefix}`) },
    { applicationNo: 1 }
  ).sort({ applicationNo: -1 });

  let seq = 1;
  if (lastDpr && lastDpr.applicationNo) {
    const lastSeqStr = lastDpr.applicationNo.replace(prefix, '');
    const lastSeq = parseInt(lastSeqStr, 10);
    if (!isNaN(lastSeq)) {
      seq = lastSeq + 1;
    }
  }

  return `${prefix}${String(seq).padStart(5, '0')}`;
};

export const saveDraft = async (userId, userDistrict, userDept, formData, ip, ua) => {
  let dpr;
  if (formData._id) {
    dpr = await StreamshedDPR.findOne({ _id: formData._id, submittedBy: userId });
    if (!dpr) throw new Error('DPR not found or unauthorized');
    if (![DPR_STATUS.DRAFT, DPR_STATUS.RETURNED].includes(dpr.status)) {
      throw new Error('Cannot save draft for submitted form');
    }
  } else {
    dpr = new StreamshedDPR({
      submittedBy: userId,
      submittedByDistrict: userDistrict,
      submittedByDepartment: userDept,
      status: DPR_STATUS.DRAFT,
      isDraft: true,
      applicationNo: `DRAFT-${Date.now()}`,
    });
  }

  Object.assign(dpr, formData);
  dpr.draftSavedAt = new Date();
  dpr.ipAddress = ip;
  dpr.userAgent = ua;

  await dpr.save();
  return dpr;
};

export const submitForm = async (userId, userDistrict, userDept, formData, ip, ua) => {
  const { error } = validateStreamshedDPR(formData);
  if (error) {
    throw new Error(`Validation Error: ${error.details.map((x) => x.message).join(', ')}`);
  }

  let dpr;
  if (formData._id) {
    dpr = await StreamshedDPR.findOne({ _id: formData._id, submittedBy: userId });
    if (!dpr) throw new Error('DPR not found or unauthorized');
    if (![DPR_STATUS.DRAFT, DPR_STATUS.RETURNED].includes(dpr.status)) {
      throw new Error('Form already submitted');
    }
  } else {
    dpr = new StreamshedDPR({
      submittedBy: userId,
      submittedByDistrict: userDistrict,
      submittedByDepartment: userDept,
    });
  }

  const appNo = await generateAppNo(userDistrict);
  
  Object.assign(dpr, formData);
  dpr.applicationNo = appNo;
  dpr.status = DPR_STATUS.SUBMITTED;
  dpr.isDraft = false;
  dpr.submittedAt = new Date();
  dpr.ipAddress = ip;
  dpr.userAgent = ua;

  await dpr.save();
  await createOrUpdateFlatSummary(dpr);
  return dpr;
};

export const getMyForms = async (userId, filters = {}, page = 1, limit = 10) => {
  const query = { submittedBy: userId, ...filters };
  const skip = (page - 1) * limit;

  const [forms, total] = await Promise.all([
    StreamshedDPR.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    StreamshedDPR.countDocuments(query),
  ]);

  return { forms, total, pages: Math.ceil(total / limit) };
};

export const getFormById = async (formId, requestingUser) => {
  let resolvedId = formId;

  if (!mongoose.Types.ObjectId.isValid(formId)) {
    const summaryByAppNo = await DPRFlatSummary.findOne({
      applicationNo: formId,
      formType: 'STREAMSHED'
    }).select('dprId').lean();

    resolvedId = summaryByAppNo?.dprId || formId;
  } else {
    const summaryMatch = await DPRFlatSummary.findOne({
      $or: [{ _id: formId }, { dprId: formId }],
      formType: 'STREAMSHED'
    }).select('dprId').lean();

    resolvedId = summaryMatch?.dprId || formId;
  }

  const form = await StreamshedDPR.findById(resolvedId)
    .populate('submittedBy', 'name email mobile role')
    .populate('reviewedBy', 'name email role')
    .lean();

  if (!form) throw new Error('Form not found');

  if (
    requestingUser.role === 'PIA_OFFICER' &&
    form.submittedBy._id.toString() !== requestingUser._id.toString()
  ) {
    throw new Error('Unauthorized access to this form');
  }

  if (
    requestingUser.role === 'DD_LEVEL' &&
    form.submittedByDistrict !== requestingUser.district
  ) {
    throw new Error('Unauthorized access to this district form');
  }

  return form;
};

export const getDistrictPendingForms = async (districtName, page = 1, limit = 10) => {
  const query = {
    submittedByDistrict: districtName,
    status: DPR_STATUS.SUBMITTED,
    isDraft: false,
  };
  const skip = (page - 1) * limit;

  const [forms, total] = await Promise.all([
    StreamshedDPR.find(query)
      .populate('submittedBy', 'name department')
      .sort({ submittedAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StreamshedDPR.countDocuments(query),
  ]);

  return { forms, total, pages: Math.ceil(total / limit) };
};

export const approveForm = async (formId, reviewerId) => {
  const form = await StreamshedDPR.findById(formId);
  if (!form) throw new Error('Form not found');
  if (form.status !== DPR_STATUS.SUBMITTED) throw new Error('Only submitted forms can be approved');

  form.status = DPR_STATUS.APPROVED;
  form.reviewedBy = reviewerId;
  form.approvedAt = new Date();

  await form.save();
  await createOrUpdateFlatSummary(form);
  return form;
};

export const rejectForm = async (formId, reviewerId, reason) => {
  const form = await StreamshedDPR.findById(formId);
  if (!form) throw new Error('Form not found');
  if (form.status !== DPR_STATUS.SUBMITTED) throw new Error('Only submitted forms can be rejected/returned');

  form.status = DPR_STATUS.RETURNED;
  form.reviewedBy = reviewerId;
  form.reviewedAt = new Date();
  form.rejectionReason = reason;
  form.rejectionCount += 1;

  form.revisionHistory.push({
    status: DPR_STATUS.RETURNED,
    changedBy: reviewerId,
    changedAt: new Date(),
    note: reason,
  });

  await form.save();
  await createOrUpdateFlatSummary(form);
  return form;
};

export const resubmitForm = async (formId, userId, formData) => {
  const { error } = validateStreamshedDPR(formData);
  if (error) {
    throw new Error(`Validation Error: ${error.details.map((x) => x.message).join(', ')}`);
  }

  const form = await StreamshedDPR.findOne({ _id: formId, submittedBy: userId });
  if (!form) throw new Error('Form not found or unauthorized');
  if (form.status !== DPR_STATUS.RETURNED) throw new Error('Only returned forms can be resubmitted');

  form.revisionHistory.push({
    status: DPR_STATUS.SUBMITTED,
    changedBy: userId,
    changedAt: new Date(),
    note: 'Form resubmitted with corrections',
  });

  Object.assign(form, formData);
  form.status = DPR_STATUS.SUBMITTED;
  form.submittedAt = new Date();
  form.rejectionReason = undefined;

  await form.save();
  await createOrUpdateFlatSummary(form);
  return form;
};

export const deleteForm = async (formId, userId) => {
  const form = await StreamshedDPR.findOne({ _id: formId, submittedBy: userId });
  if (!form) throw new Error('Form not found or unauthorized');
  if (!form.isDraft) throw new Error('Only draft forms can be deleted');

  await StreamshedDPR.deleteOne({ _id: formId });
  return true;
};

export const updateFormStatus = async (formId, newStatus, reviewerId) => {
  const form = await StreamshedDPR.findById(formId);
  if (!form) throw new Error('Form not found');

  // Only allow UNDER_REVIEW transition from SUBMITTED/RESUBMITTED
  if (newStatus === 'UNDER_REVIEW' && !['SUBMITTED', 'RESUBMITTED'].includes(form.status)) {
    return form; // silently return — already past this state
  }

  form.status = newStatus;
  if (reviewerId) form.reviewedBy = reviewerId;
  form.reviewedAt = new Date();

  await form.save();
  return form;
};


import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Monthly Progress Report for one department of one project.
 *
 * One document = one reporting month. It replaces the per-head "Praroop"
 * collections for project reporting: the Head is a field, so the same model
 * serves the 55-(1-3) and the 55(4) form.
 *
 * Targets and "progress up to previous month" are written by the server when
 * the report is saved (from the project and from earlier reports); they are a
 * snapshot for the record, never an input.
 *
 * Approval chain (three tiers, each Maker → Checker → Approver):
 *
 *   PIA entry       Draft → PIA Checker → PIA Approver → District Maker → District Checker
 *                   → District Approver → HQ Maker → HQ Checker → HQ Approver → Verified by State
 *   District entry  Draft (District Technical Staff) → District Checker → District Approver
 *                   → HQ Maker → HQ Checker → HQ Approver → Verified by State
 *
 * Any reviewer can return the report to its reporting Maker with remarks; it
 * then goes through its whole chain again. An Approver can reject it, which
 * voids the report and lets the month be reported afresh.
 */

export const PROJECT_MPR_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_PIA_CHECKER: 'PENDING_PIA_CHECKER',
  PENDING_PIA_APPROVER: 'PENDING_PIA_APPROVER',
  SUBMITTED_TO_DISTRICT: 'SUBMITTED_TO_DISTRICT',
  PENDING_DISTRICT_CHECKER: 'PENDING_DISTRICT_CHECKER',
  PENDING_DISTRICT_APPROVER: 'PENDING_DISTRICT_APPROVER',
  SUBMITTED_TO_HQ: 'SUBMITTED_TO_HQ',
  PENDING_HQ_CHECKER: 'PENDING_HQ_CHECKER',
  PENDING_HQ_APPROVER: 'PENDING_HQ_APPROVER',
  VERIFIED_BY_STATE: 'VERIFIED_BY_STATE',
  RETURNED_FOR_CORRECTION: 'RETURNED_FOR_CORRECTION',
  REJECTED: 'REJECTED',
};

export const MPR_STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING_PIA_CHECKER: 'Pending PIA Checker',
  PENDING_PIA_APPROVER: 'Pending PIA Approver',
  SUBMITTED_TO_DISTRICT: 'Submitted to District',
  PENDING_DISTRICT_CHECKER: 'Pending District Checker',
  PENDING_DISTRICT_APPROVER: 'Pending District Approver',
  SUBMITTED_TO_HQ: 'Submitted to HQ',
  PENDING_HQ_CHECKER: 'Pending HQ Checker',
  PENDING_HQ_APPROVER: 'Pending HQ Approver',
  VERIFIED_BY_STATE: 'Verified by State',
  RETURNED_FOR_CORRECTION: 'Returned for Correction',
  REJECTED: 'Rejected',
};

/** Who prepared the report: the PIA, or District Technical Staff on its behalf. */
export const MPR_ENTRY_MODE = { PIA: 'PIA', DISTRICT: 'DISTRICT' };

export const MPR_FORM_TYPE = {
  HEAD_55_1_TO_3: '55-(1-3)',
  HEAD_55_4: '55(4)',
  HEAD_55_5: '55(5)',
};

const activityProgressSchema = new mongoose.Schema({
  activityCode: { type: String, required: true },
  activityName: { type: String, required: true },
  unit: String,
  hasPhysical: { type: Boolean, default: true },
  allowsDecimal: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },

  physicalTarget: { type: Number, default: 0, min: 0 },
  physicalPrevious: { type: Number, default: 0, min: 0 },
  physicalCurrent: { type: Number, default: 0, min: 0 },
  physicalTotal: { type: Number, default: 0, min: 0 },

  financialTargetLakh: { type: Number, default: 0, min: 0 },
  financialPreviousLakh: { type: Number, default: 0, min: 0 },
  financialCurrentLakh: { type: Number, default: 0, min: 0 },
  financialTotalLakh: { type: Number, default: 0, min: 0 },
}, { _id: false });

// One step of the approval chain, as taken in the current submission cycle.
const stepSchema = new mongoose.Schema({
  by: { type: ObjectId, ref: 'User' },
  at: Date,
  note: String,
}, { _id: false });

const projectMprSchema = new mongoose.Schema({
  mprNo: { type: String, unique: true, sparse: true },

  project: { type: ObjectId, ref: 'ProjectSanction', required: true },
  projectCode: String,
  sanctionCode: String,
  projectTitle: String,
  district: { type: String, required: true, index: true },
  // Location snapshot, so every report carries District, Block, Gram Panchayat and Village
  location: {
    block: String,
    gramPanchayat: String,
    village: String,
  },

  departmentId: { type: ObjectId, ref: 'Department', required: true },
  departmentName: { type: String, required: true },
  // The PIA (implementing agency officer) of the department when the report was made
  pia: {
    userId: { type: ObjectId, ref: 'User' },
    name: String,
  },

  head: {
    headId: { type: ObjectId, ref: 'BudgetHead' },
    code: { type: String, required: true },
    name: String,
  },
  formType: { type: String, enum: Object.values(MPR_FORM_TYPE), required: true },
  entryMode: { type: String, enum: Object.values(MPR_ENTRY_MODE), default: MPR_ENTRY_MODE.PIA },

  // Reporting period. `periodIndex` = calendar year * 12 + month, so periods sort and compare as numbers.
  financialYear: { type: String, required: true }, // e.g. "2026-27"
  fyStartYear: { type: Number, required: true },
  reportingMonth: { type: String, required: true }, // e.g. "April"
  periodIndex: { type: Number, required: true },

  status: { type: String, enum: Object.values(PROJECT_MPR_STATUS), default: PROJECT_MPR_STATUS.DRAFT, index: true },
  // When the report reached its current status (for "waiting since" and review reminders)
  stageEnteredAt: Date,

  activities: [activityProgressSchema],
  totals: {
    activities: { type: Number, default: 0 },
    activitiesCompleted: { type: Number, default: 0 },
    activitiesInProgress: { type: Number, default: 0 },
    activitiesNotStarted: { type: Number, default: 0 },
    physicalPercent: { type: Number, default: 0 },
    financialTargetLakh: { type: Number, default: 0 },
    financialPreviousLakh: { type: Number, default: 0 },
    financialCurrentLakh: { type: Number, default: 0 },
    financialTotalLakh: { type: Number, default: 0 },
    financialRemainingLakh: { type: Number, default: 0 },
    financialPercent: { type: Number, default: 0 },
  },
  remarks: { type: String, trim: true, maxlength: 1000 },
  // Supporting files (site photographs, measurement sheets)
  evidence: [{
    url: String,
    publicId: String,
    name: String,
    mimeType: String,
    size: Number,
    caption: { type: String, trim: true, maxlength: 200 },
    uploadedBy: { type: ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  }],

  // The reporting Maker: created the report and is the only one who may correct it
  submittedBy: { type: ObjectId, ref: 'User', required: true, index: true },
  submittedAt: Date,

  // Who took each step of the current cycle. Cleared when the report is returned.
  steps: {
    piaChecker: stepSchema,
    piaApprover: stepSchema,
    districtMaker: stepSchema,
    districtChecker: stepSchema,
    districtApprover: stepSchema,
    hqMaker: stepSchema,
    hqChecker: stepSchema,
    hqApprover: stepSchema,
  },

  // District approval (kept as separate fields for lists and official documents)
  reviewedBy: { type: ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: String,
  // Final verification by the HQ Approver
  verifiedBy: { type: ObjectId, ref: 'User' },
  verifiedAt: Date,
  verificationNote: String,

  returnReason: String,
  returnedByLevel: { type: String, enum: ['PIA', 'DISTRICT', 'STATE'] },
  returnedByRole: String,
  returnedBy: { type: ObjectId, ref: 'User' },
  returnedAt: Date,

  rejectionReason: String,
  rejectedBy: { type: ObjectId, ref: 'User' },
  rejectedAt: Date,
  rejectedByRole: String,
  // null for a live report; the report's own id once rejected, so the month can be reported again
  rejectedKey: { type: String, default: null },

  // Audit trail: every action with user, designation, date, time and remarks
  revisionHistory: [{
    status: String,
    action: String,
    level: String,
    role: String,
    designation: String,
    changedBy: { type: ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    note: String,
    _id: false,
  }],
}, { timestamps: true });

// One live report per project + department + head + financial year + month, whichever entry
// mode is used. Rejected reports carry their own `rejectedKey` and fall out of this rule.
projectMprSchema.index(
  { project: 1, departmentId: 1, 'head.code': 1, financialYear: 1, reportingMonth: 1, rejectedKey: 1 },
  { unique: true, name: 'one_live_report_per_month' },
);
projectMprSchema.index({ project: 1, departmentId: 1, periodIndex: 1 });
projectMprSchema.index({ district: 1, status: 1, submittedAt: -1 });
projectMprSchema.index({ financialYear: 1, status: 1, submittedAt: -1 });

const ProjectMPR = mongoose.model('ProjectMPR', projectMprSchema);
export default ProjectMPR;

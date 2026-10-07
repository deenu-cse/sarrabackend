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
 */

export const PROJECT_MPR_STATUS = {
  SUBMITTED: 'SUBMITTED',
  DISTRICT_APPROVED: 'DISTRICT_APPROVED',
  RETURNED_TO_PIA: 'RETURNED_TO_PIA',
  STATE_VERIFIED: 'STATE_VERIFIED',
};

export const MPR_FORM_TYPE = {
  HEAD_55_1_TO_3: '55-(1-3)',
  HEAD_55_4: '55(4)',
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

const projectMprSchema = new mongoose.Schema({
  mprNo: { type: String, unique: true, sparse: true },

  project: { type: ObjectId, ref: 'ProjectSanction', required: true },
  projectCode: String,
  projectTitle: String,
  district: { type: String, required: true, index: true },

  departmentId: { type: ObjectId, ref: 'Department', required: true },
  departmentName: { type: String, required: true },

  head: {
    headId: { type: ObjectId, ref: 'BudgetHead' },
    code: { type: String, required: true },
    name: String,
  },
  formType: { type: String, enum: Object.values(MPR_FORM_TYPE), required: true },

  // Reporting period. `periodIndex` = calendar year * 12 + month, so periods sort and compare as numbers.
  financialYear: { type: String, required: true }, // e.g. "2026-27"
  fyStartYear: { type: Number, required: true },
  reportingMonth: { type: String, required: true }, // e.g. "April"
  periodIndex: { type: Number, required: true },

  status: { type: String, enum: Object.values(PROJECT_MPR_STATUS), default: PROJECT_MPR_STATUS.SUBMITTED, index: true },

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
  // Optional supporting files (site photographs, measurement sheets)
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

  submittedBy: { type: ObjectId, ref: 'User', required: true, index: true },
  submittedAt: Date,
  reviewedBy: { type: ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: String,
  returnReason: String,
  returnedByLevel: { type: String, enum: ['DISTRICT', 'STATE'] },
  // State (M&E) verification after district approval
  verifiedBy: { type: ObjectId, ref: 'User' },
  verifiedAt: Date,
  verificationNote: String,
  revisionHistory: [{
    status: String,
    changedBy: { type: ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    note: String,
    _id: false,
  }],
}, { timestamps: true });

// One report per project + department + head + financial year + month. The
// database refuses a duplicate even if two requests arrive at the same instant.
projectMprSchema.index(
  { project: 1, departmentId: 1, 'head.code': 1, financialYear: 1, reportingMonth: 1 },
  { unique: true },
);
projectMprSchema.index({ project: 1, departmentId: 1, periodIndex: 1 });
projectMprSchema.index({ district: 1, status: 1, submittedAt: -1 });
projectMprSchema.index({ financialYear: 1, status: 1, submittedAt: -1 });

const ProjectMPR = mongoose.model('ProjectMPR', projectMprSchema);
export default ProjectMPR;

import mongoose from 'mongoose';
import { SANCTION_STATUS } from '../constants/status.constants.js';

/** Who prepares a department's Monthly Progress Report. */
export const REPORTING_MODE = {
  PIA: 'PIA', // the PIA Maker, approved by the PIA Checker and Approver
  DISTRICT: 'DISTRICT', // District Technical Staff (a District Maker) on behalf of the PIA
};

const sanctionedTargetSchema = new mongoose.Schema({
  activityId: String,
  activityLabel: String,
  unit: String,
  physicalTarget: { type: Number, default: 0 },
  financialAmountLakh: { type: Number, default: 0 },
}, { _id: false });

// Planned target for one Head activity within one department's allocation
const departmentActivitySchema = new mongoose.Schema({
  activityCode: { type: String, required: true },
  activityName: { type: String, required: true },
  unit: String,
  physicalTarget: { type: Number, default: 0, min: 0 },
  financialTargetLakh: { type: Number, default: 0, min: 0 },
}, { _id: false });

// One PIA department: its fund split and its activity plan
const departmentAllocationSchema = new mongoose.Schema({
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  departmentName: { type: String, required: true },
  deptShareLakh: { type: Number, default: 0, min: 0 },
  sarraShareLakh: { type: Number, default: 0, min: 0 },
  totalLakh: { type: Number, default: 0, min: 0 },
  activityFinancialTotalLakh: { type: Number, default: 0, min: 0 },
  activities: [departmentActivitySchema],
  // PIA Maker of this department, assigned by the District Maker. Reports its progress when the reporting mode is PIA.
  piaUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  piaAssignedAt: Date,
  piaAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  piaAcceptedAt: Date,
  // Officers who held this department before the current one (transfers / handing over charge)
  piaHistory: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    assignedAt: Date,
    acceptedAt: Date,
    relievedAt: Date,
    relievedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    _id: false,
  }],
  // MPR reporting responsibility, set by the District Maker before any report is filed.
  // One department has one reporting Maker at a time, so a month can only ever be reported once.
  reportingMode: { type: String, enum: Object.values(REPORTING_MODE), default: REPORTING_MODE.PIA },
  // District Technical Staff (a District Maker) mapped to the department; reports it in DISTRICT mode.
  districtStaffUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reportingAssignedAt: Date,
  reportingAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Where this department's completion report stands (the report itself is a ProjectCompletion)
  completion: {
    status: { type: String, enum: ['SUBMITTED', 'DISTRICT_VERIFIED', 'RETURNED'] },
    completionDate: Date,
    submittedAt: Date,
    verifiedAt: Date,
  },
}, { _id: false });

const workflowStepSchema = new mongoose.Schema({
  // BUDGET_REVERSED only appears in the history of projects from before budget allocation was removed.
  action: { type: String, enum: ['CREATED', 'CHECKER_VERIFIED', 'APPROVED', 'REJECTED', 'FORWARDED_TO_DISTRICT', 'DISTRICT_ACCEPTED', 'FORWARDED_TO_PIA', 'REPORTING_ASSIGNED', 'PIA_ACCEPTED', 'RETURNED', 'RESUBMITTED', 'REVISED', 'PIA_TRANSFERRED', 'BUDGET_REVERSED', 'COMPLETION_SUBMITTED', 'COMPLETION_VERIFIED', 'COMPLETION_RETURNED', 'CLOSED'] },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedAt: { type: Date, default: Date.now },
  // Snapshot of who acted, as they were at that moment (e.g. "HQ Checker", "Executive Engineer")
  role: String,
  designation: String,
  note: String,
}, { _id: false });

const projectSanctionSchema = new mongoose.Schema({
  sanctionId: {
    type: String,
    unique: true,
    sparse: true,
  },
  // Permanent, backend-generated Project ID (e.g. SARRA-2026-DEH-00002)
  projectId: {
    type: String,
    unique: true,
    sparse: true,
  },
  // Link to approved DPR (optional now since projects can be created directly)
  dprId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  dprType: {
    type: String,
    enum: ['SPRINGSHED', 'STREAMSHED', 'GROUNDWATER'],
  },
  dprApplicationNo: {
    type: String,
  },
  projectType: {
    type: String,
    enum: ['SPRINGSHED', 'STREAMSHED', 'GROUNDWATER'],
    required: true,
  },

  // Core info
  projectTitle: String,
  financialYear: { type: String, required: true },
  district: { type: String, required: true },
  department: { type: String },

  // Location hierarchy (names are snapshotted so history survives master edits)
  location: {
    districtId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    district: String,
    blockId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    block: String,
    gramPanchayatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    gramPanchayat: String,
    villageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    village: String,
  },

  // Committee approval dates
  approvalDates: {
    dlec: Date,
    slec: Date,
    hpc: Date,
  },

  // PIA departments, budget head and department-wise plan
  numberOfPIA: { type: Number, min: 1, max: 10 },
  head: {
    headId: { type: mongoose.Schema.Types.ObjectId, ref: 'BudgetHead' },
    code: String,
    name: String,
  },
  departmentAllocations: [departmentAllocationSchema],

  // Optimistic lock for monthly progress reports filed against this project
  mprVersion: { type: Number, default: 0 },

  // Status
  status: {
    type: String,
    enum: Object.values(SANCTION_STATUS),
    default: SANCTION_STATUS.DRAFT,
  },
  isActive: {
    type: Boolean,
    default: false,
  },

  // Sanctioned targets (component-wise)
  sanctionedTargets: [sanctionedTargetSchema],
  totalSanctionedBudgetLakh: { type: Number, default: 0 },
  deptShareLakh: { type: Number, default: 0 },
  sarraShareLakh: { type: Number, default: 0 },

  // 3-Tier Workflow: Maker
  makerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  makerNote: String,
  makerAt: Date,

  // 3-Tier Workflow: Checker
  checkerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  checkerNote: String,
  checkerAt: Date,

  // 3-Tier Workflow: Approver
  approverUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approverNote: String,
  approverAt: Date,

  // Rejection
  rejectionReason: String,
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedAt: Date,

  // Documents
  secretariatApprovalOrder: { url: String, publicId: String },
  stateSanctionOrder: { url: String, publicId: String },

  // District Forwarding
  forwardedToDistrict: String,
  forwardedToDistrictAt: Date,
  forwardedToDistrictBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // District Acceptance
  districtAcceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  districtAcceptedAt: Date,

  // PIA Forwarding
  forwardedToPIA: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  piaForwardedAt: Date,
  piaForwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // PIA Acceptance
  piaAcceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  piaAcceptedAt: Date,

  // Closure: set by the HQ Approver once every department's completion report is verified by the district
  closure: {
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    closedAt: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
    sanctionedLakh: Number,
    expenditureLakh: Number,
    // Sanctioned but not spent when the project closed
    balanceLakh: Number,
  },

  // Audit trail
  workflowHistory: [workflowStepSchema],

}, { timestamps: true });

// Indexes (sanctionId and projectId are indexed by their unique field definitions)
projectSanctionSchema.index({ status: 1 });
projectSanctionSchema.index({ district: 1 });
projectSanctionSchema.index({ dprId: 1 });
projectSanctionSchema.index({ forwardedToPIA: 1, isActive: 1 });
projectSanctionSchema.index({ 'departmentAllocations.piaUserId': 1 });
projectSanctionSchema.index({ 'departmentAllocations.districtStaffUserId': 1 });
projectSanctionSchema.index({ district: 1, status: 1 });
projectSanctionSchema.index({ financialYear: 1 });
projectSanctionSchema.index({ 'closure.status': 1 });

const ProjectSanction = mongoose.model('ProjectSanction', projectSanctionSchema);
export default ProjectSanction;

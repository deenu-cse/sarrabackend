import mongoose from 'mongoose';
import { SANCTION_STATUS } from '../constants/status.constants.js';

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
  // PIA officer of this department, assigned by the district. Only this officer may report its progress.
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
  // Where this department's completion report stands (the report itself is a ProjectCompletion)
  completion: {
    status: { type: String, enum: ['SUBMITTED', 'DISTRICT_VERIFIED', 'RETURNED'] },
    completionDate: Date,
    submittedAt: Date,
    verifiedAt: Date,
  },
}, { _id: false });

const workflowStepSchema = new mongoose.Schema({
  action: { type: String, enum: ['CREATED', 'CHECKER_VERIFIED', 'APPROVED', 'REJECTED', 'FORWARDED_TO_DISTRICT', 'DISTRICT_ACCEPTED', 'FORWARDED_TO_PIA', 'PIA_ACCEPTED', 'RETURNED', 'RESUBMITTED', 'REVISED', 'PIA_TRANSFERRED', 'BUDGET_REVERSED', 'COMPLETION_SUBMITTED', 'COMPLETION_VERIFIED', 'COMPLETION_RETURNED', 'CLOSED'] },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedAt: { type: Date, default: Date.now },
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

  // Budget released so far. A summary of the BudgetAllocationEntry records,
  // written in the same transaction as each allocation; `budgetVersion` is the
  // optimistic lock that stops two concurrent allocations both succeeding.
  budgetVersion: { type: Number, default: 0 },
  // Optimistic lock for monthly progress reports filed against this project
  mprVersion: { type: Number, default: 0 },
  budgetAllocation: {
    totalLakh: { type: Number, default: 0 },
    releasedLakh: { type: Number, default: 0 },
    remainingLakh: { type: Number, default: 0 },
    status: { type: String, enum: ['NOT_ALLOCATED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED'], default: 'NOT_ALLOCATED' },
    lastAllocatedAt: Date,
  },

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
  fundAllocationOrder: { url: String, publicId: String },
  allocatedAmountLakh: { type: Number, default: 0 },

  // PIA Forwarding
  forwardedToPIA: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  piaForwardedAt: Date,
  piaForwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // PIA Acceptance
  piaAcceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  piaAcceptedAt: Date,

  // Closure: set by the State Approver once every department's completion report is verified
  closure: {
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    closedAt: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
    sanctionedLakh: Number,
    releasedLakh: Number,
    expenditureLakh: Number,
    // Released but not spent: to be refunded to the State
    unspentLakh: Number,
    // Sanctioned but never released: lapses as a saving
    unreleasedLakh: Number,
    refundStatus: { type: String, enum: ['NOT_APPLICABLE', 'PENDING', 'RECORDED'] },
    refundReference: String,
    refundRecordedAt: Date,
    refundRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },

  // Audit trail
  workflowHistory: [workflowStepSchema],

}, { timestamps: true });

// Indexes
projectSanctionSchema.index({ sanctionId: 1 });
projectSanctionSchema.index({ status: 1 });
projectSanctionSchema.index({ district: 1 });
projectSanctionSchema.index({ dprId: 1 });
projectSanctionSchema.index({ forwardedToPIA: 1, isActive: 1 });
projectSanctionSchema.index({ 'departmentAllocations.piaUserId': 1 });
projectSanctionSchema.index({ district: 1, status: 1 });
projectSanctionSchema.index({ financialYear: 1 });
projectSanctionSchema.index({ 'closure.status': 1 });

const ProjectSanction = mongoose.model('ProjectSanction', projectSanctionSchema);
export default ProjectSanction;

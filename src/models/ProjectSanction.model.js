import mongoose from 'mongoose';
import { SANCTION_STATUS } from '../constants/status.constants.js';

const sanctionedTargetSchema = new mongoose.Schema({
  activityId: String,
  activityLabel: String,
  unit: String,
  physicalTarget: { type: Number, default: 0 },
  financialAmountLakh: { type: Number, default: 0 },
}, { _id: false });

const workflowStepSchema = new mongoose.Schema({
  action: { type: String, enum: ['CREATED', 'CHECKER_VERIFIED', 'APPROVED', 'REJECTED', 'FORWARDED_TO_DISTRICT', 'DISTRICT_ACCEPTED', 'FORWARDED_TO_PIA', 'PIA_ACCEPTED', 'RETURNED'] },
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

  // Audit trail
  workflowHistory: [workflowStepSchema],

}, { timestamps: true });

// Indexes
projectSanctionSchema.index({ sanctionId: 1 });
projectSanctionSchema.index({ status: 1 });
projectSanctionSchema.index({ district: 1 });
projectSanctionSchema.index({ dprId: 1 });
projectSanctionSchema.index({ forwardedToPIA: 1, isActive: 1 });
projectSanctionSchema.index({ district: 1, status: 1 });
projectSanctionSchema.index({ financialYear: 1 });

const ProjectSanction = mongoose.model('ProjectSanction', projectSanctionSchema);
export default ProjectSanction;

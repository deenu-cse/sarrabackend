import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const REVISION_STATUS = {
  PENDING_CHECKER: 'PENDING_CHECKER',
  PENDING_APPROVER: 'PENDING_APPROVER',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const figuresSchema = new mongoose.Schema({
  departmentId: { type: ObjectId, ref: 'Department', required: true },
  departmentName: String,
  deptShareLakh: Number,
  sarraShareLakh: Number,
  totalLakh: Number,
  activityFinancialTotalLakh: Number,
  activities: [{
    activityCode: String,
    activityName: String,
    unit: String,
    physicalTarget: Number,
    financialTargetLakh: Number,
    _id: false,
  }],
}, { _id: false });

/**
 * A revised estimate for a sanctioned project: new department shares and
 * activity targets. It goes through the same Maker → Checker → Approver chain
 * as the project and only changes the project when the Approver approves it.
 * `before` keeps what the project looked like, so every revision can be audited.
 */
const projectRevisionSchema = new mongoose.Schema({
  project: { type: ObjectId, ref: 'ProjectSanction', required: true, index: true },
  revisionNo: { type: Number, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: Object.values(REVISION_STATUS), default: REVISION_STATUS.PENDING_CHECKER, index: true },

  before: [figuresSchema],
  proposed: [figuresSchema],
  beforeTotalLakh: Number,
  proposedTotalLakh: Number,

  makerUserId: { type: ObjectId, ref: 'User', required: true },
  checkerUserId: { type: ObjectId, ref: 'User' },
  checkerNote: String,
  checkerAt: Date,
  approverUserId: { type: ObjectId, ref: 'User' },
  approverNote: String,
  approverAt: Date,
  rejectedBy: { type: ObjectId, ref: 'User' },
  rejectionReason: String,
  rejectedAt: Date,
}, { timestamps: true });

projectRevisionSchema.index({ project: 1, revisionNo: 1 }, { unique: true });

const ProjectRevision = mongoose.model('ProjectRevision', projectRevisionSchema);
export default ProjectRevision;

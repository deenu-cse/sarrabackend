import mongoose from 'mongoose';
import { H56_LEVELS } from './Head56Item.model.js';

export const H56_ALLOCATION_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_CHECKER: 'PENDING_CHECKER',
  PENDING_APPROVER: 'PENDING_APPROVER',
  RETURNED: 'RETURNED',
  PUBLISHED: 'PUBLISHED',
};

export const H56_ALLOCATION_STATUS_LABELS = {
  DRAFT: 'Draft (HQ Maker)',
  PENDING_CHECKER: 'Pending HQ Checker',
  PENDING_APPROVER: 'Pending HQ Approver',
  RETURNED: 'Returned to HQ Maker',
  PUBLISHED: 'Published',
};

/**
 * One line of an allocation. A PIA allocation carries the full target block of
 * the Prarup-2 format (unit, size, rate, departmental and SARRA share); HQ and
 * District allocations use the approved budget (`sarraShareLakh`) and, where the
 * line has one, a physical target.
 * Opening figures are the progress and SARRA expenditure up to the previous year.
 */
const lineSchema = new mongoose.Schema({
  code: { type: String, required: true },
  physicalTarget: { type: Number, default: 0, min: 0 },
  targetSize: { type: Number, default: 0, min: 0 },
  rate: { type: Number, default: 0, min: 0 },
  deptShareLakh: { type: Number, default: 0, min: 0 },
  sarraShareLakh: { type: Number, default: 0, min: 0 },
  openingPhysical: { type: Number, default: 0, min: 0 },
  openingSarraLakh: { type: Number, default: 0, min: 0 },
  note: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: false });

const historySchema = new mongoose.Schema({
  action: String,
  status: String,
  role: String,
  designation: String,
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now },
  note: String,
}, { _id: false });

/**
 * Approved Head 56 budget of one implementing unit for one financial year:
 * SARRA HQ, a District SARRA Centre, or a PIA (a department in a district).
 *
 * HQ Maker enters it, HQ Checker verifies it, HQ Approver approves and
 * publishes it. Monthly reports read only `published`; while a revision goes
 * through the same chain the published figures stay in force.
 */
const head56AllocationSchema = new mongoose.Schema({
  financialYear: { type: String, required: true },
  fyStartYear: { type: Number, required: true },
  level: { type: String, enum: Object.values(H56_LEVELS), required: true },
  // HQ | DISTRICT:<district> | PIA:<district>:<departmentId>
  unitKey: { type: String, required: true },
  unitName: { type: String, required: true },
  district: { type: String, default: null },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  departmentName: { type: String, default: null },

  status: { type: String, enum: Object.values(H56_ALLOCATION_STATUS), default: H56_ALLOCATION_STATUS.DRAFT },
  lines: { type: [lineSchema], default: [] },
  reason: { type: String, trim: true, maxlength: 1000, default: '' },

  published: {
    version: { type: Number, default: 0 },
    lines: { type: [lineSchema], default: undefined },
    publishedAt: Date,
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },

  makerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedAt: Date,
  checkerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  checkedAt: Date,
  checkerNote: String,
  returnReason: String,
  returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  returnedAt: Date,
  history: { type: [historySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

head56AllocationSchema.index({ financialYear: 1, unitKey: 1 }, { unique: true });
head56AllocationSchema.index({ financialYear: 1, status: 1 });
head56AllocationSchema.index({ district: 1, financialYear: 1 });

const Head56Allocation = mongoose.model('Head56Allocation', head56AllocationSchema);
export default Head56Allocation;

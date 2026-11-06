import mongoose from 'mongoose';
import { PROJECT_MPR_STATUS } from './ProjectMPR.model.js';
import { H56_LEVELS } from './Head56Item.model.js';

/** Supporting document types a Head 56 Maker can attach. */
export const H56_DOC_TYPES = {
  BILL: 'Bill',
  VOUCHER: 'Voucher',
  WORK_ORDER: 'Work order',
  SANCTION_ORDER: 'Sanction / payment order',
  ATTENDANCE: 'Attendance / honorarium sheet',
  OTHER: 'Other',
};

/**
 * One line of the Prarup-2 format, as it stood when the report was saved:
 * the targets come from the published allocation, "previous" figures from the
 * unit's earlier reports of the year, "current" figures from the Maker.
 */
const lineSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  nameHindi: { type: String, default: '' },
  parentCode: { type: String, default: null },
  unit: { type: String, default: '' },
  hasPhysical: { type: Boolean, default: false },
  allowsDecimal: { type: Boolean, default: false },
  physicalTarget: { type: Number, default: 0 },
  targetSize: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  deptShareLakh: { type: Number, default: 0 },
  sarraShareLakh: { type: Number, default: 0 },
  openingPhysical: { type: Number, default: 0 },
  openingSarraLakh: { type: Number, default: 0 },
  physicalPrevious: { type: Number, default: 0 },
  physicalCurrent: { type: Number, default: 0 },
  expenditurePreviousLakh: { type: Number, default: 0 },
  expenditureCurrentLakh: { type: Number, default: 0 },
  remarks: { type: String, trim: true, maxlength: 500, default: '' },
}, { _id: false });

const documentSchema = new mongoose.Schema({
  code: { type: String, default: null },
  docType: { type: String, enum: Object.keys(H56_DOC_TYPES), default: 'OTHER' },
  url: { type: String, required: true },
  publicId: String,
  name: String,
  mimeType: String,
  size: Number,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
});

const stepSchema = new mongoose.Schema({
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at: Date,
  note: String,
  checks: { type: [String], default: undefined },
}, { _id: false });

/**
 * Monthly Progress Report of Budget Head 56 for one implementing unit.
 *
 * Statuses and the review chain are the same as for project MPRs (see
 * mprWorkflow.js): a PIA report climbs PIA → District → HQ, a District SARRA
 * Centre report starts with the District Checker, and an HQ report with the
 * HQ Checker. Verified reports are locked; HQ can reopen the latest one.
 */
const head56MprSchema = new mongoose.Schema({
  mprNo: { type: String, required: true, unique: true },
  financialYear: { type: String, required: true },
  fyStartYear: { type: Number, required: true },
  reportingMonth: { type: String, required: true },
  monthIndex: { type: Number, required: true },
  periodIndex: { type: Number, required: true },

  level: { type: String, enum: Object.values(H56_LEVELS), required: true },
  entryMode: { type: String, enum: Object.values(H56_LEVELS), required: true },
  unitKey: { type: String, required: true },
  unitName: { type: String, required: true },
  district: { type: String, default: null },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  departmentName: { type: String, default: null },

  allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Head56Allocation' },
  allocationVersion: Number,
  lines: { type: [lineSchema], default: [] },
  totals: {
    budgetLakh: { type: Number, default: 0 },
    deptShareLakh: { type: Number, default: 0 },
    openingSarraLakh: { type: Number, default: 0 },
    expenditurePreviousLakh: { type: Number, default: 0 },
    expenditureCurrentLakh: { type: Number, default: 0 },
    expenditureFyLakh: { type: Number, default: 0 },
    expenditureTotalLakh: { type: Number, default: 0 },
    balanceLakh: { type: Number, default: 0 },
    utilisationPercent: { type: Number, default: 0 },
  },
  remarks: { type: String, trim: true, maxlength: 2000, default: '' },
  documents: { type: [documentSchema], default: [] },

  status: { type: String, enum: Object.values(PROJECT_MPR_STATUS), default: PROJECT_MPR_STATUS.DRAFT },
  stageEnteredAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedAt: Date,
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
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: Date,

  returnReason: String,
  returnedByLevel: String,
  returnedByRole: String,
  returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  returnedAt: Date,
  rejectionReason: String,
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedAt: Date,
  rejectedByRole: String,
  // null while the report is live; its own id once rejected, so the month can be filed again
  rejectedKey: { type: String, default: null },
  reopenCount: { type: Number, default: 0 },

  revisionHistory: [{
    status: String,
    action: String,
    level: String,
    role: String,
    designation: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    note: String,
  }],
}, { timestamps: true });

head56MprSchema.index({ unitKey: 1, financialYear: 1, reportingMonth: 1, rejectedKey: 1 }, { unique: true, name: 'one_live_head56_report_per_month' });
head56MprSchema.index({ status: 1, district: 1 });
head56MprSchema.index({ financialYear: 1, periodIndex: 1 });
head56MprSchema.index({ submittedBy: 1, updatedAt: -1 });

const Head56Mpr = mongoose.model('Head56Mpr', head56MprSchema);
export default Head56Mpr;

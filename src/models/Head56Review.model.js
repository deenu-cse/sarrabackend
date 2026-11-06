import mongoose from 'mongoose';

/**
 * Monthly review of the consolidated Head 56 report by the CEO / ACEO / CFO
 * (recorded by the HQ Approver). A reviewed month is closed: no report of it
 * can be filed, resubmitted or reopened until the review is withdrawn.
 */
const head56ReviewSchema = new mongoose.Schema({
  financialYear: { type: String, required: true },
  reportingMonth: { type: String, required: true },
  periodIndex: { type: Number, required: true },
  status: { type: String, enum: ['REVIEWED', 'WITHDRAWN'], default: 'REVIEWED' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewedAt: { type: Date, default: Date.now },
  role: String,
  designation: String,
  remarks: { type: String, trim: true, maxlength: 2000 },
  // The consolidated figures the reviewer saw
  snapshot: {
    budgetLakh: Number,
    expenditureFyLakh: Number,
    expenditureMonthLakh: Number,
    utilisationPercent: Number,
    units: Number,
    verified: Number,
    missing: Number,
  },
  withdrawnBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  withdrawnAt: Date,
  withdrawReason: String,
}, { timestamps: true });

head56ReviewSchema.index({ periodIndex: 1 }, { unique: true, partialFilterExpression: { status: 'REVIEWED' }, name: 'one_review_per_month' });

const Head56Review = mongoose.model('Head56Review', head56ReviewSchema);
export default Head56Review;

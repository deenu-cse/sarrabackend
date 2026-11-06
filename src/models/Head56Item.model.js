import mongoose from 'mongoose';

/** Where Head 56 money is spent and reported: SARRA HQ, a District SARRA Centre, or a PIA. */
export const H56_LEVELS = { HQ: 'HQ', DISTRICT: 'DISTRICT', PIA: 'PIA' };
export const H56_LEVEL_LABELS = { HQ: 'SARRA HQ', DISTRICT: 'District SARRA Centre', PIA: 'PIA' };

/**
 * Master of Budget Head 56 — Non-Salary Grant (गैर वेतन हेतु अनुदान).
 * Two levels: a sub-head (56-01 … 56-09) and, under some of them, its items
 * (56-01(01) …). A line with no active children is reportable.
 *
 * Controlled centrally by SARRA HQ; reports and allocations copy the code and
 * name at the time they are made, so renaming an item never rewrites history.
 */
const head56ItemSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  nameHindi: { type: String, trim: true, maxlength: 200, default: '' },
  // null for a sub-head (56-01); the sub-head code for its items (56-01(01))
  parentCode: { type: String, default: null, trim: true },
  sortOrder: { type: Number, default: 0 },
  // Levels that may receive an allocation for this line and report on it
  levels: { type: [String], enum: Object.values(H56_LEVELS), default: () => Object.values(H56_LEVELS) },
  // Non-physical expenditure lines (travel, office, …) are never asked for physical targets
  hasPhysical: { type: Boolean, default: false },
  unit: { type: String, trim: true, default: '' },
  allowsDecimal: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

head56ItemSchema.index({ parentCode: 1, sortOrder: 1 });

const Head56Item = mongoose.model('Head56Item', head56ItemSchema);
export default Head56Item;

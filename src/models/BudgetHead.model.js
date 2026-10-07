import mongoose from 'mongoose';

const headActivitySchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  nameHindi: { type: String, trim: true },
  unit: { type: String, trim: true, default: '' },
  sortOrder: { type: Number, default: 0 },
  // false for purely financial lines (e.g. DPR preparation, M&E)
  hasPhysical: { type: Boolean, default: true },
  // Whether the physical target may be fractional (Ha.) or must be whole (No.)
  allowsDecimal: { type: Boolean, default: false },
  allowsZero: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
}, { _id: false });

/**
 * Budget Head master (e.g. 55-01 Spring). The activity list a project can plan
 * against is owned by the Head, never by the client.
 */
const budgetHeadSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  // Maps the Head onto the legacy project type used by the sanction workflow
  projectType: { type: String, enum: ['SPRINGSHED', 'STREAMSHED', 'GROUNDWATER'], required: true },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  activities: [headActivitySchema],
}, { timestamps: true });

const BudgetHead = mongoose.model('BudgetHead', budgetHeadSchema);
export default BudgetHead;

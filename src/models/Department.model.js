import mongoose from 'mongoose';

/** Department (PIA) master. */
const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // Normalised name used for duplicate detection
  nameKey: { type: String, required: true, unique: true },
  sortOrder: { type: Number, default: 1000 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

departmentSchema.index({ isActive: 1, sortOrder: 1, name: 1 });

const Department = mongoose.model('Department', departmentSchema);
export default Department;

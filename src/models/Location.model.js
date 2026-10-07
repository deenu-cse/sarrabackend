import mongoose from 'mongoose';

export const LOCATION_TYPES = {
  DISTRICT: 'DISTRICT',
  BLOCK: 'BLOCK',
  GRAM_PANCHAYAT: 'GRAM_PANCHAYAT',
  VILLAGE: 'VILLAGE',
};

/**
 * Geographical hierarchy master: District → Block → Gram Panchayat → Village.
 * A single self-referencing collection keeps the hierarchy rules in one place:
 * every non-district node points at its direct parent, and (type, parent, nameKey)
 * is unique so the same name cannot be created twice under one parent.
 */
const locationSchema = new mongoose.Schema({
  type: { type: String, enum: Object.values(LOCATION_TYPES), required: true },
  name: { type: String, required: true, trim: true },
  // Normalised (lower-cased, whitespace-collapsed) name used for duplicate detection
  nameKey: { type: String, required: true },
  // Short code used in Project IDs (districts only)
  code: { type: String, uppercase: true, trim: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  // Denormalised district ancestor for fast filtering
  district: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

locationSchema.index({ type: 1, parent: 1, nameKey: 1 }, { unique: true });
locationSchema.index({ type: 1, parent: 1, isActive: 1, name: 1 });

const Location = mongoose.model('Location', locationSchema);
export default Location;

import mongoose from 'mongoose';

/**
 * A Project ID reserved for one creation draft. `draftKey` is unique, so asking
 * for an ID twice for the same draft always returns the same ID, and the ID can
 * be turned into a project exactly once.
 */
const projectIdReservationSchema = new mongoose.Schema({
  draftKey: { type: String, required: true, unique: true },
  projectId: { type: String, required: true, unique: true },
  districtId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true },
  districtName: String,
  reservedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['RESERVED', 'CONSUMED'], default: 'RESERVED' },
  sanction: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectSanction' },
  consumedAt: Date,
}, { timestamps: true });

const ProjectIdReservation = mongoose.model('ProjectIdReservation', projectIdReservationSchema);
export default ProjectIdReservation;

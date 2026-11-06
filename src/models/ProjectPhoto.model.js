import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const PHOTO_STAGE = { PRE: 'PRE', MID: 'MID', POST: 'POST' };
export const PHOTO_SOURCE = { PORTAL: 'PORTAL', MOBILE: 'MOBILE' };
export const PHOTO_VERIFICATION = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' };

/**
 * Field photograph of a project activity, from the portal or the SARRA M&E
 * mobile application: pre-, mid- or post-intervention, with GPS coordinates
 * and capture time, linked to the Project ID and the activity's approved
 * target. District Technical Staff or an authorised reviewer verifies it.
 */
const projectPhotoSchema = new mongoose.Schema({
  project: { type: ObjectId, ref: 'ProjectSanction', required: true },
  projectCode: String,
  sanctionCode: String,
  district: { type: String, required: true, index: true },
  location: { block: String, gramPanchayat: String, village: String },

  departmentId: { type: ObjectId, ref: 'Department', required: true },
  departmentName: { type: String, required: true },
  piaName: String,

  activityCode: { type: String, required: true },
  activityName: { type: String, required: true },
  unit: String,
  physicalTarget: Number,
  // Physical progress the field team recorded with the photograph (optional)
  physicalProgress: { type: Number, min: 0 },

  stage: { type: String, enum: Object.values(PHOTO_STAGE), required: true },
  url: { type: String, required: true },
  publicId: String,
  name: String,
  mimeType: String,
  size: Number,
  caption: { type: String, trim: true, maxlength: 300 },

  gps: {
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    accuracy: { type: Number, min: 0 },
  },
  capturedAt: { type: Date, required: true },
  source: { type: String, enum: Object.values(PHOTO_SOURCE), default: PHOTO_SOURCE.PORTAL },

  uploadedBy: { type: ObjectId, ref: 'User', required: true },
  uploadedByRole: String,

  verification: {
    status: { type: String, enum: Object.values(PHOTO_VERIFICATION), default: PHOTO_VERIFICATION.PENDING },
    by: { type: ObjectId, ref: 'User' },
    role: String,
    at: Date,
    remarks: { type: String, trim: true, maxlength: 500 },
  },
}, { timestamps: true });

projectPhotoSchema.index({ project: 1, capturedAt: 1 });
projectPhotoSchema.index({ project: 1, departmentId: 1, activityCode: 1, stage: 1 });
projectPhotoSchema.index({ 'verification.status': 1, district: 1 });

const ProjectPhoto = mongoose.model('ProjectPhoto', projectPhotoSchema);
export default ProjectPhoto;

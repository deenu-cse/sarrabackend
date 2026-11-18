import mongoose from 'mongoose';
import { fileSchema } from './fileRef.schema.js';

export const TRAINING_LEVELS = { GRAM_PANCHAYAT: 'Gram Panchayat', BLOCK: 'Block', DISTRICT: 'District' };

const placeSchema = new mongoose.Schema({ id: String, name: String }, { _id: false });
const genderSchema = new mongoose.Schema({ male: { type: Number, default: 0, min: 0 }, female: { type: Number, default: 0, min: 0 } }, { _id: false });

/**
 * A training and capacity development programme (SARRA "Training Format"),
 * recorded by the Maker of SARRA HQ, a District SARRA Centre or a PIA.
 */
const trainingProgrammeSchema = new mongoose.Schema({
  refNo: { type: String, required: true, unique: true },
  // Who organised it: HQ | DISTRICT | PIA (a department in a district)
  organiser: {
    level: { type: String, enum: ['HQ', 'DISTRICT', 'PIA'], required: true },
    unitKey: { type: String, required: true },
    unitName: { type: String, required: true },
    district: { type: String, default: null },
    departmentName: { type: String, default: null },
  },
  level: { type: String, enum: Object.keys(TRAINING_LEVELS), required: true },
  district: { type: String, required: true },
  districtId: String,
  block: placeSchema,
  gramPanchayat: placeSchema,
  date: { type: Date, required: true },
  place: { type: String, required: true, trim: true, maxlength: 300 },
  departments: { type: [String], default: [] },
  subject: { type: String, required: true, trim: true, maxlength: 300 },
  participants: {
    officer: { type: genderSchema, default: () => ({}) },
    representative: { type: genderSchema, default: () => ({}) },
    community: { type: genderSchema, default: () => ({}) },
  },
  remarks: { type: String, trim: true, maxlength: 2000, default: '' },
  photographs: { type: [fileSchema], default: [] },
  documents: { type: [fileSchema], default: [] },
  minutes: { type: [fileSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

trainingProgrammeSchema.index({ date: -1 });
trainingProgrammeSchema.index({ district: 1, date: -1 });
trainingProgrammeSchema.index({ 'organiser.unitKey': 1, date: -1 });

const TrainingProgramme = mongoose.model('TrainingProgramme', trainingProgrammeSchema);
export default TrainingProgramme;

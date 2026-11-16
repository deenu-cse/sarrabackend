import mongoose from 'mongoose';
import { fileSchema } from './fileRef.schema.js';

const placeSchema = new mongoose.Schema({ id: String, name: String }, { _id: false });

/**
 * Dhara Naula Sanrakshan Samiti (DNSS) of a Gram Panchayat, recorded by the
 * District Maker (SARRA "DNSS Details" reporting format). One per Gram Panchayat.
 */
const dnssCommitteeSchema = new mongoose.Schema({
  district: { type: String, required: true },
  districtId: String,
  block: placeSchema,
  gramPanchayat: placeSchema,
  groups: { type: Number, default: 0, min: 0 },
  members: {
    male: { type: Number, default: 0, min: 0 },
    female: { type: Number, default: 0, min: 0 },
  },
  chairperson: { type: String, trim: true, maxlength: 150 },
  contactNumber: { type: String, trim: true, maxlength: 20 },
  formationDate: Date,
  remarks: { type: String, trim: true, maxlength: 2000, default: '' },
  formationLetter: { type: [fileSchema], default: [] },
  photographs: { type: [fileSchema], default: [] },
  minutes: { type: [fileSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

dnssCommitteeSchema.index({ 'gramPanchayat.id': 1 }, { unique: true, name: 'one_dnss_per_gram_panchayat' });
dnssCommitteeSchema.index({ district: 1, 'block.name': 1 });

const DnssCommittee = mongoose.model('DnssCommittee', dnssCommitteeSchema);
export default DnssCommittee;

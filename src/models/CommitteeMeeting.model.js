import mongoose from 'mongoose';
import { fileSchema } from './fileRef.schema.js';

/** The committees whose meetings are reported (SARRA reporting formats). */
export const COMMITTEE_TYPES = {
  HPC: { code: 'HPC', name: 'High Power Committee', level: 'HQ' },
  SLEC: { code: 'SLEC', name: 'State Level Executive Committee', level: 'HQ' },
  DLEC: { code: 'DLEC', name: 'District Level Executive Committee', level: 'DISTRICT' },
};

export const MEETING_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  RETURNED: 'RETURNED',
};

export const MEETING_STATUS_LABELS = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending HQ Approver',
  APPROVED: 'Approved by HQ',
  RETURNED: 'Returned to Maker',
};

/**
 * One meeting of HPC, SLEC (entered by the HQ Maker) or a district's DLEC
 * (entered by the District Maker). Submitted to the HQ Approver, who approves
 * it or returns it with remarks. An approved meeting is locked.
 */
const committeeMeetingSchema = new mongoose.Schema({
  refNo: { type: String, required: true, unique: true },
  type: { type: String, enum: Object.keys(COMMITTEE_TYPES), required: true },
  district: { type: String, default: null },
  meetingNo: { type: Number, required: true, min: 1 },
  meetingDate: { type: Date, required: true },
  place: { type: String, required: true, trim: true, maxlength: 300 },
  participants: {
    male: { type: Number, default: 0, min: 0 },
    female: { type: Number, default: 0, min: 0 },
  },
  remarks: { type: String, trim: true, maxlength: 2000, default: '' },
  minutes: { type: [fileSchema], default: [] },
  photographs: { type: [fileSchema], default: [] },

  status: { type: String, enum: Object.values(MEETING_STATUS), default: MEETING_STATUS.DRAFT },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submittedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  approvalNote: String,
  returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  returnedAt: Date,
  returnReason: String,
  history: [{
    action: String,
    status: String,
    role: String,
    designation: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    note: String,
  }],
}, { timestamps: true });

// The same meeting number cannot be entered twice for a committee (per district for DLEC).
committeeMeetingSchema.index({ type: 1, district: 1, meetingNo: 1 }, { unique: true, name: 'one_record_per_meeting' });
committeeMeetingSchema.index({ status: 1, type: 1 });
committeeMeetingSchema.index({ meetingDate: -1 });

const CommitteeMeeting = mongoose.model('CommitteeMeeting', committeeMeetingSchema);
export default CommitteeMeeting;

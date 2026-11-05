import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'LOGIN', 'LOGOUT', 'FORM_SUBMIT', 'FORM_APPROVE', 'FORM_REJECT',
      'FORM_DRAFT_SAVE', 'USER_CREATE', 'USER_DEACTIVATE', 'USER_SUSPEND', 'USER_RESTORE',
      'PASSWORD_CHANGE', 'TOKEN_REFRESH', 'BOOTSTRAP',
      'CREATE_SANCTION', 'CHECKER_VERIFY_SANCTION', 'APPROVE_SANCTION', 'REJECT_SANCTION',
      'FORWARD_SANCTION_TO_DISTRICT', 'DISTRICT_ACCEPT_SANCTION', 'FORWARD_SANCTION_TO_PIA',
      'PIA_ACCEPT_SANCTION', 'FORM_RESUBMIT', 'MPR_SUBMIT', 'MPR_APPROVE', 'MPR_REJECT',
      'MPR_RETURN', 'MPR_RESUBMIT', 'MPR_FORWARD', 'MPR_DRAFT_DISCARD', 'RETURN_SANCTION',
      'CREATE_BLOCK', 'CREATE_GRAM_PANCHAYAT', 'CREATE_VILLAGE', 'CREATE_DEPARTMENT',
      'GENERATE_PROJECT_ID', 'ASSIGN_REPORTING',
      'PROJECT_REVISION', 'PIA_TRANSFER', 'PROJECT_COMPLETION', 'PROJECT_CLOSE',
      'OUTCOME_RECORD', 'MPR_EVIDENCE_UPLOAD', 'SETTINGS_UPDATE', 'REPORT_DISPATCH',
      'PHOTO_UPLOAD', 'PHOTO_VERIFY', 'USER_REQUEST', 'USER_APPROVE', 'USER_REJECT'
    ]
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  performedByRole: String,
  targetResource: String,
  targetId: mongoose.Schema.Types.ObjectId,
  ipAddress: String,
  userAgent: String,
  metadata: mongoose.Schema.Types.Mixed,
  timestamp: {
    type: Date,
    default: Date.now,
    expires: '365d'
  }
});

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;

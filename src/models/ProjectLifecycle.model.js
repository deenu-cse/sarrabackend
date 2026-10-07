import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const fileSchema = new mongoose.Schema({
  url: String,
  publicId: String,
  name: String,
  mimeType: String,
  size: Number,
}, { _id: false });

// ─── Completion report ───────────────────────────────────────────────────────

export const COMPLETION_STATUS = {
  SUBMITTED: 'SUBMITTED',
  DISTRICT_VERIFIED: 'DISTRICT_VERIFIED',
  RETURNED: 'RETURNED',
};

/**
 * Completion report of one department of one project.
 *
 * Filed by the department's PIA officer when its works are finished, verified
 * by the District Director, and the basis on which the State closes the
 * project. The money figures are a snapshot taken by the server from the
 * release ledger and the approved progress reports; they are never typed in.
 */
const projectCompletionSchema = new mongoose.Schema({
  project: { type: ObjectId, ref: 'ProjectSanction', required: true },
  projectCode: String,
  district: { type: String, required: true, index: true },
  departmentId: { type: ObjectId, ref: 'Department', required: true },
  departmentName: { type: String, required: true },

  status: { type: String, enum: Object.values(COMPLETION_STATUS), default: COMPLETION_STATUS.SUBMITTED, index: true },
  completionDate: { type: Date, required: true },
  remarks: { type: String, trim: true, maxlength: 2000 },

  // Snapshot at the time of filing (Rs. lakh)
  sanctionedLakh: { type: Number, default: 0 },
  releasedLakh: { type: Number, default: 0 },
  expenditureLakh: { type: Number, default: 0 },
  unspentLakh: { type: Number, default: 0 },
  physicalPercent: { type: Number, default: 0 },
  reportsCount: { type: Number, default: 0 },

  completionCertificate: fileSchema,
  utilisationCertificate: fileSchema,

  submittedBy: { type: ObjectId, ref: 'User', required: true },
  submittedAt: Date,
  reviewedBy: { type: ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewNote: String,
  returnReason: String,
  history: [{
    status: String,
    changedBy: { type: ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    note: String,
    _id: false,
  }],
}, { timestamps: true });

// One completion report per department of a project.
projectCompletionSchema.index({ project: 1, departmentId: 1 }, { unique: true });

export const ProjectCompletion = mongoose.model('ProjectCompletion', projectCompletionSchema);

// ─── Outcome tracking ────────────────────────────────────────────────────────

/**
 * Outcome indicator master: what a project is expected to change on the
 * ground (spring discharge, depth to groundwater, households benefited …).
 * `direction` says which way is an improvement.
 */
const outcomeIndicatorSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  nameHindi: { type: String, trim: true },
  unit: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  direction: { type: String, enum: ['INCREASE', 'DECREASE'], default: 'INCREASE' },
  allowsDecimal: { type: Boolean, default: true },
  // Budget Head codes this indicator applies to; empty = every Head
  headCodes: [String],
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export const OutcomeIndicator = mongoose.model('OutcomeIndicator', outcomeIndicatorSchema);

export const OUTCOME_KIND = { BASELINE: 'BASELINE', MEASUREMENT: 'MEASUREMENT' };

/** One reading of one indicator for one project: the baseline, or a later measurement. */
const projectOutcomeSchema = new mongoose.Schema({
  project: { type: ObjectId, ref: 'ProjectSanction', required: true },
  projectCode: String,
  district: { type: String, required: true, index: true },
  headCode: String,

  indicatorCode: { type: String, required: true },
  indicatorName: String,
  unit: String,
  direction: { type: String, enum: ['INCREASE', 'DECREASE'], default: 'INCREASE' },

  kind: { type: String, enum: Object.values(OUTCOME_KIND), required: true },
  value: { type: Number, required: true, min: 0 },
  measuredOn: { type: Date, required: true },
  // yyyy-mm-dd of `measuredOn`: one reading per indicator per day
  dayKey: { type: String, required: true },
  season: { type: String, enum: ['PRE_MONSOON', 'MONSOON', 'POST_MONSOON', 'WINTER'] },
  remarks: { type: String, trim: true, maxlength: 500 },
  evidence: fileSchema,

  recordedBy: { type: ObjectId, ref: 'User', required: true },
  recordedByRole: String,

  voided: { type: Boolean, default: false },
  voidedBy: { type: ObjectId, ref: 'User' },
  voidedAt: Date,
  voidReason: String,
}, { timestamps: true });

projectOutcomeSchema.index({ project: 1, indicatorCode: 1, measuredOn: 1 });
// One live baseline per project + indicator, and one live reading per day.
projectOutcomeSchema.index(
  { project: 1, indicatorCode: 1 },
  { unique: true, partialFilterExpression: { kind: 'BASELINE', voided: false } },
);
projectOutcomeSchema.index(
  { project: 1, indicatorCode: 1, dayKey: 1 },
  { unique: true, partialFilterExpression: { voided: false } },
);

export const ProjectOutcome = mongoose.model('ProjectOutcome', projectOutcomeSchema);

// ─── Settings, reminders, dispatch log ───────────────────────────────────────

/** System settings (single document, _id = "system"). */
const systemSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'system' },
  deadlines: {
    // The report for a month is due by this day of the following month.
    mprDueDay: { type: Number, default: 5, min: 1, max: 28 },
    // Remind the PIA officer this many days before the due date.
    remindDaysBefore: { type: Number, default: 3, min: 0, max: 15 },
    // Days after the due date before the district, then the State, is told.
    escalateToDistrictAfterDays: { type: Number, default: 3, min: 1, max: 30 },
    escalateToStateAfterDays: { type: Number, default: 7, min: 1, max: 60 },
    // Days the district has to review a submitted report.
    districtReviewDays: { type: Number, default: 5, min: 1, max: 30 },
    remindersEnabled: { type: Boolean, default: true },
  },
  emailReports: {
    enabled: { type: Boolean, default: true },
    // Day of the month the monthly summary is sent.
    dayOfMonth: { type: Number, default: 8, min: 1, max: 28 },
    sendToStateAdmins: { type: Boolean, default: true },
    sendToMneAdmins: { type: Boolean, default: true },
    sendToDistricts: { type: Boolean, default: true },
    extraRecipients: [String],
  },
  // Job name → the day / month it last ran for (stops a job running twice).
  lastRun: { type: Map, of: String, default: {} },
  updatedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });

export const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

/** One row per reminder actually sent; the unique key makes each reminder go out once. */
const reminderLogSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  kind: String,
  project: { type: ObjectId, ref: 'ProjectSanction' },
  departmentId: ObjectId,
  periodIndex: Number,
  recipients: Number,
  createdAt: { type: Date, default: Date.now, expires: '400d' },
});

export const ReminderLog = mongoose.model('ReminderLog', reminderLogSchema);

const reportDispatchSchema = new mongoose.Schema({
  type: { type: String, enum: ['STATE_MONTHLY', 'DISTRICT_MONTHLY'], required: true },
  period: String, // e.g. "September 2026"
  district: String,
  recipients: [String],
  trigger: { type: String, enum: ['SCHEDULED', 'MANUAL'], default: 'SCHEDULED' },
  status: { type: String, enum: ['SENT', 'FAILED', 'DRY_RUN'], default: 'SENT' },
  error: String,
  sentBy: { type: ObjectId, ref: 'User' },
  sentAt: { type: Date, default: Date.now },
});
reportDispatchSchema.index({ sentAt: -1 });

export const ReportDispatch = mongoose.model('ReportDispatch', reportDispatchSchema);

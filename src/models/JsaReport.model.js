import mongoose from 'mongoose';

/**
 * Jal Sanrakshan Abhiyan (JSA) — treatment plan and progress of tributary
 * rivers / streams (SARRA weekly progress format Prarup-03).
 *
 * Activities of the format. `unit` is what a target and progress count;
 * plantation is reported both in hectares and in number of plants.
 */
export const JSA_ACTIVITIES = [
  { key: 'cementedCheckDam', name: 'Cemented Check Dam', nameHindi: 'सीमेंटेड चैक डैम', unit: 'No.' },
  { key: 'checkDam', name: 'Check Dam', nameHindi: 'चैक डैम', unit: 'No.' },
  { key: 'contourTrench', name: 'Contour Trenches', nameHindi: 'कन्टूर ट्रेन्चेज', unit: 'No.' },
  { key: 'rechargePit', name: 'Recharge Pit', nameHindi: 'रिचार्ज पिट', unit: 'No.' },
  { key: 'dugoutPondShaft', name: 'Dugout Pond / Pond / Shaft', nameHindi: 'डगआउट पौण्ड / तालाब / शॉफ्ट', unit: 'No.' },
  { key: 'plantationHa', name: 'Plantation (area)', nameHindi: 'वृक्षारोपण (है०)', unit: 'Ha', decimals: 3 },
  { key: 'plantationNo', name: 'Plantation (plants)', nameHindi: 'वृक्षारोपण (सं०)', unit: 'No.' },
  { key: 'other', name: 'Other', nameHindi: 'अन्य', unit: 'No.' },
];

export const JSA_LEVELS = { VILLAGE: 'Village', BLOCK: 'Block', DISTRICT: 'District' };

const pair = new mongoose.Schema({ target: { type: Number, default: 0, min: 0 }, progress: { type: Number, default: 0, min: 0 } }, { _id: false });
const activitiesSchema = new mongoose.Schema(Object.fromEntries(JSA_ACTIVITIES.map((a) => [a.key, { type: pair, default: () => ({}) }])), { _id: false });
const placeSchema = new mongoose.Schema({ id: String, name: String }, { _id: false });

/** One weekly progress statement: everything as on its date (progress is cumulative). */
const updateSchema = new mongoose.Schema({
  asOnDate: { type: Date, required: true },
  streams: { type: Number, default: 0, min: 0 },
  activities: { type: activitiesSchema, default: () => ({}) },
  otherDescription: { type: String, trim: true, maxlength: 500, default: '' },
  remarks: { type: String, trim: true, maxlength: 1000, default: '' },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now },
});

/**
 * The JSA report of one place for one campaign year: a village, a block or the
 * whole district (all filled by the District Maker). The progress statements
 * are kept week by week; the latest one as on a date is the place's position.
 */
const jsaReportSchema = new mongoose.Schema({
  campaign: { type: Number, required: true },
  level: { type: String, enum: Object.keys(JSA_LEVELS), required: true },
  district: { type: String, required: true },
  districtId: String,
  block: placeSchema,
  gramPanchayat: placeSchema,
  village: placeSchema,
  placeKey: { type: String, required: true },
  streamNames: { type: String, trim: true, maxlength: 1000, default: '' },
  updates: { type: [updateSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

jsaReportSchema.index({ campaign: 1, level: 1, placeKey: 1 }, { unique: true, name: 'one_jsa_report_per_place' });
jsaReportSchema.index({ campaign: 1, district: 1 });

export const JsaReport = mongoose.model('JsaReport', jsaReportSchema);

/**
 * Factors of the potential recharge report (SARRA "potential recharge"):
 * average capacity of one structure (cu.m) × refills in the monsoon.
 */
export const DEFAULT_RECHARGE_FACTORS = {
  contourTrench: { capacity: 0.27, refills: 3 },
  rechargePit: { capacity: 1.5, refills: 3 },
  dugoutPondShaft: { capacity: 11.5, refills: 3 },
  cementedCheckDam: { capacity: 20, refills: 1 },
  checkDam: { capacity: 5, refills: 1 },
};

const jsaSettingSchema = new mongoose.Schema({
  _id: { type: String, default: 'jsa' },
  factors: { type: mongoose.Schema.Types.Mixed, default: () => DEFAULT_RECHARGE_FACTORS },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const JsaSetting = mongoose.model('JsaSetting', jsaSettingSchema);
export default JsaReport;

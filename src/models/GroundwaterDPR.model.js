import mongoose from 'mongoose';
import { DEPARTMENTS } from '../constants/departments.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';
import { DPR_STATUS } from '../constants/status.constants.js';
import {
  ARS_DETAILS,
  LAND_OWNERSHIPS,
  LAND_TYPE_DESIGNATIONS,
  GROUNDWATER_AVAILABILITY_STATUS,
  WATER_SOURCES_RECHARGE,
  GROUNDWATER_USES,
  VULNERABILITY_LEVELS,
  GROUNDWATER_ACTIVITY_IDS
} from '../constants/form.constants.js';

const groundwaterDPRSchema = new mongoose.Schema({
  applicationNo: { type: String, unique: true, sparse: true },
  formType: { type: String, default: 'GROUNDWATER' },
  status: { type: String, enum: Object.values(DPR_STATUS), default: DPR_STATUS.DRAFT },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedByDistrict: { type: String, required: true },
  submittedByDepartment: { type: String, required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  approvedAt: Date,
  rejectionReason: { type: String, minlength: 20, maxlength: 500 },
  rejectionCount: { type: Number, default: 0 },
  revisionHistory: [{ status: String, changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, changedAt: Date, note: String }],
  isDraft: { type: Boolean, default: true },
  draftSavedAt: Date,
  submittedAt: Date,
  ipAddress: String,
  userAgent: String,
  deviceFingerprint: String,

  section1_deptDetails: {
    department: { type: String, enum: [...DEPARTMENTS, ''] },
    departmentOther: String,
    district: { type: String, enum: [...DISTRICTS, ''] },
    block: String,
    address: String,
    nodalOfficer: String,
    contactNo: String,
    email: String,
  },

  section2_aquiferIdentification: {
    subWatershedName: String,
    microWatershedName: String,
    microWatershedCode: String,
    aquiferName: String,
    district: String,
    blockTown: String,
    villages: String,
    aquiferRechargeSiteName: String,
    aquiferRechargeSiteUniqueCode: String,
    noOfVillagesHabitation: Number,
    villagesHabitationNames: String,
    arsDetails: [{
      sn: Number,
      arsDetail: { type: String },
      name: String,
      latitude: { dd: String, mm: String, ss: String },
      longitude: { dd: String, mm: String, ss: String },
      altitudeMasl: Number,
      approxRechargeAreaHa: Number,
      landOwnership: { type: String, enum: [...LAND_OWNERSHIPS, ''] },
      landTypeDesignation: { type: String, enum: [...LAND_TYPE_DESIGNATIONS, ''] },
      landTypeOther: String
    }],
    hydrologicalDetails: [{
      arsDetail: String,
      name: String,
      depthToWaterTablePreMonsoon: Number,
      depthToWaterTablePostMonsoon: Number,
      depthToWaterTable10YrsAgo: Number
    }],
    sourceOfWaterForRecharge: String,
    sourceOfWaterOther: String,
    avgAvailabilityPeriodMonths: Number,
    groundwaterAvailabilityStatus: { type: String, enum: [...GROUNDWATER_AVAILABILITY_STATUS, ''] },
    primaryGroundwaterUses: [String],
    primaryGroundwaterUsesOther: String
  },

  section3_photographs: {
    rechargeSitePhoto: { url: String, publicId: String },
    interventionSitePhoto: { url: String, publicId: String }
  },

  section4_riskAssessment: {
    potentialRisks: String,
    vulnerabilityLevel: { type: String, enum: [...VULNERABILITY_LEVELS, ''] }
  },

  section5_budgetAndPlan: {
    responsibleOfficer: {
      department: String, district: String, block: String, gramPanchayat: String,
      nodalOfficerName: String, designation: String, contactNo: String, email: String
    },
    table51: {
      dprPreparationBudgetLakh: Number,
      totalInterventionsCostLakh: Number,
      monitoringEvaluationBudgetLakh: Number,
      totalBudgetLakh: Number
    },
    table52: [{
      activityId: { type: String },
      activityLabel: String,
      isHeader: Boolean,
      unit: String,
      arsTargets: [{ arsDetail: String, target: Number }],
      totalPhysicalTarget: Number,
      financialAmountLakh: Number
    }],
    dprFinancialAmountLakh: Number,
    monitoringFinancialAmountLakh: Number,
    table83: {
      totalProjectCostLakh: Number,
      waterRechargeBudgetLakh: Number,
      waterRechargePercentage: Number
    },
    table74: {
      totalFinancialAmountLakh: Number,
      fundFromPIADeptLakh: Number,
      fundFromOtherSourcesLakh: Number,
      fundFromSARRAConvergenceLakh: Number,
      grandTotalLakh: Number
    },
    annexures: {
      detailProjectReport: { url: String, publicId: String },
      otherDocuments: { url: String, publicId: String }
    },
    submissionDate: Date,
    submittedByName: String,
    signatureWithStamp: { url: String, publicId: String }
  }
}, { timestamps: true });

groundwaterDPRSchema.index({ applicationNo: 1 });
groundwaterDPRSchema.index({ submittedBy: 1 });
groundwaterDPRSchema.index({ status: 1 });
groundwaterDPRSchema.index({ submittedByDistrict: 1 });
groundwaterDPRSchema.index({ submittedByDepartment: 1 });
groundwaterDPRSchema.index({ formType: 1 });
groundwaterDPRSchema.index({ submittedByDistrict: 1, status: 1 });
groundwaterDPRSchema.index({ submittedBy: 1, isDraft: 1 });

const GroundwaterDPR = mongoose.model('GroundwaterDPR', groundwaterDPRSchema);
export default GroundwaterDPR;

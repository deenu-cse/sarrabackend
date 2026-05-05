import mongoose from 'mongoose';
import { DPR_STATUS } from '../constants/status.constants.js';

const dprFlatSummarySchema = new mongoose.Schema(
  {
    dprId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    applicationNo: { type: String, required: true, unique: true },
    formType: { type: String, default: 'SPRINGSHED', enum: ['SPRINGSHED', 'STREAMSHED', 'GROUNDWATER'] },

    status: { type: String, enum: Object.values(DPR_STATUS) },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedByName: String,
    submittedAt: Date,
    approvedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionCount: { type: Number, default: 0 },

    district: String,
    department: String,
    block: String,
    gramPanchayat: String,
    springDistrict: String,
    springBlock: String,
    springGP: String,

    springCount: { type: Number, default: 0 },
    springNames: [String],
    springCodes: [String],

    springTypeBreakdown: {
      naula: { type: Number, default: 0 },
      dhara: { type: Number, default: 0 },
      gadheraNala: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },

    springNatureBreakdown: {
      perennial: { type: Number, default: 0 },
      seasonal: { type: Number, default: 0 },
      dried: { type: Number, default: 0 },
    },

    totalPopulationBenefited: { type: Number, default: 0 },
    publicOwnershipCount: { type: Number, default: 0 },
    privateOwnershipCount: { type: Number, default: 0 },
    pipeSupplyCount: { type: Number, default: 0 },

    typologyBreakdown: {
      contact: { type: Number, default: 0 },
      depression: { type: Number, default: 0 },
      fractureFault: { type: Number, default: 0 },
      karst: { type: Number, default: 0 },
      thermal: { type: Number, default: 0 },
    },

    avgDischargeLPM: { type: Number, default: 0 },
    totalDischargeLPM: { type: Number, default: 0 },
    highVariabilityCount: { type: Number, default: 0 },
    lowVariabilityCount: { type: Number, default: 0 },
    dischargeTrendBreakdown: {
      highlyDecreased: { type: Number, default: 0 },
      slightlyDecreased: { type: Number, default: 0 },
      noChange: { type: Number, default: 0 },
      increased: { type: Number, default: 0 },
    },

    resourceThreatCount: { type: Number, default: 0 },
    threatDegreeBreakdown: {
      low: { type: Number, default: 0 },
      moderate: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
    },
    waterUsageBreakdown: {
      drinkingCooking: { type: Number, default: 0 },
      washingSanitation: { type: Number, default: 0 },
      cattlesLivestock: { type: Number, default: 0 },
      irrigation: { type: Number, default: 0 },
      industrial: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    totalDependentHouseholds: { type: Number, default: 0 },
    totalDependentPopulation: { type: Number, default: 0 },
    totalDependentLivestock: { type: Number, default: 0 },

    rechargeAreaDemarcatedCount: { type: Number, default: 0 },
    totalRechargeAreaHa: { type: Number, default: 0 },
    totalForestLandHa: { type: Number, default: 0 },
    totalRevenueLandHa: { type: Number, default: 0 },
    totalPrivateLandHa: { type: Number, default: 0 },

    samitiExistsCount: { type: Number, default: 0 },
    samitiInterestedCount: { type: Number, default: 0 },
    samitiMonitoringCount: { type: Number, default: 0 },

    totalBudgetLakh: { type: Number, default: 0 },
    dprPreparationBudgetLakh: { type: Number, default: 0 },
    totalInterventionsCostLakh: { type: Number, default: 0 },
    monitoringEvaluationBudgetLakh: { type: Number, default: 0 },
    fundFromPIADeptLakh: { type: Number, default: 0 },
    fundFromOtherSourcesLakh: { type: Number, default: 0 },
    fundFromSARRAConvergenceLakh: { type: Number, default: 0 },
    grandTotalLakh: { type: Number, default: 0 },

    activityTargets: [
      {
        activityId: String,
        activityLabel: String,
        unit: String,
        totalPhysicalTarget: { type: Number, default: 0 },
        financialAmountLakh: { type: Number, default: 0 },
      },
    ],

    // Streamshed specific
    streamCount: { type: Number, default: 0 },
    streamNames: [String],
    mainStreamName: String,
    totalLengthKm: { type: Number, default: 0 },
    perennialStreamCount: { type: Number, default: 0 },
    seasonalStreamCount: { type: Number, default: 0 },
    driedStreamCount: { type: Number, default: 0 },
    totalCatchmentAreaHa: { type: Number, default: 0 },
    totalBenefitedPopulation: { type: Number, default: 0 },
    waterRechargePercentage: { type: Number, default: 0 },
    subWatershedName: String,
    microWatershedName: String,
    
    // Groundwater specific
    arsCount: { type: Number, default: 0 },
    arsNames: [String],
    groundwaterAvailabilityStatus: String,
    vulnerabilityLevel: String,
    avgDepthPreMonsoon: { type: Number, default: 0 },
    avgDepthPostMonsoon: { type: Number, default: 0 },
    primaryGroundwaterUses: [String],
    sourceOfWaterForRecharge: String,
  },
  {
    timestamps: true,
  }
);

dprFlatSummarySchema.index({ district: 1 });
dprFlatSummarySchema.index({ department: 1 });
dprFlatSummarySchema.index({ status: 1 });
dprFlatSummarySchema.index({ submittedAt: -1 });
dprFlatSummarySchema.index({ totalBudgetLakh: 1 });
dprFlatSummarySchema.index({ district: 1, status: 1 });
dprFlatSummarySchema.index({ district: 1, department: 1, status: 1 });
dprFlatSummarySchema.index({ submittedAt: -1, status: 1 });

export const DPRFlatSummary = mongoose.model('DPRFlatSummary', dprFlatSummarySchema);

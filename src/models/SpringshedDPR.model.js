import mongoose from 'mongoose';
import {
  SPRING_TYPES, SPRING_NATURES, CLEANLINESS_LEVELS, OWNERSHIPS, SCHEME_TYPES,
  TYPOLOGIES, ROCK_TYPES, AQUIFER_TYPES, TOPOGRAPHICAL_FEATURES, ACCESSIBILITIES,
  SEASONAL_VARIABILITIES, MONTHS, DISCHARGE_TRENDS, WATER_COLOURS, SMELL_ODOURS,
  TASTES, LAND_USES, DEGREE_OF_THREATS, WATER_USAGES, DEPENDENCY_LEVELS,
  OTHER_WATER_SOURCES, ACTIVITY_IDS
} from '../constants/form.constants.js';
import { DEPARTMENTS } from '../constants/departments.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';
import { DPR_STATUS } from '../constants/status.constants.js';

const springshedDPRSchema = new mongoose.Schema(
  {
    applicationNo: {
      type: String,
      unique: true,
      sparse: true,
    },
    formType: {
      type: String,
      default: 'SPRINGSHED',
    },
    status: {
      type: String,
      enum: Object.values(DPR_STATUS),
      default: DPR_STATUS.DRAFT,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    submittedByDistrict: {
      type: String,
      required: true,
    },
    submittedByDepartment: {
      type: String,
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: Date,
    approvedAt: Date,
    rejectionReason: {
      type: String,
      minlength: 20,
      maxlength: 500,
    },
    rejectionCount: {
      type: Number,
      default: 0,
    },
    revisionHistory: [
      {
        status: String,
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        changedAt: Date,
        note: String,
      },
    ],
    isDraft: {
      type: Boolean,
      default: true,
    },
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

    section2_springIdentification: {
      springDistrict: String,
      springBlock: String,
      springGP: String,
      revenuVillage: String,
      town: String,
      wardNo: String,
      surveyDate: Date,
      springs: [
        {
          name: String,
          revenueVillage: String,
          hamletTok: String,
          latitude: { dd: String, mm: String, ss: String },
          longitude: { dd: String, mm: String, ss: String },
          altitude: String,
          springCode: String,
        },
      ],
    },

    section3_springDescription: {
      table31: [
        {
          springName: String,
          springType: { type: String, enum: [...SPRING_TYPES, ''] },
          springTypeOther: String,
          springNature: { type: String, enum: [...SPRING_NATURES, ''] },
          newlyEmerged: Boolean,
          muddyWaterInRain: Boolean,
          cleanliness: { type: String, enum: [...CLEANLINESS_LEVELS, ''] },
        },
      ],
      table32: [
        {
          springName: String,
          ownership: { type: String, enum: [...OWNERSHIPS, ''] },
          chamberTank: Boolean,
          permanentStructure: Boolean,
          pipeWaterSupply: Boolean,
          schemeType: { type: String, enum: [...SCHEME_TYPES, ''] },
          populationBenefited: Number,
        },
      ],
    },

    section4_photographs: {
      closeUpPhoto: { url: String, publicId: String },
      wideAnglePhoto: { url: String, publicId: String },
      selfieWithSpring: { url: String, publicId: String },
    },

    section5_hydroGeological: {
      table51: [
        {
          springName: String,
          typology: { type: String, enum: [...TYPOLOGIES, ''] },
          rockType: { type: String, enum: [...ROCK_TYPES, ''] },
          aquiferType: { type: String, enum: [...AQUIFER_TYPES, ''] },
          topographicalFeature: { type: String, enum: [...TOPOGRAPHICAL_FEATURES, ''] },
          settlementNearSpring: Boolean,
          accessibility: { type: String, enum: [...ACCESSIBILITIES, ''] },
        },
      ],
    },

    section6_physicalCharacteristics: {
      table61: [
        {
          springName: String,
          dischargeMessurable: Boolean,
          springDischargeLPM: Number,
          seasonalVariability: { type: String, enum: [...SEASONAL_VARIABILITIES, ''] },
          peakMonths: [{ type: String, enum: MONTHS }],
          leanMonths: [{ type: String, enum: MONTHS }],
        },
      ],
      table62: [
        {
          springName: String,
          dischargeTrend: { type: String, enum: [...DISCHARGE_TRENDS, ''] },
          waterColour: { type: String, enum: [...WATER_COLOURS, ''] },
          smellOdour: { type: String, enum: [...SMELL_ODOURS, ''] },
          taste: { type: String, enum: [...TASTES, ''] },
        },
      ],
    },

    section7_otherInformation: {
      table71: [
        {
          springName: String,
          dominantLandUse: { type: String, enum: [...LAND_USES, ''] },
          landUseNearSpring: { type: String, enum: [...LAND_USES, ''] },
          resourceThreat: Boolean,
          degreeOfThreat: { type: String, enum: [...DEGREE_OF_THREATS, ''] },
          majorStressor: String,
          waterUsage: [{ type: String, enum: WATER_USAGES }],
        },
      ],
      table72: [
        {
          springName: String,
          stressorType: { type: String, enum: ['Natural', 'Anthropogenic', 'Both'] },
          naturalStressors: [String],
          anthropogenicStressors: [String],
          bothStressors: [String],
        },
      ],
      table73: [
        {
          springName: String,
          waterUsage: [String],
          dependentHouseholds: Number,
          dependentPopulation: Number,
          dependentLivestock: Number,
          dependencyLevel: { type: String, enum: [...DEPENDENCY_LEVELS, ''] },
          otherWaterSource: { type: String, enum: [...OTHER_WATER_SOURCES, ''] },
        },
      ],
    },

    section8_rechargeArea: {
      table81: [
        {
          springName: String,
          rechargeAreaDemarcated: Boolean,
          totalRechargeAreaHa: Number,
          forestLandHa: Number,
          revenueLandHa: Number,
          privateLandHa: Number,
          kmlFile: { url: String, publicId: String },
        },
      ],
    },

    section9_communityInitiatives: {
      table91: [
        {
          springName: String,
          previousCommunityInitiatives: Boolean,
          dharaNaulaSamitiExists: Boolean,
          samitiInterestedInImplementation: Boolean,
          samitiForMonitoring: Boolean,
        },
      ],
    },

    section10_budgetAndPlan: {
      responsibleOfficer: {
        department: String,
        district: String,
        block: String,
        gramPanchayat: String,
        nodalOfficerName: String,
        designation: String,
        contactNo: String,
        email: String,
      },
      table101: {
        dprPreparationBudgetLakh: Number,
        totalInterventionsCostLakh: Number,
        monitoringEvaluationBudgetLakh: Number,
        totalBudgetLakh: Number,
      },
      table102: [
        {
          activityId: { type: String, enum: ACTIVITY_IDS },
          activityLabel: String,
          unit: String,
          springTargets: [{ springName: String, target: Number }],
          totalPhysicalTarget: Number,
          financialAmountLakh: Number,
        },
      ],
      dprFinancialAmountLakh: Number,
      monitoringFinancialAmountLakh: Number,
      table103: {
        totalFinancialAmountLakh: Number,
        fundFromPIADeptLakh: Number,
        fundFromOtherSourcesLakh: Number,
        fundFromSARRAConvergenceLakh: Number,
        grandTotalLakh: Number,
      },
      annexures: {
        detailProjectReport: { url: String, publicId: String },
        dharaNaulaDetails: { url: String, publicId: String },
        mouSpringRejuvenation: { url: String, publicId: String },
        dlecMinutes: { url: String, publicId: String },
        otherDocuments: { url: String, publicId: String },
      },
      submissionDate: Date,
      submittedByName: String,
      signatureWithStamp: { url: String, publicId: String },
    },
  },
  {
    timestamps: true,
  }
);

springshedDPRSchema.index({ applicationNo: 1 });
springshedDPRSchema.index({ submittedBy: 1 });
springshedDPRSchema.index({ status: 1 });
springshedDPRSchema.index({ submittedByDistrict: 1 });
springshedDPRSchema.index({ submittedByDepartment: 1 });
springshedDPRSchema.index({ formType: 1 });
springshedDPRSchema.index({ submittedByDistrict: 1, status: 1 });
springshedDPRSchema.index({ submittedBy: 1, isDraft: 1 });

const SpringshedDPR = mongoose.model('SpringshedDPR', springshedDPRSchema);
export default SpringshedDPR;

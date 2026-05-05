import mongoose from 'mongoose';
import {
  STREAM_DETAILS, STREAM_NATURES, WATER_USES_STREAM, STREAM_ACTIVITY_IDS
} from '../constants/form.constants.js';
import { DEPARTMENTS } from '../constants/departments.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';
import { DPR_STATUS } from '../constants/status.constants.js';

const streamshedDPRSchema = new mongoose.Schema(
  {
    applicationNo: {
      type: String,
      unique: true,
      sparse: true,
    },
    formType: {
      type: String,
      default: 'STREAMSHED',
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
      district: { type: String, enum: [...DISTRICTS, ''] },
      block: String,
      address: String,
      nodalOfficer: String,
      contactNo: String,
      email: String,
    },

    section2_streamIdentification: {
      streamName: String,
      streamOrder: String,
      district: { type: String, enum: [...DISTRICTS, ''] },
      blockTown: String,
      lengthOfStreamKm: Number,
      subWatershedName: String,
      microWatershedName: String,
      noOfVillagesHabitation: Number,
      villagesHabitationNames: String,
      table21: [
        {
          sn: Number,
          detail: { type: String },
          name: String,
          streamOrder: String,
          startPoint: {
            latitude: { dd: String, mm: String, ss: String },
            longitude: { dd: String, mm: String, ss: String }
          },
          endPoint: {
            latitude: { dd: String, mm: String, ss: String },
            longitude: { dd: String, mm: String, ss: String }
          },
          lengthKm: Number,
          altitudeMtr: Number
        }
      ],
      table22: [
        {
          detail: String,
          name: String,
          streamOrder: String,
          streamNature: { type: String, enum: [...STREAM_NATURES, ''] },
          ifSeasonalMonths: String,
          dischargeDecJanLPM: Number,
          dischargeMayJuneLPM: Number,
          decreaseInDischarge15YrsPercent: Number
        }
      ],
      table23: [
        {
          detail: String,
          name: String,
          streamOrder: String,
          waterUse: { type: String, enum: [...WATER_USES_STREAM, ''] },
          noOfSchemes: Number,
          benefitedPopulation: Number,
          irrigationCommandAreaHa: Number
        }
      ]
    },

    section3_catchmentArea: {
      table31: [
        {
          detail: String,
          name: String,
          streamOrder: String,
          catchmentAreaHa: Number,
          landCoverPercent: {
            agriculture: Number,
            reserveForest: Number,
            vanPanchayat: Number,
            pastureNonForest: Number,
            settlement: Number
          }
        }
      ],
      attachLandCoverMap: { url: String, publicId: String },
      table32: [
        {
          detail: String,
          name: String,
          streamOrder: String,
          catchmentTreatmentDoneLast3Yrs: Boolean,
          permanentFunctionalStructure: Boolean
        }
      ]
    },

    section4_photographs: {
      mainStreamPhoto: { url: String, publicId: String },
      tributariesConfluencePhoto: { url: String, publicId: String }
    },

    section5_rechargeAreas: {
      table51: [
        {
          detail: String,
          name: String,
          streamOrder: String,
          rechargeAreaDemarcated: Boolean,
          totalRechargeAreaHa: Number,
          forestLandHa: Number,
          revenueLandHa: Number,
          privateLandHa: Number
        }
      ]
    },

    section6_maps: {
      mapDescription: String,
      geoCoordinatesFile: { url: String, publicId: String }
    },

    section7_budgetAndPlan: {
      responsibleOfficer: {
        department: String,
        district: String,
        block: String,
        gramPanchayat: String,
        nodalOfficerName: String,
        designation: String,
        contactNo: String,
        email: String
      },
      table71: {
        dprPreparationBudgetLakh: Number,
        totalInterventionsCostLakh: Number,
        monitoringEvaluationBudgetLakh: Number,
        totalBudgetLakh: Number
      },
      table72: [
        {
          activityId: { type: String, enum: STREAM_ACTIVITY_IDS },
          activityLabel: String,
          isHeader: Boolean,
          unit: String,
          streamTargets: [
            {
              streamDetail: String,
              target: Number
            }
          ],
          totalPhysicalTarget: Number,
          financialAmountLakh: Number
        }
      ],
      dprFinancialAmountLakh: Number,
      monitoringFinancialAmountLakh: Number,
      table73: {
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
    },

    section8_geoLocation: {
      geoLocationDescription: String,
      geoLocationFile: { url: String, publicId: String }
    }
  },
  {
    timestamps: true,
  }
);

streamshedDPRSchema.index({ applicationNo: 1 });
streamshedDPRSchema.index({ submittedBy: 1 });
streamshedDPRSchema.index({ status: 1 });
streamshedDPRSchema.index({ submittedByDistrict: 1 });
streamshedDPRSchema.index({ submittedByDepartment: 1 });
streamshedDPRSchema.index({ formType: 1 });
streamshedDPRSchema.index({ submittedByDistrict: 1, status: 1 });
streamshedDPRSchema.index({ submittedBy: 1, isDraft: 1 });

const StreamshedDPR = mongoose.model('StreamshedDPR', streamshedDPRSchema);
export default StreamshedDPR;

import Joi from 'joi';
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
import { DEPARTMENTS } from '../constants/departments.constants.js';
import { DISTRICTS } from '../constants/districts.constants.js';

export const submitDprSchema = Joi.object({
  isDraft: Joi.boolean().default(false),

  section1_deptDetails: Joi.object({
    department: Joi.string().valid(...DEPARTMENTS).required(),
    departmentOther: Joi.string().allow('', null),
    district: Joi.string().valid(...DISTRICTS).required(),
    block: Joi.string().required(),
    address: Joi.string().required(),
    nodalOfficer: Joi.string().required(),
    contactNo: Joi.string().required(),
    email: Joi.string().email().required(),
  }).required(),

  section2_aquiferIdentification: Joi.object({
    subWatershedName: Joi.string().required(),
    microWatershedName: Joi.string().required(),
    microWatershedCode: Joi.string().required(),
    aquiferName: Joi.string().required(),
    district: Joi.string().required(),
    blockTown: Joi.string().required(),
    villages: Joi.string().required(),
    aquiferRechargeSiteName: Joi.string().required(),
    aquiferRechargeSiteUniqueCode: Joi.string().required(),
    noOfVillagesHabitation: Joi.number().required(),
    villagesHabitationNames: Joi.string().required(),
    arsDetails: Joi.array().items(Joi.object({
      sn: Joi.number().required(),
      arsDetail: Joi.string().required(),
      name: Joi.string().required(),
      latitude: Joi.object({ dd: Joi.string(), mm: Joi.string(), ss: Joi.string() }),
      longitude: Joi.object({ dd: Joi.string(), mm: Joi.string(), ss: Joi.string() }),
      altitudeMasl: Joi.number().required(),
      approxRechargeAreaHa: Joi.number().required(),
      landOwnership: Joi.string().valid(...LAND_OWNERSHIPS).required(),
      landTypeDesignation: Joi.string().valid(...LAND_TYPE_DESIGNATIONS).required(),
      landTypeOther: Joi.string().allow('', null)
    })).min(1).required(),
    hydrologicalDetails: Joi.array().items(Joi.object({
      arsDetail: Joi.string().required(),
      name: Joi.string().required(),
      depthToWaterTablePreMonsoon: Joi.number().required(),
      depthToWaterTablePostMonsoon: Joi.number().required(),
      depthToWaterTable10YrsAgo: Joi.number().required()
    })).required(),
    sourceOfWaterForRecharge: Joi.string().valid(...WATER_SOURCES_RECHARGE).required(),
    sourceOfWaterOther: Joi.string().allow('', null),
    avgAvailabilityPeriodMonths: Joi.number().required(),
    groundwaterAvailabilityStatus: Joi.string().valid(...GROUNDWATER_AVAILABILITY_STATUS).required(),
    primaryGroundwaterUses: Joi.array().items(Joi.string().valid(...GROUNDWATER_USES)).required(),
    primaryGroundwaterUsesOther: Joi.string().allow('', null)
  }).required(),

  section3_photographs: Joi.object({
    rechargeSitePhoto: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
    interventionSitePhoto: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional()
  }).optional(),

  section4_riskAssessment: Joi.object({
    potentialRisks: Joi.string().required(),
    vulnerabilityLevel: Joi.string().valid(...VULNERABILITY_LEVELS).required()
  }).required(),

  section5_budgetAndPlan: Joi.object({
    responsibleOfficer: Joi.object({
      department: Joi.string().required(),
      district: Joi.string().required(),
      block: Joi.string().required(),
      gramPanchayat: Joi.string().allow('', null),
      nodalOfficerName: Joi.string().required(),
      designation: Joi.string().required(),
      contactNo: Joi.string().required(),
      email: Joi.string().email().required()
    }).required(),
    table51: Joi.object({
      dprPreparationBudgetLakh: Joi.number().required(),
      totalInterventionsCostLakh: Joi.number().required(),
      monitoringEvaluationBudgetLakh: Joi.number().required(),
      totalBudgetLakh: Joi.number().required()
    }).required(),
    table52: Joi.array().items(Joi.object({
      activityId: Joi.string().allow('', null),
      activityLabel: Joi.string().required(),
      isHeader: Joi.boolean().optional(),
      unit: Joi.string().allow('', null),
      arsTargets: Joi.array().items(Joi.object({
        arsDetail: Joi.string().required(),
        target: Joi.number().required()
      })).optional(),
      totalPhysicalTarget: Joi.number().required(),
      financialAmountLakh: Joi.number().required()
    })).required(),
    dprFinancialAmountLakh: Joi.number().required(),
    monitoringFinancialAmountLakh: Joi.number().required(),
    table83: Joi.object({
      totalProjectCostLakh: Joi.number().required(),
      waterRechargeBudgetLakh: Joi.number().required(),
      waterRechargePercentage: Joi.number().required()
    }).required(),
    table74: Joi.object({
      totalFinancialAmountLakh: Joi.number().required(),
      fundFromPIADeptLakh: Joi.number().required(),
      fundFromOtherSourcesLakh: Joi.number().required(),
      fundFromSARRAConvergenceLakh: Joi.number().required(),
      grandTotalLakh: Joi.number().required()
    }).required(),
    annexures: Joi.object({
      detailProjectReport: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
      otherDocuments: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional()
    }).optional(),
    submissionDate: Joi.date().required(),
    submittedByName: Joi.string().required(),
    signatureWithStamp: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional()
  }).required()
});

export const rejectDprSchema = Joi.object({
  rejectionReason: Joi.string().min(20).max(500).required()
});

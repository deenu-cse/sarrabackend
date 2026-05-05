import Joi from 'joi';
import {
  SPRING_TYPES, SPRING_NATURES, CLEANLINESS_LEVELS, OWNERSHIPS, SCHEME_TYPES,
  TYPOLOGIES, ROCK_TYPES, AQUIFER_TYPES, TOPOGRAPHICAL_FEATURES, ACCESSIBILITIES,
  SEASONAL_VARIABILITIES, MONTHS, DISCHARGE_TRENDS, WATER_COLOURS, SMELL_ODOURS,
  TASTES, LAND_USES, DEGREE_OF_THREATS, WATER_USAGES, DEPENDENCY_LEVELS,
  OTHER_WATER_SOURCES, ACTIVITY_IDS
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

  section2_springIdentification: Joi.object({
    springDistrict: Joi.string().required(),
    springBlock: Joi.string().required(),
    springGP: Joi.string().required(),
    revenuVillage: Joi.string().required(),
    town: Joi.string().allow('', null),
    wardNo: Joi.string().allow('', null),
    surveyDate: Joi.date().required(),
    springs: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      revenueVillage: Joi.string().required(),
      hamletTok: Joi.string().required(),
      latitude: Joi.object({ dd: Joi.string(), mm: Joi.string(), ss: Joi.string() }),
      longitude: Joi.object({ dd: Joi.string(), mm: Joi.string(), ss: Joi.string() }),
      altitude: Joi.string(),
      springCode: Joi.string().allow('', null)
    })).min(1).required()
  }).required(),

  section3_springDescription: Joi.object({
    table31: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      springType: Joi.string().valid(...SPRING_TYPES).required(),
      springTypeOther: Joi.string().allow('', null),
      springNature: Joi.string().valid(...SPRING_NATURES).required(),
      newlyEmerged: Joi.boolean().required(),
      muddyWaterInRain: Joi.boolean().required(),
      cleanliness: Joi.string().valid(...CLEANLINESS_LEVELS).required()
    })).required(),
    table32: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      ownership: Joi.string().valid(...OWNERSHIPS).required(),
      chamberTank: Joi.boolean().required(),
      permanentStructure: Joi.boolean().required(),
      pipeWaterSupply: Joi.boolean().required(),
      schemeType: Joi.string().valid(...SCHEME_TYPES).required(),
      populationBenefited: Joi.number().required()
    })).required()
  }).required(),

  section4_photographs: Joi.object({
    closeUpPhoto: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
    wideAnglePhoto: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
    selfieWithSpring: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional()
  }).optional(),

  section5_hydroGeological: Joi.object({
    table51: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      typology: Joi.string().valid(...TYPOLOGIES).required(),
      rockType: Joi.string().valid(...ROCK_TYPES).required(),
      aquiferType: Joi.string().valid(...AQUIFER_TYPES).required(),
      topographicalFeature: Joi.string().valid(...TOPOGRAPHICAL_FEATURES).required(),
      settlementNearSpring: Joi.boolean().required(),
      accessibility: Joi.string().valid(...ACCESSIBILITIES).required()
    })).required()
  }).required(),

  section6_physicalCharacteristics: Joi.object({
    table61: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      dischargeMessurable: Joi.boolean().required(),
      springDischargeLPM: Joi.number().allow(null),
      seasonalVariability: Joi.string().valid(...SEASONAL_VARIABILITIES).required(),
      peakMonths: Joi.array().items(Joi.string().valid(...MONTHS)).max(3).required(),
      leanMonths: Joi.array().items(Joi.string().valid(...MONTHS)).max(3).required()
    })).required(),
    table62: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      dischargeTrend: Joi.string().valid(...DISCHARGE_TRENDS).required(),
      waterColour: Joi.string().valid(...WATER_COLOURS).required(),
      smellOdour: Joi.string().valid(...SMELL_ODOURS).required(),
      taste: Joi.string().valid(...TASTES).required()
    })).required()
  }).required(),

  section7_otherInformation: Joi.object({
    table71: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      dominantLandUse: Joi.string().valid(...LAND_USES).required(),
      landUseNearSpring: Joi.string().valid(...LAND_USES).required(),
      resourceThreat: Joi.boolean().required(),
      degreeOfThreat: Joi.string().valid(...DEGREE_OF_THREATS).required(),
      majorStressor: Joi.string().allow('', null),
      waterUsage: Joi.array().items(Joi.string().valid(...WATER_USAGES)).required()
    })).required(),
    table72: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      stressorType: Joi.string().valid('Natural', 'Anthropogenic', 'Both').required(),
      naturalStressors: Joi.array().items(Joi.string()).max(3),
      anthropogenicStressors: Joi.array().items(Joi.string()).max(3),
      bothStressors: Joi.array().items(Joi.string()).max(3)
    })).required(),
    table73: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      waterUsage: Joi.array().items(Joi.string()).max(3),
      dependentHouseholds: Joi.number().required(),
      dependentPopulation: Joi.number().required(),
      dependentLivestock: Joi.number().required(),
      dependencyLevel: Joi.string().valid(...DEPENDENCY_LEVELS).required(),
      otherWaterSource: Joi.string().valid(...OTHER_WATER_SOURCES).required()
    })).required()
  }).required(),

  section8_rechargeArea: Joi.object({
    table81: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      rechargeAreaDemarcated: Joi.boolean().required(),
      totalRechargeAreaHa: Joi.number().required(),
      forestLandHa: Joi.number().required(),
      revenueLandHa: Joi.number().required(),
      privateLandHa: Joi.number().required(),
      kmlFile: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional()
    })).required()
  }).required(),

  section9_communityInitiatives: Joi.object({
    table91: Joi.array().items(Joi.object({
      springName: Joi.string().required(),
      previousCommunityInitiatives: Joi.boolean().required(),
      dharaNaulaSamitiExists: Joi.boolean().required(),
      samitiInterestedInImplementation: Joi.boolean().required(),
      samitiForMonitoring: Joi.boolean().required()
    })).required()
  }).required(),

  section10_budgetAndPlan: Joi.object({
    responsibleOfficer: Joi.object({
      department: Joi.string().required(),
      district: Joi.string().required(),
      block: Joi.string().required(),
      gramPanchayat: Joi.string().required(),
      nodalOfficerName: Joi.string().required(),
      designation: Joi.string().required(),
      contactNo: Joi.string().required(),
      email: Joi.string().email().required()
    }).required(),
    table101: Joi.object({
      dprPreparationBudgetLakh: Joi.number().required(),
      totalInterventionsCostLakh: Joi.number().required(),
      monitoringEvaluationBudgetLakh: Joi.number().required(),
      totalBudgetLakh: Joi.number().required()
    }).required(),
    table102: Joi.array().items(Joi.object({
      activityId: Joi.string().valid(...ACTIVITY_IDS).required(),
      activityLabel: Joi.string().required(),
      unit: Joi.string().required(),
      springTargets: Joi.array().items(Joi.object({
        springName: Joi.string().required(),
        target: Joi.number().required()
      })),
      totalPhysicalTarget: Joi.number().required(),
      financialAmountLakh: Joi.number().required()
    })).required(),
    dprFinancialAmountLakh: Joi.number().required(),
    monitoringFinancialAmountLakh: Joi.number().required(),
    table103: Joi.object({
      totalFinancialAmountLakh: Joi.number().required(),
      fundFromPIADeptLakh: Joi.number().required(),
      fundFromOtherSourcesLakh: Joi.number().required(),
      fundFromSARRAConvergenceLakh: Joi.number().required(),
      grandTotalLakh: Joi.number().required()
    }).required(),
    annexures: Joi.object({
      detailProjectReport: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
      dharaNaulaDetails: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
      mouSpringRejuvenation: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
      dlecMinutes: Joi.object({ url: Joi.string(), publicId: Joi.string() }).optional(),
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

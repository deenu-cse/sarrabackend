import Joi from 'joi';

const coordinatesSchema = Joi.object({
  dd: Joi.string().allow('').optional(),
  mm: Joi.string().allow('').optional(),
  ss: Joi.string().allow('').optional(),
});

const uploadSchema = Joi.object({
  url: Joi.string().uri().required(),
  publicId: Joi.string().required(),
}).allow(null);

export const validateStreamshedDPR = (data) => {
  const schema = Joi.object({
    _id: Joi.string().optional(),
    applicationNo: Joi.string().optional(),

    section1_deptDetails: Joi.object({
      department: Joi.string().required(),
      district: Joi.string().required(),
      block: Joi.string().allow('').optional(),
      address: Joi.string().allow('').optional(),
      nodalOfficer: Joi.string().required(),
      contactNo: Joi.string().required(),
      email: Joi.string().email().required(),
    }).required(),

    section2_streamIdentification: Joi.object({
      streamName: Joi.string().required(),
      streamOrder: Joi.string().required(),
      district: Joi.string().required(),
      blockTown: Joi.string().allow('').optional(),
      lengthOfStreamKm: Joi.number().allow('', null).optional(),
      subWatershedName: Joi.string().allow('').optional(),
      microWatershedName: Joi.string().allow('').optional(),
      noOfVillagesHabitation: Joi.number().allow('', null).optional(),
      villagesHabitationNames: Joi.string().allow('').optional(),
      table21: Joi.array().items(
        Joi.object({
          sn: Joi.number().allow('', null).optional(),
          detail: Joi.string().required(),
          name: Joi.string().required(),
          streamOrder: Joi.string().allow('').optional(),
          startPoint: Joi.object({
            latitude: coordinatesSchema,
            longitude: coordinatesSchema,
          }),
          endPoint: Joi.object({
            latitude: coordinatesSchema,
            longitude: coordinatesSchema,
          }),
          lengthKm: Joi.number().allow('', null).optional(),
          altitudeMtr: Joi.number().allow('', null).optional(),
        })
      ).min(1).required(),
      table22: Joi.array().items(
        Joi.object({
          detail: Joi.string().optional(),
          name: Joi.string().optional(),
          streamOrder: Joi.string().allow('').optional(),
          streamNature: Joi.string().allow('').optional(),
          ifSeasonalMonths: Joi.string().allow('').optional(),
          dischargeDecJanLPM: Joi.number().allow('', null).optional(),
          dischargeMayJuneLPM: Joi.number().allow('', null).optional(),
          decreaseInDischarge15YrsPercent: Joi.number().allow('', null).optional(),
        })
      ),
      table23: Joi.array().items(
        Joi.object({
          detail: Joi.string().optional(),
          name: Joi.string().optional(),
          streamOrder: Joi.string().allow('').optional(),
          waterUse: Joi.string().allow('').optional(),
          noOfSchemes: Joi.number().allow('', null).optional(),
          benefitedPopulation: Joi.number().allow('', null).optional(),
          irrigationCommandAreaHa: Joi.number().allow('', null).optional(),
        })
      ),
    }).required(),

    section3_catchmentArea: Joi.object({
      table31: Joi.array().items(
        Joi.object({
          detail: Joi.string().optional(),
          name: Joi.string().optional(),
          streamOrder: Joi.string().allow('').optional(),
          catchmentAreaHa: Joi.number().allow('', null).optional(),
          landCoverPercent: Joi.object({
            agriculture: Joi.number().allow('', null).optional(),
            reserveForest: Joi.number().allow('', null).optional(),
            vanPanchayat: Joi.number().allow('', null).optional(),
            pastureNonForest: Joi.number().allow('', null).optional(),
            settlement: Joi.number().allow('', null).optional(),
          }).custom((value, helpers) => {
            const sum = (Number(value.agriculture) || 0) + (Number(value.reserveForest) || 0) + (Number(value.vanPanchayat) || 0) + (Number(value.pastureNonForest) || 0) + (Number(value.settlement) || 0);
            if (sum > 0 && Math.abs(sum - 100) > 0.01) {
              return helpers.message('Land cover percentages must sum to 100');
            }
            return value;
          }),
        })
      ),
      attachLandCoverMap: uploadSchema,
      table32: Joi.array().items(
        Joi.object({
          detail: Joi.string().optional(),
          name: Joi.string().optional(),
          streamOrder: Joi.string().allow('').optional(),
          catchmentTreatmentDoneLast3Yrs: Joi.any().optional(),
          permanentFunctionalStructure: Joi.any().optional(),
        })
      ),
    }),

    section4_photographs: Joi.object({
      mainStreamPhoto: uploadSchema,
      tributariesConfluencePhoto: uploadSchema,
    }),

    section5_rechargeAreas: Joi.object({
      table51: Joi.array().items(
        Joi.object({
          detail: Joi.string().optional(),
          name: Joi.string().optional(),
          streamOrder: Joi.string().allow('').optional(),
          rechargeAreaDemarcated: Joi.any().optional(),
          totalRechargeAreaHa: Joi.number().allow('', null).optional(),
          forestLandHa: Joi.number().allow('', null).optional(),
          revenueLandHa: Joi.number().allow('', null).optional(),
          privateLandHa: Joi.number().allow('', null).optional(),
        })
      ),
    }),

    section6_maps: Joi.object({
      mapDescription: Joi.string().allow('').optional(),
      geoCoordinatesFile: uploadSchema,
    }),

    section7_budgetAndPlan: Joi.object({
      responsibleOfficer: Joi.object({
        department: Joi.string().allow('').optional(),
        district: Joi.string().allow('').optional(),
        block: Joi.string().allow('').optional(),
        gramPanchayat: Joi.string().allow('').optional(),
        nodalOfficerName: Joi.string().allow('').optional(),
        designation: Joi.string().allow('').optional(),
        contactNo: Joi.string().allow('').optional(),
        email: Joi.string().allow('').optional(),
      }),
      table71: Joi.object({
        dprPreparationBudgetLakh: Joi.number().allow('', null).optional(),
        totalInterventionsCostLakh: Joi.number().allow('', null).optional(),
        monitoringEvaluationBudgetLakh: Joi.number().allow('', null).optional(),
        totalBudgetLakh: Joi.number().allow('', null).optional(),
      }),
      table72: Joi.array().items(
        Joi.object({
          activityId: Joi.string().required(),
          activityLabel: Joi.string().optional(),
          isHeader: Joi.boolean().optional(),
          unit: Joi.string().allow('').optional(),
          streamTargets: Joi.array().items(
            Joi.object({
              streamDetail: Joi.string().optional(),
              target: Joi.number().allow('', null).optional(),
            })
          ),
          totalPhysicalTarget: Joi.number().allow('', null).optional(),
          financialAmountLakh: Joi.number().allow('', null).optional(),
        })
      ),
      dprFinancialAmountLakh: Joi.number().allow('', null).optional(),
      monitoringFinancialAmountLakh: Joi.number().allow('', null).optional(),
      table73: Joi.object({
        totalProjectCostLakh: Joi.number().allow('', null).optional(),
        waterRechargeBudgetLakh: Joi.number().allow('', null).optional(),
        waterRechargePercentage: Joi.number().allow('', null).optional(),
      }),
      table74: Joi.object({
        totalFinancialAmountLakh: Joi.number().allow('', null).optional(),
        fundFromPIADeptLakh: Joi.number().allow('', null).optional(),
        fundFromOtherSourcesLakh: Joi.number().allow('', null).optional(),
        fundFromSARRAConvergenceLakh: Joi.number().allow('', null).optional(),
        grandTotalLakh: Joi.number().allow('', null).optional(),
      }),
      annexures: Joi.object({
        detailProjectReport: uploadSchema,
        otherDocuments: uploadSchema,
      }),
      submissionDate: Joi.any().optional(),
      submittedByName: Joi.string().allow('').optional(),
      signatureWithStamp: uploadSchema,
    }),

    section8_geoLocation: Joi.object({
      geoLocationDescription: Joi.string().allow('').optional(),
      geoLocationFile: uploadSchema,
    }),
  });

  return schema.validate(data, { abortEarly: false, allowUnknown: true });
};

import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';
import logger from '../config/logger.js';
import { reportCache } from '../utils/cache.js';

export const createOrUpdateFlatSummary = async (dprDocument) => {
  try {
    const sec1 = dprDocument.section1_deptDetails || {};
    const sec2 = dprDocument.section2_springIdentification || {};
    const sec3 = dprDocument.section3_springDescription || {};
    const sec5 = dprDocument.section5_hydroGeological || {};
    const sec6 = dprDocument.section6_physicalCharacteristics || {};
    const sec7 = dprDocument.section7_otherInformation || {};
    const sec8 = dprDocument.section8_rechargeArea || {};
    const sec9 = dprDocument.section9_communityInitiatives || {};
    const sec10 = dprDocument.section10_budgetAndPlan || {};

    const springs = sec2.springs || [];
    const table31 = sec3.table31 || [];
    const table32 = sec3.table32 || [];
    const table51 = sec5.table51 || [];
    const table61 = sec6.table61 || [];
    const table62 = sec6.table62 || [];
    const table71 = sec7.table71 || [];
    const table73 = sec7.table73 || [];
    const table81 = sec8.table81 || [];
    const table91 = sec9.table91 || [];

    // Table 3.1
    const springTypeBreakdown = { naula: 0, dhara: 0, gadheraNala: 0, other: 0 };
    const springNatureBreakdown = { perennial: 0, seasonal: 0, dried: 0 };
    table31.forEach(r => {
      if (r.springType === 'Naula') springTypeBreakdown.naula++;
      else if (r.springType === 'Dhara') springTypeBreakdown.dhara++;
      else if (r.springType === 'Gadhera/Nala') springTypeBreakdown.gadheraNala++;
      else springTypeBreakdown.other++;

      if (r.springNature === 'Perennial') springNatureBreakdown.perennial++;
      else if (r.springNature === 'Seasonal') springNatureBreakdown.seasonal++;
      else if (r.springNature === 'Dried') springNatureBreakdown.dried++;
    });

    // Table 3.2
    const totalPopulationBenefited = table32.reduce((s, r) => s + (r.populationBenefited || 0), 0);
    const publicOwnershipCount = table32.filter(r => r.ownership === 'Public').length;
    const privateOwnershipCount = table32.filter(r => r.ownership === 'Private').length;
    const pipeSupplyCount = table32.filter(r => r.pipeWaterSupply === true).length;

    // Table 5.1
    const typologyBreakdown = { contact: 0, depression: 0, fractureFault: 0, karst: 0, thermal: 0 };
    table51.forEach(r => {
      if (r.typology === 'Contact') typologyBreakdown.contact++;
      else if (r.typology === 'Depression') typologyBreakdown.depression++;
      else if (r.typology === 'Fracture/Fault') typologyBreakdown.fractureFault++;
      else if (r.typology === 'Karst') typologyBreakdown.karst++;
      else if (r.typology === 'Thermal') typologyBreakdown.thermal++;
    });

    // Table 6.1
    const measurable = table61.filter(r => r.dischargeMessurable);
    const totalDischargeLPM = measurable.reduce((s, r) => s + (r.springDischargeLPM || 0), 0);
    const avgDischargeLPM = measurable.length > 0 ? totalDischargeLPM / measurable.length : 0;
    const highVariabilityCount = table61.filter(r => r.seasonalVariability === 'High').length;
    const lowVariabilityCount = table61.filter(r => r.seasonalVariability === 'Low').length;

    // Table 6.2
    const dischargeTrendBreakdown = { highlyDecreased: 0, slightlyDecreased: 0, noChange: 0, increased: 0 };
    table62.forEach(r => {
      if (r.dischargeTrend === 'Highly decreased') dischargeTrendBreakdown.highlyDecreased++;
      else if (r.dischargeTrend === 'Slightly decreased') dischargeTrendBreakdown.slightlyDecreased++;
      else if (r.dischargeTrend === 'No change') dischargeTrendBreakdown.noChange++;
      else if (r.dischargeTrend === 'Increased') dischargeTrendBreakdown.increased++;
    });

    // Table 7.1
    const resourceThreatCount = table71.filter(r => r.resourceThreat === true).length;
    const threatDegreeBreakdown = { low: 0, moderate: 0, high: 0 };
    table71.forEach(r => {
      if (r.degreeOfThreat === 'Low') threatDegreeBreakdown.low++;
      else if (r.degreeOfThreat === 'Moderate') threatDegreeBreakdown.moderate++;
      else if (r.degreeOfThreat === 'High') threatDegreeBreakdown.high++;
    });

    // Table 7.3
    const waterUsageBreakdown = {
      drinkingCooking: 0, washingSanitation: 0, cattlesLivestock: 0,
      irrigation: 0, industrial: 0, other: 0
    };
    table73.forEach(r => {
      if (r.waterUsage && Array.isArray(r.waterUsage)) {
        r.waterUsage.forEach(u => {
          if (u === 'Drinking/Cooking') waterUsageBreakdown.drinkingCooking++;
          else if (u === 'Washing/Sanitation') waterUsageBreakdown.washingSanitation++;
          else if (u === 'Cattles/Livestock') waterUsageBreakdown.cattlesLivestock++;
          else if (u === 'Irrigation') waterUsageBreakdown.irrigation++;
          else if (u === 'Industrial') waterUsageBreakdown.industrial++;
          else if (u === 'Other') waterUsageBreakdown.other++;
        });
      }
    });

    const totalDependentHouseholds = table73.reduce((s, r) => s + (r.dependentHouseholds || 0), 0);
    const totalDependentPopulation = table73.reduce((s, r) => s + (r.dependentPopulation || 0), 0);
    const totalDependentLivestock = table73.reduce((s, r) => s + (r.dependentLivestock || 0), 0);

    // Table 8.1
    const rechargeAreaDemarcatedCount = table81.filter(r => r.rechargeAreaDemarcated === true).length;
    const totalRechargeAreaHa = table81.reduce((s, r) => s + (r.totalRechargeAreaHa || 0), 0);
    const totalForestLandHa = table81.reduce((s, r) => s + (r.forestLandHa || 0), 0);
    const totalRevenueLandHa = table81.reduce((s, r) => s + (r.revenueLandHa || 0), 0);
    const totalPrivateLandHa = table81.reduce((s, r) => s + (r.privateLandHa || 0), 0);

    // Table 9.1
    const samitiExistsCount = table91.filter(r => r.dharaNaulaSamitiExists === true).length;
    const samitiInterestedCount = table91.filter(r => r.samitiInterestedInImplementation === true).length;
    const samitiMonitoringCount = table91.filter(r => r.samitiForMonitoring === true).length;

    // Table 10.1 & 10.3
    const table101 = sec10.table101 || {};
    const table103 = sec10.table103 || {};

    // Table 10.2
    const activityTargets = (sec10.table102 || []).map(r => ({
      activityId: r.activityId,
      activityLabel: r.activityLabel,
      unit: r.unit,
      totalPhysicalTarget: r.totalPhysicalTarget || 0,
      financialAmountLakh: r.financialAmountLakh || 0
    }));

    const updatePayload = {
      dprId: dprDocument._id,                          // ← explicit so upsert always sets required field
      applicationNo: dprDocument.applicationNo,
      formType: dprDocument.formType || 'SPRINGSHED',
      status: dprDocument.status,
      submittedBy: dprDocument.submittedBy,
      submittedByName: sec10.submittedByName || sec10.responsibleOfficer?.nodalOfficerName || 'Unknown',
      submittedAt: dprDocument.submittedAt,
      approvedAt: dprDocument.approvedAt,
      reviewedBy: dprDocument.reviewedBy,
      rejectionCount: dprDocument.rejectionCount || 0,

      district: sec1.district || dprDocument.submittedByDistrict,
      department: sec1.department || dprDocument.submittedByDepartment,
      block: sec1.block,
      gramPanchayat: sec10.responsibleOfficer?.gramPanchayat,
      springDistrict: sec2.springDistrict || sec1.district || dprDocument.submittedByDistrict,
      springBlock: sec2.springBlock || sec1.block,
      springGP: sec2.springGP,

      springCount: springs.length,
      springNames: springs.map(s => s.name).filter(Boolean),
      springCodes: springs.map(s => s.springCode).filter(Boolean),

      springTypeBreakdown,
      springNatureBreakdown,
      totalPopulationBenefited,
      publicOwnershipCount,
      privateOwnershipCount,
      pipeSupplyCount,

      typologyBreakdown,

      avgDischargeLPM: Math.round(avgDischargeLPM * 100) / 100,
      totalDischargeLPM: Math.round(totalDischargeLPM * 100) / 100,
      highVariabilityCount,
      lowVariabilityCount,
      dischargeTrendBreakdown,

      resourceThreatCount,
      threatDegreeBreakdown,
      waterUsageBreakdown,
      totalDependentHouseholds,
      totalDependentPopulation,
      totalDependentLivestock,

      rechargeAreaDemarcatedCount,
      totalRechargeAreaHa: Math.round(totalRechargeAreaHa * 100) / 100,
      totalForestLandHa: Math.round(totalForestLandHa * 100) / 100,
      totalRevenueLandHa: Math.round(totalRevenueLandHa * 100) / 100,
      totalPrivateLandHa: Math.round(totalPrivateLandHa * 100) / 100,

      samitiExistsCount,
      samitiInterestedCount,
      samitiMonitoringCount,

      totalBudgetLakh: Math.round((table101.totalBudgetLakh || 0) * 100) / 100,
      dprPreparationBudgetLakh: Math.round((table101.dprPreparationBudgetLakh || 0) * 100) / 100,
      totalInterventionsCostLakh: Math.round((table101.totalInterventionsCostLakh || 0) * 100) / 100,
      monitoringEvaluationBudgetLakh: Math.round((table101.monitoringEvaluationBudgetLakh || 0) * 100) / 100,
      fundFromPIADeptLakh: Math.round((table103.fundFromPIADeptLakh || 0) * 100) / 100,
      fundFromOtherSourcesLakh: Math.round((table103.fundFromOtherSourcesLakh || 0) * 100) / 100,
      fundFromSARRAConvergenceLakh: Math.round((table103.fundFromSARRAConvergenceLakh || 0) * 100) / 100,
      grandTotalLakh: Math.round((table103.grandTotalLakh || 0) * 100) / 100,

      activityTargets
    };

    await DPRFlatSummary.findOneAndUpdate(
      { dprId: dprDocument._id },
      { $set: updatePayload },
      { upsert: true, new: true }
    );

    reportCache.invalidate('overview');
    reportCache.invalidate('district');
    reportCache.invalidate('department');
    reportCache.invalidate('monthly');
    reportCache.invalidate('spring');
    reportCache.invalidate('budget');
    reportCache.invalidate('list');
    reportCache.invalidate('approval');

  } catch (error) {
    logger.error(`Failed to create/update flat summary for DPR ${dprDocument._id}: ${error.message}`);
  }
};

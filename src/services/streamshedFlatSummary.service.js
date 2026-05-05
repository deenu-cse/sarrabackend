import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';

export const createOrUpdateFlatSummary = async (doc) => {
  try {
    const s1 = doc.section1_deptDetails || {};
    const s2 = doc.section2_streamIdentification || {};
    const s3 = doc.section3_catchmentArea || {};
    const s5 = doc.section5_rechargeAreas || {};
    const s7 = doc.section7_budgetAndPlan || {};

    const table21 = s2.table21 || [];
    const table22 = s2.table22 || [];
    const table23 = s2.table23 || [];
    const table31 = s3.table31 || [];
    const table51 = s5.table51 || [];

    const streamCount = table21.length;
    const streamNames = table21.map(s => s.name).filter(Boolean);
    const mainStream = table21.find(s => s.detail === 'Main Stream');
    const mainStreamName = mainStream ? mainStream.name : '';

    const totalLengthKm = table21.reduce((sum, item) => sum + (Number(item.lengthKm) || 0), 0);

    const perennialStreamCount = table22.filter(s => s.streamNature === 'Perennial').length;
    const seasonalStreamCount = table22.filter(s => s.streamNature === 'Seasonal').length;
    const driedStreamCount = table22.filter(s => s.streamNature === 'Dried').length;

    const totalCatchmentAreaHa = table31.reduce((sum, item) => sum + (Number(item.catchmentAreaHa) || 0), 0);
    const totalRechargeAreaHa = table51.reduce((sum, item) => sum + (Number(item.totalRechargeAreaHa) || 0), 0);
    const totalForestLandHa = table51.reduce((sum, item) => sum + (Number(item.forestLandHa) || 0), 0);
    const totalRevenueLandHa = table51.reduce((sum, item) => sum + (Number(item.revenueLandHa) || 0), 0);
    const totalPrivateLandHa = table51.reduce((sum, item) => sum + (Number(item.privateLandHa) || 0), 0);
    
    const rechargeAreaDemarcatedCount = table51.filter(s => s.rechargeAreaDemarcated === true).length;

    const totalBenefitedPopulation = table23.reduce((sum, item) => sum + (Number(item.benefitedPopulation) || 0), 0);

    const waterRechargePercentage = s7.table73?.waterRechargePercentage || 0;
    const subWatershedName = s2.subWatershedName || '';
    const microWatershedName = s2.microWatershedName || '';

    const budget = s7.table71 || {};
    const funding = s7.table74 || {};

    const flatData = {
      applicationNo: doc.applicationNo,
      dprId: doc._id,
      formType: doc.formType || 'STREAMSHED',
      status: doc.status,
      isDraft: doc.isDraft,
      submittedBy: doc.submittedBy,
      submittedAt: doc.submittedAt,
      approvedAt: doc.approvedAt,

      // Mapped to the common report schema fields
      district: s1.district || doc.submittedByDistrict || '',
      department: s1.department || doc.submittedByDepartment || '',
      block: s1.block || s2.blockTown || '',

      submittedByDistrict: doc.submittedByDistrict,
      submittedByDepartment: doc.submittedByDepartment,

      // Streamshed-specific
      streamCount,
      streamNames,
      mainStreamName,
      totalLengthKm,
      perennialStreamCount,
      seasonalStreamCount,
      driedStreamCount,
      totalCatchmentAreaHa,
      totalRechargeAreaHa,
      totalForestLandHa,
      totalRevenueLandHa,
      totalPrivateLandHa,
      rechargeAreaDemarcatedCount,
      totalBenefitedPopulation,
      totalPopulationBenefited: totalBenefitedPopulation,
      waterRechargePercentage,
      subWatershedName,
      microWatershedName,

      // Budget (shared field names with Springshed)
      totalBudgetLakh: budget.totalBudgetLakh || 0,
      dprPreparationBudgetLakh: budget.dprPreparationBudgetLakh || 0,
      totalInterventionsCostLakh: budget.totalInterventionsCostLakh || 0,
      monitoringEvaluationBudgetLakh: budget.monitoringEvaluationBudgetLakh || 0,

      fundFromPIADeptLakh: funding.fundFromPIADeptLakh || 0,
      fundFromOtherSourcesLakh: funding.fundFromOtherSourcesLakh || 0,
      fundFromSARRAConvergenceLakh: funding.fundFromSARRAConvergenceLakh || 0,
      grandTotalLakh: funding.grandTotalLakh || 0,

      // Spring-type fields zeroed (not applicable for streamshed)
      springCount: 0,
    };

    await DPRFlatSummary.findOneAndUpdate(
      { applicationNo: doc.applicationNo },
      flatData,
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error updating Streamshed DPR Flat Summary:', error.message);
  }
};

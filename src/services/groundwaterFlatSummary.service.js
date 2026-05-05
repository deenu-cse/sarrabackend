import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';
import logger from '../config/logger.js';
import { reportCache } from '../utils/cache.js';

export const createOrUpdateFlatSummary = async (dprDocument) => {
  try {
    const sec1 = dprDocument.section1_deptDetails || {};
    const sec2 = dprDocument.section2_aquiferIdentification || {};
    const sec4 = dprDocument.section4_riskAssessment || {};
    const sec5 = dprDocument.section5_budgetAndPlan || {};

    const arsDetails = sec2.arsDetails || [];
    const hydrologicalDetails = sec2.hydrologicalDetails || [];

    const arsCount = arsDetails.length;
    const arsNames = arsDetails.map(ars => ars.name).filter(Boolean);
    const totalRechargeAreaHa = arsDetails.reduce((sum, ars) => sum + (ars.approxRechargeAreaHa || 0), 0);

    const totalDepthPre = hydrologicalDetails.reduce((sum, h) => sum + (h.depthToWaterTablePreMonsoon || 0), 0);
    const totalDepthPost = hydrologicalDetails.reduce((sum, h) => sum + (h.depthToWaterTablePostMonsoon || 0), 0);
    
    const avgDepthPreMonsoon = hydrologicalDetails.length > 0 ? totalDepthPre / hydrologicalDetails.length : 0;
    const avgDepthPostMonsoon = hydrologicalDetails.length > 0 ? totalDepthPost / hydrologicalDetails.length : 0;

    const table51 = sec5.table51 || {};
    const table74 = sec5.table74 || {};
    const table83 = sec5.table83 || {};

    const landTypeBreakdown = arsDetails.reduce((acc, ars) => {
      const type = (ars.landTypeDesignation || 'Other').toLowerCase();
      if (type.includes('forest')) acc.forest += (ars.approxRechargeAreaHa || 0);
      else if (type.includes('revenue')) acc.revenue += (ars.approxRechargeAreaHa || 0);
      else acc.private += (ars.approxRechargeAreaHa || 0);
      return acc;
    }, { forest: 0, revenue: 0, private: 0 });

    const updatePayload = {
      dprId: dprDocument._id,
      applicationNo: dprDocument.applicationNo,
      formType: dprDocument.formType || 'GROUNDWATER',
      status: dprDocument.status,
      submittedBy: dprDocument.submittedBy,
      submittedByName: sec5.submittedByName || sec5.responsibleOfficer?.nodalOfficerName || 'Unknown',
      submittedAt: dprDocument.submittedAt,
      approvedAt: dprDocument.approvedAt,
      reviewedBy: dprDocument.reviewedBy,
      rejectionCount: dprDocument.rejectionCount || 0,

      district: sec1.district || dprDocument.submittedByDistrict,
      department: sec1.department || dprDocument.submittedByDepartment,
      block: sec1.block,
      gramPanchayat: sec5.responsibleOfficer?.gramPanchayat,
      
      subWatershedName: sec2.subWatershedName,
      microWatershedName: sec2.microWatershedName,

      arsCount,
      arsNames,
      totalRechargeAreaHa: Math.round(totalRechargeAreaHa * 100) / 100,
      totalForestLandHa: Math.round(landTypeBreakdown.forest * 100) / 100,
      totalRevenueLandHa: Math.round(landTypeBreakdown.revenue * 100) / 100,
      totalPrivateLandHa: Math.round(landTypeBreakdown.private * 100) / 100,
      
      totalPopulationBenefited: sec2.noOfVillagesHabitation || 0, // Using villages as impact proxy
      
      groundwaterAvailabilityStatus: sec2.groundwaterAvailabilityStatus,
      vulnerabilityLevel: sec4.vulnerabilityLevel,
      
      avgDepthPreMonsoon: Math.round(avgDepthPreMonsoon * 100) / 100,
      avgDepthPostMonsoon: Math.round(avgDepthPostMonsoon * 100) / 100,
      
      primaryGroundwaterUses: sec2.primaryGroundwaterUses || [],
      sourceOfWaterForRecharge: sec2.sourceOfWaterForRecharge,

      totalBudgetLakh: Math.round((table51.totalBudgetLakh || 0) * 100) / 100,
      dprPreparationBudgetLakh: Math.round((table51.dprPreparationBudgetLakh || 0) * 100) / 100,
      totalInterventionsCostLakh: Math.round((table51.totalInterventionsCostLakh || 0) * 100) / 100,
      monitoringEvaluationBudgetLakh: Math.round((table51.monitoringEvaluationBudgetLakh || 0) * 100) / 100,
      
      fundFromPIADeptLakh: Math.round((table74.fundFromPIADeptLakh || 0) * 100) / 100,
      fundFromOtherSourcesLakh: Math.round((table74.fundFromOtherSourcesLakh || 0) * 100) / 100,
      fundFromSARRAConvergenceLakh: Math.round((table74.fundFromSARRAConvergenceLakh || 0) * 100) / 100,
      grandTotalLakh: Math.round((table74.grandTotalLakh || 0) * 100) / 100,
      
      waterRechargePercentage: Math.round((table83.waterRechargePercentage || 0) * 100) / 100,

      activityTargets: (sec5.table52 || []).map(r => ({
        activityId: r.activityId,
        activityLabel: r.activityLabel,
        unit: r.unit,
        totalPhysicalTarget: r.totalPhysicalTarget || 0,
        financialAmountLakh: r.financialAmountLakh || 0
      }))
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
    reportCache.invalidate('spring'); // Used broadly
    reportCache.invalidate('budget');
    reportCache.invalidate('list');
    reportCache.invalidate('approval');

  } catch (error) {
    logger.error(`Failed to create/update flat summary for Groundwater DPR ${dprDocument._id}: ${error.message}`);
  }
};

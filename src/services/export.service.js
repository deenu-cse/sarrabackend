import { stringify } from 'csv-stringify';
import { pipeline } from 'stream';
import { DPRFlatSummary } from '../models/DPRFlatSummary.model.js';
import SpringshedDPR from '../models/SpringshedDPR.model.js';
import { buildFilterHelper, getOverviewStats, getDistrictWiseStats } from './report.service.js';
import { buildSummaryExcel, buildDistrictExcel, buildDepartmentExcel, buildBudgetExcel } from '../utils/excelBuilder.js';
import { buildSingleDPRPDF, buildSummaryPDF } from '../utils/pdfBuilder.js';

export const generateCSV = async (filters, type, res) => {
  const matchFilter = buildFilterHelper(filters);

  if (type === 'springs') {
    const aggPipeline = [
      { $match: matchFilter },
      { $unwind: '$section2_springIdentification.springs' },
      {
        $project: {
          applicationNo: 1,
          district: '$section1_deptDetails.district',
          springName: '$section2_springIdentification.springs.name',
          springCode: '$section2_springIdentification.springs.springCode',
          village: '$section2_springIdentification.springs.revenueVillage'
        }
      }
    ];

    const cursor = SpringshedDPR.aggregate(aggPipeline).cursor();

    const stringifier = stringify({
      header: true,
      columns: ['Application No', 'District', 'Spring Name', 'Spring Code', 'Village']
    });

    pipeline(cursor, stringifier, res, (err) => {
      if (err) console.error('CSV export failed', err);
    });
    return;
  }

  // Common flattened cursor
  const cursor = DPRFlatSummary.find(matchFilter).cursor();

  let columns = [];
  if (type === 'summary') {
    columns = [
      { key: 'applicationNo', header: 'Application No' },
      { key: 'district', header: 'District' },
      { key: 'department', header: 'Department' },
      { key: 'block', header: 'Block' },
      { key: 'gramPanchayat', header: 'Gram Panchayat' },
      { key: 'status', header: 'Status' },
      { key: 'springCount', header: 'Spring Count' },
      { key: 'totalPopulationBenefited', header: 'Total Population Benefited' },
      { key: 'totalRechargeAreaHa', header: 'Total Recharge Area (Ha)' },
      { key: 'totalBudgetLakh', header: 'Total Budget (Lakh)' },
      { key: 'submittedAt', header: 'Submitted At' },
      { key: 'submittedByName', header: 'Submitted By' },
      { key: 'approvedAt', header: 'Approved At' }
    ];
  } else if (type === 'budget') {
    columns = [
      { key: 'applicationNo', header: 'Application No' },
      { key: 'district', header: 'District' },
      { key: 'department', header: 'Department' },
      { key: 'totalBudgetLakh', header: 'Total Budget (Lakh)' },
      { key: 'dprPreparationBudgetLakh', header: 'DPR Prep Budget' },
      { key: 'totalInterventionsCostLakh', header: 'Interventions Cost' },
      { key: 'monitoringEvaluationBudgetLakh', header: 'M&E Budget' },
      { key: 'fundFromPIADeptLakh', header: 'PIA Fund' },
      { key: 'fundFromOtherSourcesLakh', header: 'Other Sources Fund' },
      { key: 'fundFromSARRAConvergenceLakh', header: 'SARRA Convergence Fund' },
      { key: 'grandTotalLakh', header: 'Grand Total' }
    ];
  } else {
    // Detailed
    columns = [
      { key: 'applicationNo', header: 'Application No' },
      { key: 'district', header: 'District' },
      { key: 'status', header: 'Status' },
      { key: 'springNamesJoined', header: 'Springs' },
      { key: 'springTypeBreakdown.naula', header: 'Naula Count' },
      { key: 'springTypeBreakdown.dhara', header: 'Dhara Count' },
      { key: 'avgDischargeLPM', header: 'Avg Discharge LPM' },
      { key: 'resourceThreatCount', header: 'Resource Threat Count' },
      { key: 'samitiExistsCount', header: 'Samiti Exists Count' }
    ];
  }

  const stringifier = stringify({ header: true, columns: columns.map(c => c.header) });

  const transformFunc = async function* (source) {
    for await (const doc of source) {
      const row = columns.map(col => {
        if (col.key === 'springNamesJoined') return doc.springNames.join(' | ');
        if (col.key.includes('.')) {
          const [a, b] = col.key.split('.');
          return doc[a] ? doc[a][b] : '';
        }
        return doc[col.key];
      });
      yield row;
    }
  };

  pipeline(cursor, transformFunc, stringifier, res, (err) => {
    if (err) console.error('CSV export failed', err);
  });
};

export const generateExcel = async (filters, type, res) => {
  const matchFilter = buildFilterHelper(filters);
  let workbook;

  if (type === 'summary') {
    const data = await DPRFlatSummary.find(matchFilter).lean();
    workbook = await buildSummaryExcel(data);
  } else if (type === 'district_report') {
    const [overview, districts] = await Promise.all([
      getOverviewStats(filters),
      getDistrictWiseStats(filters)
    ]);
    workbook = await buildDistrictExcel(overview, districts);
  } else if (type === 'department_report') {
    const { getDepartmentWiseStats } = await import('./report.service.js');
    const overview = await getOverviewStats(filters);
    const depts = await getDepartmentWiseStats(filters);
    const { buildDepartmentExcel } = await import('../utils/excelBuilder.js');
    workbook = await buildDepartmentExcel(overview, depts);
  } else if (type === 'budget') {
    const { getBudgetStats } = await import('./report.service.js');
    const { buildBudgetExcel } = await import('../utils/excelBuilder.js');
    const budgetData = await getBudgetStats(filters);
    workbook = await buildBudgetExcel(budgetData, budgetData.activityWiseBudget);
  }

  if (workbook) {
    await workbook.xlsx.write(res);
    res.end();
  } else {
    res.status(400).send('Invalid Excel type');
  }
};

export const generateSingleDPRPDF = async (dprId, res) => {
  const dpr = await SpringshedDPR.findById(dprId).lean();
  if (!dpr) throw new Error('DPR not found');
  buildSingleDPRPDF(dpr, res);
};

export const generateSummaryPDF = async (filters, res) => {
  const overview = await getOverviewStats(filters);
  const districtStats = await getDistrictWiseStats(filters);
  buildSummaryPDF({ overview, districtStats }, res);
};

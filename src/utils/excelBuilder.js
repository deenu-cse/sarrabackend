import ExcelJS from 'exceljs';

export const buildSummaryExcel = async (dataList) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Summary Report', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });

  sheet.columns = [
    { header: 'Application No', key: 'applicationNo', width: 20 },
    { header: 'District', key: 'district', width: 15 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Block', key: 'block', width: 15 },
    { header: 'Gram Panchayat', key: 'gramPanchayat', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Spring Count', key: 'springCount', width: 15 },
    { header: 'Total Population Benefited', key: 'totalPopulationBenefited', width: 25 },
    { header: 'Total Recharge Area (Ha)', key: 'totalRechargeAreaHa', width: 25 },
    { header: 'Total Budget (Lakh)', key: 'totalBudgetLakh', width: 20 },
    { header: 'Submitted At', key: 'submittedAt', width: 20 },
    { header: 'Submitted By', key: 'submittedByName', width: 20 },
    { header: 'Approved At', key: 'approvedAt', width: 20 }
  ];

  formatHeaders(sheet);

  dataList.forEach((data, i) => {
    const row = sheet.addRow({
      ...data,
      submittedAt: data.submittedAt ? new Date(data.submittedAt).toLocaleDateString() : '',
      approvedAt: data.approvedAt ? new Date(data.approvedAt).toLocaleDateString() : ''
    });
    formatRow(row, i);
  });

  return workbook;
};

export const buildDistrictExcel = async (overviewData, districtList) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('District Wise Stats', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });

  sheet.columns = [
    { header: 'District', key: 'district', width: 20 },
    { header: 'Total Forms', key: 'totalForms', width: 15 },
    { header: 'Approved', key: 'approved', width: 15 },
    { header: 'Pending', key: 'pending', width: 15 },
    { header: 'Rejected', key: 'rejected', width: 15 },
    { header: 'Approval Rate (%)', key: 'approvalRate', width: 20 },
    { header: 'Total Budget (Lakh)', key: 'totalBudgetLakh', width: 20 },
    { header: 'Total Springs', key: 'totalSprings', width: 15 },
    { header: 'Total Population Benefited', key: 'totalPopulation', width: 25 },
    { header: 'Total Recharge Area (Ha)', key: 'totalRecharge', width: 25 }
  ];

  formatHeaders(sheet);

  districtList.forEach((data, i) => {
    const row = sheet.addRow(data);
    formatRow(row, i);
  });

  return workbook;
};

export const buildDepartmentExcel = async (overviewData, departmentList) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Department Wise Stats', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });

  sheet.columns = [
    { header: 'Department', key: 'department', width: 30 },
    { header: 'Total Forms', key: 'totalForms', width: 15 },
    { header: 'Approved', key: 'approved', width: 15 },
    { header: 'Pending', key: 'pending', width: 15 },
    { header: 'Rejected', key: 'rejected', width: 15 },
    { header: 'Approval Rate (%)', key: 'approvalRate', width: 20 },
    { header: 'Total Budget (Lakh)', key: 'totalBudgetLakh', width: 20 },
    { header: 'Budget Share (%)', key: 'totalDeptBudgetShare', width: 20 },
    { header: 'Total Springs', key: 'totalSprings', width: 15 },
    { header: 'Total Population', key: 'totalPopulation', width: 20 }
  ];

  formatHeaders(sheet);

  departmentList.forEach((data, i) => {
    const row = sheet.addRow(data);
    formatRow(row, i);
  });

  return workbook;
};

export const buildBudgetExcel = async (budgetData, activityData) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Budget Breakdown', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });

  sheet.columns = [
    { header: 'Activity ID', key: 'activityId', width: 20 },
    { header: 'Activity Label', key: 'activityLabel', width: 40 },
    { header: 'Total Financial (Lakh)', key: 'totalFinancialAmountLakh', width: 25 },
    { header: 'Total Physical Target', key: 'totalPhysicalTarget', width: 25 },
    { header: 'Forms Included', key: 'formCount', width: 15 }
  ];

  formatHeaders(sheet);

  activityData.forEach((data, i) => {
    const row = sheet.addRow(data);
    formatRow(row, i);
  });

  return workbook;
};

// --- Helpers ---

function formatHeaders(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0A3D62' }
  };
  headerRow.eachCell(cell => {
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  });
}

function formatRow(row, index) {
  const isAlternate = index % 2 === 1;
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: isAlternate ? 'FFF0F4F8' : 'FFFFFFFF' }
  };
  row.eachCell(cell => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
    };
    if (typeof cell.value === 'number') {
      cell.numFmt = '0.00';
    }
  });
}

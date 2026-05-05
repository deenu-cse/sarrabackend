import PDFDocument from 'pdfkit';

const THEME_BLUE = '#0a3d62';
const THEME_LIGHT = '#f0f4f8';
const THEME_ACCENT = '#e67e22';

export const buildSummaryPDF = (data, res) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  // Cover / Header
  doc.rect(0, 0, 595, 80).fill(THEME_BLUE);
  doc.fillColor('white').fontSize(24).text('SARRA Analytics & Report', 40, 25);
  doc.fontSize(12).text('Spring & River Rejuvenation Authority, Govt. of Uttarakhand', 40, 55);

  doc.moveDown(3);

  // Key Metrics
  doc.fillColor(THEME_BLUE).fontSize(18).text('Key Metrics', { underline: true });
  doc.moveDown(1);
  
  const metrics = [
    { label: 'Total Forms Submitted', value: data.overview.totalForms },
    { label: 'Approved Forms', value: data.overview.totalApproved },
    { label: 'Pending Forms', value: data.overview.totalPending },
    { label: 'Total Budget (Lakh)', value: data.overview.totalBudgetLakh },
    { label: 'Total Springs', value: data.overview.totalSprings },
    { label: 'Recharge Area (Ha)', value: data.overview.totalRechargeAreaHa },
  ];

  let y = doc.y;
  metrics.forEach((m, i) => {
    const x = i % 2 === 0 ? 40 : 300;
    if (i > 0 && i % 2 === 0) y += 50;

    doc.rect(x, y, 250, 40).fill(THEME_LIGHT);
    doc.fillColor('#333').fontSize(10).text(m.label, x + 10, y + 8);
    doc.fillColor(THEME_ACCENT).fontSize(16).text(m.value.toString(), x + 10, y + 20);
  });

  doc.moveDown(6);

  // District Wise Breakdown
  doc.fillColor(THEME_BLUE).fontSize(18).text('District Wise Overview', { underline: true });
  doc.moveDown(1);

  const headers = ['District', 'Total Forms', 'Approved', 'Budget (Lakh)'];
  const rows = data.districtStats.map(d => [
    d.district, d.totalForms.toString(), d.approved.toString(), d.totalBudgetLakh.toString()
  ]);

  drawTable(doc, headers, rows);

  doc.end();
};

export const buildSingleDPRPDF = (dpr, res) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  // Header
  doc.rect(0, 0, 595, 100).fill(THEME_BLUE);
  doc.fillColor('white').fontSize(20).text('Format for Spring Rejuvenation Plan Proposal', 40, 30);
  doc.fontSize(12).text(`Application No: ${dpr.applicationNo} | Status: ${dpr.status}`, 40, 60);

  doc.fillColor('black').moveDown(4);

  // Section 1
  doc.fontSize(16).fillColor(THEME_BLUE).text('Section 1 - Department / Organization Details');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('black');
  
  const s1 = dpr.section1_deptDetails;
  doc.text(`Department: ${s1.department}`);
  doc.text(`District: ${s1.district}`);
  doc.text(`Block: ${s1.block}`);
  doc.text(`Nodal Officer: ${s1.nodalOfficer}`);
  doc.text(`Contact: ${s1.contactNo}`);
  doc.text(`Email: ${s1.email}`);
  
  doc.moveDown(2);

  // Budget Summary
  doc.fontSize(16).fillColor(THEME_BLUE).text('Budget Summary (Lakh)');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('black');
  const b = dpr.section10_budgetAndPlan?.table101 || {};
  doc.text(`DPR Preparation: ${b.dprPreparationBudgetLakh || 0}`);
  doc.text(`Total Interventions: ${b.totalInterventionsCostLakh || 0}`);
  doc.text(`M&E Budget: ${b.monitoringEvaluationBudgetLakh || 0}`);
  doc.text(`Total Proposed Budget: ${b.totalBudgetLakh || 0}`);

  // End
  doc.end();
};

// Simple table drawing helper
function drawTable(doc, headers, rows) {
  const startY = doc.y;
  const startX = 40;
  const usableWidth = 515;
  const colWidth = usableWidth / headers.length;
  const rowHeight = 25;

  // Header
  doc.rect(startX, startY, usableWidth, rowHeight).fill(THEME_BLUE);
  doc.fillColor('white').fontSize(10);
  
  headers.forEach((h, i) => {
    doc.text(h, startX + (i * colWidth) + 5, startY + 8, { width: colWidth - 10, align: 'left' });
  });

  // Rows
  let currentY = startY + rowHeight;
  doc.fillColor('black');

  rows.forEach((row, i) => {
    if (currentY > 750) {
      doc.addPage();
      currentY = 40;
    }

    if (i % 2 === 0) {
      doc.rect(startX, currentY, usableWidth, rowHeight).fill(THEME_LIGHT);
    }
    
    doc.fillColor('black');
    row.forEach((cell, j) => {
      doc.text(cell, startX + (j * colWidth) + 5, currentY + 8, { width: colWidth - 10, align: 'left' });
    });

    currentY += rowHeight;
  });

  doc.y = currentY + 20;
}

const fs = require('fs');
const path = require('path');

const filePath = path.resolve('src/controllers/mprAbstract55.controller.js');
if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

// 1. Add imports for MPRPraroop1C and MPRPraroop1D
if (!content.includes('MPRPraroop1C')) {
    content = content.replace(
        /import MPRPraroop1B from '\.\.\/models\/MPRPraroop1B\.model\.js';/,
        `import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';`
    );
}

// 2. We need to fetch and aggregate praroop1c and praroop1d in getFullAnalytics
const targetMarker = `  result.praroop1b = praroop1b;`;
if (content.includes(targetMarker) && !content.includes('result.praroop1c = praroop1c;')) {
    
    const aggregationCode = `
  // ── Build dedicated Praroop-1(C) analytics section ──
  const praroopCMprs = await MPRPraroop1C.find(matchObj);

  // Merge 1C into overview totals
  result.overview.totalForms += praroopCMprs.length;
  result.overview.totalApproved += praroopCMprs.filter(m => m.status === 'APPROVED').length;
  result.overview.totalPending += praroopCMprs.filter(m => m.status === 'SUBMITTED').length;
  result.overview.totalRejected += praroopCMprs.filter(m => m.status === 'REJECTED').length;
  result.overview.statusBreakdown.forEach(s => {
    s.count += praroopCMprs.filter(m => m.status === s.status).length;
  });
  praroopCMprs.forEach(mpr => {
    const se = mpr.computed?.grandTotalSarraExpend || 0;
    const ds = mpr.computed?.grandTotalTargetDeptLakh || 0;
    const pr = mpr.totalApprovedSchemes || 0;
    result.overview.totalProposals += pr;
    result.overview.totalDeptShare += ds;
    result.overview.totalSarraShare += se;
    result.overview.totalBudget += (se + ds);
    const mt = result.monthlyTrend.find(m => m.month === mpr.reportingMonth);
    if (mt) { mt.submitted = (mt.submitted||0)+1; mt.proposals = (mt.proposals||0)+pr; mt.budget = (mt.budget||0)+(se+ds); }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        let dst = result.districtStats.find(x => x.name === d.district);
        if (!dst) { dst = { name: d.district, proposals: 0, deptShare: 0, sarraShare: 0, count: 0 }; result.districtStats.push(dst); }
        dst.proposals += (d.totalPhysical||0); dst.sarraShare += (d.totalSarraExpend||0); dst.count++;
      });
    }
  });

  const praroop1c = {
    overview: {
      totalForms: praroopCMprs.length,
      totalApproved: praroopCMprs.filter(m => m.status === 'APPROVED').length,
      totalPending: praroopCMprs.filter(m => m.status === 'SUBMITTED').length,
      totalRejected: praroopCMprs.filter(m => m.status === 'REJECTED').length,
      totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, activitiesWithProgress: 0,
      statusBreakdown: [
        { status: 'SUBMITTED', count: praroopCMprs.filter(m => m.status === 'SUBMITTED').length },
        { status: 'APPROVED', count: praroopCMprs.filter(m => m.status === 'APPROVED').length },
        { status: 'REJECTED', count: praroopCMprs.filter(m => m.status === 'REJECTED').length }
      ]
    },
    activityStats: [], districtStats: [], recentForms: []
  };
  const actMapC = {}; const distMapC = {};
  praroopCMprs.forEach(mpr => {
    praroop1c.overview.totalPhysicalProgress += (mpr.computed?.grandTotalPhysicalProgress||0);
    praroop1c.overview.totalSarraExpend += (mpr.computed?.grandTotalSarraExpend||0);
    praroop1c.overview.totalSarraBudget += (mpr.computed?.grandTotalTargetSarraLakh||0);
    praroop1c.overview.totalDeptBudget += (mpr.computed?.grandTotalTargetDeptLakh||0);
    praroop1c.overview.activitiesWithProgress += (mpr.computed?.activitiesWithProgress||0);
    if (mpr.activities) {
      mpr.activities.forEach(act => {
        if (act.isHeader) return;
        if (!actMapC[act.activityCode]) {
          actMapC[act.activityCode] = { code: act.activityCode, name: act.activityEnglishName, hindiName: act.activityName, unit: act.unit||'', totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, targetUnit: 0 };
        }
        const a = actMapC[act.activityCode];
        a.totalPhysicalProgress += (act.districtTotals?.totalPhysicalProgress||0);
        a.totalSarraExpend += (act.districtTotals?.totalSarraExpend||0);
        a.totalSarraBudget += (act.districtTotals?.targetSarraShareLakh||0);
        a.totalDeptBudget += (act.districtTotals?.targetDeptShareLakh||0);
        a.targetUnit += (act.districtTotals?.targetUnit||0);
      });
    }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        if (!distMapC[d.district]) distMapC[d.district] = { name: d.district, totalPhysical: 0, totalSarraExpend: 0 };
        distMapC[d.district].totalPhysical += (d.totalPhysical||0);
        distMapC[d.district].totalSarraExpend += (d.totalSarraExpend||0);
      });
    }
  });
  praroop1c.activityStats = Object.values(actMapC);
  praroop1c.districtStats = Object.values(distMapC).filter(d => d.totalPhysical > 0 || d.totalSarraExpend > 0);
  praroop1c.recentForms = praroopCMprs.slice(0, 5).map(m => ({
    _id: m._id, applicationNo: m.applicationNo, reportingMonth: m.reportingMonth, financialYear: m.financialYear,
    status: m.status, submittedByDistrict: m.submittedByDistrict, submittedAt: m.submittedAt,
    grandTotalPhysicalProgress: m.computed?.grandTotalPhysicalProgress||0, grandTotalSarraExpend: m.computed?.grandTotalSarraExpend||0
  }));
  result.praroop1c = praroop1c;

  // ── Build dedicated Praroop-1(D) analytics section ──
  const praroopDMprs = await MPRPraroop1D.find(matchObj);

  // Merge 1D into overview totals
  result.overview.totalForms += praroopDMprs.length;
  result.overview.totalApproved += praroopDMprs.filter(m => m.status === 'APPROVED').length;
  result.overview.totalPending += praroopDMprs.filter(m => m.status === 'SUBMITTED').length;
  result.overview.totalRejected += praroopDMprs.filter(m => m.status === 'REJECTED').length;
  result.overview.statusBreakdown.forEach(s => {
    s.count += praroopDMprs.filter(m => m.status === s.status).length;
  });
  praroopDMprs.forEach(mpr => {
    const se = mpr.computed?.grandTotalSarraExpend || 0;
    const ds = mpr.computed?.grandTotalTargetDeptLakh || 0;
    const pr = mpr.totalApprovedSchemes || 0;
    result.overview.totalProposals += pr;
    result.overview.totalDeptShare += ds;
    result.overview.totalSarraShare += se;
    result.overview.totalBudget += (se + ds);
    const mt = result.monthlyTrend.find(m => m.month === mpr.reportingMonth);
    if (mt) { mt.submitted = (mt.submitted||0)+1; mt.proposals = (mt.proposals||0)+pr; mt.budget = (mt.budget||0)+(se+ds); }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        let dst = result.districtStats.find(x => x.name === d.district);
        if (!dst) { dst = { name: d.district, proposals: 0, deptShare: 0, sarraShare: 0, count: 0 }; result.districtStats.push(dst); }
        dst.proposals += (d.totalPhysical||0); dst.sarraShare += (d.totalSarraExpend||0); dst.count++;
      });
    }
  });

  const praroop1d = {
    overview: {
      totalForms: praroopDMprs.length,
      totalApproved: praroopDMprs.filter(m => m.status === 'APPROVED').length,
      totalPending: praroopDMprs.filter(m => m.status === 'SUBMITTED').length,
      totalRejected: praroopDMprs.filter(m => m.status === 'REJECTED').length,
      totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, activitiesWithProgress: 0,
      statusBreakdown: [
        { status: 'SUBMITTED', count: praroopDMprs.filter(m => m.status === 'SUBMITTED').length },
        { status: 'APPROVED', count: praroopDMprs.filter(m => m.status === 'APPROVED').length },
        { status: 'REJECTED', count: praroopDMprs.filter(m => m.status === 'REJECTED').length }
      ]
    },
    activityStats: [], districtStats: [], recentForms: []
  };
  const actMapD = {}; const distMapD = {};
  praroopDMprs.forEach(mpr => {
    praroop1d.overview.totalPhysicalProgress += (mpr.computed?.grandTotalPhysicalProgress||0);
    praroop1d.overview.totalSarraExpend += (mpr.computed?.grandTotalSarraExpend||0);
    praroop1d.overview.totalSarraBudget += (mpr.computed?.grandTotalTargetSarraLakh||0);
    praroop1d.overview.totalDeptBudget += (mpr.computed?.grandTotalTargetDeptLakh||0);
    praroop1d.overview.activitiesWithProgress += (mpr.computed?.activitiesWithProgress||0);
    if (mpr.activities) {
      mpr.activities.forEach(act => {
        if (act.isHeader) return;
        if (!actMapD[act.activityCode]) {
          actMapD[act.activityCode] = { code: act.activityCode, name: act.activityEnglishName, hindiName: act.activityName, unit: act.unit||'', totalPhysicalProgress: 0, totalSarraExpend: 0, totalSarraBudget: 0, totalDeptBudget: 0, targetUnit: 0 };
        }
        const a = actMapD[act.activityCode];
        a.totalPhysicalProgress += (act.districtTotals?.totalPhysicalProgress||0);
        a.totalSarraExpend += (act.districtTotals?.totalSarraExpend||0);
        a.totalSarraBudget += (act.districtTotals?.targetSarraShareLakh||0);
        a.totalDeptBudget += (act.districtTotals?.targetDeptShareLakh||0);
        a.targetUnit += (act.districtTotals?.targetUnit||0);
      });
    }
    if (mpr.computed?.districtWiseSummary) {
      mpr.computed.districtWiseSummary.forEach(d => {
        if (!distMapD[d.district]) distMapD[d.district] = { name: d.district, totalPhysical: 0, totalSarraExpend: 0 };
        distMapD[d.district].totalPhysical += (d.totalPhysical||0);
        distMapD[d.district].totalSarraExpend += (d.totalSarraExpend||0);
      });
    }
  });
  praroop1d.activityStats = Object.values(actMapD);
  praroop1d.districtStats = Object.values(distMapD).filter(d => d.totalPhysical > 0 || d.totalSarraExpend > 0);
  praroop1d.recentForms = praroopDMprs.slice(0, 5).map(m => ({
    _id: m._id, applicationNo: m.applicationNo, reportingMonth: m.reportingMonth, financialYear: m.financialYear,
    status: m.status, submittedByDistrict: m.submittedByDistrict, submittedAt: m.submittedAt,
    grandTotalPhysicalProgress: m.computed?.grandTotalPhysicalProgress||0, grandTotalSarraExpend: m.computed?.grandTotalSarraExpend||0
  }));
  result.praroop1d = praroop1d;
`;
    content = content.replace(targetMarker, targetMarker + '\n' + aggregationCode);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated backend controller via CJS!');

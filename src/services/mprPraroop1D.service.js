import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const DISTRICTS = ['Dehradun', 'Haridwar', 'Tehri', 'Pauri', 'Chamoli', 'Uttarkashi', 'Rudraprayag', 'USNagar', 'Nainital', 'Almora', 'Pithoragarh', 'Bageshwar', 'Champawat'];

const ACTIVITIES = [
  { code: '55-04', name: 'प्राथमिक / विस्तृत परियोजना रिपोर्ट पर व्यय', en: 'DPR Preparation', hasPhysical: false, hasSize: false },
  { code: '55-04(01)', name: 'समोच्च खन्तियां/कन्टूर ट्रेंच', en: 'Contour Trenches', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(02)', name: 'रिचार्ज पिट', en: 'Recharge Pit', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(03)', name: 'रिचार्ज शॉफ्ट', en: 'Recharge Shaft', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(04)', name: 'डग आउट पॉण्ड', en: 'Dugout Pond', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(05)', name: 'चाल / खाल', en: 'Chal-Khal', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(06)', name: 'मैदानी क्षेत्रों में अमृत सरोवर', en: 'Amrit Sarovar (Plains)', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(07)', name: 'मैदानी क्षेत्रों में अमृत सरोवर का पुनरोद्धार', en: 'Amrit Sarovar Restoration (Plains)', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(08)', name: 'मैदानी क्षेत्रों में बड़े तालाब', en: 'Large Ponds (Plains)', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-04(09)', name: 'मैदानी क्षेत्रों में बड़े तालाब का पुनरोद्धार', en: 'Large Ponds Restoration (Plains)', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: 'M&E', name: 'मूल्यांकन एवं अनुश्रवण / मूल्यांकन एवं अनुश्रवण पर व्यय', en: 'Monitoring & Evaluation', hasPhysical: false, hasSize: false }
];

const PREVIOUS_MONTH_MAP = {
  'May': 'April', 'June': 'May', 'July': 'June', 'August': 'July',
  'September': 'August', 'October': 'September', 'November': 'October',
  'December': 'November', 'January': 'December', 'February': 'January', 'March': 'February'
};

class MPRPraroop1DService {
  initializeActivityData() {
    return ACTIVITIES.map(act => ({
      activityCode: act.code,
      activityName: act.name,
      activityEnglishName: act.en,
      unit: act.unit || '',
      hasPhysical: act.hasPhysical,
      hasSize: act.hasSize,
      isHeader: false,
      districts: DISTRICTS.map(dist => ({
        districtName: dist,
        physicalProgressTillLastFY: 0,
        targetUnit: 0,
        targetSizeCubicMeter: 0,
        lastMonthPhysicalProgress: 0,
        thisMonthPhysicalProgress: 0,
        sarraExpendTillLastFY: 0,
        ratePerUnit: 0,
        targetDeptShareLakh: 0,
        targetSarraShareLakh: 0,
        lastMonthSarraExpend: 0,
        thisMonthSarraExpend: 0
      }))
    }));
  }

  async saveDraft(userId, userDistrict, userDept, formData, ip, ua) {
    const { financialYear, reportingMonth, activities, totalApprovedSchemes, totalGroundwaterSitesUnderSchemes, groundwaterSitesCurrentlyBeingTreated } = formData;
    
    let mpr = await MPRPraroop1D.findOne({
      submittedBy: userId,
      financialYear,
      reportingMonth,
      headCode: '55-04',
      isDraft: true
    });

    if (mpr) {
      mpr.activities = activities;
      mpr.totalApprovedSchemes = totalApprovedSchemes;
      mpr.totalGroundwaterSitesUnderSchemes = totalGroundwaterSitesUnderSchemes;
      mpr.groundwaterSitesCurrentlyBeingTreated = groundwaterSitesCurrentlyBeingTreated;
      mpr.ipAddress = ip;
      mpr.userAgent = ua;
    } else {
      mpr = new MPRPraroop1D({
        financialYear,
        reportingMonth,
        headCode: '55-04',
        submittedBy: userId,
        submittedByDistrict: userDistrict || 'Headquarters',
        submittedByDepartment: userDept,
        activities,
        totalApprovedSchemes,
        totalGroundwaterSitesUnderSchemes,
        groundwaterSitesCurrentlyBeingTreated,
        isDraft: true,
        ipAddress: ip,
        userAgent: ua
      });
    }

    await mpr.save();
    return mpr;
  }

  async submitMPR(userId, userDistrict, userDept, formData, ip, ua) {
    const { financialYear, reportingMonth, activities, totalApprovedSchemes, totalGroundwaterSitesUnderSchemes, groundwaterSitesCurrentlyBeingTreated } = formData;
    
    const districtCode = userDistrict ? userDistrict.substring(0, 3).toUpperCase() : 'HQ';
    const prefix = `SARRA-MPR1D-${new Date().getFullYear()}-${districtCode}-`;
    const lastMpr = await MPRPraroop1D.findOne({ applicationNo: { $regex: `^${prefix}` } }).sort({ applicationNo: -1 });
    let nextNumber = 1;
    if (lastMpr && lastMpr.applicationNo) {
      const lastNumber = parseInt(lastMpr.applicationNo.replace(prefix, ''), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const applicationNo = `${prefix}${nextNumber.toString().padStart(4, '0')}`;

    let mpr = await MPRPraroop1D.findOne({
      submittedBy: userId,
      financialYear,
      reportingMonth,
      headCode: '55-04',
      isDraft: true
    });

    if (mpr) {
      mpr.applicationNo = applicationNo;
      mpr.isDraft = false;
      mpr.status = 'SUBMITTED';
      mpr.submittedAt = new Date();
      mpr.activities = activities;
      mpr.totalApprovedSchemes = totalApprovedSchemes;
      mpr.totalGroundwaterSitesUnderSchemes = totalGroundwaterSitesUnderSchemes;
      mpr.groundwaterSitesCurrentlyBeingTreated = groundwaterSitesCurrentlyBeingTreated;
      mpr.ipAddress = ip;
      mpr.userAgent = ua;
    } else {
      mpr = new MPRPraroop1D({
        applicationNo,
        financialYear,
        reportingMonth,
        headCode: '55-04',
        submittedBy: userId,
        submittedByDistrict: userDistrict || 'Headquarters',
        submittedByDepartment: userDept,
        activities,
        totalApprovedSchemes,
        totalGroundwaterSitesUnderSchemes,
        groundwaterSitesCurrentlyBeingTreated,
        isDraft: false,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        ipAddress: ip,
        userAgent: ua
      });
    }

    mpr.revisionHistory.push({
      status: 'SUBMITTED',
      changedBy: userId,
      note: 'Initial Submission'
    });

    await mpr.save();
    return mpr;
  }

  async resubmitMPR(mprId, userId, formData, ip, ua) {
    const { activities, totalApprovedSchemes, totalGroundwaterSitesUnderSchemes, groundwaterSitesCurrentlyBeingTreated } = formData;
    
    let mpr = await MPRPraroop1D.findOne({
      _id: mprId,
      submittedBy: userId,
      status: { $in: ['REJECTED', 'RETURNED_TO_PIA'] }
    });

    if (!mpr) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Rejected MPR not found or unauthorized');
    }

    mpr.status = 'SUBMITTED';
    mpr.submittedAt = new Date();
    mpr.activities = activities;
    mpr.totalApprovedSchemes = totalApprovedSchemes;
    mpr.totalGroundwaterSitesUnderSchemes = totalGroundwaterSitesUnderSchemes;
    mpr.groundwaterSitesCurrentlyBeingTreated = groundwaterSitesCurrentlyBeingTreated;
    mpr.ipAddress = ip;
    mpr.userAgent = ua;
    
    mpr.revisionHistory.push({
      status: 'SUBMITTED',
      changedBy: userId,
      note: 'Resubmitted by PIA Officer'
    });

    await mpr.save();
    return mpr;
  }

  async getMyMPRs(userId, filters = {}, page = 1, limit = 10) {
    const query = { submittedBy: userId, isDraft: false, ...filters };
    const skip = (page - 1) * limit;

    const mprs = await MPRPraroop1D.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-activities.districts');

    const total = await MPRPraroop1D.countDocuments(query);

    return {
      data: mprs,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getMPRById(mprId, requestingUserId) {
    const mpr = await MPRPraroop1D.findById(mprId)
      .populate('submittedBy', 'name email mobile role')
      .populate('reviewedBy', 'name email role')
      .populate('districtApprovedBy', 'name email role')
      .populate('revisionHistory.changedBy', 'name role');

    if (!mpr) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'MPR not found');
    }
    return mpr;
  }

  async approveMPR(mprId, reviewerId, note) {
    const mpr = await MPRPraroop1D.findById(mprId);
    if (!mpr) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'MPR not found');
    
    mpr.status = 'APPROVED';
    mpr.reviewedBy = reviewerId;
    mpr.approvedAt = new Date();
    mpr.revisionHistory.push({ status: 'APPROVED', changedBy: reviewerId, note });
    
    await mpr.save();
    return mpr;
  }

  async rejectMPR(mprId, reviewerId, note) {
    const mpr = await MPRPraroop1D.findById(mprId);
    if (!mpr) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'MPR not found');
    
    mpr.status = 'REJECTED';
    mpr.reviewedBy = reviewerId;
    mpr.rejectionReason = note;
    mpr.revisionHistory.push({ status: 'REJECTED', changedBy: reviewerId, note });
    
    await mpr.save();
    return mpr;
  }

  async getPreviousMonthData(userId, financialYear, month) {
    const prevMonth = PREVIOUS_MONTH_MAP[month];
    if (!prevMonth) return null;

    const prevMpr = await MPRPraroop1D.findOne({
      submittedBy: userId,
      financialYear,
      reportingMonth: prevMonth,
      isDraft: false
    });

    if (!prevMpr) return null;

    const formattedData = {};
    prevMpr.activities.forEach(act => {
      formattedData[act.activityCode] = { districts: {} };
      act.districts.forEach(dist => {
        formattedData[act.activityCode].districts[dist.districtName] = {
          lastMonthPhysicalProgress: dist.thisMonthPhysicalProgress,
          lastMonthSarraExpend: dist.thisMonthSarraExpend
        };
      });
    });

    return formattedData;
  }

  async getBaselineFromDPR(userId, financialYear) {
    const baselines = {};
    ACTIVITIES.forEach(act => {
      baselines[act.code] = { districts: {} };
      DISTRICTS.forEach(d => {
        baselines[act.code].districts[d] = {
          targetUnit: 0,
          targetSizeCubicMeter: 0,
          targetDeptShareLakh: 0,
          targetSarraShareLakh: 0,
          ratePerUnit: 0
        };
      });
    });
    return baselines;
  }

  async getProgressTillLastFY(userId, district, financialYear) {
    const progress = {};
    ACTIVITIES.forEach(act => {
      progress[act.code] = { districts: {} };
      DISTRICTS.forEach(d => {
        progress[act.code].districts[d] = {
          physicalProgressTillLastFY: 0,
          sarraExpendTillLastFY: 0
        };
      });
    });
    return progress;
  }
  
  async getAnnualSummary(financialYear) {
     const mprs = await MPRPraroop1D.find({ financialYear, isDraft: false });
     return mprs;
  }
}

export default new MPRPraroop1DService();

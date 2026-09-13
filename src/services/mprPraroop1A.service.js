import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const DISTRICTS = ['Dehradun', 'Haridwar', 'Tehri', 'Pauri', 'Chamoli', 'Uttarkashi', 'Rudraprayag', 'USNagar', 'Nainital', 'Almora', 'Pithoragarh', 'Bageshwar', 'Champawat'];

const ACTIVITIES = [
  { code: '55-01', name: 'प्राथमिक / विस्तृत परियोजना रिपोर्ट पर व्यय', en: 'DPR Preparation', hasPhysical: false, hasSize: false },
  { code: '55-01(01)', name: 'समोच्च खनियां / कन्टूर ट्रेंचेज', en: 'Contour Trenches', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-01(02)', name: 'रिचार्ज पिट', en: 'Recharge Pit', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-01(03)', name: 'डग आउट पौण्ड', en: 'Dugout Ponds', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-01(04)', name: 'चाल / खाल', en: 'Chal-Khal', hasPhysical: true, hasSize: true, unit: 'No.' },
  { code: '55-01(05)', name: 'ब्रशवुड चेक डेम', en: 'Brushwood Check Dam', hasPhysical: true, hasSize: false, unit: 'No.' },
  { code: '55-01(06)', name: 'अस्थाई चेक डेम (पिरुल आदि चेक डेम)', en: 'Temporary Check Dam (Pirul etc.)', hasPhysical: true, hasSize: false, unit: 'No.' },
  { code: '55-01(07)', name: 'Loose Boulder Check Dam', en: 'Loose Boulder Check Dam', hasPhysical: true, hasSize: false, unit: 'No.' },
  { code: '55-01(08)', name: 'R:R Dry Check Dam', en: 'RR Dry Check Dam', hasPhysical: true, hasSize: false, unit: 'No.' },
  { code: '55-01(09)', name: 'Gabion / Crate Wire Check Dam', en: 'Gabion/Crate Wire Check Dam', hasPhysical: true, hasSize: false, unit: 'No.' },
  { code: '55-01(10)', name: 'Cemented Check Dam', en: 'Cemented Check Dam', hasPhysical: true, hasSize: false, unit: 'No.' },
  { code: '55-01(11)', name: 'वानस्पतिक उपचार गतिविधि', en: 'Vegetative Treatment', hasPhysical: true, hasSize: false, unit: 'Ha.' },
  { code: '55-01(12)', name: 'वनीकरण गतिविधि', en: 'Forestry Plantation', hasPhysical: true, hasSize: false, unit: 'Ha.' },
  { code: '55-01(13)', name: 'चारा / घास रोपण', en: 'Fodder/Grass Plantation', hasPhysical: true, hasSize: false, unit: 'Ha.' },
  { code: '55-01(14)', name: 'प्राकृतिक पुनरोत्पादन गतिविधि', en: 'ANR Activities', hasPhysical: true, hasSize: false, unit: 'Ha.' },
  { code: '55-01(15)', name: 'वृक्षारोपण गतिविधि', en: 'Plantation Activities', hasPhysical: true, hasSize: false, unit: 'Ha.' },
  { code: '55-01(16)', name: 'उपरोक्त गतिविधियों से कुल उपचारित जल संग्रहण क्षेत्र', en: 'Total Catchment Area Treated', hasPhysical: true, hasSize: false, unit: 'Ha.' },
  { code: 'M&E', name: 'मूल्यांकन एवं अनुश्रवण / मूल्यांकन एवं अनुश्रवण पर व्यय', en: 'Monitoring & Evaluation', hasPhysical: false, hasSize: false }
];

const PREVIOUS_MONTH_MAP = {
  'May': 'April', 'June': 'May', 'July': 'June', 'August': 'July',
  'September': 'August', 'October': 'September', 'November': 'October',
  'December': 'November', 'January': 'December', 'February': 'January', 'March': 'February'
};

class MPRPraroop1AService {
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
    const { projectSanctionId, sanctionId, financialYear, reportingMonth, activities, totalApprovedSchemes, totalSpringsUnderSchemes, springsCurrentlyBeingTreated } = formData;
    
    let query = {
      submittedBy: userId,
      financialYear,
      reportingMonth,
      headCode: '55-01',
      isDraft: true
    };
    if (projectSanctionId) {
      query = { projectSanctionId, isDraft: true };
    }

    let mpr = await MPRPraroop1A.findOne(query);

    if (mpr) {
      mpr.activities = activities;
      mpr.totalApprovedSchemes = totalApprovedSchemes;
      mpr.totalSpringsUnderSchemes = totalSpringsUnderSchemes;
      mpr.springsCurrentlyBeingTreated = springsCurrentlyBeingTreated;
      mpr.ipAddress = ip;
      mpr.userAgent = ua;
      if (projectSanctionId) mpr.projectSanctionId = projectSanctionId;
      if (sanctionId) mpr.sanctionId = sanctionId;
    } else {
      mpr = new MPRPraroop1A({
        projectSanctionId,
        sanctionId,
        financialYear,
        reportingMonth,
        headCode: '55-01',
        submittedBy: userId,
        submittedByDistrict: userDistrict || 'Headquarters',
        submittedByDepartment: userDept,
        activities,
        totalApprovedSchemes,
        totalSpringsUnderSchemes,
        springsCurrentlyBeingTreated,
        isDraft: true,
        ipAddress: ip,
        userAgent: ua
      });
    }

    await mpr.save();
    return mpr;
  }

  async submitMPR(userId, userDistrict, userDept, formData, ip, ua) {
    const { projectSanctionId, sanctionId, financialYear, reportingMonth, activities, totalApprovedSchemes, totalSpringsUnderSchemes, springsCurrentlyBeingTreated } = formData;
    
    const districtCode = userDistrict ? userDistrict.substring(0, 3).toUpperCase() : 'HQ';
    const prefix = `SARRA-MPR1A-${new Date().getFullYear()}-${districtCode}-`;
    const lastMpr = await MPRPraroop1A.findOne({ applicationNo: { $regex: `^${prefix}` } }).sort({ applicationNo: -1 });
    let nextNumber = 1;
    if (lastMpr && lastMpr.applicationNo) {
      const lastNumber = parseInt(lastMpr.applicationNo.replace(prefix, ''), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const applicationNo = `${prefix}${nextNumber.toString().padStart(4, '0')}`;

    let query = {
      submittedBy: userId,
      financialYear,
      reportingMonth,
      headCode: '55-01',
      isDraft: true
    };
    if (projectSanctionId) {
      query = { projectSanctionId, isDraft: true };
    }

    let mpr = await MPRPraroop1A.findOne(query);

    if (mpr) {
      mpr.applicationNo = applicationNo;
      mpr.isDraft = false;
      mpr.status = 'SUBMITTED';
      mpr.submittedAt = new Date();
      mpr.activities = activities;
      mpr.totalApprovedSchemes = totalApprovedSchemes;
      mpr.totalSpringsUnderSchemes = totalSpringsUnderSchemes;
      mpr.springsCurrentlyBeingTreated = springsCurrentlyBeingTreated;
      mpr.ipAddress = ip;
      mpr.userAgent = ua;
      if (projectSanctionId) mpr.projectSanctionId = projectSanctionId;
      if (sanctionId) mpr.sanctionId = sanctionId;
    } else {
      mpr = new MPRPraroop1A({
        projectSanctionId,
        sanctionId,
        applicationNo,
        financialYear,
        reportingMonth,
        headCode: '55-01',
        submittedBy: userId,
        submittedByDistrict: userDistrict || 'Headquarters',
        submittedByDepartment: userDept,
        activities,
        totalApprovedSchemes,
        totalSpringsUnderSchemes,
        springsCurrentlyBeingTreated,
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
    const { activities, totalApprovedSchemes, totalSpringsUnderSchemes, springsCurrentlyBeingTreated } = formData;
    
    let mpr = await MPRPraroop1A.findOne({
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
    mpr.totalSpringsUnderSchemes = totalSpringsUnderSchemes;
    mpr.springsCurrentlyBeingTreated = springsCurrentlyBeingTreated;
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

    const mprs = await MPRPraroop1A.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-activities.districts');

    const total = await MPRPraroop1A.countDocuments(query);

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
    const mpr = await MPRPraroop1A.findById(mprId)
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
    const mpr = await MPRPraroop1A.findById(mprId);
    if (!mpr) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'MPR not found');
    
    mpr.status = 'APPROVED';
    mpr.reviewedBy = reviewerId;
    mpr.approvedAt = new Date();
    mpr.revisionHistory.push({ status: 'APPROVED', changedBy: reviewerId, note });
    
    await mpr.save();
    return mpr;
  }

  async rejectMPR(mprId, reviewerId, note) {
    const mpr = await MPRPraroop1A.findById(mprId);
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
    if (!prevMonth) return null; // April has no previous month in same FY

    const prevMpr = await MPRPraroop1A.findOne({
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
    // Return empty zeros as fallback logic requested in prompt
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
    // Aggregate past FY if needed. Returns empty zeros for now.
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
     const mprs = await MPRPraroop1A.find({ financialYear, isDraft: false });
     return mprs;
  }
}

export default new MPRPraroop1AService();

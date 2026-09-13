import mongoose from 'mongoose';

const MPRPraroop1ASchema = new mongoose.Schema({
  applicationNo: {
    type: String,
    unique: true,
    sparse: true
  },
  projectSanctionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectSanction'
  },
  sanctionId: {
    type: String
  },
  reportType: {
    type: String,
    default: 'PRAROOP_1A'
  },
  headCode: {
    type: String,
    default: '55-01'
  },
  financialYear: {
    type: String,
    required: true
  },
  reportingMonth: {
    type: String,
    required: true,
    enum: ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March']
  },
  status: {
    type: String,
    enum: ['DRAFT', 'SUBMITTED', 'DISTRICT_MAKER_REVIEW', 'DISTRICT_CHECKER_REVIEW', 'DISTRICT_APPROVED', 'FORWARDED_TO_STATE', 'STATE_VERIFIED', 'RETURNED_TO_PIA', 'REJECTED', 'APPROVED'],
    default: 'DRAFT'
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  submittedByDistrict: {
    type: String,
    required: true
  },
  submittedByDepartment: {
    type: String
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  approvedAt: Date,
  rejectionReason: String,
  districtApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  districtApprovedAt: Date,
  returnReason: String,
  revisionHistory: [{
    status: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    note: String
  }],
  isDraft: {
    type: Boolean,
    default: true
  },
  submittedAt: Date,
  ipAddress: String,
  userAgent: String,

  // Top Summary
  totalApprovedSchemes: { type: Number, default: 0 },
  totalSpringsUnderSchemes: { type: Number, default: 0 },
  springsCurrentlyBeingTreated: { type: Number, default: 0 },

  // Activity Data
  activities: [{
    activityCode: String,
    activityName: String,
    activityEnglishName: String,
    unit: String,
    hasPhysical: Boolean,
    hasSize: Boolean,
    isHeader: Boolean,

    districts: [{
      districtName: {
        type: String,
        enum: ['Dehradun', 'Haridwar', 'Tehri', 'Pauri', 'Chamoli', 'Uttarkashi', 'Rudraprayag', 'USNagar', 'Nainital', 'Almora', 'Pithoragarh', 'Bageshwar', 'Champawat']
      },
      // Physical (READ-ONLY)
      physicalProgressTillLastFY: { type: Number, default: 0 },
      targetUnit: { type: Number, default: 0 },
      targetSizeCubicMeter: { type: Number, default: 0 },
      
      // Physical (EDITABLE)
      lastMonthPhysicalProgress: { type: Number, default: 0 },
      thisMonthPhysicalProgress: { type: Number, default: 0 },
      
      // Physical (AUTO-CALCULATED)
      cumulativePhysicalProgress: { type: Number, default: 0 },
      totalPhysicalProgress: { type: Number, default: 0 },
      
      // Financial (READ-ONLY)
      sarraExpendTillLastFY: { type: Number, default: 0 },
      ratePerUnit: { type: Number, default: 0 },
      targetDeptShareLakh: { type: Number, default: 0 },
      targetSarraShareLakh: { type: Number, default: 0 },
      
      // Financial (EDITABLE)
      lastMonthSarraExpend: { type: Number, default: 0 },
      thisMonthSarraExpend: { type: Number, default: 0 },
      
      // Financial (AUTO-CALCULATED)
      totalSarraExpend: { type: Number, default: 0 }
    }],

    // Activity-level totals
    districtTotals: {
      physicalProgressTillLastFY: { type: Number, default: 0 },
      targetUnit: { type: Number, default: 0 },
      lastMonthPhysicalProgress: { type: Number, default: 0 },
      thisMonthPhysicalProgress: { type: Number, default: 0 },
      cumulativePhysicalProgress: { type: Number, default: 0 },
      totalPhysicalProgress: { type: Number, default: 0 },
      sarraExpendTillLastFY: { type: Number, default: 0 },
      targetDeptShareLakh: { type: Number, default: 0 },
      targetSarraShareLakh: { type: Number, default: 0 },
      lastMonthSarraExpend: { type: Number, default: 0 },
      thisMonthSarraExpend: { type: Number, default: 0 },
      totalSarraExpend: { type: Number, default: 0 }
    }
  }],

  // Form-level computed totals
  computed: {
    grandTotalPhysicalProgress: { type: Number, default: 0 },
    grandTotalSarraExpend: { type: Number, default: 0 },
    grandTotalTargetSarraLakh: { type: Number, default: 0 },
    grandTotalTargetDeptLakh: { type: Number, default: 0 },
    activitiesWithProgress: { type: Number, default: 0 },
    districtWiseSummary: [{
      district: String,
      totalPhysical: Number,
      totalSarraExpend: Number
    }]
  }
}, { timestamps: true });

MPRPraroop1ASchema.pre('save', function (next) {
  const mpr = this;

  let grandTotalPhysicalProgress = 0;
  let grandTotalSarraExpend = 0;
  let grandTotalTargetSarraLakh = 0;
  let grandTotalTargetDeptLakh = 0;
  let activitiesWithProgress = 0;

  const districtWiseMap = new Map();
  ['Dehradun', 'Haridwar', 'Tehri', 'Pauri', 'Chamoli', 'Uttarkashi', 'Rudraprayag', 'USNagar', 'Nainital', 'Almora', 'Pithoragarh', 'Bageshwar', 'Champawat'].forEach(d => {
    districtWiseMap.set(d, { totalPhysical: 0, totalSarraExpend: 0 });
  });

  if (mpr.activities && mpr.activities.length > 0) {
    mpr.activities.forEach(activity => {
      let activityHasProgress = false;

      let dtPhysicalProgressTillLastFY = 0;
      let dtTargetUnit = 0;
      let dtLastMonthPhysicalProgress = 0;
      let dtThisMonthPhysicalProgress = 0;
      let dtCumulativePhysicalProgress = 0;
      let dtTotalPhysicalProgress = 0;
      let dtSarraExpendTillLastFY = 0;
      let dtTargetDeptShareLakh = 0;
      let dtTargetSarraShareLakh = 0;
      let dtLastMonthSarraExpend = 0;
      let dtThisMonthSarraExpend = 0;
      let dtTotalSarraExpend = 0;

      if (activity.districts && activity.districts.length > 0) {
        activity.districts.forEach(district => {
          // Calculate District values
          district.cumulativePhysicalProgress = district.physicalProgressTillLastFY + district.lastMonthPhysicalProgress + district.thisMonthPhysicalProgress;
          district.totalPhysicalProgress = district.cumulativePhysicalProgress;
          district.totalSarraExpend = district.sarraExpendTillLastFY + district.lastMonthSarraExpend + district.thisMonthSarraExpend;

          // Accumulate Activity totals
          dtPhysicalProgressTillLastFY += district.physicalProgressTillLastFY;
          dtTargetUnit += district.targetUnit;
          dtLastMonthPhysicalProgress += district.lastMonthPhysicalProgress;
          dtThisMonthPhysicalProgress += district.thisMonthPhysicalProgress;
          dtCumulativePhysicalProgress += district.cumulativePhysicalProgress;
          dtTotalPhysicalProgress += district.totalPhysicalProgress;
          dtSarraExpendTillLastFY += district.sarraExpendTillLastFY;
          dtTargetDeptShareLakh += district.targetDeptShareLakh;
          dtTargetSarraShareLakh += district.targetSarraShareLakh;
          dtLastMonthSarraExpend += district.lastMonthSarraExpend;
          dtThisMonthSarraExpend += district.thisMonthSarraExpend;
          dtTotalSarraExpend += district.totalSarraExpend;

          if (district.thisMonthPhysicalProgress > 0 || district.thisMonthSarraExpend > 0) {
            activityHasProgress = true;
          }

          // Accumulate District-wise summary
          const dSummary = districtWiseMap.get(district.districtName);
          if (dSummary) {
            dSummary.totalPhysical += district.totalPhysicalProgress;
            dSummary.totalSarraExpend += district.totalSarraExpend;
          }
        });
      }

      activity.districtTotals = {
        physicalProgressTillLastFY: dtPhysicalProgressTillLastFY,
        targetUnit: dtTargetUnit,
        lastMonthPhysicalProgress: dtLastMonthPhysicalProgress,
        thisMonthPhysicalProgress: dtThisMonthPhysicalProgress,
        cumulativePhysicalProgress: dtCumulativePhysicalProgress,
        totalPhysicalProgress: dtTotalPhysicalProgress,
        sarraExpendTillLastFY: dtSarraExpendTillLastFY,
        targetDeptShareLakh: dtTargetDeptShareLakh,
        targetSarraShareLakh: dtTargetSarraShareLakh,
        lastMonthSarraExpend: dtLastMonthSarraExpend,
        thisMonthSarraExpend: dtThisMonthSarraExpend,
        totalSarraExpend: dtTotalSarraExpend
      };

      if (!activity.isHeader) {
        grandTotalPhysicalProgress += dtTotalPhysicalProgress;
        grandTotalSarraExpend += dtTotalSarraExpend;
        grandTotalTargetSarraLakh += dtTargetSarraShareLakh;
        grandTotalTargetDeptLakh += dtTargetDeptShareLakh;
        if (activityHasProgress) {
          activitiesWithProgress++;
        }
      }
    });
  }

  mpr.computed = {
    grandTotalPhysicalProgress,
    grandTotalSarraExpend,
    grandTotalTargetSarraLakh,
    grandTotalTargetDeptLakh,
    activitiesWithProgress,
    districtWiseSummary: Array.from(districtWiseMap.entries()).map(([district, data]) => ({
      district,
      totalPhysical: data.totalPhysical,
      totalSarraExpend: data.totalSarraExpend
    }))
  };

  next();
});

MPRPraroop1ASchema.index({ submittedBy: 1, financialYear: 1, reportingMonth: 1, headCode: 1, isDraft: 1 }, { unique: true, partialFilterExpression: { isDraft: true } });

const MPRPraroop1A = mongoose.model('MPRPraroop1A', MPRPraroop1ASchema);

export default MPRPraroop1A;

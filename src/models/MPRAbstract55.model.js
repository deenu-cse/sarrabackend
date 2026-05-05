import mongoose from 'mongoose';

const Schema = mongoose.Schema;

const districtDataSchema = new Schema({
  noOfProposals: { type: Number, default: 0, min: 0 },
  deptShareLakh: { type: Number, default: 0, min: 0 },
  sarraShareLakh: { type: Number, default: 0, min: 0 }
}, { _id: false });

const departmentDataSchema = new Schema({
  departmentName: { 
    type: String,
    enum: ['Forest','RD','MI','Irrigation','Jal Sansthan',
           'Peyjal','HRDA','WMD-VCRRFP','Agriculture',
           'Horticulture','Other']
  },
  districts: {
    type: Map,
    of: districtDataSchema,
    default: () => new Map()
  }
}, { _id: false });

const mprAbstract55Schema = new Schema({
  applicationNo: { type: String, unique: true, sparse: true },
  reportType: { type: String, default: 'ABSTRACT_55' },
  financialYear: { type: String, required: true },
  reportingMonth: { 
    type: String, 
    enum: ['April','May','June','July','August','September','October','November','December','January','February','March'],
    required: true 
  },
  status: { 
    type: String, 
    enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'],
    required: true,
    default: 'DRAFT'
  },
  submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  submittedByDistrict: { type: String },
  submittedByDepartment: { type: String },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  approvedAt: { type: Date },
  rejectionReason: { type: String },
  revisionHistory: [{
    status: String, 
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    changedAt: Date, 
    note: String
  }],
  isDraft: { type: Boolean, default: true },
  submittedAt: { type: Date },
  ipAddress: { type: String },
  userAgent: { type: String },
  departments: [departmentDataSchema],
  computed: {
    totalProposalsAllDepts: { type: Number, default: 0 },
    totalDeptShareLakh: { type: Number, default: 0 },
    totalSarraShareLakh: { type: Number, default: 0 },
    districtTotals: [{
      district: String,
      totalProposals: Number,
      totalDeptShare: Number,
      totalSarraShare: Number
    }],
    departmentTotals: [{
      department: String,
      totalProposals: Number,
      totalDeptShare: Number,
      totalSarraShare: Number
    }]
  }
}, { timestamps: true });

mprAbstract55Schema.pre('save', function(next) {
  let totalProposalsAllDepts = 0;
  let totalDeptShareLakh = 0;
  let totalSarraShareLakh = 0;
  
  const districtTotalsMap = new Map();
  const departmentTotalsList = [];

  if (this.departments && Array.isArray(this.departments)) {
    this.departments.forEach(dept => {
      let deptProposals = 0;
      let deptShare = 0;
      let sarraShare = 0;

      if (dept.districts) {
        dept.districts.forEach((distData, districtName) => {
          deptProposals += distData.noOfProposals || 0;
          deptShare += distData.deptShareLakh || 0;
          sarraShare += distData.sarraShareLakh || 0;

          if (!districtTotalsMap.has(districtName)) {
            districtTotalsMap.set(districtName, {
              district: districtName,
              totalProposals: 0,
              totalDeptShare: 0,
              totalSarraShare: 0
            });
          }
          const distTotal = districtTotalsMap.get(districtName);
          distTotal.totalProposals += distData.noOfProposals || 0;
          distTotal.totalDeptShare += distData.deptShareLakh || 0;
          distTotal.totalSarraShare += distData.sarraShareLakh || 0;
        });
      }

      departmentTotalsList.push({
        department: dept.departmentName,
        totalProposals: deptProposals,
        totalDeptShare: deptShare,
        totalSarraShare: sarraShare
      });

      totalProposalsAllDepts += deptProposals;
      totalDeptShareLakh += deptShare;
      totalSarraShareLakh += sarraShare;
    });
  }

  this.computed = {
    totalProposalsAllDepts,
    totalDeptShareLakh,
    totalSarraShareLakh,
    districtTotals: Array.from(districtTotalsMap.values()),
    departmentTotals: departmentTotalsList
  };

  next();
});

mprAbstract55Schema.index({ applicationNo: 1 });
mprAbstract55Schema.index({ submittedBy: 1 });
mprAbstract55Schema.index({ status: 1 });
mprAbstract55Schema.index({ financialYear: 1 });
mprAbstract55Schema.index({ reportingMonth: 1 });
mprAbstract55Schema.index({ financialYear: 1, reportingMonth: 1, submittedBy: 1 }, { unique: true });

const MPRAbstract55 = mongoose.model('MPRAbstract55', mprAbstract55Schema);
export default MPRAbstract55;

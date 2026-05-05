import User from '../models/User.model.js';
import AuditLog from '../models/AuditLog.model.js';
import SpringshedDPR from '../models/SpringshedDPR.model.js';
import { registerUser } from '../services/auth.service.js';
import { getAnalyticsOverview } from '../services/springsheddpr.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import paginate from '../utils/paginate.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 });

export const createUser = asyncHandler(async (req, res) => {
  const user = await registerUser(req.body);
  res.locals.auditTargetId = user._id;
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, user, 'User created successfully'));
});

export const getUsers = asyncHandler(async (req, res) => {
  const { role, district, isActive, search, page = 1, limit = 10 } = req.query;

  const matchObj = {};
  if (role) matchObj.role = role;
  if (district) matchObj.district = district;
  if (isActive !== undefined) matchObj.isActive = isActive === 'true';
  if (search) {
    matchObj.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } }
    ];
  }

  const pipeline = [
    { $match: matchObj },
    { $project: { password: 0 } },
    { $sort: { createdAt: -1 } }
  ];

  const result = await paginate(User, pipeline, page, limit);

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Users fetched successfully', result.pagination));
});

export const toggleUserActive = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user._id.toString()) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, 'Cannot deactivate yourself'));
  }

  const user = await User.findById(id);
  if (!user) {
    return res.status(HTTP_STATUS.NOT_FOUND).json(new ApiResponse(HTTP_STATUS.NOT_FOUND, null, 'User not found'));
  }

  user.isActive = !user.isActive;
  await user.save({ validateBeforeSave: false });
  
  res.locals.auditTargetId = user._id;

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { isActive: user.isActive }, `User ${user.isActive ? 'activated' : 'deactivated'} successfully`));
});

export const getOverviewAnalytics = asyncHandler(async (req, res) => {
  let analytics = cache.get("analytics_overview");
  
  if (!analytics) {
    analytics = await getAnalyticsOverview();
    cache.set("analytics_overview", analytics);
  }

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, analytics, 'Analytics fetched successfully'));
});

export const getDistrictAnalytics = asyncHandler(async (req, res) => {
  const { districtName } = req.params;

  const districtData = await SpringshedDPR.aggregate([
    { $match: { submittedByDistrict: districtName } },
    { 
      $facet: {
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        byDepartment: [{ $group: { _id: "$submittedByDepartment", count: { $sum: 1 } } }],
        recentForms: [
          { $sort: { createdAt: -1 } },
          { $limit: 10 },
          { $project: { applicationNo: 1, status: 1, submittedAt: 1, "section1_deptDetails.department": 1 } }
        ]
      }
    }
  ]);

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, districtData[0], 'District analytics fetched successfully'));
});

export const getAuditLogs = asyncHandler(async (req, res) => {
  const { action, userId, from, to, page = 1, limit = 20 } = req.query;

  const matchObj = {};
  if (action) matchObj.action = action;
  if (userId) matchObj.performedBy = userId;
  if (from || to) {
    matchObj.timestamp = {};
    if (from) matchObj.timestamp.$gte = new Date(from);
    if (to) matchObj.timestamp.$lte = new Date(to);
  }

  const pipeline = [
    { $match: matchObj },
    { $sort: { timestamp: -1 } },
    { $lookup: { from: 'users', localField: 'performedBy', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $project: { "user.password": 0 } }
  ];

  const result = await paginate(AuditLog, pipeline, page, limit);

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Audit logs fetched successfully', result.pagination));
});

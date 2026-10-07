import User from '../models/User.model.js';
import AuditLog from '../models/AuditLog.model.js';
import { registerUser, inviteUser } from '../services/auth.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import paginate from '../utils/paginate.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import NodeCache from 'node-cache';
import {
  sendAccountSuspendedEmail,
  sendAccountDeactivatedEmail,
  sendAccountRestoredEmail
} from '../utils/email/accountStatusEmails.js';
import { getBusinessAudit } from '../services/businessActivity.service.js';

const cache = new NodeCache({ stdTTL: 300 });

export const createUser = asyncHandler(async (req, res) => {
  const user = await registerUser(req.body);
  res.locals.auditTargetId = user._id;
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, user, 'User created successfully'));
});

export const inviteUserHandler = asyncHandler(async (req, res) => {
  const user = await inviteUser(req.body, req.user);
  res.locals.auditTargetId = user._id;
  res
    .status(HTTP_STATUS.CREATED)
    .json(new ApiResponse(HTTP_STATUS.CREATED, user, 'Invitation sent successfully'));
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
    { $project: { password: 0, inviteOtpHash: 0, passwordResetToken: 0 } },
    { $sort: { createdAt: -1 } }
  ];

  const result = await paginate(User, pipeline, page, limit);

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Users fetched successfully', result.pagination));
});

export const toggleUserActive = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user._id.toString()) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, 'Cannot change status of your own account'));
  }

  const user = await User.findById(id);
  if (!user) {
    return res.status(HTTP_STATUS.NOT_FOUND).json(new ApiResponse(HTTP_STATUS.NOT_FOUND, null, 'User not found'));
  }

  user.isActive = !user.isActive;
  user.accountStatus = user.isActive ? 'ACTIVE' : 'DEACTIVATED';
  if (!user.isActive) {
    user.deactivatedAt = new Date();
    user.deactivationReason = 'Toggled inactive';
  } else {
    user.deactivatedAt = undefined;
    user.deactivationReason = undefined;
    user.suspendedUntil = undefined;
    user.suspensionReason = undefined;
  }
  user.statusChangedBy = req.user._id;
  user.statusChangedAt = new Date();
  await user.save({ validateBeforeSave: false });

  res.locals.auditTargetId = user._id;
  res.locals.auditMetadata = { accountStatus: user.accountStatus };

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { isActive: user.isActive, accountStatus: user.accountStatus }, `User ${user.isActive ? 'activated' : 'deactivated'} successfully`));
});

const assertNotSelf = (req, id) => {
  if (id === req.user._id.toString()) {
    return 'Cannot change status of your own account';
  }
  return null;
};

export const suspendUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { until, reason } = req.body;

  const selfErr = assertNotSelf(req, id);
  if (selfErr) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, selfErr));
  }

  const untilDate = new Date(until);
  if (Number.isNaN(untilDate.getTime()) || untilDate <= new Date()) {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, 'Suspend until date must be a valid future date'));
  }

  const user = await User.findById(id);
  if (!user) {
    return res.status(HTTP_STATUS.NOT_FOUND).json(new ApiResponse(HTTP_STATUS.NOT_FOUND, null, 'User not found'));
  }

  if (user.accountStatus === 'DEACTIVATED') {
    return res
      .status(HTTP_STATUS.BAD_REQUEST)
      .json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, 'User is deactivated. Restore the account before suspending.'));
  }

  user.accountStatus = 'SUSPENDED';
  user.isActive = false;
  user.suspendedUntil = untilDate;
  user.suspensionReason = reason?.trim() || undefined;
  user.deactivatedAt = undefined;
  user.deactivationReason = undefined;
  user.statusChangedBy = req.user._id;
  user.statusChangedAt = new Date();
  await user.save({ validateBeforeSave: false });

  try {
    await sendAccountSuspendedEmail({
      user,
      admin: req.user,
      until: untilDate,
      reason: user.suspensionReason
    });
  } catch (err) {
    console.error('[suspendUser] Failed to send suspension email:', err.message);
  }

  res.locals.auditTargetId = user._id;
  res.locals.auditMetadata = {
    accountStatus: 'SUSPENDED',
    suspendedUntil: untilDate,
    reason: user.suspensionReason || null,
    targetEmail: user.email,
    emailNotified: true
  };

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(
      HTTP_STATUS.OK,
      {
        _id: user._id,
        accountStatus: user.accountStatus,
        suspendedUntil: user.suspendedUntil,
        suspensionReason: user.suspensionReason || null,
        isActive: user.isActive
      },
      'User suspended successfully'
    )
  );
});

export const deactivateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const selfErr = assertNotSelf(req, id);
  if (selfErr) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, selfErr));
  }

  const user = await User.findById(id);
  if (!user) {
    return res.status(HTTP_STATUS.NOT_FOUND).json(new ApiResponse(HTTP_STATUS.NOT_FOUND, null, 'User not found'));
  }

  user.accountStatus = 'DEACTIVATED';
  user.isActive = false;
  user.deactivatedAt = new Date();
  user.deactivationReason = reason?.trim() || undefined;
  user.suspendedUntil = undefined;
  user.suspensionReason = undefined;
  user.statusChangedBy = req.user._id;
  user.statusChangedAt = new Date();
  await user.save({ validateBeforeSave: false });

  try {
    await sendAccountDeactivatedEmail({
      user,
      admin: req.user,
      reason: user.deactivationReason,
      deactivatedAt: user.deactivatedAt
    });
  } catch (err) {
    console.error('[deactivateUser] Failed to send deactivation email:', err.message);
  }

  res.locals.auditTargetId = user._id;
  res.locals.auditMetadata = {
    accountStatus: 'DEACTIVATED',
    reason: user.deactivationReason || null,
    targetEmail: user.email,
    emailNotified: true
  };

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(
      HTTP_STATUS.OK,
      {
        _id: user._id,
        accountStatus: user.accountStatus,
        deactivatedAt: user.deactivatedAt,
        deactivationReason: user.deactivationReason || null,
        isActive: user.isActive
      },
      'User deactivated successfully'
    )
  );
});

export const restoreUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const selfErr = assertNotSelf(req, id);
  if (selfErr) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, selfErr));
  }

  const user = await User.findById(id);
  if (!user) {
    return res.status(HTTP_STATUS.NOT_FOUND).json(new ApiResponse(HTTP_STATUS.NOT_FOUND, null, 'User not found'));
  }

  const previousStatus = user.accountStatus;
  user.accountStatus = 'ACTIVE';
  user.isActive = true;
  user.suspendedUntil = undefined;
  user.suspensionReason = undefined;
  user.deactivatedAt = undefined;
  user.deactivationReason = undefined;
  user.statusChangedBy = req.user._id;
  user.statusChangedAt = new Date();
  await user.save({ validateBeforeSave: false });

  try {
    await sendAccountRestoredEmail({
      user,
      admin: req.user,
      previousStatus
    });
  } catch (err) {
    console.error('[restoreUser] Failed to send restore email:', err.message);
  }

  res.locals.auditTargetId = user._id;
  res.locals.auditMetadata = {
    accountStatus: 'ACTIVE',
    previousStatus,
    targetEmail: user.email,
    emailNotified: true
  };

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(
      HTTP_STATUS.OK,
      {
        _id: user._id,
        accountStatus: user.accountStatus,
        isActive: user.isActive
      },
      'User access restored successfully'
    )
  );
});

export const getOverviewAnalytics = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, {
    totalSubmitted: 0,
    totalApproved: 0,
    totalUnderReview: 0,
    totalRejected: 0
  }, 'Analytics fetched successfully'));
});

export const getDistrictAnalytics = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, {
    byStatus: [],
    byDepartment: [],
    recentForms: []
  }, 'District analytics fetched successfully'));
});

export const getAuditLogs = asyncHandler(async (req, res) => {
  const { action, actions, role, userId, from, to, search, page = 1, limit = 20 } = req.query;

  const matchObj = {};
  const actionList = typeof actions === 'string' ? actions.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 40) : [];
  if (typeof action === 'string' && action) matchObj.action = action;
  else if (actionList.length) matchObj.action = { $in: actionList };
  if (role) matchObj.performedByRole = role;
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
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
  ];

  if (search?.trim()) {
    const term = search.trim();
    pipeline.push({
      $match: {
        $or: [
          { 'user.name': { $regex: term, $options: 'i' } },
          { 'user.email': { $regex: term, $options: 'i' } },
          { targetResource: { $regex: term, $options: 'i' } },
          { action: { $regex: term, $options: 'i' } },
          { ipAddress: { $regex: term, $options: 'i' } }
        ]
      }
    });
  }

  pipeline.push({
    $project: {
      action: 1,
      performedByRole: 1,
      targetResource: 1,
      targetId: 1,
      ipAddress: 1,
      userAgent: 1,
      metadata: 1,
      timestamp: 1,
      performerName: { $ifNull: ['$user.name', 'System'] },
      performerEmail: { $ifNull: ['$user.email', ''] },
      performerId: '$performedBy'
    }
  });

  const result = await paginate(AuditLog, pipeline, page, limit);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayCount, actionBreakdown] = await Promise.all([
    AuditLog.countDocuments({ ...matchObj, timestamp: { $gte: todayStart } }),
    AuditLog.aggregate([
      { $match: matchObj },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ])
  ]);

  res.status(HTTP_STATUS.OK).json(
    new ApiResponse(
      HTTP_STATUS.OK,
      {
        logs: result.data,
        stats: {
          total: result.pagination.total,
          today: todayCount,
          byAction: actionBreakdown.map((a) => ({ action: a._id, count: a.count }))
        }
      },
      'Audit logs fetched successfully',
      {
        page: result.pagination.page,
        limit: result.pagination.limit,
        total: result.pagination.total,
        totalPages: result.pagination.pages
      }
    )
  );
});

export const getBusinessAuditLogs = asyncHandler(async (req, res) => {
  const data = await getBusinessAudit({
    projectId: req.query.projectId,
    search: req.query.search,
    limit: req.query.limit
  });

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, data, 'Business audit timeline fetched successfully'));
});

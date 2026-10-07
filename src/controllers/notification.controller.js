import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import {
  getNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead
} from '../services/notification.service.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const { unread, page = 1, limit = 20 } = req.query;
  const result = await getNotificationsForUser(req.user._id, { unread, page, limit });

  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Notifications fetched', result.pagination));
});

export const readNotification = asyncHandler(async (req, res) => {
  const notification = await markNotificationRead(req.user._id, req.params.id);
  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, notification, 'Notification marked as read'));
});

export const readAllNotifications = asyncHandler(async (req, res) => {
  const result = await markAllNotificationsRead(req.user._id);
  res
    .status(HTTP_STATUS.OK)
    .json(new ApiResponse(HTTP_STATUS.OK, { modifiedCount: result.modifiedCount || 0 }, 'All notifications marked as read'));
});

import Notification from '../models/Notification.model.js';
import User from '../models/User.model.js';

export const createNotification = async (recipientId, title, message, relatedResource = null, relatedId = null, extra = {}) => {
  return await Notification.create({
    recipient: recipientId,
    title,
    message,
    relatedResource,
    relatedId,
    ...extra
  });
};

export const createBusinessNotification = async ({
  recipientId,
  title,
  message,
  relatedResource = null,
  relatedId = null,
  type = 'WORKFLOW',
  priority = 'NORMAL',
  status,
  referenceNo,
  actorName,
  actorRole,
  link
}) => {
  if (!recipientId) return null;
  return createNotification(recipientId, title, message, relatedResource, relatedId, {
    type,
    priority,
    status,
    referenceNo,
    actorName,
    actorRole,
    link
  });
};

export const notifyDDOfficer = async (district, title, message, relatedResource, relatedId) => {
  const ddOfficers = await User.find({ role: 'DD_LEVEL', district, isActive: true });
  
  const notifications = ddOfficers.map(officer => ({
    recipient: officer._id,
    title,
    message,
    relatedResource,
    relatedId
  }));

  if (notifications.length > 0) {
    await Notification.insertMany(notifications);
  }
};

export const getNotificationsForUser = async (userId, { unread, page = 1, limit = 20 } = {}) => {
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const query = { recipient: userId };
  if (String(unread) === 'true') query.isRead = false;

  const [data, total] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean(),
    Notification.countDocuments(query)
  ]);

  return {
    data,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      pages: Math.ceil(total / parsedLimit),
      totalPages: Math.ceil(total / parsedLimit)
    }
  };
};

export const markNotificationRead = async (userId, notificationId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { isRead: true },
    { new: true }
  );
};

export const markAllNotificationsRead = async (userId) => {
  return Notification.updateMany({ recipient: userId, isRead: false }, { isRead: true });
};

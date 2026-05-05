import Notification from '../models/Notification.model.js';
import User from '../models/User.model.js';

export const createNotification = async (recipientId, title, message, relatedResource = null, relatedId = null) => {
  return await Notification.create({
    recipient: recipientId,
    title,
    message,
    relatedResource,
    relatedId
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

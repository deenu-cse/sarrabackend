import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'WORKFLOW'
  },
  priority: {
    type: String,
    enum: ['LOW', 'NORMAL', 'HIGH'],
    default: 'NORMAL'
  },
  status: String,
  referenceNo: String,
  actorName: String,
  actorRole: String,
  link: String,
  isRead: {
    type: Boolean,
    default: false
  },
  relatedResource: String,
  relatedId: mongoose.Schema.Types.ObjectId,
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '90d'
  }
});

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ relatedResource: 1, relatedId: 1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;

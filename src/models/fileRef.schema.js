import mongoose from 'mongoose';

/** An uploaded file (minutes, photograph, letter, document) kept in storage. */
export const fileSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: String,
  name: String,
  mimeType: String,
  size: Number,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
});

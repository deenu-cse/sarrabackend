import mongoose from 'mongoose';

/** Atomic named sequences (used for collision-safe Project IDs). */
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
}, { versionKey: false });

const Counter = mongoose.model('Counter', counterSchema);
export default Counter;

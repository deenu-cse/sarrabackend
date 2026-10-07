import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Budget allocation (fund release) against an existing project.
 *
 *   BudgetAllocationBatch     one "Proceed": a date plus one entry per department released
 *     └─ BudgetAllocationEntry   one installment for one department
 *   BudgetAllocationDocument  an uploaded PDF, linked to the batch that used it
 *
 * The entries are the financial source of truth. Unique indexes make the two
 * dangerous mistakes impossible at database level: the same submission saved
 * twice (idempotencyKey) and the same installment released twice
 * (project + department + installmentNumber).
 */

const budgetAllocationBatchSchema = new mongoose.Schema({
  project: { type: ObjectId, ref: 'ProjectSanction', required: true, index: true },
  projectCode: String, // projectId / sanctionId snapshot for reports
  // Client-generated key for one submission; a retry with the same key is not a new release
  idempotencyKey: { type: String, required: true, unique: true },
  allocationDate: { type: Date, required: true },
  entryCount: { type: Number, required: true },
  totalAmountLakh: { type: Number, required: true, min: 0 },
  // Project position before / after this batch
  previousReleasedLakh: { type: Number, required: true, min: 0 },
  newReleasedLakh: { type: Number, required: true, min: 0 },
  createdBy: { type: ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const budgetAllocationEntrySchema = new mongoose.Schema({
  batch: { type: ObjectId, ref: 'BudgetAllocationBatch', required: true, index: true },
  project: { type: ObjectId, ref: 'ProjectSanction', required: true },
  departmentId: { type: ObjectId, ref: 'Department', required: true },
  departmentName: { type: String, required: true },
  installmentNumber: { type: Number, required: true, min: 1 },
  allocationDate: { type: Date, required: true },
  amountLakh: { type: Number, required: true, min: 0 },
  // Share of the department budget released by this installment
  percentage: { type: Number, required: true, min: 0, max: 100 },
  // Department position at the time of release
  budgetLakh: { type: Number, required: true, min: 0 },
  previousReleasedLakh: { type: Number, required: true, min: 0 },
  newReleasedLakh: { type: Number, required: true, min: 0 },
  document: {
    documentId: { type: ObjectId, ref: 'BudgetAllocationDocument' },
    url: String,
    name: String,
    sizeBytes: Number,
  },
  createdBy: { type: ObjectId, ref: 'User', required: true },
}, { timestamps: true });

budgetAllocationEntrySchema.index({ project: 1, departmentId: 1, installmentNumber: 1 }, { unique: true });

const budgetAllocationDocumentSchema = new mongoose.Schema({
  project: { type: ObjectId, ref: 'ProjectSanction', required: true, index: true },
  url: { type: String, required: true },
  publicId: String,
  originalName: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  mimeType: { type: String, default: 'application/pdf' },
  uploadedBy: { type: ObjectId, ref: 'User', required: true },
  // Set when an allocation batch is committed with this document
  batch: { type: ObjectId, ref: 'BudgetAllocationBatch', default: null },
}, { timestamps: true });

/**
 * A release that was taken back. The entry is removed from the live ledger (so
 * totals and installment numbers are right again) and kept here in full, with
 * who reversed it and why.
 */
const budgetAllocationReversalSchema = new mongoose.Schema({
  project: { type: ObjectId, ref: 'ProjectSanction', required: true, index: true },
  departmentId: { type: ObjectId, ref: 'Department', required: true },
  departmentName: String,
  installmentNumber: Number,
  amountLakh: { type: Number, required: true },
  percentage: Number,
  allocationDate: Date,
  batch: { type: ObjectId, ref: 'BudgetAllocationBatch' },
  document: { documentId: ObjectId, url: String, name: String, sizeBytes: Number },
  originalEntryId: ObjectId,
  releasedBy: { type: ObjectId, ref: 'User' },
  releasedAt: Date,
  reason: { type: String, required: true },
  reversedBy: { type: ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export const BudgetAllocationReversal = mongoose.model('BudgetAllocationReversal', budgetAllocationReversalSchema);
export const BudgetAllocationBatch = mongoose.model('BudgetAllocationBatch', budgetAllocationBatchSchema);
export const BudgetAllocationEntry = mongoose.model('BudgetAllocationEntry', budgetAllocationEntrySchema);
export const BudgetAllocationDocument = mongoose.model('BudgetAllocationDocument', budgetAllocationDocumentSchema);

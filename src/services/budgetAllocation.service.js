import mongoose from 'mongoose';
import ProjectSanction from '../models/ProjectSanction.model.js';
import {
  BudgetAllocationBatch, BudgetAllocationEntry, BudgetAllocationDocument, BudgetAllocationReversal,
} from '../models/BudgetAllocation.model.js';
import { uploadFile, deleteFile } from './upload.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

// ─── Business rules (single place to change them) ────────────────────────────

/** Maximum installments a department's budget can be released in. */
export const MAX_INSTALLMENTS = 4;

/**
 * What a department's releasable budget is:
 *   'TOTAL' — Department Share + SARRA Share (the department's project total)
 *   'SARRA' — SARRA Share only
 */
const ALLOCATION_BASIS = 'TOTAL';

/** A release order PDF must accompany every installment. */
const DOCUMENT_REQUIRED = true;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Budget can be released only once the project has been approved (sanctioned). */
const RELEASABLE_STATUSES = [
  SANCTION_STATUS.SANCTIONED,
  SANCTION_STATUS.FORWARDED_TO_DISTRICT,
  SANCTION_STATUS.DISTRICT_ACCEPTED,
  SANCTION_STATUS.FORWARDED_TO_PIA,
  SANCTION_STATUS.PIA_ACCEPTED,
];

export const ALLOCATION_STATUS = {
  NOT_ALLOCATED: 'NOT_ALLOCATED',
  PARTIALLY_ALLOCATED: 'PARTIALLY_ALLOCATED',
  FULLY_ALLOCATED: 'FULLY_ALLOCATED',
};

// ─── Money ───────────────────────────────────────────────────────────────────
// Amounts are stored in Rs. lakh. All arithmetic and comparisons are done in
// whole rupees (integers), so 40 + 40 + 20 is exactly 100 and never 99.99999.

const UNITS_PER_LAKH = 100000;
const toUnits = (lakh) => Math.round((Number(lakh) || 0) * UNITS_PER_LAKH);
const toLakh = (units) => units / UNITS_PER_LAKH;
const formatLakh = (units) => `₹ ${toLakh(units).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 5 })} Lakh`;
const percentOf = (units, totalUnits) => (totalUnits > 0 ? Math.round((units / totalUnits) * 10000) / 100 : 0);
// Progress is rounded down, so 99.999% is never shown as 100% before the budget is really complete.
const progressOf = (units, totalUnits) => (totalUnits > 0 ? Math.min(100, Math.floor((units * 10000) / totalUnits) / 100) : 0);

const ORDINALS = ['', '1st', '2nd', '3rd', '4th'];
const ordinal = (n) => ORDINALS[n] || `${n}th`;

const bad = (message, data) => new ApiError(HTTP_STATUS.BAD_REQUEST, message, data);
const conflict = (message, code) => new ApiError(HTTP_STATUS.CONFLICT, message, { code });

const statusFor = (releasedUnits, budgetUnits) => {
  if (budgetUnits > 0 && releasedUnits >= budgetUnits) return ALLOCATION_STATUS.FULLY_ALLOCATED;
  if (releasedUnits > 0) return ALLOCATION_STATUS.PARTIALLY_ALLOCATED;
  return ALLOCATION_STATUS.NOT_ALLOCATED;
};

const departmentBudgetUnits = (department) => (
  ALLOCATION_BASIS === 'SARRA' ? toUnits(department.sarraShareLakh) : toUnits(department.totalLakh)
);

const projectBudgetUnits = (project) => {
  const departments = project.departmentAllocations || [];
  if (departments.length) return departments.reduce((sum, d) => sum + departmentBudgetUnits(d), 0);
  return ALLOCATION_BASIS === 'SARRA' ? toUnits(project.sarraShareLakh) : toUnits(project.totalSanctionedBudgetLakh);
};

const projectCode = (project) => project.projectId || project.sanctionId || '';

// ─── Eligibility ─────────────────────────────────────────────────────────────

/** Why budget cannot be released for this project right now (null = it can). */
const ineligibility = (project, releasedUnits, budgetUnits) => {
  if (!(project.departmentAllocations || []).length) {
    return { code: 'NO_DEPARTMENTS', message: 'This project has no department-wise budget, so budget cannot be allocated against it.' };
  }
  if (project.closure?.status === 'CLOSED') {
    return { code: 'CLOSED', message: 'This project is closed. No further budget can be released against it.' };
  }
  if (project.status === SANCTION_STATUS.REJECTED) {
    return { code: 'REJECTED', message: 'This project was rejected. Budget cannot be allocated against it.' };
  }
  if (!RELEASABLE_STATUSES.includes(project.status)) {
    return { code: 'NOT_APPROVED', message: 'This project has not been approved yet. Budget can be allocated after the Approver sanctions it.' };
  }
  if (budgetUnits > 0 && releasedUnits >= budgetUnits) {
    return { code: 'FULLY_ALLOCATED', message: 'The budget of this project is already fully allocated.' };
  }
  return null;
};

/**
 * Budget position of a project for list screens, from the summary the last
 * allocation stored on the project (kept in step with the entries inside the
 * same transaction).
 */
export const summarizeProjectBudget = (project) => {
  const budgetUnits = projectBudgetUnits(project);
  const releasedUnits = Math.min(toUnits(project.budgetAllocation?.releasedLakh), budgetUnits);
  const reason = ineligibility(project, releasedUnits, budgetUnits);
  return {
    totalBudgetLakh: toLakh(budgetUnits),
    totalAllocatedLakh: toLakh(releasedUnits),
    remainingLakh: toLakh(Math.max(0, budgetUnits - releasedUnits)),
    percentAllocated: progressOf(releasedUnits, budgetUnits),
    allocationStatus: statusFor(releasedUnits, budgetUnits),
    eligible: !reason,
    ineligibleCode: reason?.code || null,
  };
};

// ─── Full budget state (computed from the entries) ───────────────────────────

const loadEntries = (projectId, session) => {
  const query = BudgetAllocationEntry.find({ project: projectId }).sort({ installmentNumber: 1 }).lean();
  return session ? query.session(session) : query;
};

/** Everything about a project's budget, recalculated from the stored installments. */
const buildState = (project, entries) => {
  const byDepartment = new Map();
  for (const entry of entries) {
    const key = String(entry.departmentId);
    if (!byDepartment.has(key)) byDepartment.set(key, []);
    byDepartment.get(key).push(entry);
  }

  const departments = (project.departmentAllocations || []).map((department) => {
    const installments = byDepartment.get(String(department.departmentId)) || [];
    const budgetUnits = departmentBudgetUnits(department);
    const releasedUnits = installments.reduce((sum, e) => sum + toUnits(e.amountLakh), 0);
    const remainingUnits = Math.max(0, budgetUnits - releasedUnits);
    const status = statusFor(releasedUnits, budgetUnits);

    let blockedReason = null;
    if (budgetUnits <= 0) blockedReason = 'This department has no budget to release.';
    else if (status === ALLOCATION_STATUS.FULLY_ALLOCATED) blockedReason = 'Department already fully allocated.';
    else if (installments.length >= MAX_INSTALLMENTS) blockedReason = 'Maximum installment limit reached.';

    const last = installments[installments.length - 1];
    return {
      departmentId: String(department.departmentId),
      name: department.departmentName,
      deptShareLakh: department.deptShareLakh || 0,
      sarraShareLakh: department.sarraShareLakh || 0,
      totalLakh: department.totalLakh || 0,
      budgetLakh: toLakh(budgetUnits),
      releasedLakh: toLakh(releasedUnits),
      remainingLakh: toLakh(remainingUnits),
      percentAllocated: progressOf(releasedUnits, budgetUnits),
      status,
      installments: installments.map((e) => ({
        installmentNumber: e.installmentNumber,
        amountLakh: e.amountLakh,
        percentage: e.percentage,
        allocationDate: e.allocationDate,
        document: e.document?.url ? { name: e.document.name, url: e.document.url } : null,
        releasedAt: e.createdAt || null,
        releasedBy: e.createdBy?.name || null,
      })),
      nextInstallmentNumber: blockedReason ? null : installments.length + 1,
      canAllocate: !blockedReason,
      blockedReason,
      lastAllocationDate: last ? last.allocationDate : null,
      // Only the latest installment can be reversed, so numbering stays continuous.
      reversibleInstallment: last ? last.installmentNumber : null,
      // internal (stripped before sending)
      _budgetUnits: budgetUnits,
      _releasedUnits: releasedUnits,
      _remainingUnits: remainingUnits,
    };
  });

  const budgetUnits = departments.reduce((sum, d) => sum + d._budgetUnits, 0);
  const releasedUnits = departments.reduce((sum, d) => sum + d._releasedUnits, 0);
  const reason = ineligibility(project, releasedUnits, budgetUnits);

  return {
    project: {
      id: String(project._id),
      projectId: project.projectId || null,
      sanctionId: project.sanctionId || null,
      code: projectCode(project),
      projectName: project.projectTitle || '',
      status: project.status,
      district: project.location?.district || project.district || '',
      block: project.location?.block || '',
      gramPanchayat: project.location?.gramPanchayat || '',
      village: project.location?.village || '',
      head: project.head?.code ? { code: project.head.code, name: project.head.name } : null,
    },
    rules: {
      maxInstallments: MAX_INSTALLMENTS,
      finalInstallmentMustComplete: true,
      documentRequired: DOCUMENT_REQUIRED,
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
      budgetBasis: ALLOCATION_BASIS,
    },
    departments,
    totals: {
      totalBudgetLakh: toLakh(budgetUnits),
      releasedLakh: toLakh(releasedUnits),
      remainingLakh: toLakh(Math.max(0, budgetUnits - releasedUnits)),
      percentAllocated: progressOf(releasedUnits, budgetUnits),
      status: statusFor(releasedUnits, budgetUnits),
    },
    eligible: !reason,
    ineligibleCode: reason?.code || null,
    ineligibleReason: reason?.message || null,
    _budgetUnits: budgetUnits,
    _releasedUnits: releasedUnits,
  };
};

/** Remove internal fields before a state leaves the service. */
const publicState = (state) => {
  const { _budgetUnits, _releasedUnits, departments, ...rest } = state;
  return {
    ...rest,
    departments: departments.map(({ _budgetUnits: b, _releasedUnits: r, _remainingUnits: m, ...department }) => department),
  };
};

const findProject = async (projectId, session) => {
  if (typeof projectId !== 'string' || !mongoose.isValidObjectId(projectId)) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Project not found.');
  }
  const query = ProjectSanction.findById(projectId).lean();
  const project = await (session ? query.session(session) : query);
  if (!project) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Project not found.');
  return project;
};

export const getBudgetState = async (projectId) => {
  const project = await findProject(projectId);
  // Read-only view: also resolve who released each installment.
  const [entries, reversals] = await Promise.all([
    BudgetAllocationEntry.find({ project: project._id }).sort({ installmentNumber: 1 }).populate('createdBy', 'name').lean(),
    BudgetAllocationReversal.find({ project: project._id }).sort({ createdAt: -1 }).populate('reversedBy', 'name').lean(),
  ]);
  return {
    ...publicState(buildState(project, entries)),
    reversals: reversals.map((r) => ({
      id: String(r._id),
      department: r.departmentName,
      installmentNumber: r.installmentNumber,
      amountLakh: r.amountLakh,
      allocationDate: r.allocationDate,
      reason: r.reason,
      reversedBy: r.reversedBy?.name || null,
      reversedAt: r.createdAt,
      document: r.document?.url ? { name: r.document.name, url: r.document.url } : null,
    })),
  };
};

/** Approved projects whose budget is not yet fully allocated. */
export const listEligibleProjects = async () => {
  const projects = await ProjectSanction.find({
    status: { $in: RELEASABLE_STATUSES },
    'departmentAllocations.0': { $exists: true },
    'budgetAllocation.status': { $ne: ALLOCATION_STATUS.FULLY_ALLOCATED },
  })
    .select('projectId sanctionId projectTitle district location status departmentAllocations totalSanctionedBudgetLakh sarraShareLakh budgetAllocation createdAt')
    .sort({ createdAt: -1 })
    .limit(1000)
    .lean();

  return projects
    .map((project) => ({ project, budget: summarizeProjectBudget(project) }))
    .filter(({ budget }) => budget.eligible)
    .map(({ project, budget }) => ({
      id: String(project._id),
      projectId: projectCode(project),
      projectName: project.projectTitle || '',
      district: project.location?.district || project.district || '',
      totalBudget: budget.totalBudgetLakh,
      totalAllocatedBudget: budget.totalAllocatedLakh,
      remainingBudget: budget.remainingLakh,
      allocationStatus: budget.allocationStatus,
    }));
};

// ─── Documents ───────────────────────────────────────────────────────────────

const PDF_MAGIC = Buffer.from('%PDF-');

/**
 * Validate and store one release-order PDF for a project. The file is checked
 * by declared type, extension, size and its actual leading bytes.
 */
export const uploadAllocationDocument = async (projectId, file, user) => {
  const project = await findProject(projectId);
  const state = buildState(project, await loadEntries(project._id));
  if (!state.eligible) throw bad(state.ineligibleReason);

  if (!file || !file.buffer) throw bad('Please choose a PDF file to upload.');
  const name = String(file.originalname || '').replace(/[\\/]/g, '_').slice(-150) || 'document.pdf';
  if (!/\.pdf$/i.test(name)) throw bad('Only PDF files can be uploaded. The file must have a .pdf extension.');
  if (file.mimetype !== 'application/pdf') throw bad('Only PDF files can be uploaded.');
  if (!file.buffer.length) throw bad('The selected file is empty.');
  if (file.buffer.length > MAX_DOCUMENT_BYTES) {
    throw bad(`The PDF is too large. Maximum size is ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.`);
  }
  // Content check: a renamed image or script does not start with the PDF signature.
  if (file.buffer.subarray(0, 1024).indexOf(PDF_MAGIC) === -1) {
    throw bad('This file is not a valid PDF document.');
  }

  let stored;
  try {
    stored = await uploadFile(file.buffer, 'budget-allocations');
  } catch (err) {
    logger.error(`Budget allocation document upload failed: ${err?.message || err}`);
    throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'The PDF could not be uploaded. Please try again.');
  }
  if (!stored?.url) throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'The PDF could not be uploaded. Please try again.');

  const document = await BudgetAllocationDocument.create({
    project: project._id,
    url: stored.url,
    publicId: stored.publicId,
    originalName: name,
    sizeBytes: file.buffer.length,
    uploadedBy: user._id,
  });

  return { documentId: String(document._id), name: document.originalName, sizeBytes: document.sizeBytes, url: document.url };
};

// ─── Validation of an allocation request ─────────────────────────────────────

const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{16,64}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Strict calendar date (UTC midnight); rejects values such as 2026-02-31. */
const parseAllocationDate = (value) => {
  const match = typeof value === 'string' ? ISO_DATE.exec(value.slice(0, 10)) : null;
  if (!match) throw bad('Budget allocation date is required.');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw bad('Budget allocation date is not a valid date.');
  }
  if (year < 2000) throw bad('Budget allocation date is too far in the past.');
  // Allow for "today" in IST while the server clock is still on the previous UTC day.
  if (date.getTime() > Date.now() + DAY_MS) throw bad('Budget allocation date cannot be in the future.');
  return date;
};

const displayDate = (date) => new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Check a request against the current state and return the exact plan to save.
 * Used unchanged by Preview and by Proceed, so both apply identical rules.
 */
const planAllocation = async (project, state, body, user, session) => {
  if (!state.eligible) {
    throw state.ineligibleCode === 'FULLY_ALLOCATED'
      ? conflict(state.ineligibleReason, 'PROJECT_FULLY_ALLOCATED')
      : bad(state.ineligibleReason);
  }

  const allocationDate = parseAllocationDate(body.allocationDate);

  const inputs = Array.isArray(body.entries) ? body.entries : [];
  if (!inputs.length) throw bad('Enter an installment amount for at least one department.');
  if (inputs.length > state.departments.length) throw bad('The request contains more allocations than the project has departments.');

  const departmentsById = new Map(state.departments.map((d) => [d.departmentId, d]));
  const documentIds = [...new Set(inputs.map((i) => (typeof i?.documentId === 'string' ? i.documentId : '')).filter(Boolean))];
  if (documentIds.some((id) => !mongoose.isValidObjectId(id))) throw bad('An attached document is invalid. Please upload the PDF again.');
  const documentQuery = BudgetAllocationDocument.find({ _id: { $in: documentIds } }).lean();
  const documents = await (session ? documentQuery.session(session) : documentQuery);
  const documentsById = new Map(documents.map((d) => [String(d._id), d]));

  const seen = new Set();
  const entries = inputs.map((input) => {
    const department = departmentsById.get(typeof input?.departmentId === 'string' ? input.departmentId : '');
    if (!department) throw bad('One of the departments does not belong to this project.');
    const { name } = department;
    if (seen.has(department.departmentId)) throw bad(`${name} appears more than once in this allocation.`);
    seen.add(department.departmentId);

    if (!department.canAllocate) {
      throw conflict(`${name}: ${department.blockedReason}`, department.status === ALLOCATION_STATUS.FULLY_ALLOCATED ? 'DEPARTMENT_FULLY_ALLOCATED' : 'INSTALLMENT_LIMIT_REACHED');
    }

    // The client states which installment it believes it is entering. A mismatch
    // means its screen is out of date (another tab or user released meanwhile).
    const installmentNumber = Number(input.installmentNumber);
    if (!Number.isInteger(installmentNumber) || installmentNumber < 1) throw bad(`${name}: installment number is invalid.`);
    if (installmentNumber > MAX_INSTALLMENTS) throw conflict(`${name}: Maximum installment limit reached.`, 'INSTALLMENT_LIMIT_REACHED');
    if (installmentNumber !== department.nextInstallmentNumber) {
      throw conflict(
        `${name}: the budget position has changed since this page was loaded (next is the ${ordinal(department.nextInstallmentNumber)} installment). Reload and try again.`,
        'STALE_STATE',
      );
    }

    const amount = typeof input.amountLakh === 'number' ? input.amountLakh : Number(String(input.amountLakh ?? '').trim() || NaN);
    if (!Number.isFinite(amount)) throw bad(`${name}: installment amount must be a valid number.`);
    if (amount < 0) throw bad(`${name}: installment amount cannot be negative.`);
    const amountUnits = toUnits(amount);
    if (amountUnits <= 0) throw bad(`${name}: installment amount must be greater than zero.`);
    if (Math.abs(amount * UNITS_PER_LAKH - amountUnits) > 0.001) throw bad(`${name}: installment amount can have at most 5 decimal places.`);

    if (amountUnits > department._remainingUnits) {
      throw bad(
        `${name}: Allocation exceeds the remaining department budget. Remaining budget: ${formatLakh(department._remainingUnits)}.`,
        { code: 'EXCEEDS_REMAINING', departmentId: department.departmentId, remainingLakh: toLakh(department._remainingUnits) },
      );
    }
    if (installmentNumber === MAX_INSTALLMENTS && amountUnits !== department._remainingUnits) {
      throw bad(`${name}: the ${ordinal(MAX_INSTALLMENTS)} installment is the last one allowed, so it must release the full remaining budget of ${formatLakh(department._remainingUnits)}.`);
    }

    // Percentage is derived from the amount; a supplied percentage must agree with it.
    const percentage = percentOf(amountUnits, department._budgetUnits);
    if (input.percentage !== undefined && input.percentage !== null && input.percentage !== '') {
      const supplied = Number(input.percentage);
      if (!Number.isFinite(supplied) || supplied < 0 || supplied > 100) throw bad(`${name}: budget allotment percentage must be between 0 and 100.`);
      const tolerance = 0.011 + (100 / department._budgetUnits);
      if (Math.abs(supplied - (amountUnits / department._budgetUnits) * 100) > tolerance) {
        throw bad(`${name}: the percentage (${supplied}%) does not match the installment amount (${percentage}% of the department budget).`);
      }
    }

    if (department.lastAllocationDate && allocationDate.getTime() < new Date(department.lastAllocationDate).getTime()) {
      throw bad(`${name}: allocation date cannot be earlier than its previous installment (${displayDate(department.lastAllocationDate)}).`);
    }

    let document = null;
    const documentId = typeof input.documentId === 'string' ? input.documentId : '';
    if (documentId) {
      document = documentsById.get(documentId);
      if (!document || String(document.project) !== String(project._id)) throw bad(`${name}: the attached PDF was not found for this project. Please upload it again.`);
      if (String(document.uploadedBy) !== String(user._id)) throw new ApiError(HTTP_STATUS.FORBIDDEN, `${name}: the attached PDF was uploaded by another user.`);
      if (document.batch) throw bad(`${name}: the attached PDF is already used by an earlier allocation. Please upload the document for this release.`);
    } else if (DOCUMENT_REQUIRED) {
      throw bad(`${name}: upload the PDF document for this installment.`);
    }

    const newReleasedUnits = department._releasedUnits + amountUnits;
    return {
      departmentId: department.departmentId,
      departmentName: name,
      installmentNumber,
      amountUnits,
      amountLakh: toLakh(amountUnits),
      percentage,
      budgetLakh: department.budgetLakh,
      previousReleasedLakh: toLakh(department._releasedUnits),
      newReleasedLakh: toLakh(newReleasedUnits),
      remainingAfterLakh: toLakh(department._budgetUnits - newReleasedUnits),
      percentAllocatedAfter: progressOf(newReleasedUnits, department._budgetUnits),
      fullyAllocatedAfter: newReleasedUnits >= department._budgetUnits,
      document: document ? { documentId: String(document._id), name: document.originalName, url: document.url, sizeBytes: document.sizeBytes } : null,
    };
  });

  const totalUnits = entries.reduce((sum, e) => sum + e.amountUnits, 0);
  const releasedAfterUnits = state._releasedUnits + totalUnits;
  // Cannot happen when every department is within its own budget; kept as a final guard.
  if (releasedAfterUnits > state._budgetUnits) throw bad('Allocation exceeds the remaining project budget.');

  return {
    allocationDate,
    entries,
    totals: {
      totalBudgetLakh: toLakh(state._budgetUnits),
      previousReleasedLakh: toLakh(state._releasedUnits),
      thisReleaseLakh: toLakh(totalUnits),
      releasedAfterLakh: toLakh(releasedAfterUnits),
      remainingAfterLakh: toLakh(state._budgetUnits - releasedAfterUnits),
      percentAllocatedAfter: progressOf(releasedAfterUnits, state._budgetUnits),
      statusAfter: statusFor(releasedAfterUnits, state._budgetUnits),
    },
  };
};

const publicPlan = (plan) => ({
  allocationDate: plan.allocationDate,
  entries: plan.entries.map(({ amountUnits, ...entry }) => entry),
  totals: plan.totals,
});

/** Preview: full validation and the exact figures Proceed would save. Writes nothing. */
export const previewAllocation = async (projectId, body, user) => {
  const project = await findProject(projectId);
  const state = buildState(project, await loadEntries(project._id));
  const plan = await planAllocation(project, state, body || {}, user, null);
  return { project: state.project, ...publicPlan(plan) };
};

// ─── Commit ──────────────────────────────────────────────────────────────────

const versionFilter = (version) => (version > 0
  ? { budgetVersion: version }
  : { $or: [{ budgetVersion: 0 }, { budgetVersion: { $exists: false } }] });

/** Summary stored on the project so list screens need no aggregation. */
const summaryFromState = (state, at) => ({
  totalLakh: state.totals.totalBudgetLakh,
  releasedLakh: state.totals.releasedLakh,
  remainingLakh: state.totals.remainingLakh,
  status: state.totals.status,
  lastAllocatedAt: at,
});

/** Rebuild the stored summary from the entries (used to undo a failed non-transactional write). */
const resyncSummary = async (projectId) => {
  const project = await ProjectSanction.findById(projectId).lean();
  if (!project) return;
  const state = buildState(project, await loadEntries(projectId));
  await ProjectSanction.updateOne(
    { _id: projectId },
    { $set: { budgetAllocation: summaryFromState(state, project.budgetAllocation?.lastAllocatedAt || null) }, $inc: { budgetVersion: 1 } },
  );
};

const batchResult = async (batch, alreadyProcessed) => ({
  alreadyProcessed,
  batch: {
    id: String(batch._id),
    allocationDate: batch.allocationDate,
    entryCount: batch.entryCount,
    totalAmountLakh: batch.totalAmountLakh,
    previousReleasedLakh: batch.previousReleasedLakh,
    newReleasedLakh: batch.newReleasedLakh,
    createdAt: batch.createdAt,
  },
  state: await getBudgetState(String(batch.project)),
});

const MAX_ATTEMPTS = 4;
const RETRY = Symbol('retry');

/**
 * Commit an allocation (Proceed).
 *
 * Safety, in order:
 *  1. Idempotency — a request whose key was already committed returns that
 *     result; it never releases budget twice.
 *  2. Everything is re-validated here against installments read from the
 *     database; nothing from Preview or the browser is trusted.
 *  3. Concurrency — the project row carries a version. The commit only
 *     succeeds if the version is still the one the validation was based on,
 *     so two users releasing the same remaining budget cannot both win; the
 *     loser is re-validated against the new position.
 *  4. Atomicity — version bump, batch, entries and document links are one
 *     transaction; a failure leaves no partial allocation behind.
 *  5. Unique indexes (idempotencyKey; project + department + installment) are
 *     the database-level backstop for 1 and 3.
 */
export const commitAllocation = async (projectId, body = {}, user) => {
  const idempotencyKey = body.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw bad('This allocation request is invalid. Please reload the page and try again.');
  }

  const findExisting = async () => {
    const existing = await BudgetAllocationBatch.findOne({ idempotencyKey }).lean();
    if (!existing) return null;
    if (String(existing.project) !== String(projectId) || String(existing.createdBy) !== String(user._id)) {
      throw conflict('This allocation request was already used. Please reload the page and try again.', 'IDEMPOTENCY_KEY_REUSED');
    }
    return existing;
  };

  const already = await findExisting();
  if (already) return batchResult(already, true);

  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await runInTransaction(async (session) => {
        const options = session ? { session } : {};
        const project = await findProject(projectId, session);
        const state = buildState(project, await loadEntries(project._id, session));
        const plan = await planAllocation(project, state, body, user, session);
        const now = new Date();
        const version = project.budgetVersion || 0;

        // Position after this batch, recomputed from the entries plus this plan.
        const after = buildState(project, [
          ...(await loadEntries(project._id, session)),
          ...plan.entries.map((e) => ({ departmentId: e.departmentId, installmentNumber: e.installmentNumber, amountLakh: e.amountLakh })),
        ]);

        // Claim the project position. If someone else committed since we read it,
        // nothing matches and the whole attempt is redone on fresh data.
        const claimed = await ProjectSanction.updateOne(
          { _id: project._id, ...versionFilter(version) },
          { $set: { budgetVersion: version + 1, budgetAllocation: summaryFromState(after, now) } },
          options,
        );
        if (claimed.modifiedCount !== 1) return RETRY;

        const batchId = new mongoose.Types.ObjectId();
        try {
          await BudgetAllocationBatch.create([{
            _id: batchId,
            project: project._id,
            projectCode: projectCode(project),
            idempotencyKey,
            allocationDate: plan.allocationDate,
            entryCount: plan.entries.length,
            totalAmountLakh: plan.totals.thisReleaseLakh,
            previousReleasedLakh: plan.totals.previousReleasedLakh,
            newReleasedLakh: plan.totals.releasedAfterLakh,
            createdBy: user._id,
          }], options);

          await BudgetAllocationEntry.insertMany(plan.entries.map((e) => ({
            batch: batchId,
            project: project._id,
            departmentId: e.departmentId,
            departmentName: e.departmentName,
            installmentNumber: e.installmentNumber,
            allocationDate: plan.allocationDate,
            amountLakh: e.amountLakh,
            percentage: e.percentage,
            budgetLakh: e.budgetLakh,
            previousReleasedLakh: e.previousReleasedLakh,
            newReleasedLakh: e.newReleasedLakh,
            document: e.document || undefined,
            createdBy: user._id,
          })), options);

          const documentIds = [...new Set(plan.entries.map((e) => e.document?.documentId).filter(Boolean))];
          if (documentIds.length) {
            const linked = await BudgetAllocationDocument.updateMany(
              { _id: { $in: documentIds }, batch: null },
              { $set: { batch: batchId } },
              options,
            );
            if (linked.modifiedCount !== documentIds.length) {
              throw bad('An attached PDF is already used by another allocation. Please upload the document again.');
            }
          }
        } catch (err) {
          // No transaction (standalone MongoDB): undo by hand, then restore the summary from the entries.
          if (!session) {
            await BudgetAllocationEntry.deleteMany({ batch: batchId });
            await BudgetAllocationBatch.deleteOne({ _id: batchId });
            await BudgetAllocationDocument.updateMany({ batch: batchId }, { $set: { batch: null } });
            await resyncSummary(project._id);
          }
          throw err;
        }

        return { batchId, plan };
      });

      if (result === RETRY) continue;

      const batch = await BudgetAllocationBatch.findById(result.batchId).lean();
      const response = await batchResult(batch, false);
      return {
        ...response,
        audit: {
          batchId: String(batch._id),
          projectCode: batch.projectCode,
          allocationDate: batch.allocationDate,
          previousReleasedLakh: batch.previousReleasedLakh,
          newReleasedLakh: batch.newReleasedLakh,
          entries: result.plan.entries.map((e) => ({
            department: e.departmentName,
            departmentId: e.departmentId,
            installment: e.installmentNumber,
            amountLakh: e.amountLakh,
            previousReleasedLakh: e.previousReleasedLakh,
            newReleasedLakh: e.newReleasedLakh,
            document: e.document ? { id: e.document.documentId, name: e.document.name, url: e.document.url } : null,
          })),
        },
      };
    } catch (err) {
      // The same request may have been committed by a parallel duplicate (double click,
      // network retry). If so this is not an error: return what was saved.
      // eslint-disable-next-line no-await-in-loop
      const duplicate = await findExisting();
      if (duplicate) return batchResult(duplicate, true);
      // A unique-index collision means another request took this installment first:
      // validate again on the new position, which produces the precise message.
      if (err?.code === 11000) { lastError = err; continue; }
      throw err;
    }
  }

  logger.warn(`Budget allocation for project ${projectId} could not be committed after ${MAX_ATTEMPTS} attempts${lastError ? `: ${lastError.message}` : ''}`);
  throw conflict('The budget position changed while saving. Please reload the page and try again.', 'STALE_STATE');
};

/** Best-effort removal of an uploaded PDF that was never used by an allocation. */
export const discardDocument = async (projectId, documentId, user) => {
  if (typeof documentId !== 'string' || !mongoose.isValidObjectId(documentId)) return;
  const document = await BudgetAllocationDocument.findOneAndDelete({
    _id: documentId, project: projectId, uploadedBy: user._id, batch: null,
  });
  if (document?.publicId) await deleteFile(document.publicId);
};

/**
 * Take back a release that was entered wrongly. Only the latest installment of
 * a department can be reversed. The entry leaves the ledger and is archived
 * with the reason; the project position is recalculated in the same transaction.
 */
export const reverseInstallment = async (projectId, body = {}, user) => {
  const reason = String(body.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (reason.length < 10) throw bad('Give the reason for reversing this release (at least 10 characters).');
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId : '';
  const installmentNumber = Number(body.installmentNumber);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runInTransaction(async (session) => {
      const options = session ? { session } : {};
      const project = await findProject(projectId, session);
      if (project.closure?.status === 'CLOSED') throw conflict('This project is closed. Its releases can no longer be changed.', 'PROJECT_CLOSED');
      const entries = await loadEntries(project._id, session);
      const state = buildState(project, entries);
      const department = state.departments.find((d) => d.departmentId === departmentId);
      if (!department) throw bad('The department does not belong to this project.');
      if (!department.installments.length) throw conflict(`${department.name} has no release to reverse.`, 'NOTHING_TO_REVERSE');
      if (installmentNumber !== department.reversibleInstallment) {
        throw conflict(`${department.name}: only the latest installment (${ordinal(department.reversibleInstallment)}) can be reversed.`, 'NOT_LATEST');
      }
      const entry = entries.find((e) => String(e.departmentId) === departmentId && e.installmentNumber === installmentNumber);

      const version = project.budgetVersion || 0;
      const after = buildState(project, entries.filter((e) => String(e._id) !== String(entry._id)));
      const claimed = await ProjectSanction.updateOne(
        { _id: project._id, ...versionFilter(version) },
        { $set: { budgetVersion: version + 1, budgetAllocation: summaryFromState(after, project.budgetAllocation?.lastAllocatedAt || null) } },
        options,
      );
      if (claimed.modifiedCount !== 1) return RETRY;

      const removed = await BudgetAllocationEntry.deleteOne({ _id: entry._id }, options);
      if (removed.deletedCount !== 1) throw conflict('This release was already reversed.', 'ALREADY_REVERSED');
      const [reversal] = await BudgetAllocationReversal.create([{
        project: project._id,
        departmentId: entry.departmentId,
        departmentName: entry.departmentName,
        installmentNumber: entry.installmentNumber,
        amountLakh: entry.amountLakh,
        percentage: entry.percentage,
        allocationDate: entry.allocationDate,
        batch: entry.batch,
        document: entry.document,
        originalEntryId: entry._id,
        releasedBy: entry.createdBy,
        releasedAt: entry.createdAt,
        reason,
        reversedBy: user._id,
      }], options);
      return { reversal, entry, department: department.name, previousReleasedLakh: department.releasedLakh };
    });
    if (result === RETRY) continue;
    return {
      state: await getBudgetState(String(projectId)),
      audit: {
        department: result.department,
        installment: result.entry.installmentNumber,
        amountLakh: result.entry.amountLakh,
        previousReleasedLakh: result.previousReleasedLakh,
        newReleasedLakh: toLakh(toUnits(result.previousReleasedLakh) - toUnits(result.entry.amountLakh)),
        reason,
      },
    };
  }
  throw conflict('The budget position changed while saving. Please reload the page and try again.', 'STALE_STATE');
};

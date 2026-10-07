import mongoose from 'mongoose';
import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import ProjectRevision from '../models/ProjectRevision.model.js';
import User from '../models/User.model.js';
import { BudgetAllocationEntry } from '../models/BudgetAllocation.model.js';
import { ProjectCompletion, COMPLETION_STATUS } from '../models/ProjectLifecycle.model.js';
import { uploadFile, deleteFile } from './upload.service.js';
import { safeNotify, activeUserQuery } from './workflowNotification.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

/**
 * Project closure.
 *
 *   PIA officer      files a completion report for the department
 *   District         verifies it, or returns it with a reason
 *   State Approver   closes the project once every department is verified
 *
 * Money figures are always worked out here from the release ledger and the
 * progress reports. Nothing the browser sends is trusted for them.
 */

const bad = (message, data) => new ApiError(HTTP_STATUS.BAD_REQUEST, message, data);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const conflict = (message, code) => new ApiError(HTTP_STATUS.CONFLICT, message, { code });
const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);

const MONEY = 100000;
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY);
const fromMoney = (units) => units / MONEY;
const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sameId = (a, b) => String(a?._id || a || '') === String(b?._id || b || '');

const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PENDING_REVISION = ['PENDING_CHECKER', 'PENDING_APPROVER'];
const FILED = [COMPLETION_STATUS.SUBMITTED, COMPLETION_STATUS.DISTRICT_VERIFIED];

const withSession = (query, session) => (session ? query.session(session) : query);
// Older projects may not have the version fields yet; a missing field counts as 0.
const versionIs = (field, value) => (value > 0 ? { [field]: value } : { $or: [{ [field]: 0 }, { [field]: { $exists: false } }] });

const loadProject = async (projectId, session) => {
  if (!isValidId(projectId)) throw notFound('Project not found.');
  const project = await withSession(ProjectSanction.findById(projectId).lean(), session);
  if (!project) throw notFound('Project not found.');
  return project;
};

const canRead = (project, user) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN].includes(user.role)) return true;
  if (user.role === USER_ROLES.DD_LEVEL) return Boolean(user.district) && user.district === project.district;
  if (user.role === USER_ROLES.PIA_OFFICER) return (project.departmentAllocations || []).some((d) => sameId(d.piaUserId, user._id));
  return false;
};

const projectStart = (project) => {
  const dates = [project.approvalDates?.dlec, project.approvalDates?.slec, project.approvalDates?.hpc, project.makerAt, project.createdAt]
    .filter(Boolean).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()));
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
};

/** Released, spent and reporting position of every department of a project. */
const loadFigures = async (project, session) => {
  const [entries, reports] = await Promise.all([
    withSession(BudgetAllocationEntry.find({ project: project._id }).select('departmentId amountLakh').lean(), session),
    withSession(ProjectMPR.find({ project: project._id }).select('departmentId status periodIndex reportingMonth financialYear totals').sort({ periodIndex: 1 }).lean(), session),
  ]);

  return (project.departmentAllocations || []).map((department) => {
    const released = entries.filter((e) => sameId(e.departmentId, department.departmentId)).reduce((sum, e) => sum + toMoney(e.amountLakh), 0);
    const mine = reports.filter((r) => sameId(r.departmentId, department.departmentId));
    const spent = mine.reduce((sum, r) => sum + toMoney(r.totals?.financialCurrentLakh), 0);
    const last = mine[mine.length - 1] || null;
    const sanctioned = toMoney(department.totalLakh);
    return {
      department,
      sanctioned,
      released,
      spent,
      unspent: Math.max(0, released - spent),
      excess: Math.max(0, spent - released),
      physicalPercent: last?.totals?.physicalPercent || 0,
      financialPercent: sanctioned > 0 ? Math.min(100, Math.floor((spent * 10000) / sanctioned) / 100) : 0,
      reports: {
        total: mine.length,
        awaitingDistrict: mine.filter((r) => r.status === PROJECT_MPR_STATUS.SUBMITTED).length,
        returned: mine.filter((r) => r.status === PROJECT_MPR_STATUS.RETURNED_TO_PIA).length,
        lastPeriod: last ? `${last.reportingMonth} ${last.financialYear}` : null,
      },
    };
  });
};

/** Why this department's completion report cannot be filed right now (null = it can). */
const submitBlocker = (project, row, existing) => {
  if (project.closure?.status === 'CLOSED') return 'This project is closed.';
  if (!row.department.piaAcceptedAt) return 'Accept the project for this department first.';
  if (existing && FILED.includes(existing.status)) {
    return existing.status === COMPLETION_STATUS.DISTRICT_VERIFIED ? 'The completion report has been verified by the district.' : 'The completion report is with the district for verification.';
  }
  if (row.reports.total === 0) return 'File at least one monthly progress report before the completion report.';
  if (row.reports.returned > 0) return 'A monthly report was returned for correction. Resubmit it first.';
  if (row.reports.awaitingDistrict > 0) return 'A monthly report is still awaiting district review. The completion report can be filed after it is approved.';
  return null;
};

const fileDto = (file) => (file?.url ? { url: file.url, name: file.name || 'Document', mimeType: file.mimeType || null, size: file.size || null } : null);

const completionDto = (doc) => (doc ? {
  id: String(doc._id),
  status: doc.status,
  completionDate: doc.completionDate,
  remarks: doc.remarks || '',
  sanctionedLakh: doc.sanctionedLakh,
  releasedLakh: doc.releasedLakh,
  expenditureLakh: doc.expenditureLakh,
  unspentLakh: doc.unspentLakh,
  physicalPercent: doc.physicalPercent,
  reportsCount: doc.reportsCount,
  completionCertificate: fileDto(doc.completionCertificate),
  utilisationCertificate: fileDto(doc.utilisationCertificate),
  submittedBy: doc.submittedBy?.name || null,
  submittedAt: doc.submittedAt,
  reviewedBy: doc.reviewedBy?.name || null,
  reviewedAt: doc.reviewedAt || null,
  reviewNote: doc.reviewNote || null,
  returnReason: doc.returnReason || null,
  history: (doc.history || []).map((step) => ({ status: step.status, note: step.note || '', changedAt: step.changedAt, changedBy: step.changedBy?.name || null })),
} : null);

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

/** Everything the closure screen needs, with what the signed-in user may do. */
export const getCompletionState = async (projectId, user) => {
  const project = await loadProject(projectId);
  if (!canRead(project, user)) throw forbidden('You do not have access to this project.');

  const [rows, completions, pendingRevision, officers] = await Promise.all([
    loadFigures(project),
    ProjectCompletion.find({ project: project._id })
      .populate('submittedBy', 'name').populate('reviewedBy', 'name').populate('history.changedBy', 'name').lean(),
    ProjectRevision.exists({ project: project._id, status: { $in: PENDING_REVISION } }),
    User.find({ _id: { $in: (project.departmentAllocations || []).map((d) => d.piaUserId).filter(Boolean) } }).select('name').lean(),
  ]);
  const officerName = new Map(officers.map((o) => [String(o._id), o.name]));
  const closed = project.closure?.status === 'CLOSED';
  const ownDistrict = user.role === USER_ROLES.DD_LEVEL && user.district === project.district;
  const isPia = user.role === USER_ROLES.PIA_OFFICER;

  const visible = rows.filter((row) => !isPia || sameId(row.department.piaUserId, user._id));
  const departments = visible.map((row) => {
    const doc = completions.find((c) => sameId(c.departmentId, row.department.departmentId)) || null;
    const mine = isPia && sameId(row.department.piaUserId, user._id);
    const blocker = submitBlocker(project, row, doc);
    return {
      departmentId: String(row.department.departmentId),
      name: row.department.departmentName,
      officer: row.department.piaUserId ? { id: String(row.department.piaUserId), name: officerName.get(String(row.department.piaUserId)) || '' } : null,
      accepted: Boolean(row.department.piaAcceptedAt),
      sanctionedLakh: fromMoney(row.sanctioned),
      releasedLakh: fromMoney(row.released),
      expenditureLakh: fromMoney(row.spent),
      unspentLakh: fromMoney(row.unspent),
      excessLakh: fromMoney(row.excess),
      physicalPercent: row.physicalPercent,
      financialPercent: row.financialPercent,
      reports: row.reports,
      completion: completionDto(doc),
      canSubmit: mine && !blocker,
      submitBlockedReason: mine ? blocker : null,
      canVerify: ownDistrict && !closed && doc?.status === COMPLETION_STATUS.SUBMITTED,
      canReturn: ownDistrict && !closed && Boolean(doc) && FILED.includes(doc.status),
    };
  });

  const all = rows.map((row) => completions.find((c) => sameId(c.departmentId, row.department.departmentId)) || null);
  const verified = all.filter((doc) => doc?.status === COMPLETION_STATUS.DISTRICT_VERIFIED).length;
  const filed = all.filter((doc) => doc && FILED.includes(doc.status)).length;
  const isApprover = user.role === USER_ROLES.SUPER_ADMIN && user.workflowRole === 'APPROVER';

  let closeBlockedReason = null;
  if (closed) closeBlockedReason = 'This project is already closed.';
  else if (!rows.length) closeBlockedReason = 'This project has no departments.';
  else if (verified < rows.length) closeBlockedReason = `${rows.length - verified} of ${rows.length} department${rows.length === 1 ? '' : 's'} still need a district-verified completion report.`;
  else if (pendingRevision) closeBlockedReason = 'A revised estimate is still awaiting a decision.';

  const released = sum(rows, 'released');
  const sanctioned = toMoney(project.totalSanctionedBudgetLakh) || sum(rows, 'sanctioned');
  return {
    project: {
      id: String(project._id),
      code: project.projectId || project.sanctionId || '',
      name: project.projectTitle || '',
      district: project.district,
      status: project.status,
    },
    closure: closed ? {
      status: 'CLOSED',
      closedAt: project.closure.closedAt,
      closedBy: (await User.findById(project.closure.closedBy).select('name').lean())?.name || null,
      note: project.closure.note || '',
      sanctionedLakh: project.closure.sanctionedLakh,
      releasedLakh: project.closure.releasedLakh,
      expenditureLakh: project.closure.expenditureLakh,
      unspentLakh: project.closure.unspentLakh,
      unreleasedLakh: project.closure.unreleasedLakh,
      refundStatus: project.closure.refundStatus,
      refundReference: project.closure.refundReference || null,
      refundRecordedAt: project.closure.refundRecordedAt || null,
    } : { status: 'OPEN' },
    totals: {
      sanctionedLakh: fromMoney(sanctioned),
      releasedLakh: fromMoney(released),
      expenditureLakh: fromMoney(sum(rows, 'spent')),
      unspentLakh: fromMoney(sum(rows, 'unspent')),
      unreleasedLakh: fromMoney(Math.max(0, sanctioned - released)),
    },
    progress: { departments: rows.length, filed, verified },
    departments,
    canClose: isApprover && !closeBlockedReason,
    closeBlockedReason: user.role === USER_ROLES.SUPER_ADMIN ? closeBlockedReason : null,
    closeRole: 'APPROVER',
    canRecordRefund: closed && user.role === USER_ROLES.SUPER_ADMIN && project.closure.refundStatus === 'PENDING',
  };
};

const checkFile = (file, label) => {
  if (!FILE_TYPES.includes(file.mimetype)) throw bad(`${label}: upload a PDF, JPG or PNG file.`);
  if (file.size > MAX_FILE_BYTES) throw bad(`${label}: the file is too large. Maximum size is 10 MB.`);
};

const store = async (file) => {
  const saved = await uploadFile(file.buffer, 'project-completion');
  return { url: saved.url, publicId: saved.publicId, name: clean(file.originalname, 200) || 'Document', mimeType: file.mimetype, size: file.size };
};

const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCDate() === Number(match[3]) ? date : null;
};

const notifyQuietly = async (recipients, payload) => {
  try { await safeNotify(recipients, payload); } catch (err) { logger.error(`Closure notification failed: ${err.message}`); }
};

const notice = (project, actor, extra) => ({
  referenceNo: project.projectId || project.sanctionId || '',
  projectTitle: project.projectTitle || '',
  actorName: actor?.name || 'SARRA CRM',
  actorRole: actor?.workflowRole || actor?.role || 'System',
  status: project.status,
  eventDate: new Date(),
  relatedResource: 'ProjectSanction',
  relatedId: project._id,
  ...extra,
});

/** PIA officer files (or, after a return, corrects) the department's completion report. */
export const submitCompletion = async (projectId, body = {}, files = {}, user) => {
  if (user.role !== USER_ROLES.PIA_OFFICER) throw forbidden('Only the PIA officer of the department can file its completion report.');
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId : '';
  const completionDate = parseDay(body.completionDate);
  if (!completionDate) throw bad('Enter the date the works were completed.');
  const today = new Date();
  if (completionDate.getTime() > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) throw bad('The completion date cannot be in the future.');
  const remarks = clean(body.remarks, 2000);

  const certificate = files.completionCertificate?.[0] || null;
  const utilisation = files.utilisationCertificate?.[0] || null;
  if (certificate) checkFile(certificate, 'Completion Certificate');
  if (utilisation) checkFile(utilisation, 'Utilisation Certificate');

  // Check everything that does not need the files before uploading them.
  const before = await loadProject(projectId);
  const row = (await loadFigures(before)).find((item) => sameId(item.department.departmentId, departmentId) && sameId(item.department.piaUserId, user._id));
  if (!row) throw forbidden('You are not the assigned PIA officer for this department.');
  const existingBefore = await ProjectCompletion.findOne({ project: before._id, departmentId: row.department.departmentId }).lean();
  const blockedBefore = submitBlocker(before, row, existingBefore);
  if (blockedBefore) throw conflict(blockedBefore, 'COMPLETION_BLOCKED');
  const start = projectStart(before);
  if (completionDate.getTime() < Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) throw bad('The completion date cannot be before the project started.');
  if (!certificate && !existingBefore?.completionCertificate?.url) throw bad('Attach the Completion Certificate.');
  if (!utilisation && !existingBefore?.utilisationCertificate?.url) throw bad('Attach the Utilisation Certificate.');

  const uploaded = [];
  try {
    const storedCertificate = certificate ? await store(certificate) : null;
    if (storedCertificate) uploaded.push(storedCertificate);
    const storedUtilisation = utilisation ? await store(utilisation) : null;
    if (storedUtilisation) uploaded.push(storedUtilisation);

    const { saved, replaced, project } = await runInTransaction(async (session) => {
      const options = session ? { session } : {};
      const current = await loadProject(projectId, session);
      const figures = (await loadFigures(current, session)).find((item) => sameId(item.department.departmentId, departmentId) && sameId(item.department.piaUserId, user._id));
      if (!figures) throw forbidden('You are not the assigned PIA officer for this department.');
      const existing = await withSession(ProjectCompletion.findOne({ project: current._id, departmentId: figures.department.departmentId }), session);
      const blocked = submitBlocker(current, figures, existing);
      if (blocked) throw conflict(blocked, 'COMPLETION_BLOCKED');

      const now = new Date();
      const snapshot = {
        status: COMPLETION_STATUS.SUBMITTED,
        completionDate,
        remarks,
        sanctionedLakh: fromMoney(figures.sanctioned),
        releasedLakh: fromMoney(figures.released),
        expenditureLakh: fromMoney(figures.spent),
        unspentLakh: fromMoney(figures.unspent),
        physicalPercent: figures.physicalPercent,
        reportsCount: figures.reports.total,
        submittedBy: user._id,
        submittedAt: now,
      };
      const old = [];
      let doc = existing;
      if (doc) {
        if (storedCertificate && doc.completionCertificate?.publicId) old.push(doc.completionCertificate.publicId);
        if (storedUtilisation && doc.utilisationCertificate?.publicId) old.push(doc.utilisationCertificate.publicId);
        Object.assign(doc, snapshot);
        if (storedCertificate) doc.completionCertificate = storedCertificate;
        if (storedUtilisation) doc.utilisationCertificate = storedUtilisation;
        doc.returnReason = undefined;
        doc.reviewedBy = undefined;
        doc.reviewedAt = undefined;
        doc.reviewNote = undefined;
        doc.history.push({ status: COMPLETION_STATUS.SUBMITTED, changedBy: user._id, changedAt: now, note: 'Corrected and resubmitted' });
        await doc.save(options);
      } else {
        try {
          [doc] = await ProjectCompletion.create([{
            ...snapshot,
            project: current._id,
            projectCode: current.projectId || current.sanctionId || '',
            district: current.district,
            departmentId: figures.department.departmentId,
            departmentName: figures.department.departmentName,
            completionCertificate: storedCertificate,
            utilisationCertificate: storedUtilisation,
            history: [{ status: COMPLETION_STATUS.SUBMITTED, changedBy: user._id, changedAt: now, note: 'Filed with the district' }],
          }], options);
        } catch (err) {
          if (err?.code === 11000) throw conflict('The completion report of this department has already been filed.', 'COMPLETION_BLOCKED');
          throw err;
        }
      }

      // The report version moves too, so a monthly report being saved at this instant is validated again and refused.
      const marked = await ProjectSanction.updateOne(
        { _id: current._id, 'closure.status': { $ne: 'CLOSED' }, departmentAllocations: { $elemMatch: { departmentId: figures.department.departmentId, piaUserId: user._id } } },
        {
          $set: { 'departmentAllocations.$.completion': { status: COMPLETION_STATUS.SUBMITTED, completionDate, submittedAt: now } },
          $inc: { mprVersion: 1 },
          $push: { workflowHistory: { action: 'COMPLETION_SUBMITTED', performedBy: user._id, performedAt: now, note: `${figures.department.departmentName}: completion report filed` } },
        },
        options,
      );
      if (marked.modifiedCount !== 1) throw conflict('The project changed while the report was being saved. Please try again.', 'STALE');
      return { saved: doc, replaced: old, project: current };
    });

    replaced.forEach((publicId) => { deleteFile(publicId); });
    const directors = await User.find({ ...activeUserQuery, role: USER_ROLES.DD_LEVEL, district: project.district });
    await notifyQuietly(directors, notice(project, user, {
      title: `${project.projectId || 'Project'}: completion report to verify`,
      message: `${saved.departmentName} filed its completion report for ${project.projectTitle || project.projectId}.`,
      emailDescription: 'A completion report has been filed and is awaiting your verification. Please check the certificates and the final expenditure, then verify it or return it for correction.',
      subject: 'Action Required: Completion Report Awaiting Verification',
      priority: 'HIGH',
      primaryLabel: 'Open Project',
      link: `/dashboard/dd/projects/${project._id}#closure`,
    }));
    return saved;
  } catch (err) {
    // Nothing was saved, so the files just uploaded are orphans.
    if (!err?.keepFiles) uploaded.forEach((file) => { deleteFile(file.publicId); });
    throw err;
  }
};

const reviewCompletion = async (projectId, departmentId, user, apply) => runInTransaction(async (session) => {
  const options = session ? { session } : {};
  const project = await loadProject(projectId, session);
  if (user.role !== USER_ROLES.DD_LEVEL || !user.district || user.district !== project.district) throw forbidden('This project belongs to another district.');
  if (project.closure?.status === 'CLOSED') throw conflict('This project is closed.', 'PROJECT_CLOSED');
  if (!isValidId(departmentId)) throw notFound('Completion report not found.');
  const doc = await withSession(ProjectCompletion.findOne({ project: project._id, departmentId }), session);
  if (!doc) throw notFound('Completion report not found.');
  const now = new Date();
  const result = apply(doc, now);
  await doc.save(options);
  const set = { 'departmentAllocations.$.completion.status': doc.status };
  if (doc.status === COMPLETION_STATUS.DISTRICT_VERIFIED) set['departmentAllocations.$.completion.verifiedAt'] = now;
  await ProjectSanction.updateOne(
    { _id: project._id, 'departmentAllocations.departmentId': doc.departmentId },
    { $set: set, $inc: { mprVersion: 1 }, $push: { workflowHistory: { action: result.action, performedBy: user._id, performedAt: now, note: `${doc.departmentName}: ${result.note}` } } },
    options,
  );
  return { doc, project };
});

/** District Director verifies a department's completion report. */
export const verifyCompletion = async (projectId, departmentId, note, user) => {
  const text = clean(note, 1000);
  const { doc, project } = await reviewCompletion(projectId, departmentId, user, (completion, now) => {
    if (completion.status !== COMPLETION_STATUS.SUBMITTED) {
      throw conflict(completion.status === COMPLETION_STATUS.DISTRICT_VERIFIED ? 'This completion report is already verified.' : 'This completion report was returned and has not been filed again.', 'NOT_VERIFIABLE');
    }
    completion.status = COMPLETION_STATUS.DISTRICT_VERIFIED;
    completion.reviewedBy = user._id;
    completion.reviewedAt = now;
    completion.reviewNote = text || undefined;
    completion.returnReason = undefined;
    completion.history.push({ status: COMPLETION_STATUS.DISTRICT_VERIFIED, changedBy: user._id, changedAt: now, note: text || 'Verified by district' });
    return { action: 'COMPLETION_VERIFIED', note: 'completion report verified by district' };
  });

  const [submitter, verifiedCount] = await Promise.all([
    User.findById(doc.submittedBy),
    ProjectCompletion.countDocuments({ project: project._id, status: COMPLETION_STATUS.DISTRICT_VERIFIED }),
  ]);
  await notifyQuietly(submitter, notice(project, user, {
    title: `${project.projectId || 'Project'}: completion report verified`,
    message: `The completion report of ${doc.departmentName} was verified by ${user.name}.`,
    subject: 'Completion Report Verified by District',
    primaryLabel: 'Open Project',
    link: `/dashboard/officer/projects/${project._id}#closure`,
  }));
  if (verifiedCount >= (project.departmentAllocations || []).length) {
    const approvers = await User.find({ ...activeUserQuery, role: USER_ROLES.SUPER_ADMIN, workflowRole: 'APPROVER' });
    await notifyQuietly(approvers, notice(project, user, {
      title: `${project.projectId || 'Project'} is ready to be closed`,
      message: `Every department of ${project.projectTitle || project.projectId} has a district-verified completion report.`,
      emailDescription: 'All completion reports of this project have been verified by the district. Please review the final expenditure and unspent balance, and close the project.',
      subject: 'Action Required: Project Ready for Closure',
      priority: 'HIGH',
      primaryLabel: 'Review and Close',
      link: `/dashboard/admin/projects/${project._id}#closure`,
    }));
  }
  return doc;
};

/** District Director sends a completion report back. Monthly reporting opens again for the department. */
export const returnCompletion = async (projectId, departmentId, reason, user) => {
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Give the reason for returning the completion report.');
  const { doc, project } = await reviewCompletion(projectId, departmentId, user, (completion, now) => {
    if (!FILED.includes(completion.status)) throw conflict('This completion report has already been returned.', 'NOT_RETURNABLE');
    completion.status = COMPLETION_STATUS.RETURNED;
    completion.reviewedBy = user._id;
    completion.reviewedAt = now;
    completion.returnReason = text;
    completion.history.push({ status: COMPLETION_STATUS.RETURNED, changedBy: user._id, changedAt: now, note: text });
    return { action: 'COMPLETION_RETURNED', note: `completion report returned (${text})` };
  });
  await notifyQuietly(await User.findById(doc.submittedBy), notice(project, user, {
    title: `${project.projectId || 'Project'}: completion report returned`,
    message: `The completion report of ${doc.departmentName} was returned by ${user.name}: ${text}`,
    emailDescription: 'Your completion report has been returned for correction. Please read the remarks, correct it and file it again.',
    subject: 'Completion Report Returned for Correction',
    priority: 'HIGH',
    primaryLabel: 'Open Project',
    link: `/dashboard/officer/projects/${project._id}#closure`,
  }));
  return doc;
};

/** State Approver closes the project. Figures are taken again from the ledger at this moment. */
export const closeProject = async (projectId, body = {}, user) => {
  if (user.role !== USER_ROLES.SUPER_ADMIN || user.workflowRole !== 'APPROVER') throw forbidden('Only the Approver can close a project.');
  const note = clean(body.note, 1000);
  if (note.length < 10) throw bad('Write a closure note (at least 10 characters).');
  const refundReference = clean(body.refundReference, 200);

  const result = await runInTransaction(async (session) => {
    const options = session ? { session } : {};
    const project = await loadProject(projectId, session);
    if (project.closure?.status === 'CLOSED') throw conflict('This project is already closed.', 'PROJECT_CLOSED');
    if (project.status === SANCTION_STATUS.REJECTED) throw conflict('A rejected project cannot be closed.', 'NOT_CLOSABLE');
    const rows = await loadFigures(project, session);
    if (!rows.length) throw conflict('This project has no departments.', 'NOT_CLOSABLE');
    const completions = await withSession(ProjectCompletion.find({ project: project._id }).lean(), session);
    const verified = rows.filter((row) => completions.some((c) => sameId(c.departmentId, row.department.departmentId) && c.status === COMPLETION_STATUS.DISTRICT_VERIFIED)).length;
    if (verified < rows.length) throw conflict(`${rows.length - verified} of ${rows.length} department${rows.length === 1 ? '' : 's'} still need a district-verified completion report.`, 'NOT_CLOSABLE');
    if (rows.some((row) => row.reports.awaitingDistrict > 0 || row.reports.returned > 0)) throw conflict('A monthly progress report of this project is still open.', 'NOT_CLOSABLE');
    if (await withSession(ProjectRevision.exists({ project: project._id, status: { $in: PENDING_REVISION } }), session)) {
      throw conflict('A revised estimate is still awaiting a decision.', 'NOT_CLOSABLE');
    }

    const released = sum(rows, 'released');
    const sanctioned = toMoney(project.totalSanctionedBudgetLakh) || sum(rows, 'sanctioned');
    const unspent = sum(rows, 'unspent');
    const now = new Date();
    const closure = {
      status: 'CLOSED',
      closedAt: now,
      closedBy: user._id,
      note,
      sanctionedLakh: fromMoney(sanctioned),
      releasedLakh: fromMoney(released),
      expenditureLakh: fromMoney(sum(rows, 'spent')),
      unspentLakh: fromMoney(unspent),
      unreleasedLakh: fromMoney(Math.max(0, sanctioned - released)),
      // eslint-disable-next-line no-nested-ternary
      refundStatus: unspent === 0 ? 'NOT_APPLICABLE' : (refundReference ? 'RECORDED' : 'PENDING'),
      ...(unspent > 0 && refundReference ? { refundReference, refundRecordedAt: now, refundRecordedBy: user._id } : {}),
    };
    // budgetVersion and mprVersion both move: a release or a report being saved at this instant fails its own check.
    const updated = await ProjectSanction.updateOne(
      { _id: project._id, 'closure.status': { $ne: 'CLOSED' }, $and: [versionIs('budgetVersion', project.budgetVersion), versionIs('mprVersion', project.mprVersion)] },
      {
        $set: { closure },
        $inc: { budgetVersion: 1, mprVersion: 1 },
        $push: { workflowHistory: { action: 'CLOSED', performedBy: user._id, performedAt: now, note } },
      },
      options,
    );
    if (updated.modifiedCount !== 1) throw conflict('The project changed while it was being closed. Please review the figures and try again.', 'STALE');
    return { project, closure };
  });

  const { project, closure } = result;
  const recipients = await User.find({
    ...activeUserQuery,
    $or: [
      { role: USER_ROLES.DD_LEVEL, district: project.district },
      { _id: { $in: (project.departmentAllocations || []).map((d) => d.piaUserId).filter(Boolean) } },
    ],
  });
  await notifyQuietly(recipients, notice(project, user, {
    title: `${project.projectId || 'Project'} closed`,
    message: `${project.projectTitle || project.projectId} was closed by ${user.name}.${closure.unspentLakh > 0 ? ` Unspent balance to refund: Rs. ${closure.unspentLakh} lakh.` : ''}`,
    subject: 'SARRA Project Closed',
    primaryLabel: 'Open Project',
  }));
  return { id: String(project._id), code: project.projectId || project.sanctionId || '', closure };
};

/** Record the challan / treasury reference once the unspent balance is refunded. */
export const recordRefund = async (projectId, body = {}, user) => {
  if (user.role !== USER_ROLES.SUPER_ADMIN) throw forbidden('Only the State administrator can record a refund.');
  const reference = clean(body.refundReference, 200);
  if (reference.length < 3) throw bad('Enter the challan or treasury reference of the refund.');
  const project = await loadProject(projectId);
  if (project.closure?.status !== 'CLOSED') throw conflict('The refund is recorded after the project is closed.', 'NOT_CLOSED');
  if (project.closure.refundStatus !== 'PENDING') throw conflict('No refund is pending for this project.', 'NO_REFUND_PENDING');
  const now = new Date();
  const updated = await ProjectSanction.updateOne(
    { _id: project._id, 'closure.refundStatus': 'PENDING' },
    { $set: { 'closure.refundStatus': 'RECORDED', 'closure.refundReference': reference, 'closure.refundRecordedAt': now, 'closure.refundRecordedBy': user._id } },
  );
  if (updated.modifiedCount !== 1) throw conflict('No refund is pending for this project.', 'NO_REFUND_PENDING');
  return { refundStatus: 'RECORDED', refundReference: reference, refundRecordedAt: now };
};

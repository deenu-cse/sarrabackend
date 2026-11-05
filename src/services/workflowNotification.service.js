import User from '../models/User.model.js';
import ProjectSanction from '../models/ProjectSanction.model.js';
import { createBusinessNotification } from './notification.service.js';
import { sendWorkflowEmail } from '../utils/email/workflowEmails.js';
import USER_ROLES, { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { actorLabel, tierRoleQuery } from '../utils/access.js';
import { REVIEW_STAGES, stageOwner, statusLabel } from './mprWorkflow.js';

/**
 * In-app and e-mail notifications of the workflow. Every event goes to the
 * users who hold the next step, so a pending action always reaches the next
 * authorised person (the workflow engine's automatic forwarding).
 */

const { MAKER, CHECKER, APPROVER } = WORKFLOW_ROLES;

const getFrontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.CRM_URL || 'http://localhost:3000').replace(/\/$/, '');

const dashboardPathForRole = (role) => {
  if (role === USER_ROLES.PIA_OFFICER) return '/dashboard/officer';
  if (role === USER_ROLES.DD_LEVEL) return '/dashboard/dd';
  if (role === USER_ROLES.MND_OFFICER) return '/dashboard/mnd';
  if (role === USER_ROLES.MND_SUPER_ADMIN) return '/dashboard/mnd-admin';
  return '/dashboard/admin';
};

const projectPathForRole = (role, projectId) => {
  if (role === USER_ROLES.PIA_OFFICER) return `/dashboard/officer/projects/${projectId}`;
  if (role === USER_ROLES.DD_LEVEL) return `/dashboard/dd/projects/${projectId}`;
  return `/dashboard/admin/projects/${projectId}`;
};

/** Where a project MPR opens for each role. */
export const projectMprPathForRole = (role, mprId) => {
  if (role === USER_ROLES.PIA_OFFICER) return `/dashboard/officer/mprs/report/${mprId}`;
  if (role === USER_ROLES.DD_LEVEL) return `/dashboard/dd/mpr-review/project/${mprId}`;
  if (role === USER_ROLES.MND_SUPER_ADMIN) return `/dashboard/mnd-admin/mpr/project/${mprId}`;
  return `/dashboard/admin/projects/mpr/${mprId}`;
};

const mprPathForRole = (role, formKey, mprId) => {
  if (formKey === 'abstract55') {
    return role === USER_ROLES.MND_SUPER_ADMIN ? `/dashboard/mnd-admin/mpr/${mprId}` : '/dashboard/mnd/abstract55';
  }
  if (role === USER_ROLES.DD_LEVEL) return `/dashboard/dd/mpr-review/${formKey}/${mprId}`;
  if (role === USER_ROLES.MND_SUPER_ADMIN) return `/dashboard/mnd-admin/mpr/${formKey}/${mprId}`;
  if (role === USER_ROLES.MND_OFFICER) return `/dashboard/mnd/mpr/${formKey}/${mprId}`;
  return `/dashboard/officer/mprs/${formKey}/${mprId}`;
};

export const activeUserQuery = { isActive: true, accountStatus: { $ne: 'DEACTIVATED' } };

const compactRole = (user) => (user ? actorLabel(user) : 'System');
const referenceForProject = (project) => project?.sanctionId || project?.projectId || project?.dprApplicationNo || 'Sanction ID pending';
const referenceForMpr = (mpr) => mpr?.applicationNo || 'MPR reference pending';

/**
 * Notify users in-app and by e-mail. `payload.link` is the page to open; with
 * `payload.linkFor(recipient)` each recipient gets the page of their own role.
 */
export const safeNotify = async (recipients, payload) => {
  const users = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);
  const frontendUrl = getFrontendUrl();

  await Promise.all(users.map(async (recipient) => {
    const link = payload.linkFor?.(recipient) || payload.link || dashboardPathForRole(recipient.role);

    try {
      await createBusinessNotification({
        recipientId: recipient._id,
        title: payload.title,
        message: payload.message,
        relatedResource: payload.relatedResource,
        relatedId: payload.relatedId,
        type: payload.type || 'WORKFLOW',
        priority: payload.priority || 'NORMAL',
        status: payload.status,
        referenceNo: payload.referenceNo,
        actorName: payload.actorName,
        actorRole: payload.actorRole,
        link
      });
    } catch (err) {
      console.error('[workflowNotification] in-app notification failed:', err.message);
    }

    try {
      await sendWorkflowEmail({
        to: recipient.email,
        subject: payload.subject,
        headline: payload.title,
        description: payload.emailDescription || payload.message,
        referenceNo: payload.referenceNo,
        projectTitle: payload.projectTitle,
        actorName: payload.actorName,
        actorRole: payload.actorRole,
        status: payload.status,
        eventDate: payload.eventDate,
        primaryUrl: `${frontendUrl}${link}`,
        primaryLabel: payload.primaryLabel,
        dashboardUrl: `${frontendUrl}${dashboardPathForRole(recipient.role)}`
      });
    } catch (err) {
      console.error('[workflowNotification] email failed:', err.message);
    }
  }));
};

const usersOf = (tier, role, scope) => User.find(tierRoleQuery(tier, role, scope));

// ─── Project workflow ────────────────────────────────────────────────────────

/** Who receives each project event, and what they are told. */
const PROJECT_EVENTS = {
  PROJECT_SUBMITTED: {
    to: () => usersOf(TIERS.HQ, CHECKER),
    title: (ref) => `${ref} requires HQ Checker verification`,
    message: (p, actor) => `${p.projectTitle || 'A project'} was submitted by ${actor} and is awaiting verification of its DPR, targets and financial allocation.`,
    email: 'A project has been submitted by the HQ Maker and is awaiting your verification. Please verify the DPR, project details, physical and financial targets, or return it to the Maker with your objection.',
    subject: 'Action Required: SARRA Project Awaiting Verification',
    priority: 'HIGH', cta: 'Verify Project',
  },
  PROJECT_CHECKED: {
    to: () => usersOf(TIERS.HQ, APPROVER),
    title: (ref) => `${ref} is ready for sanction`,
    message: (p, actor) => `${p.projectTitle || 'A project'} was verified by ${actor} and is awaiting your approval and Sanction Order.`,
    email: 'The project has been verified by the HQ Checker. Please review it and approve it with the Sanction Order, or return it to the Maker.',
    subject: 'Approval Required: SARRA Project Ready for Sanction',
    priority: 'HIGH', cta: 'Review Project',
  },
  PROJECT_APPROVED: {
    to: (p) => User.find({ ...activeUserQuery, _id: p.makerUserId }),
    title: (ref) => `Project sanctioned: ${ref}`,
    message: (p, actor) => `${p.projectTitle || 'The project'} was sanctioned by ${actor}. Forward it to ${p.district} district.`,
    email: 'Your project has been sanctioned and its Sanction ID issued. Please forward it to the concerned District SARRA Centre.',
    subject: (ref) => `Project Sanctioned: ${ref}`,
    priority: 'HIGH', cta: 'Forward to District',
  },
  PROJECT_REJECTED: {
    to: (p) => User.find({ ...activeUserQuery, _id: p.makerUserId }),
    title: (ref) => `${ref} was returned with an objection`,
    message: (p, actor, note) => `${p.projectTitle || 'The project'} was returned by ${actor}: ${note || p.rejectionReason || 'please review the remarks'}.`,
    email: 'Your project has been returned with an objection. Please open it, read the remarks, correct it and resubmit it under the same Project ID.',
    subject: (ref) => `Project Returned: ${ref}`,
    priority: 'HIGH', cta: 'Correct Project',
  },
  PROJECT_FORWARDED_DISTRICT: {
    to: (p) => usersOf(TIERS.DISTRICT, MAKER, { district: p.district }),
    title: (ref, p) => `${ref} forwarded to ${p.district} district`,
    message: (p) => `${p.projectTitle || 'A sanctioned project'} has been forwarded to your district for acceptance, PIA assignment and reporting responsibility.`,
    email: 'A sanctioned project has been forwarded to your District SARRA Centre. Please accept it, assign the PIA and the District Technical Staff, and set the MPR reporting responsibility.',
    subject: 'Action Required: SARRA Project Forwarded to Your District',
    priority: 'HIGH', cta: 'Accept Project',
  },
  PROJECT_DISTRICT_ACCEPTED: {
    to: (p) => User.find({ ...activeUserQuery, _id: p.makerUserId }),
    title: (ref) => `${ref} accepted by district`,
    message: (p, actor) => `${p.projectTitle || 'The project'} was accepted by ${actor}. The district is assigning the PIA.`,
    email: 'The district has accepted your project and will now assign the PIA and the reporting responsibility.',
    subject: (ref) => `District Accepted Project: ${ref}`,
    priority: 'NORMAL', cta: 'Open Project',
  },
  PROJECT_FORWARDED_PIA: {
    to: (p, ids) => (ids?.length ? User.find({ ...activeUserQuery, _id: { $in: ids } }) : User.find({ ...activeUserQuery, _id: p.forwardedToPIA })),
    title: (ref) => `${ref} assigned to you`,
    message: (p) => `${p.projectTitle || 'A project'} has been assigned to you as PIA Maker. Accept it to start implementation and monthly reporting.`,
    email: 'A project has been assigned to you by the District SARRA Centre. Please open it and accept it to start implementation.',
    subject: 'Action Required: New SARRA Project Assigned to You',
    priority: 'HIGH', cta: 'Accept Project',
  },
  REPORTING_ASSIGNED: {
    to: (p, ids) => User.find({ ...activeUserQuery, _id: { $in: ids || [] } }),
    title: (ref) => `${ref}: you are the District Technical Staff`,
    message: (p) => `You have been mapped as District Technical Staff for ${p.projectTitle || 'a project'}. Where the district holds the reporting responsibility, you prepare its monthly progress report.`,
    email: 'You have been mapped as District Technical Staff to a project. Where the district holds the reporting responsibility, you prepare and submit its monthly progress reports to the District Checker.',
    subject: 'SARRA: Reporting Responsibility Assigned',
    priority: 'NORMAL', cta: 'Open Project',
  },
  PROJECT_PIA_ACCEPTED: {
    to: (p) => usersOf(TIERS.DISTRICT, MAKER, { district: p.district }),
    title: (ref) => `${ref} accepted by the PIA`,
    message: (p, actor) => `${actor} accepted ${p.projectTitle || 'the project'}. Implementation has begun.`,
    email: 'The PIA has accepted the project and implementation has begun.',
    subject: (ref) => `PIA Accepted Project: ${ref}`,
    priority: 'NORMAL', cta: 'Open Project',
  },
  REVISION_SUBMITTED: {
    to: () => usersOf(TIERS.HQ, CHECKER),
    title: (ref) => `${ref}: target revision to verify`,
    message: (p, actor) => `${actor} proposed a target revision for ${p.projectTitle || 'a project'}.`,
    email: 'A target revision has been proposed and is awaiting your verification.',
    subject: 'Action Required: Target Revision Awaiting Verification',
    priority: 'HIGH', cta: 'Review Revision',
  },
  REVISION_CHECKED: {
    to: () => usersOf(TIERS.HQ, APPROVER),
    title: (ref) => `${ref}: target revision to approve`,
    message: (p, actor) => `A target revision of ${p.projectTitle || 'a project'} was verified by ${actor}.`,
    email: 'A target revision has been verified and is awaiting your approval.',
    subject: 'Approval Required: Target Revision',
    priority: 'HIGH', cta: 'Review Revision',
  },
  REVISION_DECIDED: {
    to: () => usersOf(TIERS.HQ, MAKER),
    title: (ref) => `${ref}: target revision decided`,
    message: (p, actor, note) => `The target revision of ${p.projectTitle || 'the project'} was decided by ${actor}${note ? `: ${note}` : ''}.`,
    email: 'A target revision you are following has been decided. Open the project to see the outcome.',
    subject: 'SARRA: Target Revision Decided',
    priority: 'NORMAL', cta: 'Open Project',
  },
};

export const notifyProjectWorkflow = async ({ project, actor, event, note, recipientIds }) => {
  const config = PROJECT_EVENTS[event];
  if (!project || !config) return;
  const referenceNo = referenceForProject(project);
  const actorName = actor?.name || 'SARRA CRM';
  const pick = (value) => (typeof value === 'function' ? value(referenceNo, project) : value);
  const recipients = await config.to(project, recipientIds);
  await safeNotify(recipients, {
    title: config.title(referenceNo, project),
    message: config.message(project, actorName, note),
    emailDescription: config.email,
    subject: pick(config.subject),
    referenceNo,
    projectTitle: project.projectTitle || referenceNo,
    actorName,
    actorRole: compactRole(actor),
    status: project.status,
    eventDate: new Date(),
    relatedResource: 'ProjectSanction',
    relatedId: project._id,
    priority: config.priority,
    primaryLabel: config.cta,
    linkFor: (recipient) => projectPathForRole(recipient.role, project._id),
  });
};

// ─── Legacy Praroop MPR forms ────────────────────────────────────────────────

export const notifyMprWorkflow = async ({ mpr, actor, event, formKey, formLabel }) => {
  if (!mpr) return;
  const populatedMpr = mpr.projectSanctionId?.projectTitle
    ? mpr
    : await mpr.constructor.findById(mpr._id).populate('projectSanctionId', 'projectTitle sanctionId district');

  const actorName = actor?.name || 'SARRA CRM';
  const actorRole = compactRole(actor);
  const eventDate = new Date();
  const referenceNo = referenceForMpr(populatedMpr);
  const project = populatedMpr.projectSanctionId;
  const projectTitle = project?.projectTitle || `${formLabel || populatedMpr.reportType || 'MPR'} ${populatedMpr.reportingMonth || ''}`.trim();

  if (event === 'MPR_SUBMITTED' || event === 'MPR_RESUBMITTED') {
    const isMnd = actor?.role === USER_ROLES.MND_OFFICER;
    const recipients = isMnd
      ? await User.find({ ...activeUserQuery, role: USER_ROLES.MND_SUPER_ADMIN })
      : await User.find({ ...activeUserQuery, role: USER_ROLES.DD_LEVEL, district: populatedMpr.submittedByDistrict });
    const targetRole = isMnd ? USER_ROLES.MND_SUPER_ADMIN : USER_ROLES.DD_LEVEL;
    return safeNotify(recipients, {
      title: `${referenceNo} submitted for review`,
      message: `${formLabel || 'MPR'} for ${populatedMpr.reportingMonth} ${populatedMpr.financialYear} was submitted by ${actorName}.`,
      emailDescription: 'A monthly progress report has been submitted and is awaiting your review. Please open the report, review the submitted progress, and complete your assigned action.',
      subject: 'Action Required: SARRA MPR Awaiting Review',
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: populatedMpr.status,
      eventDate,
      relatedResource: populatedMpr.reportType || 'MPR',
      relatedId: populatedMpr._id,
      priority: 'HIGH',
      primaryLabel: 'Review MPR',
      link: mprPathForRole(targetRole, formKey, populatedMpr._id)
    });
  }

  if (event === 'MPR_DISTRICT_APPROVED') {
    const mndAdmins = await User.find({ ...activeUserQuery, role: USER_ROLES.MND_SUPER_ADMIN });
    return safeNotify(mndAdmins, {
      title: `${referenceNo} approved by district`,
      message: `${formLabel || 'MPR'} has been reviewed by ${actorName} and is ready for state review.`,
      emailDescription: 'The monthly progress report has been reviewed at district level and is now available for state review.',
      subject: 'MPR Ready for State Review',
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: populatedMpr.status,
      eventDate,
      relatedResource: populatedMpr.reportType || 'MPR',
      relatedId: populatedMpr._id,
      priority: 'NORMAL',
      primaryLabel: 'Review MPR',
      link: mprPathForRole(USER_ROLES.MND_SUPER_ADMIN, formKey, populatedMpr._id)
    });
  }

  if (event === 'MPR_RETURNED' || event === 'MPR_APPROVED' || event === 'MPR_REJECTED') {
    const submitter = await User.findById(populatedMpr.submittedBy);
    const returned = event === 'MPR_RETURNED' || event === 'MPR_REJECTED';
    return safeNotify(submitter, {
      title: returned ? `${referenceNo} requires changes` : `${referenceNo} reviewed successfully`,
      message: returned
        ? `${formLabel || 'MPR'} was returned by ${actorName}. Please review the remarks and resubmit.`
        : `${formLabel || 'MPR'} has been reviewed and approved by ${actorName}.`,
      emailDescription: returned
        ? 'Your monthly progress report has been returned for changes. Please open the report, review the remarks, and resubmit the corrected information.'
        : 'Your monthly progress report has been reviewed successfully. You can open the report to see its latest status.',
      subject: returned ? `MPR Returned for Changes: ${referenceNo}` : `MPR Reviewed: ${referenceNo}`,
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: populatedMpr.status,
      eventDate,
      relatedResource: populatedMpr.reportType || 'MPR',
      relatedId: populatedMpr._id,
      priority: returned ? 'HIGH' : 'NORMAL',
      primaryLabel: 'Open MPR',
      link: mprPathForRole(submitter?.role, formKey, populatedMpr._id)
    });
  }
};

export const getProjectForNotification = async (projectId) =>
  ProjectSanction.findById(projectId);

// ─── Project MPRs ────────────────────────────────────────────────────────────

/** Users who hold the review step a report is now at. */
export const stageRecipients = (mpr) => {
  const stage = REVIEW_STAGES[mpr.status];
  if (!stage) return Promise.resolve([]);
  const scope = stage.tier === TIERS.HQ ? {} : { district: mpr.district, ...(stage.tier === TIERS.PIA ? { department: mpr.departmentName } : {}) };
  return User.find({ ...tierRoleQuery(stage.tier, stage.role, scope), _id: { $ne: mpr.submittedBy } });
};

/**
 * Notifications for project Monthly Progress Reports (ProjectMPR).
 *   SUBMITTED / RESUBMITTED / FORWARDED   to the users of the next review step
 *   RETURNED / REJECTED / VERIFIED        to the reporting Maker
 */
export const notifyProjectMpr = async ({ mpr, actor, event }) => {
  if (!mpr) return undefined;
  const period = `${mpr.reportingMonth} ${mpr.financialYear}`;
  const common = {
    referenceNo: mpr.mprNo,
    projectTitle: mpr.projectTitle || mpr.projectCode,
    actorName: actor?.name || 'SARRA CRM',
    actorRole: compactRole(actor),
    status: mpr.status,
    eventDate: new Date(),
    relatedResource: 'ProjectMPR',
    relatedId: mpr._id,
    linkFor: (recipient) => projectMprPathForRole(recipient.role, mpr._id),
  };

  if (['SUBMITTED', 'RESUBMITTED', 'FORWARDED'].includes(event)) {
    const owner = stageOwner(mpr.status);
    const verb = { SUBMITTED: 'submitted', RESUBMITTED: 'corrected and resubmitted', FORWARDED: 'forwarded' }[event];
    return safeNotify(await stageRecipients(mpr), {
      ...common,
      title: `${mpr.mprNo} awaits ${owner} action`,
      message: `${mpr.departmentName} progress report for ${period} (${mpr.projectCode}, ${mpr.district}) was ${verb} by ${common.actorName} (${common.actorRole}). Status: ${statusLabel(mpr.status)}.`,
      emailDescription: `A monthly progress report is waiting for your action as ${owner}. Please open it, check the physical and financial progress and the evidence, then forward it or return it to its Maker with remarks.`,
      subject: `Action Required: SARRA MPR Pending ${owner}`,
      priority: 'HIGH',
      primaryLabel: 'Review MPR',
    });
  }

  const maker = await User.findById(mpr.submittedBy);
  if (event === 'RETURNED') {
    return safeNotify(maker, {
      ...common,
      title: `${mpr.mprNo} returned for correction`,
      message: `Your ${period} progress report for ${mpr.departmentName} was returned by ${common.actorName} (${mpr.returnedByRole || common.actorRole}): ${mpr.returnReason || 'please review the remarks'}.`,
      emailDescription: 'Your monthly progress report has been returned for correction. Please open the report, read the remarks, correct it and resubmit it through the approval chain.',
      subject: `MPR Returned for Correction: ${mpr.mprNo}`,
      priority: 'HIGH',
      primaryLabel: 'Correct MPR',
    });
  }
  if (event === 'REJECTED') {
    return safeNotify(maker, {
      ...common,
      title: `${mpr.mprNo} rejected`,
      message: `Your ${period} progress report for ${mpr.departmentName} was rejected by ${common.actorName} (${mpr.rejectedByRole || common.actorRole}): ${mpr.rejectionReason || ''}. The month can be reported again.`,
      emailDescription: 'Your monthly progress report has been rejected with a recorded reason. A fresh report can be filed for the same month.',
      subject: `MPR Rejected: ${mpr.mprNo}`,
      priority: 'HIGH',
      primaryLabel: 'Open MPR',
    });
  }
  if (event === 'VERIFIED') {
    return safeNotify(maker, {
      ...common,
      title: `${mpr.mprNo} verified by State`,
      message: `Your ${period} progress report for ${mpr.departmentName} received final approval from ${common.actorName}.`,
      emailDescription: 'Your monthly progress report has been verified at State level and is now part of the consolidated State dashboard.',
      subject: `MPR Verified by State: ${mpr.mprNo}`,
      priority: 'NORMAL',
      primaryLabel: 'Open MPR',
    });
  }
  return undefined;
};

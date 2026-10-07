import User from '../models/User.model.js';
import ProjectSanction from '../models/ProjectSanction.model.js';
import { createBusinessNotification } from './notification.service.js';
import { sendWorkflowEmail } from '../utils/email/workflowEmails.js';
import USER_ROLES from '../constants/roles.constants.js';

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

const compactRole = (user) => user?.workflowRole || user?.role || 'System';
const referenceForProject = (project) => project?.sanctionId || project?.projectId || project?.dprApplicationNo || 'Sanction ID pending';
const referenceForMpr = (mpr) => mpr?.applicationNo || 'MPR reference pending';

export const safeNotify = async (recipients, payload) => {
  const users = (Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean);
  const frontendUrl = getFrontendUrl();

  await Promise.all(users.map(async (recipient) => {
    const link = payload.link || dashboardPathForRole(recipient.role);

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

export const notifyProjectWorkflow = async ({ project, actor, event, note, recipientIds }) => {
  if (!project) return;
  const eventDate = new Date();
  const projectId = project._id;
  const referenceNo = referenceForProject(project);
  const actorName = actor?.name || 'SARRA CRM';
  const actorRole = compactRole(actor);
  const projectTitle = project.projectTitle || referenceNo;

  if (event === 'PROJECT_SUBMITTED') {
    const checkers = await User.find({
      ...activeUserQuery,
      role: USER_ROLES.SUPER_ADMIN,
      workflowRole: 'CHECKER'
    });
    return safeNotify(checkers, {
      title: `${referenceNo} requires checker review`,
      message: `${projectTitle} has been submitted by ${actorName} and is awaiting checker verification.`,
      emailDescription: 'A new project has been submitted by the Maker and is now awaiting your review. Please open the project to review the submitted information and complete your assigned action.',
      subject: 'Action Required: New SARRA Project Awaiting Your Review',
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: project.status,
      eventDate,
      relatedResource: 'ProjectSanction',
      relatedId: projectId,
      priority: 'HIGH',
      primaryLabel: 'Review Project',
      link: `/dashboard/admin/projects/${projectId}`
    });
  }

  if (event === 'PROJECT_CHECKED') {
    const approvers = await User.find({
      ...activeUserQuery,
      role: USER_ROLES.SUPER_ADMIN,
      workflowRole: 'APPROVER'
    });
    return safeNotify(approvers, {
      title: `${referenceNo} is ready for approval`,
      message: `${projectTitle} has been checked by ${actorName} and is waiting for approver action.`,
      emailDescription: 'The project has been checked and forwarded to you for approval. Please review the project details and complete the approval action.',
      subject: 'Approval Required: SARRA Project Ready for Approval',
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: project.status,
      eventDate,
      relatedResource: 'ProjectSanction',
      relatedId: projectId,
      priority: 'HIGH',
      primaryLabel: 'Review Project',
      link: `/dashboard/admin/projects/${projectId}`
    });
  }

  if (event === 'PROJECT_APPROVED' || event === 'PROJECT_REJECTED') {
    const maker = await User.findById(project.makerUserId);
    const rejected = event === 'PROJECT_REJECTED';
    return safeNotify(maker, {
      title: rejected ? `${referenceNo} was returned for correction` : `Project approved: ${referenceNo}`,
      message: rejected
        ? `${projectTitle} was returned by ${actorName}. ${note || project.rejectionReason || 'Please review the remarks and take corrective action.'}`
        : `${projectTitle} has been approved by ${actorName}. You can continue with the next required workflow step.`,
      emailDescription: rejected
        ? 'Your project has been returned for correction. Please open the project, review the remarks, and submit the required changes according to the workflow.'
        : 'Your project has been approved by the Approver. You can open the project to review its current status and continue with the next required step.',
      subject: rejected ? `Project Returned: ${referenceNo}` : `Project Approved: ${referenceNo}`,
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: project.status,
      eventDate,
      relatedResource: 'ProjectSanction',
      relatedId: projectId,
      priority: rejected ? 'HIGH' : 'NORMAL',
      primaryLabel: 'Open Project',
      link: `/dashboard/admin/projects/${projectId}`
    });
  }

  if (event === 'PROJECT_FORWARDED_DISTRICT') {
    const districtUsers = await User.find({
      ...activeUserQuery,
      role: USER_ROLES.DD_LEVEL,
      district: project.district
    });
    return safeNotify(districtUsers, {
      title: `${referenceNo} assigned to ${project.district} district`,
      message: `${projectTitle} has been forwarded to your district for acceptance and PIA assignment.`,
      emailDescription: 'A sanctioned project has been forwarded to your district. Please review the project, confirm district acceptance, and continue the assignment workflow.',
      subject: 'Action Required: SARRA Project Forwarded to Your District',
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: project.status,
      eventDate,
      relatedResource: 'ProjectSanction',
      relatedId: projectId,
      priority: 'HIGH',
      primaryLabel: 'Review Project',
      link: `/dashboard/dd/projects/${projectId}`
    });
  }

  if (event === 'PROJECT_FORWARDED_PIA') {
    // Department-wise projects name the officers just assigned; older projects have a single PIA.
    const pia = Array.isArray(recipientIds) && recipientIds.length
      ? await User.find({ ...activeUserQuery, _id: { $in: recipientIds } })
      : await User.findById(project.forwardedToPIA);
    return safeNotify(pia, {
      title: `${referenceNo} assigned for PIA acceptance`,
      message: `${projectTitle} has been assigned to you. Please accept the project to activate MPR submission.`,
      emailDescription: 'A project has been assigned to you by the district office. Please open the project and accept it to activate monthly progress reporting.',
      subject: 'Action Required: New SARRA Project Assigned to You',
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: project.status,
      eventDate,
      relatedResource: 'ProjectSanction',
      relatedId: projectId,
      priority: 'HIGH',
      primaryLabel: 'Accept Project',
      link: `/dashboard/officer/projects/${projectId}`
    });
  }

  if (event === 'PROJECT_DISTRICT_ACCEPTED') {
    const makers = await User.find({
      ...activeUserQuery,
      _id: project.makerUserId
    });
    return safeNotify(makers, {
      title: `${referenceNo} accepted by district`,
      message: `${projectTitle} was accepted by ${actorName}. Please forward it to the assigned PIA when ready.`,
      emailDescription: 'The district has accepted your project. Please open the project and complete the next workflow action by forwarding it to the appropriate PIA.',
      subject: `District Accepted Project: ${referenceNo}`,
      referenceNo,
      projectTitle,
      actorName,
      actorRole,
      status: project.status,
      eventDate,
      relatedResource: 'ProjectSanction',
      relatedId: projectId,
      priority: 'NORMAL',
      primaryLabel: 'Open Project',
      link: `/dashboard/admin/projects/${projectId}`
    });
  }
};

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

/**
 * Notifications for project Monthly Progress Reports (ProjectMPR).
 * SUBMITTED / RESUBMITTED go to the District Directors of the project's
 * district; APPROVED / RETURNED go back to the PIA officer who filed it.
 */
export const notifyProjectMpr = async ({ mpr, actor, event }) => {
  if (!mpr) return;
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
  };

  if (event === 'SUBMITTED' || event === 'RESUBMITTED') {
    const directors = await User.find({ ...activeUserQuery, role: USER_ROLES.DD_LEVEL, district: mpr.district });
    return safeNotify(directors, {
      ...common,
      title: `${mpr.mprNo} ${event === 'RESUBMITTED' ? 'resubmitted' : 'submitted'} for review`,
      message: `${mpr.departmentName} progress report for ${period} (${mpr.projectCode}) was ${event === 'RESUBMITTED' ? 'corrected and resubmitted' : 'submitted'} by ${common.actorName}.`,
      emailDescription: 'A monthly progress report has been submitted and is awaiting your review. Please open the report, review the progress, and approve it or return it for correction.',
      subject: 'Action Required: SARRA MPR Awaiting Review',
      priority: 'HIGH',
      primaryLabel: 'Review MPR',
      link: `/dashboard/dd/mpr-review/project/${mpr._id}`,
    });
  }

  if (event === 'VERIFIED') {
    const submitter = await User.findById(mpr.submittedBy);
    return safeNotify(submitter, {
      ...common,
      title: `${mpr.mprNo} verified by State`,
      message: `Your ${period} progress report for ${mpr.departmentName} was verified by ${common.actorName}.`,
      emailDescription: 'Your monthly progress report has been verified at State level.',
      subject: `MPR Verified by State: ${mpr.mprNo}`,
      priority: 'NORMAL',
      primaryLabel: 'Open MPR',
      link: `/dashboard/officer/mprs/report/${mpr._id}`,
    });
  }

  if (event === 'APPROVED') {
    // District approval also puts the report in the M&E admin's queue for State verification.
    const admins = await User.find({ ...activeUserQuery, role: USER_ROLES.MND_SUPER_ADMIN });
    await safeNotify(admins, {
      ...common,
      title: `${mpr.mprNo} ready for State verification`,
      message: `${mpr.departmentName} progress report for ${period} (${mpr.projectCode}) was approved by ${mpr.district} district.`,
      emailDescription: 'A monthly progress report has been approved at district level and is ready for State verification.',
      subject: 'MPR Ready for State Verification',
      priority: 'NORMAL',
      primaryLabel: 'Verify MPR',
      link: `/dashboard/mnd-admin/mpr/project/${mpr._id}`,
    });
  }

  if (event === 'APPROVED' || event === 'RETURNED') {
    const returned = event === 'RETURNED';
    const submitter = await User.findById(mpr.submittedBy);
    return safeNotify(submitter, {
      ...common,
      title: returned ? `${mpr.mprNo} returned for correction` : `${mpr.mprNo} approved by district`,
      message: returned
        ? `Your ${period} progress report for ${mpr.departmentName} was returned by ${common.actorName}: ${mpr.returnReason || 'please review the remarks'}.`
        : `Your ${period} progress report for ${mpr.departmentName} was approved by ${common.actorName}.`,
      emailDescription: returned
        ? 'Your monthly progress report has been returned for correction. Please open the report, read the remarks, correct the figures and resubmit.'
        : 'Your monthly progress report has been approved at district level.',
      subject: returned ? `MPR Returned for Correction: ${mpr.mprNo}` : `MPR Approved: ${mpr.mprNo}`,
      priority: returned ? 'HIGH' : 'NORMAL',
      primaryLabel: 'Open MPR',
      link: `/dashboard/officer/mprs/report/${mpr._id}`,
    });
  }
  return undefined;
};

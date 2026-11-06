import User from '../models/User.model.js';
import USER_ROLES, { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { H56_LEVELS } from '../models/Head56Item.model.js';
import { MPR_STATUS_LABELS } from '../models/ProjectMPR.model.js';
import { actorLabel, tierRoleQuery } from '../utils/access.js';
import { stageOwner } from './mprWorkflow.js';
import { safeNotify, stageRecipients } from './workflowNotification.service.js';
import logger from '../config/logger.js';

/**
 * Notifications of the Head 56 module (in-app and e-mail). Every step reaches
 * the officers who hold the next one; the Maker hears about returns, rejections,
 * reopening and final verification.
 */

const { MAKER, CHECKER, APPROVER } = WORKFLOW_ROLES;

/** Head 56 hub of each role. */
export const head56Base = (role) => ({
  [USER_ROLES.PIA_OFFICER]: '/dashboard/officer/head56',
  [USER_ROLES.DD_LEVEL]: '/dashboard/dd/head56',
  [USER_ROLES.MND_OFFICER]: '/dashboard/mnd/head56',
  [USER_ROLES.MND_SUPER_ADMIN]: '/dashboard/mnd-admin/head56',
}[role] || '/dashboard/admin/head56');

const quietly = async (work) => {
  try { await work(); } catch (err) { logger.error(`Head 56 notification failed: ${err.message}`); }
};

const usersOf = (tier, role, scope) => User.find(tierRoleQuery(tier, role, scope));

/** Makers of a unit: the HQ Makers, the District Makers of a district, or the PIA Makers of a department in a district. */
const unitMakers = (unit) => {
  if (unit.level === H56_LEVELS.HQ) return usersOf(TIERS.HQ, MAKER);
  if (unit.level === H56_LEVELS.DISTRICT) return usersOf(TIERS.DISTRICT, MAKER, { district: unit.district });
  return usersOf(TIERS.PIA, MAKER, { district: unit.district, department: unit.departmentName });
};

export const notifyHead56Report = ({ mpr, actor, event }) => quietly(async () => {
  if (!mpr) return;
  const common = {
    referenceNo: mpr.mprNo,
    projectTitle: `Head 56 – ${mpr.unitName}`,
    actorName: actor?.name || 'SARRA CRM',
    actorRole: actor ? actorLabel(actor) : 'System',
    status: mpr.status,
    eventDate: new Date(),
    relatedResource: 'Head56Mpr',
    relatedId: mpr._id,
    linkFor: (recipient) => `${head56Base(recipient.role)}/report/${mpr._id}`,
  };
  const period = `${mpr.reportingMonth} ${mpr.financialYear}`;
  if (['SUBMITTED', 'RESUBMITTED', 'FORWARDED'].includes(event)) {
    const owner = mpr.status === 'SUBMITTED_TO_DISTRICT' ? 'District Technical Staff' : stageOwner(mpr.status);
    const verb = { SUBMITTED: 'submitted', RESUBMITTED: 'corrected and resubmitted', FORWARDED: 'forwarded' }[event];
    await safeNotify(await stageRecipients(mpr), {
      ...common,
      title: `Head 56 report ${mpr.mprNo} awaits ${owner}`,
      message: `${mpr.unitName}: Head 56 progress report for ${period} was ${verb} by ${common.actorName} (${common.actorRole}). Status: ${MPR_STATUS_LABELS[mpr.status]}.`,
      emailDescription: `A Head 56 (Non-Salary Grant) monthly report is waiting for your action as ${owner}. Check the expenditure against the allocation, the physical progress and the supporting documents, then forward it or return it to its Maker with remarks.`,
      subject: `Action Required: Head 56 MPR Pending ${owner}`,
      priority: 'HIGH',
      primaryLabel: 'Review Report',
    });
    return;
  }
  const maker = await User.findById(mpr.submittedBy);
  const text = {
    RETURNED: [`Head 56 report ${mpr.mprNo} returned for correction`, `Your ${period} Head 56 report of ${mpr.unitName} was returned by ${common.actorName} (${mpr.returnedByRole || common.actorRole}): ${mpr.returnReason || ''}`, 'Correct Report'],
    REOPENED: [`Head 56 report ${mpr.mprNo} reopened by HQ`, `Your verified ${period} Head 56 report of ${mpr.unitName} was reopened by ${common.actorName} for correction: ${mpr.returnReason || ''}`, 'Correct Report'],
    REJECTED: [`Head 56 report ${mpr.mprNo} rejected`, `Your ${period} Head 56 report of ${mpr.unitName} was rejected by ${common.actorName} (${mpr.rejectedByRole || common.actorRole}): ${mpr.rejectionReason || ''}. The month can be reported again.`, 'Open Report'],
    VERIFIED: [`Head 56 report ${mpr.mprNo} verified by State`, `Your ${period} Head 56 report of ${mpr.unitName} received final approval from ${common.actorName}. It is now locked.`, 'Open Report'],
  }[event];
  if (!text || !maker) return;
  await safeNotify(maker, { ...common, title: text[0], message: text[1], subject: text[0], priority: event === 'VERIFIED' ? 'NORMAL' : 'HIGH', primaryLabel: text[2] });
});

export const notifyHead56Allocation = ({ allocation, actor, event }) => quietly(async () => {
  if (!allocation) return;
  const common = {
    referenceNo: `${allocation.unitName} – FY ${allocation.financialYear}`,
    projectTitle: 'Head 56 allocation',
    actorName: actor?.name || 'SARRA CRM',
    actorRole: actor ? actorLabel(actor) : 'System',
    status: allocation.status,
    eventDate: new Date(),
    relatedResource: 'Head56Allocation',
    relatedId: allocation._id,
    linkFor: (recipient) => (recipient.role === USER_ROLES.SUPER_ADMIN ? `/dashboard/admin/head56/allocation/${allocation._id}` : `${head56Base(recipient.role)}?tab=allocation`),
  };
  const unitLine = `${allocation.unitName}, FY ${allocation.financialYear}`;
  if (event === 'SUBMITTED') {
    await safeNotify(await usersOf(TIERS.HQ, CHECKER), { ...common, title: `Head 56 allocation awaits HQ Checker: ${unitLine}`, message: `${common.actorName} submitted the Head 56 allocation of ${unitLine} for verification.`, subject: 'Action Required: Head 56 Allocation Pending HQ Checker', priority: 'HIGH', primaryLabel: 'Verify Allocation' });
  } else if (event === 'VERIFIED') {
    await safeNotify(await usersOf(TIERS.HQ, APPROVER), { ...common, title: `Head 56 allocation awaits HQ Approver: ${unitLine}`, message: `${common.actorName} verified the Head 56 allocation of ${unitLine}. Approve and publish it.`, subject: 'Action Required: Head 56 Allocation Pending HQ Approver', priority: 'HIGH', primaryLabel: 'Approve Allocation' });
  } else if (event === 'RETURNED') {
    const maker = allocation.makerUserId ? await User.findById(allocation.makerUserId) : null;
    await safeNotify(maker || await usersOf(TIERS.HQ, MAKER), { ...common, title: `Head 56 allocation returned: ${unitLine}`, message: `${common.actorName} returned the allocation of ${unitLine}: ${allocation.returnReason || ''}`, subject: 'Head 56 Allocation Returned to HQ Maker', priority: 'HIGH', primaryLabel: 'Open Allocation' });
  } else if (event === 'PUBLISHED') {
    const recipients = [...await unitMakers(allocation), ...(allocation.makerUserId ? [await User.findById(allocation.makerUserId)] : [])].filter(Boolean);
    const unique = [...new Map(recipients.map((user) => [String(user._id), user])).values()];
    await safeNotify(unique, { ...common, title: `Head 56 allocation published: ${unitLine}`, message: `The Head 56 allocation of ${unitLine} (version ${allocation.published?.version}) has been approved and published by ${common.actorName}. Monthly reports are checked against it.`, subject: 'Head 56 Allocation Published', priority: 'NORMAL', primaryLabel: 'Open Head 56' });
  }
});

export const notifyHead56Review = ({ review, actor }) => quietly(async () => {
  const recipients = [...await usersOf(TIERS.HQ, MAKER), ...await usersOf(TIERS.HQ, CHECKER), ...await User.find({ role: USER_ROLES.MND_SUPER_ADMIN, isActive: true })];
  await safeNotify(recipients, {
    referenceNo: `${review.reportingMonth} ${review.financialYear}`,
    projectTitle: 'Head 56 monthly review',
    actorName: actor?.name || 'SARRA CRM',
    actorRole: actor ? actorLabel(actor) : 'System',
    status: 'REVIEWED',
    eventDate: new Date(),
    relatedResource: 'Head56Review',
    relatedId: review._id,
    title: `Head 56 ${review.reportingMonth} ${review.financialYear} reviewed (${review.designation})`,
    message: `The consolidated Head 56 report of ${review.reportingMonth} ${review.financialYear} was reviewed for the ${review.designation}: ${review.remarks}`,
    subject: `Head 56 Monthly Review Recorded: ${review.reportingMonth} ${review.financialYear}`,
    priority: 'NORMAL',
    primaryLabel: 'Open Head 56',
    linkFor: (recipient) => head56Base(recipient.role),
  });
});

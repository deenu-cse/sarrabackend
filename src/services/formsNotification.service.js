import User from '../models/User.model.js';
import USER_ROLES, { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { COMMITTEE_TYPES, MEETING_STATUS_LABELS } from '../models/CommitteeMeeting.model.js';
import { actorLabel, tierRoleQuery } from '../utils/access.js';
import { safeNotify } from './workflowNotification.service.js';
import logger from '../config/logger.js';

/**
 * Notifications of committee meetings (HPC, SLEC, DLEC): a submission reaches
 * the HQ Approvers; approval or return reaches the Maker who entered it.
 */

/** Committees hub of each role. */
export const committeesBase = (role) => ({
  [USER_ROLES.DD_LEVEL]: '/dashboard/dd/committees',
  [USER_ROLES.MND_OFFICER]: '/dashboard/mnd/committees',
  [USER_ROLES.MND_SUPER_ADMIN]: '/dashboard/mnd-admin/committees',
}[role] || '/dashboard/admin/committees');

export const notifyMeeting = async ({ meeting, actor, event }) => {
  try {
    if (!meeting) return;
    const committee = COMMITTEE_TYPES[meeting.type];
    const title = `${committee.code} meeting no. ${meeting.meetingNo}${meeting.district ? ` (${meeting.district})` : ''}`;
    const common = {
      referenceNo: meeting.refNo,
      projectTitle: `${committee.code} – ${committee.name}`,
      actorName: actor?.name || 'SARRA CRM',
      actorRole: actor ? actorLabel(actor) : 'System',
      status: meeting.status,
      eventDate: new Date(),
      relatedResource: 'CommitteeMeeting',
      relatedId: meeting._id,
      linkFor: (recipient) => `${committeesBase(recipient.role)}/meeting/${meeting._id}`,
    };
    if (event === 'SUBMITTED' || event === 'RESUBMITTED') {
      const approvers = (await User.find(tierRoleQuery(TIERS.HQ, WORKFLOW_ROLES.APPROVER))).filter((u) => String(u._id) !== String(meeting.createdBy));
      await safeNotify(approvers, {
        ...common,
        title: `${title} awaits HQ Approver`,
        message: `${common.actorName} (${common.actorRole}) ${event === 'RESUBMITTED' ? 'corrected and resubmitted' : 'submitted'} the details of ${title}, held on ${new Date(meeting.meetingDate).toLocaleDateString('en-GB', { timeZone: 'UTC' })} at ${meeting.place}.`,
        emailDescription: `The details of a ${committee.name} meeting are waiting for your approval. Check the date, place, participants, minutes and photographs, then approve them or return them to the Maker with remarks.`,
        subject: `Action Required: ${committee.code} Meeting Pending HQ Approver`,
        priority: 'HIGH',
        primaryLabel: 'Review Meeting',
      });
      return;
    }
    const maker = await User.findById(meeting.submittedBy || meeting.createdBy);
    if (!maker) return;
    const text = event === 'APPROVED'
      ? [`${title} approved by HQ`, `The details of ${title} were approved by ${common.actorName}.${meeting.approvalNote ? ` Note: ${meeting.approvalNote}` : ''} The PDF can now be downloaded.`, 'NORMAL']
      : [`${title} returned for correction`, `${common.actorName} returned the details of ${title}: ${meeting.returnReason || ''}`, 'HIGH'];
    await safeNotify(maker, { ...common, title: text[0], message: text[1], subject: text[0], priority: text[2], primaryLabel: 'Open Meeting', status: MEETING_STATUS_LABELS[meeting.status] ? meeting.status : common.status });
  } catch (err) {
    logger.error(`Meeting notification failed: ${err.message}`);
  }
};

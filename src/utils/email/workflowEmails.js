import { sendEmail } from './sendEmail.js';

const STATUS_THEME = {
  PENDING_CHECKER: ['#fff7ed', '#fed7aa', '#c2410c'],
  PENDING_APPROVER: ['#fff7ed', '#fed7aa', '#c2410c'],
  SANCTIONED: ['#ecfdf5', '#a7f3d0', '#047857'],
  APPROVED: ['#ecfdf5', '#a7f3d0', '#047857'],
  DISTRICT_APPROVED: ['#f0fdfa', '#99f6e4', '#0f766e'],
  FORWARDED_TO_DISTRICT: ['#eff6ff', '#bfdbfe', '#1d4ed8'],
  FORWARDED_TO_PIA: ['#eef2ff', '#c7d2fe', '#4338ca'],
  PIA_ACCEPTED: ['#ecfdf5', '#a7f3d0', '#047857'],
  SUBMITTED: ['#eff6ff', '#bfdbfe', '#1d4ed8'],
  RETURNED_TO_PIA: ['#fff7ed', '#fed7aa', '#c2410c'],
  REJECTED: ['#fef2f2', '#fecaca', '#b91c1c']
};

const formatStatus = (status) => (status || 'Pending').replace(/_/g, ' ');

const formatDateTime = (value) => {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const sendWorkflowEmail = async ({
  to,
  subject,
  headline,
  description,
  referenceNo,
  projectTitle,
  actorName,
  actorRole,
  status,
  eventDate,
  primaryUrl,
  primaryLabel = 'Review Project',
  dashboardUrl
}) => {
  if (!to) return { success: false, skipped: true, error: 'No recipient email' };

  const [statusBg, statusBorder, statusColor] =
    STATUS_THEME[status] || ['#f1f5f9', '#cbd5e1', '#475569'];

  return sendEmail({
    to,
    subject,
    template: 'workflowNotification.html',
    data: {
      subject,
      headline,
      description,
      referenceNo: referenceNo || 'Reference pending',
      projectTitle: projectTitle || 'SARRA workflow item',
      actorName: actorName || 'SARRA CRM',
      actorRole: actorRole || 'System',
      eventDate: formatDateTime(eventDate),
      statusLabel: formatStatus(status),
      statusBg,
      statusBorder,
      statusColor,
      primaryUrl,
      primaryLabel,
      dashboardUrl,
      year: new Date().getFullYear()
    }
  });
};

export default sendWorkflowEmail;

import { sendEmail } from '../email/sendEmail.js';

const getFrontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.CRM_URL || 'http://localhost:3000').replace(/\/$/, '');

const formatDateTime = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'full',
    timeStyle: 'short'
  });
};

const durationLabel = (until) => {
  const end = new Date(until);
  const ms = end - Date.now();
  if (ms <= 0) return 'Until further notice';
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);
  if (months >= 1) {
    return `Approximately ${months} month${months === 1 ? '' : 's'} (${days} days)`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
};

const logStatusEmail = (type, email, extra = {}) => {
  console.log(`\n********** ACCOUNT ${type} EMAIL **********`);
  console.log(`To:     ${email}`);
  Object.entries(extra).forEach(([k, v]) => console.log(`${k}:`.padEnd(8), v));
  console.log('******************************************\n');
};

/**
 * Notify user that their account was suspended.
 */
export const sendAccountSuspendedEmail = async ({ user, admin, until, reason }) => {
  const suspendedUntil = formatDateTime(until);
  const reasonText = reason?.trim() || 'No reason was provided by the administrator.';

  logStatusEmail('SUSPENDED', user.email, {
    Until: suspendedUntil,
    Reason: reasonText,
    Admin: admin?.name || 'Super Admin'
  });

  return sendEmail({
    to: user.email,
    subject: 'SARRA CRM — Your account has been suspended',
    template: 'accountSuspended.html',
    data: {
      name: user.name || 'User',
      adminName: admin?.name || 'SARRA Super Admin',
      suspendedUntil,
      durationLabel: durationLabel(until),
      reason: reasonText,
      year: new Date().getFullYear()
    }
  });
};

/**
 * Notify user that their account was deactivated.
 */
export const sendAccountDeactivatedEmail = async ({ user, admin, reason, deactivatedAt }) => {
  const reasonText = reason?.trim() || 'No reason was provided by the administrator.';

  logStatusEmail('DEACTIVATED', user.email, {
    When: formatDateTime(deactivatedAt || new Date()),
    Reason: reasonText,
    Admin: admin?.name || 'Super Admin'
  });

  return sendEmail({
    to: user.email,
    subject: 'SARRA CRM — Your account has been deactivated',
    template: 'accountDeactivated.html',
    data: {
      name: user.name || 'User',
      adminName: admin?.name || 'SARRA Super Admin',
      deactivatedAt: formatDateTime(deactivatedAt || new Date()),
      reason: reasonText,
      year: new Date().getFullYear()
    }
  });
};

/**
 * Notify user that their account access was restored.
 */
export const sendAccountRestoredEmail = async ({ user, admin, previousStatus }) => {
  const loginLink = `${getFrontendUrl()}/login`;
  const prev =
    previousStatus === 'SUSPENDED'
      ? 'Suspended'
      : previousStatus === 'DEACTIVATED'
        ? 'Deactivated'
        : previousStatus || 'Restricted';

  logStatusEmail('RESTORED', user.email, {
    From: prev,
    Admin: admin?.name || 'Super Admin',
    Link: loginLink
  });

  return sendEmail({
    to: user.email,
    subject: 'SARRA CRM — Your account access has been restored',
    template: 'accountRestored.html',
    data: {
      name: user.name || 'User',
      adminName: admin?.name || 'SARRA Super Admin',
      previousStatus: prev,
      restoredAt: formatDateTime(new Date()),
      loginLink,
      year: new Date().getFullYear()
    }
  });
};

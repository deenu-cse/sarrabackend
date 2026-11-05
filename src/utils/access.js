import USER_ROLES, { WORKFLOW_ROLES, TIERS, TIER_OF_ROLE, TIER_LABELS } from '../constants/roles.constants.js';

/**
 * Who a user is in the three-tier Maker → Checker → Approver structure.
 * Every permission check of the workflow goes through these helpers, so the
 * rules live in one place.
 */

const WORKFLOW_LABELS = { MAKER: 'Maker', CHECKER: 'Checker', APPROVER: 'Approver' };

export const tierOf = (user) => TIER_OF_ROLE[user?.role] || null;

/**
 * Workflow role of a user. District and PIA accounts created before every tier
 * had its own Maker, Checker and Approver did all the work themselves, so an
 * account without a role acts as that tier's Maker.
 */
export const workflowRoleOf = (user) => {
  if (!user) return null;
  if (user.workflowRole) return user.workflowRole;
  return [USER_ROLES.DD_LEVEL, USER_ROLES.PIA_OFFICER].includes(user.role) ? WORKFLOW_ROLES.MAKER : null;
};

/** State administrator without a workflow role: manages users and settings, takes no workflow decision. */
export const isSystemAdmin = (user) => user?.role === USER_ROLES.SUPER_ADMIN && !user.workflowRole;

export const hasTierRole = (user, tier, ...roles) => tierOf(user) === tier && roles.includes(workflowRoleOf(user));

export const isHq = (user, ...roles) => hasTierRole(user, TIERS.HQ, ...roles);
export const isDistrict = (user, ...roles) => hasTierRole(user, TIERS.DISTRICT, ...roles);
export const isPia = (user, ...roles) => hasTierRole(user, TIERS.PIA, ...roles);

/** "District Checker", "HQ Approver", "PIA Maker" … */
export const roleLabel = (tier, workflowRole) => `${tier === TIERS.HQ ? 'HQ' : tier === TIERS.DISTRICT ? 'District' : 'PIA'} ${WORKFLOW_LABELS[workflowRole] || ''}`.trim();

export const actorLabel = (user) => {
  const tier = tierOf(user);
  if (!tier) return user?.role || 'System';
  if (isSystemAdmin(user)) return 'HQ Administrator';
  return roleLabel(tier, workflowRoleOf(user));
};

/** Designation recorded against an action: the officer's own, or their place in the workflow. */
export const designationOf = (user) => (user?.designation ? String(user.designation).trim() : '') || actorLabel(user);

export const tierLabel = (tier) => TIER_LABELS[tier] || tier;

export const sameId = (a, b) => String(a?._id || a || '') === String(b?._id || b || '');
export const sameText = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Accounts that can take part in the workflow. A requested account awaiting its tier Approver cannot.
export const ACTIVE_USER = { isActive: true, accountStatus: { $nin: ['DEACTIVATED', 'SUSPENDED'] }, 'approval.status': { $ne: 'PENDING' } };

const ROLE_OF_TIER = { [TIERS.HQ]: USER_ROLES.SUPER_ADMIN, [TIERS.DISTRICT]: USER_ROLES.DD_LEVEL, [TIERS.PIA]: USER_ROLES.PIA_OFFICER };

/**
 * Query for the active users who hold `workflowRole` in `tier`, optionally
 * limited to one district and one department (PIA users belong to both).
 */
export const tierRoleQuery = (tier, workflowRole, { district, department } = {}) => {
  const query = { ...ACTIVE_USER, role: ROLE_OF_TIER[tier] };
  // District and PIA accounts without a role act as Makers (see workflowRoleOf).
  query.workflowRole = workflowRole === WORKFLOW_ROLES.MAKER && tier !== TIERS.HQ ? { $in: [WORKFLOW_ROLES.MAKER, null] } : workflowRole;
  if (district) query.district = district;
  if (department) query.department = new RegExp(`^\\s*${escapeRegex(String(department).trim())}\\s*$`, 'i');
  return query;
};

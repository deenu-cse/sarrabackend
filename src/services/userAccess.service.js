import USER_ROLES, { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { isDistrict, isHq, isSystemAdmin, sameId } from '../utils/access.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * User management by administrative tier.
 *
 *   HQ administrator   creates any account directly and manages every account
 *   HQ Maker           requests accounts of any tier; the HQ Approver approves them
 *   District Maker     requests District and PIA accounts of its own district;
 *                      the District Approver of that district approves them
 *   HQ Approver /      suspend, deactivate and restore accounts in their scope
 *   District Approver
 *
 * Nobody approves an account they requested, or changes their own account.
 */

const { MAKER, APPROVER } = WORKFLOW_ROLES;
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);

/** How this user may create accounts: directly, by request, or not at all. */
export const requestScope = (actor) => {
  if (isSystemAdmin(actor)) return { direct: true, tier: TIERS.HQ, district: null };
  if (isHq(actor, MAKER)) return { direct: false, tier: TIERS.HQ, district: null };
  if (isDistrict(actor, MAKER) && actor.district) return { direct: false, tier: TIERS.DISTRICT, district: actor.district };
  return null;
};

/** Throws unless `actor` may create an account with these details. */
export const assertCanRequest = (actor, data) => {
  const scope = requestScope(actor);
  if (!scope) throw forbidden('Only the HQ administrator, the HQ Maker or a District Maker can add users.');
  if (scope.direct) return scope;
  if (data.role === USER_ROLES.SUPER_ADMIN && !data.workflowRole) throw forbidden('Only the HQ administrator can create another administrator account.');
  if (scope.tier === TIERS.DISTRICT) {
    if (![USER_ROLES.DD_LEVEL, USER_ROLES.PIA_OFFICER].includes(data.role)) throw forbidden('A District Maker can request District and PIA accounts only.');
    if (data.district !== scope.district) throw forbidden(`A District Maker can request accounts for ${scope.district} district only.`);
  }
  return scope;
};

/** May `actor` approve or reject the pending account request `target`? */
export const canDecide = (actor, target) => {
  if (target.approval?.status !== 'PENDING' || sameId(target.approval.requestedBy, actor._id)) return false;
  if (isSystemAdmin(actor)) return true;
  if (target.approval.tier === TIERS.HQ) return isHq(actor, APPROVER);
  if (target.approval.tier === TIERS.DISTRICT) return isDistrict(actor, APPROVER) && actor.district === target.district;
  return false;
};

/** May `actor` suspend, deactivate or restore `target`? */
export const canManageStatus = (actor, target) => {
  if (sameId(actor._id, target._id)) return false;
  if (isSystemAdmin(actor)) return true;
  if (target.role === USER_ROLES.SUPER_ADMIN && !target.workflowRole) return false;
  if (isHq(actor, APPROVER)) return true;
  if (isDistrict(actor, APPROVER)) return [USER_ROLES.DD_LEVEL, USER_ROLES.PIA_OFFICER].includes(target.role) && target.district === actor.district;
  return false;
};

/** Which accounts `actor` may list (null = none). */
export const listScope = (actor) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN].includes(actor.role)) return {};
  if (actor.role === USER_ROLES.DD_LEVEL && actor.district) return { district: actor.district, role: { $in: [USER_ROLES.DD_LEVEL, USER_ROLES.PIA_OFFICER] } };
  return null;
};

/** What the signed-in user may do on the user-management screens. */
export const permissionsOf = (actor) => {
  const scope = requestScope(actor);
  return {
    canCreate: Boolean(scope),
    createsDirectly: Boolean(scope?.direct),
    requestDistrict: scope?.district || null,
    canApprove: isSystemAdmin(actor) || isHq(actor, APPROVER) || isDistrict(actor, APPROVER),
    canManageStatus: isSystemAdmin(actor) || isHq(actor, APPROVER) || isDistrict(actor, APPROVER),
  };
};

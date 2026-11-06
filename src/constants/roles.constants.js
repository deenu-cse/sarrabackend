const USER_ROLES = {
  PIA_OFFICER: 'PIA_OFFICER',
  DD_LEVEL: 'DD_LEVEL',
  SUPER_ADMIN: 'SUPER_ADMIN',
  MND_OFFICER: 'MND_OFFICER',
  MND_SUPER_ADMIN: 'MND_SUPER_ADMIN'
};

const WORKFLOW_ROLES = {
  MAKER: 'MAKER',
  CHECKER: 'CHECKER',
  APPROVER: 'APPROVER'
};

/**
 * The three administrative tiers of the MIS/MPR portal. Every tier has its own
 * Maker, Checker and Approver; the account role says which tier a user is in.
 */
const TIERS = {
  HQ: 'HQ',
  DISTRICT: 'DISTRICT',
  PIA: 'PIA'
};

const TIER_OF_ROLE = {
  [USER_ROLES.SUPER_ADMIN]: TIERS.HQ,
  [USER_ROLES.DD_LEVEL]: TIERS.DISTRICT,
  [USER_ROLES.PIA_OFFICER]: TIERS.PIA
};

const TIER_LABELS = {
  [TIERS.HQ]: 'SARRA HQ',
  [TIERS.DISTRICT]: 'District SARRA Centre',
  [TIERS.PIA]: 'PIA'
};

export { WORKFLOW_ROLES, TIERS, TIER_OF_ROLE, TIER_LABELS };
export default USER_ROLES;

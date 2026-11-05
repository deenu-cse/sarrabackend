import { PROJECT_MPR_STATUS as S, MPR_ENTRY_MODE, MPR_STATUS_LABELS } from '../models/ProjectMPR.model.js';
import { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { hasTierRole, roleLabel, sameId, sameText, escapeRegex, tierOf, workflowRoleOf } from '../utils/access.js';

/**
 * The MPR workflow engine: which stage a report is at, who may act on it, and
 * where it goes next. Everything that moves, lists or notifies a report reads
 * this table, so the chain is defined once.
 */

const { MAKER, CHECKER, APPROVER } = WORKFLOW_ROLES;

// Review stages in chain order. `step` is where the actor is recorded on the report.
export const REVIEW_STAGES = {
  [S.PENDING_PIA_CHECKER]: {
    tier: TIERS.PIA, role: CHECKER, next: S.PENDING_PIA_APPROVER, step: 'piaChecker', level: 'PIA',
    verb: 'Verify & Send to PIA Approver', done: 'Verified by PIA Checker', canReject: false,
  },
  [S.PENDING_PIA_APPROVER]: {
    tier: TIERS.PIA, role: APPROVER, next: S.SUBMITTED_TO_DISTRICT, step: 'piaApprover', level: 'PIA',
    verb: 'Approve & Submit to District', done: 'Approved by PIA Approver and submitted to District', canReject: true,
  },
  [S.SUBMITTED_TO_DISTRICT]: {
    tier: TIERS.DISTRICT, role: MAKER, next: S.PENDING_DISTRICT_CHECKER, step: 'districtMaker', level: 'DISTRICT',
    verb: 'Receive & Send to District Checker', done: 'Received and reviewed by District Maker', canReject: false,
  },
  [S.PENDING_DISTRICT_CHECKER]: {
    tier: TIERS.DISTRICT, role: CHECKER, next: S.PENDING_DISTRICT_APPROVER, step: 'districtChecker', level: 'DISTRICT',
    verb: 'Verify & Send to District Approver', done: 'Physical and financial progress verified by District Checker', canReject: false,
  },
  [S.PENDING_DISTRICT_APPROVER]: {
    tier: TIERS.DISTRICT, role: APPROVER, next: S.SUBMITTED_TO_HQ, step: 'districtApprover', level: 'DISTRICT',
    verb: 'Approve & Forward to HQ', done: 'Approved by District Approver and forwarded to HQ', canReject: true,
  },
  [S.SUBMITTED_TO_HQ]: {
    tier: TIERS.HQ, role: MAKER, next: S.PENDING_HQ_CHECKER, step: 'hqMaker', level: 'STATE',
    verb: 'Compile & Send to HQ Checker', done: 'Received and compiled by HQ Maker', canReject: false,
  },
  [S.PENDING_HQ_CHECKER]: {
    tier: TIERS.HQ, role: CHECKER, next: S.PENDING_HQ_APPROVER, step: 'hqChecker', level: 'STATE',
    verb: 'Verify & Send to HQ Approver', done: 'State-level reporting and data consistency verified by HQ Checker', canReject: false,
  },
  [S.PENDING_HQ_APPROVER]: {
    tier: TIERS.HQ, role: APPROVER, next: S.VERIFIED_BY_STATE, step: 'hqApprover', level: 'STATE',
    verb: 'Final Approval', done: 'Final approval by HQ Approver: verified by State', canReject: true,
  },
};

export const IN_REVIEW = Object.keys(REVIEW_STAGES);
export const AT_PIA = [S.PENDING_PIA_CHECKER, S.PENDING_PIA_APPROVER];
export const AT_DISTRICT = [S.SUBMITTED_TO_DISTRICT, S.PENDING_DISTRICT_CHECKER, S.PENDING_DISTRICT_APPROVER];
export const AT_HQ = [S.SUBMITTED_TO_HQ, S.PENDING_HQ_CHECKER, S.PENDING_HQ_APPROVER];
/** Still with the reporting Maker. */
export const WITH_MAKER = [S.DRAFT, S.RETURNED_FOR_CORRECTION];
/** Not final: can still change. */
export const OPEN = [...WITH_MAKER, ...IN_REVIEW];
/** Approved by the district (on its way to, or verified by, the State). */
export const DISTRICT_APPROVED = [...AT_HQ, S.VERIFIED_BY_STATE];
/** Counted as filed for the month (a draft is not filed; a rejected report is void). */
export const FILED = [...IN_REVIEW, S.RETURNED_FOR_CORRECTION, S.VERIFIED_BY_STATE];

/** Named groups a list can be filtered by, besides single statuses. */
export const STATUS_GROUPS = {
  IN_REVIEW,
  AT_PIA,
  AT_DISTRICT,
  AT_HQ,
  WITH_MAKER,
  OPEN,
  DISTRICT_APPROVED,
};

/** Mongo filter for a `status` query value: a status, a group, or a comma-separated list of either. */
export const statusQuery = (value) => {
  const parts = String(value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const statuses = [...new Set(parts.flatMap((part) => STATUS_GROUPS[part] || (Object.values(S).includes(part) ? [part] : [])))];
  if (!statuses.length) return {};
  return { status: statuses.length === 1 ? statuses[0] : { $in: statuses } };
};

/** First review stage after the Maker submits. District-entered reports skip the PIA stages. */
export const firstStageOf = (entryMode) => (entryMode === MPR_ENTRY_MODE.DISTRICT ? S.PENDING_DISTRICT_CHECKER : S.PENDING_PIA_CHECKER);

export const stageOwner = (status) => {
  const stage = REVIEW_STAGES[status];
  return stage ? roleLabel(stage.tier, stage.role) : null;
};

export const statusLabel = (status) => MPR_STATUS_LABELS[status] || status;

const PIA_CHAIN = [S.PENDING_PIA_CHECKER, S.PENDING_PIA_APPROVER, ...AT_DISTRICT, ...AT_HQ];
const DISTRICT_CHAIN = [S.PENDING_DISTRICT_CHECKER, S.PENDING_DISTRICT_APPROVER, ...AT_HQ];

/**
 * The whole chain of a report, step by step, with who took each step in the
 * current cycle. `state` is done / current / upcoming.
 */
export const chainOf = (mpr, nameOf = () => null) => {
  const entryMode = mpr.entryMode || MPR_ENTRY_MODE.PIA;
  const stages = entryMode === MPR_ENTRY_MODE.DISTRICT ? DISTRICT_CHAIN : PIA_CHAIN;
  const position = stages.indexOf(mpr.status);
  const verified = mpr.status === S.VERIFIED_BY_STATE;
  const maker = {
    key: 'MAKER',
    label: entryMode === MPR_ENTRY_MODE.DISTRICT ? 'District Maker (Technical Staff) — entry' : 'PIA Maker — entry',
    tier: entryMode === MPR_ENTRY_MODE.DISTRICT ? TIERS.DISTRICT : TIERS.PIA,
    state: mpr.status === S.DRAFT || mpr.status === S.RETURNED_FOR_CORRECTION ? 'current' : 'done',
    by: mpr.submittedAt ? nameOf(mpr.submittedBy) : null,
    at: mpr.submittedAt || null,
  };
  return [maker, ...stages.map((status, index) => {
    const stage = REVIEW_STAGES[status];
    const step = mpr.steps?.[stage.step];
    let state = 'upcoming';
    if (verified || (position >= 0 && index < position)) state = 'done';
    else if (index === position) state = 'current';
    return {
      key: status,
      label: roleLabel(stage.tier, stage.role),
      tier: stage.tier,
      state,
      by: step?.by ? nameOf(step.by) : null,
      at: step?.at || null,
      note: step?.note || null,
    };
  })];
};

/** Has this user already taken a step of the report's current cycle? Nobody acts twice on one report. */
const alreadyActed = (mpr, user) => Object.values(mpr.steps || {}).some((step) => step?.by && sameId(step.by, user._id));

/**
 * May this user take the report's current review step? Checks the tier, the
 * workflow role and the scope (district; for PIA users also the department),
 * and that the user is not the report's own Maker.
 */
export const canActOnStage = (user, mpr) => {
  const stage = REVIEW_STAGES[mpr.status];
  if (!stage || !hasTierRole(user, stage.tier, stage.role)) return false;
  if (stage.tier === TIERS.PIA && (user.district !== mpr.district || !sameText(user.department, mpr.departmentName))) return false;
  if (stage.tier === TIERS.DISTRICT && user.district !== mpr.district) return false;
  if (sameId(mpr.submittedBy, user._id)) return false;
  return !alreadyActed(mpr, user);
};

/** Filter for the reports waiting for this user's action (empty filter = none). */
export const queueFilterFor = (user) => {
  const tier = tierOf(user);
  const role = workflowRoleOf(user);
  const statuses = Object.entries(REVIEW_STAGES).filter(([, stage]) => stage.tier === tier && stage.role === role).map(([status]) => status);
  if (!statuses.length) return null;
  const filter = { status: statuses.length === 1 ? statuses[0] : { $in: statuses }, submittedBy: { $ne: user._id } };
  if (tier === TIERS.PIA) {
    if (!user.district || !user.department) return null;
    filter.district = user.district;
    filter.departmentName = new RegExp(`^\\s*${escapeRegex(String(user.department).trim())}\\s*$`, 'i');
  } else if (tier === TIERS.DISTRICT) {
    if (!user.district) return null;
    filter.district = user.district;
  }
  return filter;
};

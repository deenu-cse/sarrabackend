import ProjectSanction from '../models/ProjectSanction.model.js';
import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import MPRAbstract55 from '../models/MPRAbstract55.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS, MPR_STATUS_LABELS } from '../models/ProjectMPR.model.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import { actorLabel } from '../utils/access.js';

const MPR_MODELS = [
  { model: MPRPraroop1A, label: 'Praroop-1(A)', key: 'praroop1a' },
  { model: MPRPraroop1B, label: 'Praroop-1(B)', key: 'praroop1b' },
  { model: MPRPraroop1C, label: 'Praroop-1(C)', key: 'praroop1c' },
  { model: MPRPraroop1D, label: 'Praroop-1(D)', key: 'praroop1d' },
  { model: MPRAbstract55, label: 'Abstract 55', key: 'abstract55' }
];

const PROJECT_ACTIONS = {
  CREATED: {
    label: 'Project created by HQ Maker',
    description: 'Project and DPR details were entered and sent for HQ Checker verification.',
    from: 'Draft',
    to: 'Pending Checker'
  },
  CHECKER_VERIFIED: {
    label: 'Project verified by HQ Checker',
    description: 'HQ Checker verified the project and forwarded it to the HQ Approver.',
    from: 'Pending Checker',
    to: 'Pending Approver'
  },
  APPROVED: {
    label: 'Project sanctioned by HQ Approver',
    description: 'HQ Approver approved the project and the Sanction ID was generated.',
    from: 'Pending Approver',
    to: 'Sanctioned'
  },
  REJECTED: {
    label: 'Project returned to HQ Maker',
    description: 'Project was returned to the HQ Maker with an objection.',
    to: 'Returned to Maker'
  },
  RETURNED: {
    label: 'Project returned to HQ Maker',
    description: 'Project was returned to the HQ Maker with an objection.',
    to: 'Returned to Maker'
  },
  RESUBMITTED: {
    label: 'Project corrected and resubmitted',
    description: 'HQ Maker corrected the project and sent it back to the HQ Checker.',
    from: 'Returned to Maker',
    to: 'Pending Checker'
  },
  FORWARDED_TO_DISTRICT: {
    label: 'Forwarded to district',
    description: 'HQ Maker forwarded the sanctioned project to the District SARRA Centre.',
    from: 'Sanctioned',
    to: 'Forwarded to District'
  },
  DISTRICT_ACCEPTED: {
    label: 'Accepted by District Maker',
    description: 'District Maker received and accepted the project.',
    from: 'Forwarded to District',
    to: 'District Accepted'
  },
  FORWARDED_TO_PIA: {
    label: 'Assigned to PIA',
    description: 'District Maker assigned the project to a PIA Maker.',
    from: 'District Accepted',
    to: 'Assigned to PIA'
  },
  REPORTING_ASSIGNED: {
    label: 'PIA and reporting responsibility assigned',
    description: 'District Maker assigned the PIA Maker, District Technical Staff and MPR reporting responsibility.',
    to: 'Assigned to PIA'
  },
  PIA_ACCEPTED: {
    label: 'Accepted by PIA Maker',
    description: 'PIA Maker accepted the project and implementation began.',
    from: 'Assigned to PIA',
    to: 'Active'
  },
  PIA_TRANSFERRED: { label: 'PIA charge transferred', description: 'District Maker handed a department over to another PIA Maker.' },
  REVISED: { label: 'Target revision approved', description: 'HQ Approver authorised revised targets.' },
  COMPLETION_SUBMITTED: { label: 'Completion report filed', description: 'The reporting Maker filed a completion report.' },
  COMPLETION_VERIFIED: { label: 'Completion verified by district', description: 'District verified a completion report.' },
  COMPLETION_RETURNED: { label: 'Completion report returned', description: 'District returned a completion report.' },
  CLOSED: { label: 'Project closed by HQ Approver', description: 'HQ Approver closed the project.', to: 'Closed' },
};

const PROJECT_MPR_ACTIONS = {
  DRAFT_SAVED: 'MPR draft saved',
  SUBMITTED: 'MPR submitted by Maker',
  RESUBMITTED: 'MPR corrected and resubmitted',
  FORWARDED: 'MPR verified and forwarded',
  RETURNED: 'MPR returned for correction',
  REJECTED: 'MPR rejected',
};

const MPR_ACTIONS = {
  DRAFT: { label: 'MPR draft saved', description: 'A monthly progress report draft was saved.' },
  SUBMITTED: { label: 'MPR submitted', description: 'Monthly progress report was submitted for review.' },
  RESUBMITTED: { label: 'MPR resubmitted', description: 'Returned monthly progress report was resubmitted.' },
  DISTRICT_APPROVED: { label: 'MPR approved by district', description: 'District reviewed the MPR and forwarded it for state review.' },
  FORWARDED_TO_STATE: { label: 'MPR forwarded to state', description: 'Monthly progress report was forwarded for state review.' },
  STATE_VERIFIED: { label: 'MPR state verified', description: 'State reviewer verified the monthly progress report.' },
  APPROVED: { label: 'MPR approved', description: 'Monthly progress report was approved.' },
  RETURNED_TO_PIA: { label: 'MPR returned for changes', description: 'Monthly progress report was returned to the submitting officer.' },
  REJECTED: { label: 'MPR rejected', description: 'Monthly progress report was rejected by reviewer.' }
};

const statusLabel = (value) => (value || '').replace(/_/g, ' ');
const projectReference = (project) => project?.sanctionId || project?.dprApplicationNo || 'Sanction ID pending';
const actorRole = (user, fallback) => user?.workflowRole || user?.role || fallback || 'System';

const projectHref = (projectId) => `/dashboard/admin/projects/${projectId}`;
const mprHref = (key, id) => key === 'abstract55'
  ? `/dashboard/mnd-admin/mpr/${id}`
  : `/dashboard/mnd-admin/mpr/${key}/${id}`;

const mapProjectEvent = (project, step, index) => {
  const meta = PROJECT_ACTIONS[step.action] || {
    label: statusLabel(step.action),
    description: 'Project workflow status changed.'
  };

  return {
    id: `project-${project._id}-${index}`,
    kind: 'project',
    action: step.action,
    eventName: meta.label,
    description: step.note || meta.description,
    projectId: project._id,
    projectTitle: project.projectTitle,
    referenceNo: projectReference(project),
    district: project.district,
    status: project.status,
    previousStatus: meta.from,
    newStatus: meta.to,
    performedBy: step.performedBy?.name || 'System',
    performedByRole: step.role || (step.performedBy ? actorLabel(step.performedBy) : actorRole(step.performedBy, project.makerUserId?.workflowRole)),
    designation: step.designation || step.performedBy?.designation || null,
    timestamp: step.performedAt || project.updatedAt || project.createdAt,
    href: projectHref(project._id)
  };
};

/** One action on a project Monthly Progress Report, with who took it and in which role. */
const mapProjectMprEvent = (mpr, step, index) => ({
  id: `project-mpr-${mpr._id}-${index}`,
  kind: 'mpr',
  action: step.action || step.status,
  eventName: PROJECT_MPR_ACTIONS[step.action] || `MPR ${MPR_STATUS_LABELS[step.status] || statusLabel(step.status)}`,
  description: step.note || '',
  projectId: mpr.project,
  projectTitle: mpr.projectTitle,
  referenceNo: mpr.projectCode,
  mprId: mpr._id,
  mprReferenceNo: mpr.mprNo,
  mprType: `MPR ${mpr.departmentName} ${mpr.reportingMonth} ${mpr.financialYear}`,
  district: mpr.district,
  status: step.status,
  newStatus: MPR_STATUS_LABELS[step.status] || statusLabel(step.status),
  performedBy: step.changedBy?.name || 'System',
  performedByRole: step.role || (step.changedBy ? actorLabel(step.changedBy) : 'System'),
  designation: step.designation || step.changedBy?.designation || null,
  timestamp: step.changedAt || mpr.updatedAt,
  href: `/dashboard/admin/projects/mpr/${mpr._id}`
});

const getProjectMprs = (filter, limit) => ProjectMPR.find({ ...filter, status: { $ne: PROJECT_MPR_STATUS.DRAFT } })
  .sort({ updatedAt: -1 })
  .limit(limit)
  .select('mprNo project projectCode projectTitle district departmentName reportingMonth financialYear status revisionHistory updatedAt')
  .populate('revisionHistory.changedBy', 'name role workflowRole designation')
  .lean();

const mapMprEvent = (mpr, info, revision, index) => {
  const meta = MPR_ACTIONS[revision.status] || {
    label: `MPR ${statusLabel(revision.status)}`,
    description: 'Monthly progress report status changed.'
  };
  const project = mpr.projectSanctionId;

  return {
    id: `mpr-${info.key}-${mpr._id}-${index}`,
    kind: 'mpr',
    action: revision.status,
    eventName: meta.label,
    description: revision.note || meta.description,
    projectId: project?._id || null,
    projectTitle: project?.projectTitle || `${info.label} ${mpr.reportingMonth || ''}`.trim(),
    referenceNo: project?.sanctionId || mpr.sanctionId || mpr.applicationNo,
    mprId: mpr._id,
    mprReferenceNo: mpr.applicationNo,
    mprType: info.label,
    district: mpr.submittedByDistrict,
    status: revision.status || mpr.status,
    newStatus: statusLabel(revision.status),
    performedBy: revision.changedBy?.name || mpr.reviewedBy?.name || mpr.submittedBy?.name || 'System',
    performedByRole: actorRole(revision.changedBy || mpr.reviewedBy || mpr.submittedBy),
    timestamp: revision.changedAt || mpr.updatedAt || mpr.submittedAt || mpr.createdAt,
    href: project?._id ? projectHref(project._id) : mprHref(info.key, mpr._id)
  };
};

const populateProjectQuery = (query) =>
  query
    .populate('makerUserId', 'name email role workflowRole')
    .populate('checkerUserId', 'name email role workflowRole')
    .populate('approverUserId', 'name email role workflowRole')
    .populate('districtAcceptedBy', 'name email role workflowRole district')
    .populate('forwardedToPIA', 'name email role workflowRole department district')
    .populate('piaAcceptedBy', 'name email role workflowRole')
    .populate('workflowHistory.performedBy', 'name email role workflowRole designation')
    .lean();

const mprSelect = 'applicationNo projectSanctionId sanctionId reportType headCode financialYear reportingMonth status submittedBy submittedByDistrict submittedByDepartment reviewedBy districtApprovedBy revisionHistory submittedAt updatedAt createdAt';

const getMprs = async (projectId, perModelLimit = 20) => {
  const results = await Promise.all(MPR_MODELS.map(async (info) => {
    const docs = await info.model
      .find(projectId ? { projectSanctionId: projectId } : { isDraft: false })
      .sort({ updatedAt: -1 })
      .limit(perModelLimit)
      .select(mprSelect)
      .populate('projectSanctionId', 'projectTitle sanctionId district status')
      .populate('submittedBy', 'name email role workflowRole')
      .populate('reviewedBy', 'name email role workflowRole')
      .populate('districtApprovedBy', 'name email role workflowRole')
      .populate('revisionHistory.changedBy', 'name email role workflowRole')
      .lean();
    return docs.map((doc) => ({ doc, info }));
  }));

  return results.flat();
};

export const getRecentBusinessActivity = async (limit = 12) => {
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50);
  const projects = await populateProjectQuery(
    ProjectSanction.find({ 'workflowHistory.0': { $exists: true } })
      .sort({ updatedAt: -1 })
      .limit(40)
  );

  const projectEvents = projects.flatMap((project) =>
    (project.workflowHistory || []).map((step, index) => mapProjectEvent(project, step, index))
  );

  const [mprs, projectMprs] = await Promise.all([getMprs(null, 8), getProjectMprs({}, 20)]);
  const mprEvents = mprs.flatMap(({ doc, info }) =>
    (doc.revisionHistory || []).map((revision, index) => mapMprEvent(doc, info, revision, index))
  );
  const projectMprEvents = projectMprs.flatMap((mpr) => (mpr.revisionHistory || []).map((step, index) => mapProjectMprEvent(mpr, step, index)));

  return [...projectEvents, ...mprEvents, ...projectMprEvents]
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, parsedLimit);
};

export const getProjectOptions = async ({ search = '', limit = 25 } = {}) => {
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const query = {};

  if (search?.trim()) {
    const term = search.trim();
    query.$or = [
      { sanctionId: { $regex: term, $options: 'i' } },
      { projectTitle: { $regex: term, $options: 'i' } },
      { district: { $regex: term, $options: 'i' } },
      { department: { $regex: term, $options: 'i' } }
    ];
  }

  const projects = await ProjectSanction.find(query)
    .sort({ updatedAt: -1 })
    .limit(parsedLimit)
    .select('sanctionId dprApplicationNo projectTitle district department financialYear status updatedAt createdAt')
    .lean();

  return projects.map((project) => ({
    id: project._id,
    label: project.projectTitle || projectReference(project),
    referenceNo: projectReference(project),
    district: project.district,
    department: project.department,
    financialYear: project.financialYear,
    status: project.status,
    updatedAt: project.updatedAt || project.createdAt
  }));
};

export const getProjectActivity = async (projectId) => {
  const project = await populateProjectQuery(ProjectSanction.findById(projectId));
  if (!project) return null;

  const [mprs, projectMprs] = await Promise.all([getMprs(projectId, 100), getProjectMprs({ project: projectId }, 500)]);
  const projectEvents = (project.workflowHistory || []).map((step, index) =>
    mapProjectEvent(project, step, index)
  );
  const mprEvents = mprs.flatMap(({ doc, info }) =>
    (doc.revisionHistory || []).map((revision, index) => mapMprEvent(doc, info, revision, index))
  );
  const projectMprEvents = projectMprs.flatMap((mpr) => (mpr.revisionHistory || []).map((step, index) => mapProjectMprEvent(mpr, step, index)));

  const timeline = [...projectEvents, ...mprEvents, ...projectMprEvents]
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return {
    project: {
      id: project._id,
      referenceNo: projectReference(project),
      projectTitle: project.projectTitle,
      projectType: project.projectType || project.dprType,
      district: project.district,
      department: project.department,
      financialYear: project.financialYear,
      status: project.status,
      isActive: project.isActive,
      maker: project.makerUserId,
      checker: project.checkerUserId,
      approver: project.approverUserId,
      pia: project.forwardedToPIA,
      importantDates: {
        createdAt: project.createdAt,
        makerAt: project.makerAt,
        checkerAt: project.checkerAt,
        approverAt: project.approverAt,
        forwardedToDistrictAt: project.forwardedToDistrictAt,
        districtAcceptedAt: project.districtAcceptedAt,
        piaForwardedAt: project.piaForwardedAt,
        piaAcceptedAt: project.piaAcceptedAt
      },
      href: projectHref(project._id)
    },
    mprs: [...projectMprs.map((mpr) => ({
      id: mpr._id,
      formType: `MPR — ${mpr.departmentName}`,
      formKey: 'project',
      referenceNo: mpr.mprNo,
      reportingMonth: mpr.reportingMonth,
      financialYear: mpr.financialYear,
      status: mpr.status,
      submittedBy: null,
      submittedAt: null,
      href: `/dashboard/admin/projects/mpr/${mpr._id}`
    })), ...mprs.map(({ doc, info }) => ({
      id: doc._id,
      formType: info.label,
      formKey: info.key,
      referenceNo: doc.applicationNo,
      reportingMonth: doc.reportingMonth,
      financialYear: doc.financialYear,
      status: doc.status,
      submittedBy: doc.submittedBy,
      submittedAt: doc.submittedAt,
      href: mprHref(info.key, doc._id)
    }))],
    timeline
  };
};

export const getBusinessAudit = async ({ projectId, search, limit } = {}) => {
  const projects = await getProjectOptions({ search, limit: limit || 30 });
  const selectedProjectId = projectId || projects[0]?.id;
  const selected = selectedProjectId ? await getProjectActivity(selectedProjectId) : null;
  const recentActivity = await getRecentBusinessActivity(10);

  return {
    projects,
    selected,
    recentActivity,
    statusLegend: Object.values(SANCTION_STATUS)
  };
};

export default {
  getRecentBusinessActivity,
  getProjectOptions,
  getProjectActivity,
  getBusinessAudit
};

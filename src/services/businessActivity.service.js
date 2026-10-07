import ProjectSanction from '../models/ProjectSanction.model.js';
import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import MPRAbstract55 from '../models/MPRAbstract55.model.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';

const MPR_MODELS = [
  { model: MPRPraroop1A, label: 'Praroop-1(A)', key: 'praroop1a' },
  { model: MPRPraroop1B, label: 'Praroop-1(B)', key: 'praroop1b' },
  { model: MPRPraroop1C, label: 'Praroop-1(C)', key: 'praroop1c' },
  { model: MPRPraroop1D, label: 'Praroop-1(D)', key: 'praroop1d' },
  { model: MPRAbstract55, label: 'Abstract 55', key: 'abstract55' }
];

const PROJECT_ACTIONS = {
  CREATED: {
    label: 'Project submitted by Maker',
    description: 'Project record was created and sent for checker verification.',
    from: 'Draft',
    to: 'Pending Checker'
  },
  CHECKER_VERIFIED: {
    label: 'Project checked',
    description: 'Checker verified the project and forwarded it for approval.',
    from: 'Pending Checker',
    to: 'Pending Approver'
  },
  APPROVED: {
    label: 'Project approved',
    description: 'Approver sanctioned the project.',
    from: 'Pending Approver',
    to: 'Sanctioned'
  },
  REJECTED: {
    label: 'Project returned or rejected',
    description: 'Project was returned from the current review stage.',
    to: 'Rejected'
  },
  FORWARDED_TO_DISTRICT: {
    label: 'Forwarded to district',
    description: 'Sanctioned project was forwarded to the district office.',
    from: 'Sanctioned',
    to: 'Forwarded to District'
  },
  DISTRICT_ACCEPTED: {
    label: 'Accepted by district',
    description: 'District accepted the project and recorded allocation details.',
    from: 'Forwarded to District',
    to: 'District Accepted'
  },
  FORWARDED_TO_PIA: {
    label: 'Assigned to PIA',
    description: 'District assigned the project to a PIA officer.',
    from: 'District Accepted',
    to: 'Assigned to PIA'
  },
  PIA_ACCEPTED: {
    label: 'Activated by PIA',
    description: 'PIA officer accepted and activated the project.',
    from: 'Assigned to PIA',
    to: 'Active'
  },
  RETURNED: {
    label: 'Returned for correction',
    description: 'Project was returned for correction.',
    to: 'Returned'
  }
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
    performedByRole: actorRole(step.performedBy, project.makerUserId?.workflowRole),
    timestamp: step.performedAt || project.updatedAt || project.createdAt,
    href: projectHref(project._id)
  };
};

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
    .populate('workflowHistory.performedBy', 'name email role workflowRole')
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

  const mprs = await getMprs(null, 8);
  const mprEvents = mprs.flatMap(({ doc, info }) =>
    (doc.revisionHistory || []).map((revision, index) => mapMprEvent(doc, info, revision, index))
  );

  return [...projectEvents, ...mprEvents]
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

  const mprs = await getMprs(projectId, 100);
  const projectEvents = (project.workflowHistory || []).map((step, index) =>
    mapProjectEvent(project, step, index)
  );
  const mprEvents = mprs.flatMap(({ doc, info }) =>
    (doc.revisionHistory || []).map((revision, index) => mapMprEvent(doc, info, revision, index))
  );

  const timeline = [...projectEvents, ...mprEvents]
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
    mprs: mprs.map(({ doc, info }) => ({
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
    })),
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

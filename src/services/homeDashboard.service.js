import User from '../models/User.model.js';
import ProjectSanction from '../models/ProjectSanction.model.js';
import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import MPRAbstract55 from '../models/MPRAbstract55.model.js';
import USER_ROLES from '../constants/roles.constants.js';
import { SANCTION_STATUS, MPR_STATUS } from '../constants/status.constants.js';
import { getRecentBusinessActivity } from './businessActivity.service.js';

const MPR_MODELS = [
  { model: MPRPraroop1A, type: 'Praroop-1(A)', key: 'praroop1a', hrefBase: 'praroop1a' },
  { model: MPRPraroop1B, type: 'Praroop-1(B)', key: 'praroop1b', hrefBase: 'praroop1b' },
  { model: MPRPraroop1C, type: 'Praroop-1(C)', key: 'praroop1c', hrefBase: 'praroop1c' },
  { model: MPRPraroop1D, type: 'Praroop-1(D)', key: 'praroop1d', hrefBase: 'praroop1d' }
];

const mapSanctionAction = (s, href) => ({
  id: s._id,
  kind: 'sanction',
  title: s.projectTitle || s.sanctionId || 'Project',
  subtitle: [s.sanctionId, s.district, s.department].filter(Boolean).join(' · '),
  status: s.status,
  financialYear: s.financialYear,
  updatedAt: s.updatedAt || s.createdAt,
  href
});

const mapMprAction = (m, type, href) => ({
  id: m._id,
  kind: 'mpr',
  title: m.applicationNo || `Draft · ${type}`,
  subtitle: [type, m.reportingMonth, m.financialYear, m.submittedByDistrict || m.district]
    .filter(Boolean)
    .join(' · '),
  status: m.status,
  formType: type,
  updatedAt: m.updatedAt || m.submittedAt || m.createdAt,
  href
});

async function countByStatus(Model, match = {}) {
  const rows = await Model.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  return rows.reduce((acc, r) => {
    acc[r._id || 'UNKNOWN'] = r.count;
    return acc;
  }, {});
}

async function fetchMprs(match, limit = 5) {
  const results = await Promise.all(
    MPR_MODELS.map(async ({ model, type, hrefBase }) => {
      const docs = await model
        .find(match)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select('applicationNo reportingMonth financialYear status submittedByDistrict district updatedAt submittedAt createdAt computed')
        .lean();
      return docs.map((d) => ({ ...d, formType: type, hrefBase }));
    })
  );
  return results
    .flat()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, limit);
}

async function mprStatusTotals(match = {}) {
  const parts = await Promise.all(MPR_MODELS.map(({ model }) => countByStatus(model, match)));
  const totals = {};
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      totals[k] = (totals[k] || 0) + v;
    }
  }
  return totals;
}

async function superAdminHome(user) {
  const workflow = user.workflowRole || null;

  const [
    userStats,
    sanctionByStatus,
    mprTotals,
    invitePending,
    recentBusinessActivity,
    pendingChecker,
    pendingApprover,
    pendingForwardDistrict,
    recentSanctions
  ] = await Promise.all([
    User.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$accountStatus', 'ACTIVE'] }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ['$accountStatus', 'SUSPENDED'] }, 1, 0] } },
          deactivated: { $sum: { $cond: [{ $eq: ['$accountStatus', 'DEACTIVATED'] }, 1, 0] } },
          invitePending: { $sum: { $cond: ['$invitePending', 1, 0] } }
        }
      }
    ]),
    countByStatus(ProjectSanction),
    mprStatusTotals({}),
    User.countDocuments({ invitePending: true }),
    getRecentBusinessActivity(8),
    ProjectSanction.find({ status: SANCTION_STATUS.PENDING_CHECKER })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    ProjectSanction.find({ status: SANCTION_STATUS.PENDING_APPROVER })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    ProjectSanction.find({ status: SANCTION_STATUS.SANCTIONED })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    ProjectSanction.find({})
      .sort({ updatedAt: -1 })
      .limit(6)
      .lean()
  ]);

  const us = userStats[0] || {};
  const stats = {
    totalUsers: us.total || 0,
    activeUsers: us.active || 0,
    suspendedUsers: us.suspended || 0,
    invitePending: invitePending || 0,
    totalProjects: Object.values(sanctionByStatus).reduce((a, b) => a + b, 0),
    activeProjects: (sanctionByStatus[SANCTION_STATUS.PIA_ACCEPTED] || 0),
    pendingChecker: sanctionByStatus[SANCTION_STATUS.PENDING_CHECKER] || 0,
    pendingApprover: sanctionByStatus[SANCTION_STATUS.PENDING_APPROVER] || 0,
    readyToForwardDistrict: sanctionByStatus[SANCTION_STATUS.SANCTIONED] || 0,
    forwardedDistrict: sanctionByStatus[SANCTION_STATUS.FORWARDED_TO_DISTRICT] || 0,
    totalMprs: Object.values(mprTotals).reduce((a, b) => a + b, 0),
    mprSubmitted: mprTotals.SUBMITTED || 0,
    mprApproved: (mprTotals.APPROVED || 0) + (mprTotals.STATE_VERIFIED || 0) + (mprTotals.DISTRICT_APPROVED || 0)
  };

  let actionRequired = [];
  let welcomeHint = 'Platform overview and system health';

  if (workflow === 'CHECKER') {
    welcomeHint = 'Sanctions waiting for your verification';
    actionRequired = pendingChecker.map((s) =>
      mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`)
    );
  } else if (workflow === 'APPROVER') {
    welcomeHint = 'Sanctions waiting for your approval';
    actionRequired = pendingApprover.map((s) =>
      mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`)
    );
  } else if (workflow === 'MAKER') {
    welcomeHint = 'Create and track project sanctions';
    actionRequired = [
      ...pendingForwardDistrict.map((s) =>
        mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`)
      ),
      ...recentSanctions
        .filter((s) => s.status === SANCTION_STATUS.DRAFT || s.status === SANCTION_STATUS.PENDING_CHECKER)
        .map((s) => mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`))
    ].slice(0, 8);
  } else {
    welcomeHint = 'User management, projects & system oversight';
    actionRequired = [
      ...pendingChecker.slice(0, 3).map((s) => mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`)),
      ...pendingApprover.slice(0, 3).map((s) => mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`)),
      ...pendingForwardDistrict.slice(0, 2).map((s) => mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`))
    ];
  }

  return {
    role: USER_ROLES.SUPER_ADMIN,
    workflowRole: workflow,
    welcomeHint,
    stats,
    actionRequired,
    recentActivity: recentBusinessActivity || [],
    recentItems: recentSanctions.map((s) =>
      mapSanctionAction(s, `/dashboard/admin/projects/${s._id}`)
    ),
    quickLinks: workflow
      ? [
          { label: 'Projects', href: '/dashboard/admin/projects' },
          { label: 'Create Project', href: '/dashboard/admin/projects/create' }
        ]
      : [
          { label: 'Users', href: '/dashboard/admin/users' },
          { label: 'Projects', href: '/dashboard/admin/projects' },
          { label: 'Audit Logs', href: '/dashboard/admin/audit-logs' }
        ]
  };
}

async function ddHome(user) {
  const district = user.district;
  const matchDistrict = district ? { district } : {};

  const [
    sanctionByStatus,
    pendingDistrict,
    acceptedNeedPia,
    mprPending,
    recentMprs,
    activeProjects
  ] = await Promise.all([
    countByStatus(ProjectSanction, matchDistrict),
    ProjectSanction.find({
      ...matchDistrict,
      status: SANCTION_STATUS.FORWARDED_TO_DISTRICT
    })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    ProjectSanction.find({
      ...matchDistrict,
      status: SANCTION_STATUS.DISTRICT_ACCEPTED
    })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
    fetchMprs(
      {
        ...(district ? { submittedByDistrict: district } : {}),
        status: {
          $in: [
            MPR_STATUS.SUBMITTED,
            'DISTRICT_MAKER_REVIEW',
            'DISTRICT_CHECKER_REVIEW',
            'FORWARDED_TO_STATE'
          ]
        }
      },
      8
    ),
    fetchMprs(district ? { submittedByDistrict: district } : {}, 5),
    ProjectSanction.countDocuments({
      ...matchDistrict,
      status: SANCTION_STATUS.PIA_ACCEPTED,
      isActive: true
    })
  ]);

  const mprTotals = await mprStatusTotals(district ? { submittedByDistrict: district } : {});

  const actionRequired = [
    ...pendingDistrict.map((s) =>
      mapSanctionAction(s, `/dashboard/dd/projects/${s._id}`)
    ),
    ...acceptedNeedPia.map((s) =>
      mapSanctionAction(s, `/dashboard/dd/projects/${s._id}`)
    ),
    ...mprPending.map((m) =>
      mapMprAction(
        m,
        m.formType,
        `/dashboard/dd/mpr-review/${m.hrefBase}/${m._id}`
      )
    )
  ].slice(0, 10);

  return {
    role: USER_ROLES.DD_LEVEL,
    workflowRole: user.workflowRole || null,
    welcomeHint: `District command center${district ? ` · ${district}` : ''}`,
    stats: {
      district,
      totalProjects: Object.values(sanctionByStatus).reduce((a, b) => a + b, 0),
      awaitingDistrictAccept: sanctionByStatus[SANCTION_STATUS.FORWARDED_TO_DISTRICT] || 0,
      readyToAssignPia: sanctionByStatus[SANCTION_STATUS.DISTRICT_ACCEPTED] || 0,
      activeProjects,
      totalMprs: Object.values(mprTotals).reduce((a, b) => a + b, 0),
      mprPendingReview: (mprTotals.SUBMITTED || 0) + (mprTotals.DISTRICT_MAKER_REVIEW || 0) + (mprTotals.DISTRICT_CHECKER_REVIEW || 0),
      mprApproved: (mprTotals.DISTRICT_APPROVED || 0) + (mprTotals.APPROVED || 0) + (mprTotals.STATE_VERIFIED || 0)
    },
    actionRequired,
    recentItems: recentMprs.map((m) =>
      mapMprAction(m, m.formType, `/dashboard/dd/mpr-review/${m.hrefBase}/${m._id}`)
    ),
    quickLinks: [
      { label: 'District Projects', href: '/dashboard/dd/projects' },
      { label: 'Review MPRs', href: '/dashboard/dd/mpr-review' },
      { label: 'Analytics', href: '/dashboard/dd/analytics' }
    ]
  };
}

async function piaHome(user) {
  const userId = user._id;

  const [
    pendingAccept,
    activeProjects,
    myMprs,
    mprTotals,
    returnedMprs
  ] = await Promise.all([
    ProjectSanction.find({
      $or: [
        { status: SANCTION_STATUS.FORWARDED_TO_PIA, forwardedToPIA: userId },
        { departmentAllocations: { $elemMatch: { piaUserId: userId, piaAcceptedAt: null } } }
      ]
    })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    ProjectSanction.find({
      $or: [
        { status: SANCTION_STATUS.PIA_ACCEPTED, forwardedToPIA: userId, isActive: true },
        { departmentAllocations: { $elemMatch: { piaUserId: userId, piaAcceptedAt: { $ne: null } } } }
      ]
    })
      .sort({ updatedAt: -1 })
      .limit(8)
      .lean(),
    fetchMprs({ submittedBy: userId }, 6),
    mprStatusTotals({ submittedBy: userId }),
    fetchMprs({ submittedBy: userId, status: { $in: ['RETURNED_TO_PIA', 'REJECTED'] } }, 5)
  ]);

  const actionRequired = [
    ...pendingAccept.map((s) =>
      mapSanctionAction(s, `/dashboard/officer/projects/${s._id}`)
    ),
    ...returnedMprs.map((m) =>
      mapMprAction(
        m,
        m.formType,
        `/dashboard/officer/mprs/${m.hrefBase}/${m._id}`
      )
    ),
    ...(await fetchMprs({ submittedBy: userId, status: 'DRAFT' }, 5)).map((m) =>
      mapMprAction(m, m.formType, `/dashboard/officer/mprs/${m.hrefBase}/${m._id}`)
    )
  ].slice(0, 10);

  return {
    role: USER_ROLES.PIA_OFFICER,
    workflowRole: null,
    welcomeHint: 'Your projects and monthly progress reports',
    stats: {
      pendingAccept: pendingAccept.length,
      activeProjects: activeProjects.length,
      totalMprs: Object.values(mprTotals).reduce((a, b) => a + b, 0),
      mprDrafts: mprTotals.DRAFT || 0,
      mprSubmitted: mprTotals.SUBMITTED || 0,
      mprReturned: (mprTotals.RETURNED_TO_PIA || 0) + (mprTotals.REJECTED || 0),
      mprApproved: (mprTotals.APPROVED || 0) + (mprTotals.DISTRICT_APPROVED || 0) + (mprTotals.STATE_VERIFIED || 0)
    },
    actionRequired,
    recentItems: myMprs.map((m) =>
      mapMprAction(m, m.formType, `/dashboard/officer/mprs/${m.hrefBase}/${m._id}`)
    ),
    activeProjects: activeProjects.map((s) =>
      mapSanctionAction(s, `/dashboard/officer/projects/${s._id}`)
    ),
    quickLinks: [
      { label: 'My Projects', href: '/dashboard/officer/projects' },
      { label: 'My MPRs', href: '/dashboard/officer/mprs' },
      { label: 'New MPR', href: '/dashboard/officer/mprs' }
    ]
  };
}

async function mndOfficerHome(user) {
  const userId = user._id;
  const match = { submittedBy: userId };

  const [abstractTotals, mprTotals, recent, drafts, returned] = await Promise.all([
    countByStatus(MPRAbstract55, match),
    mprStatusTotals(match),
    fetchMprs(match, 6),
    fetchMprs({ ...match, status: 'DRAFT' }, 5),
    fetchMprs({ ...match, status: { $in: ['REJECTED', 'RETURNED_TO_PIA'] } }, 5)
  ]);

  const abstractRecent = await MPRAbstract55.find(match)
    .sort({ updatedAt: -1 })
    .limit(3)
    .select('applicationNo reportingMonth financialYear status updatedAt submittedAt createdAt')
    .lean();

  const actionRequired = [
    ...drafts.map((m) =>
      mapMprAction(m, m.formType, `/dashboard/mnd/mpr/${m.hrefBase}/${m._id}`)
    ),
    ...returned.map((m) =>
      mapMprAction(m, m.formType, `/dashboard/mnd/mpr/${m.hrefBase}/${m._id}`)
    ),
    ...abstractRecent
      .filter((a) => a.status === 'DRAFT' || a.status === 'REJECTED')
      .map((a) => ({
        id: a._id,
        kind: 'mpr',
        title: a.applicationNo || 'Abstract 55 Draft',
        subtitle: `Abstract 55 · ${a.reportingMonth || ''} ${a.financialYear || ''}`,
        status: a.status,
        href: `/dashboard/mnd/mpr/${a._id}`
      }))
  ].slice(0, 10);

  return {
    role: USER_ROLES.MND_OFFICER,
    workflowRole: null,
    welcomeHint: 'Prepare and submit MPR forms (Abstract 55 & Praroop)',
    stats: {
      totalMprs: Object.values(mprTotals).reduce((a, b) => a + b, 0) + Object.values(abstractTotals).reduce((a, b) => a + b, 0),
      drafts: (mprTotals.DRAFT || 0) + (abstractTotals.DRAFT || 0),
      submitted: (mprTotals.SUBMITTED || 0) + (abstractTotals.SUBMITTED || 0),
      approved: (mprTotals.APPROVED || 0) + (mprTotals.STATE_VERIFIED || 0) + (abstractTotals.APPROVED || 0),
      rejected: (mprTotals.REJECTED || 0) + (abstractTotals.REJECTED || 0)
    },
    actionRequired,
    recentItems: [
      ...recent.map((m) =>
        mapMprAction(m, m.formType, `/dashboard/mnd/mpr/${m.hrefBase}/${m._id}`)
      ),
      ...abstractRecent.map((a) => ({
        id: a._id,
        kind: 'mpr',
        title: a.applicationNo || 'Abstract 55',
        subtitle: `Abstract 55 · ${a.reportingMonth || ''} ${a.financialYear || ''}`,
        status: a.status,
        updatedAt: a.updatedAt,
        href: `/dashboard/mnd/mpr/${a._id}`
      }))
    ]
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, 6),
    quickLinks: [
      { label: 'Abstract 55', href: '/dashboard/mnd/abstract55' },
      { label: 'Head 55-01', href: '/dashboard/mnd/head55-01' },
      { label: 'My Reports', href: '/dashboard/mnd/mpr' },
      { label: 'Analytics', href: '/dashboard/mnd/analytics' }
    ]
  };
}

async function mndAdminHome() {
  const pendingStatuses = ['SUBMITTED', 'RESUBMITTED', 'FORWARDED_TO_STATE'];

  const [abstractPending, mprPending, abstractTotals, mprTotals, recentPending] = await Promise.all([
    MPRAbstract55.find({ status: { $in: pendingStatuses } })
      .sort({ submittedAt: -1 })
      .limit(5)
      .lean(),
    fetchMprs({ status: { $in: pendingStatuses } }, 8),
    countByStatus(MPRAbstract55),
    mprStatusTotals({}),
    fetchMprs({ status: { $in: pendingStatuses } }, 5)
  ]);

  const actionRequired = [
    ...mprPending.map((m) =>
      mapMprAction(
        m,
        m.formType,
        `/dashboard/mnd-admin/mpr/${m.hrefBase}/${m._id}`
      )
    ),
    ...abstractPending.map((a) => ({
      id: a._id,
      kind: 'mpr',
      title: a.applicationNo || 'Abstract 55',
      subtitle: `Abstract 55 · ${a.submittedByDistrict || ''} · ${a.reportingMonth || ''} ${a.financialYear || ''}`,
      status: a.status,
      updatedAt: a.submittedAt || a.updatedAt,
      href: `/dashboard/mnd-admin/mpr/${a._id}`
    }))
  ]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 10);

  return {
    role: USER_ROLES.MND_SUPER_ADMIN,
    workflowRole: null,
    welcomeHint: 'State-level MPR review and monitoring',
    stats: {
      totalMprs: Object.values(mprTotals).reduce((a, b) => a + b, 0) + Object.values(abstractTotals).reduce((a, b) => a + b, 0),
      pendingReview:
        (mprTotals.SUBMITTED || 0) +
        (mprTotals.FORWARDED_TO_STATE || 0) +
        (abstractTotals.SUBMITTED || 0) +
        (abstractTotals.RESUBMITTED || 0),
      approved: (mprTotals.APPROVED || 0) + (mprTotals.STATE_VERIFIED || 0) + (abstractTotals.APPROVED || 0),
      rejected: (mprTotals.REJECTED || 0) + (abstractTotals.REJECTED || 0)
    },
    actionRequired,
    recentItems: recentPending.map((m) =>
      mapMprAction(m, m.formType, `/dashboard/mnd-admin/mpr/${m.hrefBase}/${m._id}`)
    ),
    quickLinks: [
      { label: 'All Reports', href: '/dashboard/mnd-admin/mpr' },
      { label: 'Analytics', href: '/dashboard/mnd-admin/analytics' }
    ]
  };
}

/**
 * Role-aware home dashboard payload.
 */
export const getHomeDashboard = async (user) => {
  switch (user.role) {
    case USER_ROLES.SUPER_ADMIN:
      return superAdminHome(user);
    case USER_ROLES.DD_LEVEL:
      return ddHome(user);
    case USER_ROLES.PIA_OFFICER:
      return piaHome(user);
    case USER_ROLES.MND_OFFICER:
      return mndOfficerHome(user);
    case USER_ROLES.MND_SUPER_ADMIN:
      return mndAdminHome(user);
    default:
      return {
        role: user.role,
        welcomeHint: 'Welcome to SARRA CRM',
        stats: {},
        actionRequired: [],
        recentItems: [],
        quickLinks: []
      };
  }
};

export default { getHomeDashboard };

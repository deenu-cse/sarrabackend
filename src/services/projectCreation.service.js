import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectIdReservation from '../models/ProjectIdReservation.model.js';
import Counter from '../models/Counter.model.js';
import Department from '../models/Department.model.js';
import Location, { LOCATION_TYPES } from '../models/Location.model.js';
import { assertObjectId, getActiveHead, resolveLocationChain } from './masterData.service.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import { runInTransaction } from '../utils/transaction.js';

const MAX_PIA = 10;
const MAX_AMOUNT_LAKH = 10000000; // sanity ceiling per figure
const MAX_PHYSICAL = 100000000;
const MONEY_DECIMALS = 5; // Rs. 1 precision when amounts are held in lakh
const EPSILON = 0.000005;
const DRAFT_KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

const bad = (message, data) => new ApiError(HTTP_STATUS.BAD_REQUEST, message, data);
const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
export const roundMoney = (value) => roundTo(value, MONEY_DECIMALS);

// ─── Project ID ──────────────────────────────────────────────────────────────

const assertDraftKey = (draftKey) => {
  if (typeof draftKey !== 'string' || !DRAFT_KEY_PATTERN.test(draftKey)) {
    throw bad('This project draft is invalid. Please reload the page and try again.');
  }
  return draftKey;
};

const nextSequence = async (counterId, session) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) },
  );
  return counter.seq;
};

const toReservationDto = (reservation) => ({
  projectId: reservation.projectId,
  districtId: String(reservation.districtId),
  districtName: reservation.districtName,
  generatedAt: reservation.createdAt,
});

/**
 * Reserve the permanent Project ID for a draft: SARRA-<year>-<district code>-<sequence>.
 *
 * Idempotent: the same draft always gets the same ID back, however many times
 * it asks. Collision-safe: the sequence comes from an atomic counter, and the
 * ID is protected by unique indexes on both the reservation and the project.
 */
export const reserveProjectId = async ({ draftKey, districtId }, user) => {
  assertDraftKey(draftKey);
  assertObjectId(districtId, 'District');

  const district = await Location.findOne({ _id: districtId, type: LOCATION_TYPES.DISTRICT, isActive: true }).lean();
  if (!district) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'The selected District was not found.');

  const reuse = (reservation) => {
    if (String(reservation.reservedBy) !== String(user._id)) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, 'This project draft belongs to another user.');
    }
    if (String(reservation.districtId) !== String(district._id)) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        `Project ID ${reservation.projectId} was already generated for ${reservation.districtName} district. The district cannot be changed after the Project ID is generated.`,
        { code: 'PROJECT_ID_DISTRICT_LOCKED', ...toReservationDto(reservation) },
      );
    }
    return toReservationDto(reservation);
  };

  const existing = await ProjectIdReservation.findOne({ draftKey }).lean();
  if (existing) return reuse(existing);

  const year = new Date().getFullYear();
  const districtCode = (district.code || district.name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase();
  const prefix = `SARRA-${year}-${districtCode}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // Sequence draw and reservation commit together, so a request that loses
      // a race rolls its sequence number back instead of leaving a gap.
      const reservation = await runInTransaction(async (session) => {
        const sequence = await nextSequence(`projectId:${prefix}`, session);
        const [created] = await ProjectIdReservation.create([{
          draftKey,
          projectId: `${prefix}-${String(sequence).padStart(5, '0')}`,
          districtId: district._id,
          districtName: district.name,
          reservedBy: user._id,
        }], session ? { session } : {});
        return created;
      });
      return toReservationDto(reservation);
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Same draft raced itself (double click): hand back the ID that won.
      const winner = await ProjectIdReservation.findOne({ draftKey }).lean();
      if (winner) return reuse(winner);
      // Otherwise the projectId itself was taken — draw the next sequence number.
    }
  }
  throw new ApiError(HTTP_STATUS.CONFLICT, 'Could not generate a Project ID right now. Please try again.');
};

// ─── Payload validation ──────────────────────────────────────────────────────

const toAmount = (value, label, { max = MAX_AMOUNT_LAKH, integer = false } = {}) => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) throw bad(`${label} must be a valid number.`);
  if (number < 0) throw bad(`${label} cannot be negative.`);
  if (number > max) throw bad(`${label} is too large.`);
  if (integer && !Number.isInteger(number)) throw bad(`${label} must be a whole number.`);
  return number;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict calendar-date parsing: rejects values such as 2026-02-31. */
const toDate = (value, label) => {
  if (value === '' || value === null || value === undefined) return null;
  const match = typeof value === 'string' ? ISO_DATE.exec(value.slice(0, 10)) : null;
  if (!match) throw bad(`${label} is not a valid date.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw bad(`${label} is not a valid date.`);
  }
  if (year < 2000) throw bad(`${label} is too far in the past.`);
  // Allow for "today" in IST while the server clock is still on the previous UTC day.
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw bad(`${label} cannot be in the future.`);
  return date;
};

const validateApprovalDates = (raw = {}) => {
  const dlec = toDate(raw.dlec, 'DLEC approval date');
  const slec = toDate(raw.slec, 'SLEC approval date');
  const hpc = toDate(raw.hpc, 'HPC approval date');
  if (!dlec && !slec && !hpc) throw bad('At least one approval date (DLEC, SLEC or HPC) is required.');
  if (dlec && slec && slec < dlec) throw bad('SLEC approval date cannot be earlier than the DLEC approval date.');
  if (slec && hpc && hpc < slec) throw bad('HPC approval date cannot be earlier than the SLEC approval date.');
  if (dlec && hpc && hpc < dlec) throw bad('HPC approval date cannot be earlier than the DLEC approval date.');
  return { dlec, slec, hpc };
};

const validateProjectName = (raw) => {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw bad('Project name is required.');
  if (name.length < 3) throw bad('Project name must be at least 3 characters.');
  if (name.length > 200) throw bad('Project name cannot be longer than 200 characters.');
  return name;
};

/** Build one department's allocation, taking activity names/units from the Head master. */
export const buildAllocation = (input, department, head) => {
  const label = department.name;
  const deptShareLakh = roundMoney(toAmount(input.deptShareLakh, `${label}: Department share`));
  const sarraShareLakh = roundMoney(toAmount(input.sarraShareLakh, `${label}: SARRA share`));
  const totalLakh = roundMoney(deptShareLakh + sarraShareLakh);
  if (totalLakh <= 0) throw bad(`${label}: enter a Department share or a SARRA share.`);

  const masterByCode = new Map(head.activities.map((a) => [a.code, a]));
  const seen = new Set();
  const activities = [];

  for (const row of Array.isArray(input.activities) ? input.activities : []) {
    const code = typeof row?.activityCode === 'string' ? row.activityCode : '';
    const master = masterByCode.get(code);
    if (!master) throw bad(`${label}: an activity does not belong to Head ${head.code}. Please reload and try again.`);
    if (seen.has(code)) throw bad(`${label}: activity "${master.name}" was entered more than once.`);
    seen.add(code);

    const physicalTarget = master.hasPhysical === false
      ? 0
      : toAmount(row.physicalTarget, `${label} – ${master.name}: Physical target`, { max: MAX_PHYSICAL, integer: !master.allowsDecimal });
    const financialTargetLakh = roundMoney(toAmount(row.financialTargetLakh, `${label} – ${master.name}: Financial target`));

    if (physicalTarget === 0 && financialTargetLakh === 0) continue; // activity not planned
    activities.push({
      activityCode: master.code,
      activityName: master.name,
      unit: master.unit || '',
      physicalTarget: roundTo(physicalTarget, 3),
      financialTargetLakh,
    });
  }

  if (!activities.length) throw bad(`${label}: enter a target for at least one activity.`);

  const activityFinancialTotalLakh = roundMoney(activities.reduce((sum, a) => sum + a.financialTargetLakh, 0));
  if (activityFinancialTotalLakh > totalLakh + EPSILON) {
    throw bad(`${label}: activity financial targets (${activityFinancialTotalLakh} lakh) exceed the allocated amount (${totalLakh} lakh).`);
  }

  // Keep the Head's own activity order
  activities.sort((a, b) => masterByCode.get(a.activityCode).sortOrder - masterByCode.get(b.activityCode).sortOrder);

  return {
    departmentId: department._id,
    departmentName: department.name,
    deptShareLakh,
    sarraShareLakh,
    totalLakh,
    activityFinancialTotalLakh,
    activities,
  };
};

/** Head-ordered, project-wide roll-up used by the existing sanction / MPR screens. */
export const rollUpTargets = (allocations, head) => {
  const byCode = new Map();
  for (const allocation of allocations) {
    for (const activity of allocation.activities) {
      const entry = byCode.get(activity.activityCode) || {
        activityId: activity.activityCode,
        activityLabel: activity.activityName,
        unit: activity.unit,
        physicalTarget: 0,
        financialAmountLakh: 0,
      };
      entry.physicalTarget = roundTo(entry.physicalTarget + activity.physicalTarget, 3);
      entry.financialAmountLakh = roundMoney(entry.financialAmountLakh + activity.financialTargetLakh);
      byCode.set(activity.activityCode, entry);
    }
  }
  return head.activities.filter((a) => byCode.has(a.code)).map((a) => byCode.get(a.code));
};

const currentFinancialYear = (now = new Date()) => {
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // April – March
  return `${startYear}-${startYear + 1}`;
};

/**
 * Validate everything a project consists of (name, dates, location chain,
 * departments, head, allocations and activity plan) against the master data.
 * Shared by project creation and by resubmission of a rejected project.
 */
export const validateProjectContent = async (data = {}) => {
  const projectTitle = validateProjectName(data.projectName);
  const approvalDates = validateApprovalDates(data.approvalDates);

  const { district, block, gramPanchayat, village } = await resolveLocationChain(data.location || {});
  const numberOfPIA = Number(data.numberOfPIA);
  if (!Number.isInteger(numberOfPIA) || numberOfPIA < 1 || numberOfPIA > MAX_PIA) {
    throw bad(`Number of PIA must be between 1 and ${MAX_PIA}.`);
  }
  const departmentInputs = Array.isArray(data.departments) ? data.departments : [];
  if (departmentInputs.length !== numberOfPIA) {
    throw bad(`Exactly ${numberOfPIA} department${numberOfPIA === 1 ? '' : 's'} must be selected for ${numberOfPIA} PIA.`);
  }
  const departmentIds = departmentInputs.map((d, i) => assertObjectId(d?.departmentId, `department for PIA ${i + 1}`));
  if (new Set(departmentIds).size !== departmentIds.length) {
    throw bad('The same department cannot be selected more than once.');
  }
  const departmentDocs = await Department.find({ _id: { $in: departmentIds }, isActive: true }).lean();
  const departmentById = new Map(departmentDocs.map((d) => [String(d._id), d]));
  if (departmentById.size !== departmentIds.length) throw bad('One of the selected departments was not found.');

  const head = await getActiveHead(typeof data.headId === 'string' ? data.headId : '');

  const departmentAllocations = departmentInputs.map((input) => buildAllocation(input, departmentById.get(input.departmentId), head));

  const deptShareLakh = roundMoney(departmentAllocations.reduce((s, a) => s + a.deptShareLakh, 0));
  const sarraShareLakh = roundMoney(departmentAllocations.reduce((s, a) => s + a.sarraShareLakh, 0));
  return {
    projectTitle, approvalDates, district, block, gramPanchayat, village, numberOfPIA, head,
    departmentAllocations, deptShareLakh, sarraShareLakh,
  };
};

/** Fields of a project document derived from validated content. */
export const contentToDocument = (content) => ({
  projectTitle: content.projectTitle,
  projectType: content.head.projectType,
  dprType: content.head.projectType, // kept for compatibility with existing screens
  district: content.district.name,
  department: content.departmentAllocations.map((a) => a.departmentName).join(', '),
  location: {
    districtId: content.district._id, district: content.district.name,
    blockId: content.block._id, block: content.block.name,
    gramPanchayatId: content.gramPanchayat._id, gramPanchayat: content.gramPanchayat.name,
    villageId: content.village._id, village: content.village.name,
  },
  approvalDates: content.approvalDates,
  numberOfPIA: content.numberOfPIA,
  head: { headId: content.head._id, code: content.head.code, name: content.head.name },
  departmentAllocations: content.departmentAllocations,
  sanctionedTargets: rollUpTargets(content.departmentAllocations, content.head),
  totalSanctionedBudgetLakh: roundMoney(content.deptShareLakh + content.sarraShareLakh),
  deptShareLakh: content.deptShareLakh,
  sarraShareLakh: content.sarraShareLakh,
});

// ─── Project creation ────────────────────────────────────────────────────────

/**
 * Final project creation (State Maker). Everything is re-validated against the
 * master data; names, units and totals are derived on the server, never trusted
 * from the client. The project and the consumption of its reserved Project ID
 * are written together, so a Project ID can produce at most one project.
 */
export const createProject = async (data = {}, makerUser) => {
  const draftKey = assertDraftKey(data.draftKey);

  const reservation = await ProjectIdReservation.findOne({ draftKey }).lean();
  if (!reservation) throw bad('Generate the Project ID before creating the project.');
  if (String(reservation.reservedBy) !== String(makerUser._id)) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'This project draft belongs to another user.');
  }
  if (data.projectId && data.projectId !== reservation.projectId) {
    throw bad('The Project ID does not match this draft. Please reload the page and try again.');
  }

  // Repeat submission of an already-created draft: return the same project.
  if (reservation.status === 'CONSUMED' && reservation.sanction) {
    const existing = await ProjectSanction.findById(reservation.sanction);
    if (existing) return { project: existing, alreadyCreated: true };
  }

  const content = await validateProjectContent(data);
  const { district } = content;
  if (String(district._id) !== String(reservation.districtId)) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      `Project ID ${reservation.projectId} was generated for ${reservation.districtName} district, but the project is in ${district.name}.`,
    );
  }


  const makerNote = String(data.makerNote ?? '').trim().slice(0, 1000);
  const now = new Date();

  const document = {
    projectId: reservation.projectId,
    ...contentToDocument(content),
    financialYear: currentFinancialYear(now),
    status: SANCTION_STATUS.PENDING_CHECKER,
    makerUserId: makerUser._id,
    makerNote,
    makerAt: now,
    workflowHistory: [{
      action: 'CREATED',
      performedBy: makerUser._id,
      performedAt: now,
      note: makerNote || 'Project created by Maker',
    }],
  };

  try {
    const project = await runInTransaction(async (session) => {
      const options = session ? { session } : {};

      // Claim the reservation first: only one request can move it to CONSUMED.
      const claimed = await ProjectIdReservation.findOneAndUpdate(
        { _id: reservation._id, status: 'RESERVED' },
        { $set: { status: 'CONSUMED', consumedAt: now } },
        { new: true, ...options },
      );
      if (!claimed) throw new ApiError(HTTP_STATUS.CONFLICT, 'This project has already been created.', { code: 'PROJECT_ALREADY_CREATED' });

      try {
        const [created] = await ProjectSanction.create([document], options);
        await ProjectIdReservation.updateOne({ _id: reservation._id }, { $set: { sanction: created._id } }, options);
        return created;
      } catch (err) {
        // Without a transaction there is no automatic rollback: release the claim.
        if (!session) {
          await ProjectIdReservation.updateOne(
            { _id: reservation._id, sanction: { $exists: false } },
            { $set: { status: 'RESERVED' }, $unset: { consumedAt: 1 } },
          );
        }
        throw err;
      }
    });
    return { project, alreadyCreated: false };
  } catch (err) {
    // A parallel duplicate submission lost the race: return the project that won.
    if (err?.data?.code === 'PROJECT_ALREADY_CREATED' || err?.code === 11000) {
      const existing = await ProjectSanction.findOne({ projectId: reservation.projectId });
      if (existing) return { project: existing, alreadyCreated: true };
    }
    throw err;
  }
};

/**
 * Maker corrects a rejected project and sends it back to the Checker.
 * The Project ID is kept, so the district (encoded in the ID) cannot change.
 */
export const resubmitRejectedProject = async (projectDbId, data = {}, makerUser) => {
  const project = await ProjectSanction.findById(projectDbId);
  if (!project) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Project not found.');
  if (project.status !== SANCTION_STATUS.REJECTED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Only a rejected project can be corrected and resubmitted.');
  }

  const content = await validateProjectContent(data);
  if (project.location?.districtId && String(content.district._id) !== String(project.location.districtId)) {
    throw bad(`The district cannot be changed: Project ID ${project.projectId} was issued for ${project.district}.`);
  }

  const now = new Date();
  const previousReason = project.rejectionReason;
  const note = String(data.makerNote ?? '').trim().slice(0, 1000);
  project.set(contentToDocument(content));
  project.status = SANCTION_STATUS.PENDING_CHECKER;
  project.rejectionReason = undefined;
  project.rejectedBy = undefined;
  project.rejectedAt = undefined;
  project.checkerUserId = undefined;
  project.checkerNote = undefined;
  project.checkerAt = undefined;
  project.makerUserId = makerUser._id;
  project.makerAt = now;
  if (note) project.makerNote = note;
  project.workflowHistory.push({
    action: 'RESUBMITTED',
    performedBy: makerUser._id,
    performedAt: now,
    note: note || `Corrected and resubmitted${previousReason ? ` after rejection: ${previousReason}` : ''}`,
  });
  await project.save();
  return project;
};

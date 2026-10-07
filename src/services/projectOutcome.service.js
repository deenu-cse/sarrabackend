import mongoose from 'mongoose';
import ProjectSanction from '../models/ProjectSanction.model.js';
import { OutcomeIndicator, ProjectOutcome, OUTCOME_KIND } from '../models/ProjectLifecycle.model.js';
import { uploadFile, deleteFile } from './upload.service.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

/**
 * Outcome tracking.
 *
 * Monthly reports say what was built and what was spent. Outcomes say what
 * changed because of it: a baseline reading is taken before the works, then
 * the same indicator is measured again, season after season, including after
 * the project is closed. Improvement is always worked out here.
 */

const bad = (message, data) => new ApiError(HTTP_STATUS.BAD_REQUEST, message, data);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const conflict = (message, code) => new ApiError(HTTP_STATUS.CONFLICT, message, { code });
const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);

const SCALE = 1000;
const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sameId = (a, b) => String(a?._id || a || '') === String(b?._id || b || '');
const round2 = (value) => Math.round(value * 100) / 100;

const SEED_INDICATORS = [
  { code: 'SPRING_DISCHARGE', name: 'Spring discharge', nameHindi: 'स्रोत का जल प्रवाह', unit: 'LPM', description: 'Flow of the treated spring, in litres per minute. Measure in the lean season for a fair comparison.', direction: 'INCREASE', allowsDecimal: true, headCodes: ['55-01'] },
  { code: 'STREAM_FLOW', name: 'Lean-season stream flow', nameHindi: 'शुष्क ऋतु में धारा प्रवाह', unit: 'LPS', description: 'Flow of the treated stream or river reach in the lean season, in litres per second.', direction: 'INCREASE', allowsDecimal: true, headCodes: ['55-02', '55-03'] },
  { code: 'GROUNDWATER_DEPTH', name: 'Depth to groundwater', nameHindi: 'भूजल स्तर की गहराई', unit: 'm bgl', description: 'Depth of the water table below ground level in the observation well. A smaller depth is an improvement.', direction: 'DECREASE', allowsDecimal: true, headCodes: ['55-04'] },
  { code: 'WATER_DAYS', name: 'Days of water availability', nameHindi: 'जल उपलब्धता के दिन', unit: 'days / year', description: 'Number of days in the year the source gives usable water.', direction: 'INCREASE', allowsDecimal: false, headCodes: [] },
  { code: 'HOUSEHOLDS_BENEFITED', name: 'Households benefited', nameHindi: 'लाभान्वित परिवार', unit: 'No.', description: 'Households that draw water from the treated source.', direction: 'INCREASE', allowsDecimal: false, headCodes: [] },
  { code: 'IRRIGATED_AREA', name: 'Area under irrigation', nameHindi: 'सिंचित क्षेत्र', unit: 'Ha.', description: 'Farm land irrigated from the treated source.', direction: 'INCREASE', allowsDecimal: true, headCodes: [] },
];

/** First-run seed of the indicator master; never overwrites edits. */
export const seedOutcomeIndicators = async () => {
  try {
    if ((await OutcomeIndicator.countDocuments()) === 0) {
      await OutcomeIndicator.insertMany(SEED_INDICATORS.map((indicator, index) => ({ ...indicator, sortOrder: index + 1 })));
      logger.info(`Master data: seeded ${SEED_INDICATORS.length} outcome indicators`);
    }
  } catch (err) {
    logger.error(`Outcome indicator seed failed: ${err.message}`);
  }
};

const indicatorsFor = async (headCode) => {
  const all = await OutcomeIndicator.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  return all.filter((indicator) => !(indicator.headCodes || []).length || indicator.headCodes.includes(headCode));
};

const loadProject = async (projectId) => {
  if (!isValidId(projectId)) throw notFound('Project not found.');
  const project = await ProjectSanction.findById(projectId).lean();
  if (!project) throw notFound('Project not found.');
  return project;
};

const isAssignedPia = (project, user) => user.role === USER_ROLES.PIA_OFFICER
  && (project.departmentAllocations || []).some((d) => sameId(d.piaUserId, user._id) && d.piaAcceptedAt);
const isOwnDistrict = (project, user) => user.role === USER_ROLES.DD_LEVEL && Boolean(user.district) && user.district === project.district;

const canRead = (project, user) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) return true;
  if (user.role === USER_ROLES.DD_LEVEL) return isOwnDistrict(project, user);
  return (project.departmentAllocations || []).some((d) => sameId(d.piaUserId, user._id));
};

// Readings are taken on the ground, so they start once the project is sanctioned.
const RECORDABLE = [SANCTION_STATUS.SANCTIONED, SANCTION_STATUS.FORWARDED_TO_DISTRICT, SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED];
const recordBlocker = (project, user) => {
  if (!RECORDABLE.includes(project.status)) return 'Outcomes can be recorded after the project is sanctioned.';
  if (isAssignedPia(project, user) || isOwnDistrict(project, user)) return null;
  return 'Readings are recorded by the PIA officers of the project and the District Director.';
};

const seasonOf = (date) => {
  const month = date.getUTCMonth(); // 0 = January
  if (month >= 2 && month <= 5) return 'PRE_MONSOON';
  if (month >= 6 && month <= 8) return 'MONSOON';
  if (month >= 9 && month <= 10) return 'POST_MONSOON';
  return 'WINTER';
};

const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCDate() === Number(match[3]) ? date : null;
};
const dayKeyOf = (date) => date.toISOString().slice(0, 10);

/** Change from the baseline to a later reading, and whether that is an improvement. */
const compare = (baseline, value, direction) => {
  const change = (Math.round(value * SCALE) - Math.round(baseline * SCALE)) / SCALE;
  let trend = 'UNCHANGED';
  if (change !== 0) trend = (change > 0) === (direction !== 'DECREASE') ? 'IMPROVED' : 'DECLINED';
  return { change, changePercent: baseline > 0 ? round2((change / baseline) * 100) : null, trend };
};

const readingDto = (entry, user, project) => ({
  id: String(entry._id),
  kind: entry.kind,
  value: entry.value,
  measuredOn: entry.measuredOn,
  season: entry.season,
  remarks: entry.remarks || '',
  evidence: entry.evidence?.url ? { url: entry.evidence.url, name: entry.evidence.name || 'Evidence' } : null,
  recordedBy: entry.recordedBy?.name || null,
  recordedByRole: entry.recordedByRole || null,
  recordedAt: entry.createdAt,
  // The District Director can strike out any reading; an officer only their own.
  canVoid: isOwnDistrict(project, user) || (isAssignedPia(project, user) && sameId(entry.recordedBy, user._id)),
});

/** Indicators of a project with the baseline, every reading and the change so far. */
export const getProjectOutcomes = async (projectId, user) => {
  const project = await loadProject(projectId);
  if (!canRead(project, user)) throw forbidden('You do not have access to this project.');
  const [indicators, entries] = await Promise.all([
    indicatorsFor(project.head?.code),
    ProjectOutcome.find({ project: project._id, voided: false }).populate('recordedBy', 'name').sort({ measuredOn: 1 }).lean(),
  ]);
  const blocker = recordBlocker(project, user);

  const list = indicators.map((indicator) => {
    const mine = entries.filter((entry) => entry.indicatorCode === indicator.code);
    const baseline = mine.find((entry) => entry.kind === OUTCOME_KIND.BASELINE) || null;
    const readings = mine.filter((entry) => entry.kind === OUTCOME_KIND.MEASUREMENT);
    const latest = readings[readings.length - 1] || null;
    return {
      code: indicator.code,
      name: indicator.name,
      nameHindi: indicator.nameHindi || '',
      unit: indicator.unit,
      description: indicator.description || '',
      direction: indicator.direction,
      allowsDecimal: indicator.allowsDecimal !== false,
      baseline: baseline ? readingDto(baseline, user, project) : null,
      latest: latest ? readingDto(latest, user, project) : null,
      comparison: baseline && latest ? compare(baseline.value, latest.value, indicator.direction) : null,
      readings: readings.map((entry) => ({
        ...readingDto(entry, user, project),
        ...(baseline ? compare(baseline.value, entry.value, indicator.direction) : { change: null, changePercent: null, trend: null }),
      })),
    };
  });

  const measured = list.filter((item) => item.comparison);
  return {
    project: { id: String(project._id), code: project.projectId || project.sanctionId || '', name: project.projectTitle || '', headCode: project.head?.code || null, closed: project.closure?.status === 'CLOSED' },
    canRecord: !blocker,
    recordBlockedReason: blocker,
    summary: {
      indicators: list.length,
      withBaseline: list.filter((item) => item.baseline).length,
      measured: measured.length,
      improved: measured.filter((item) => item.comparison.trend === 'IMPROVED').length,
      declined: measured.filter((item) => item.comparison.trend === 'DECLINED').length,
    },
    indicators: list,
  };
};

const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Record the baseline or a later reading of one indicator. The evidence file is optional. */
export const recordOutcome = async (projectId, body = {}, file, user) => {
  const project = await loadProject(projectId);
  if (!canRead(project, user)) throw forbidden('You do not have access to this project.');
  const blocker = recordBlocker(project, user);
  if (blocker) throw forbidden(blocker);

  const indicator = (await indicatorsFor(project.head?.code)).find((item) => item.code === body.indicatorCode);
  if (!indicator) throw bad('Select an indicator that applies to this project.');
  const kind = body.kind === OUTCOME_KIND.BASELINE ? OUTCOME_KIND.BASELINE : OUTCOME_KIND.MEASUREMENT;

  const raw = typeof body.value === 'number' ? body.value : Number(String(body.value ?? '').trim());
  if (String(body.value ?? '').trim() === '' || !Number.isFinite(raw)) throw bad(`Enter the reading in ${indicator.unit}.`);
  if (raw < 0) throw bad('The reading cannot be negative.');
  if (raw > 100000000) throw bad('The reading is too large. Please check the figure.');
  if (Math.abs(raw * SCALE - Math.round(raw * SCALE)) > 0.0001) throw bad('The reading can have at most 3 decimal places.');
  if (indicator.allowsDecimal === false && !Number.isInteger(raw)) throw bad(`${indicator.name} must be a whole number.`);

  const measuredOn = parseDay(body.measuredOn);
  if (!measuredOn) throw bad('Enter the date the reading was taken.');
  const now = new Date();
  if (measuredOn.getTime() > Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) throw bad('The date of the reading cannot be in the future.');

  const baseline = await ProjectOutcome.findOne({ project: project._id, indicatorCode: indicator.code, kind: OUTCOME_KIND.BASELINE, voided: false }).lean();
  if (kind === OUTCOME_KIND.BASELINE) {
    if (baseline) throw conflict(`The baseline of ${indicator.name} is already recorded. Strike it out first to replace it.`, 'BASELINE_EXISTS');
    const earlier = await ProjectOutcome.exists({ project: project._id, indicatorCode: indicator.code, kind: OUTCOME_KIND.MEASUREMENT, voided: false, measuredOn: { $lte: measuredOn } });
    if (earlier) throw bad('The baseline must be dated before every later reading of this indicator.');
  } else {
    if (!baseline) throw conflict(`Record the baseline of ${indicator.name} first.`, 'BASELINE_MISSING');
    if (measuredOn.getTime() <= new Date(baseline.measuredOn).getTime()) throw bad('A reading must be dated after the baseline.');
  }

  if (file) {
    if (!FILE_TYPES.includes(file.mimetype)) throw bad('Evidence: upload a photograph (JPG, PNG, WEBP) or a PDF.');
    if (file.size > MAX_FILE_BYTES) throw bad('Evidence: the file is too large. Maximum size is 10 MB.');
  }

  let evidence;
  if (file) {
    const stored = await uploadFile(file.buffer, 'project-outcomes');
    evidence = { url: stored.url, publicId: stored.publicId, name: clean(file.originalname, 200) || 'Evidence', mimeType: file.mimetype, size: file.size };
  }
  try {
    const created = await ProjectOutcome.create({
      project: project._id,
      projectCode: project.projectId || project.sanctionId || '',
      district: project.district,
      headCode: project.head?.code,
      indicatorCode: indicator.code,
      indicatorName: indicator.name,
      unit: indicator.unit,
      direction: indicator.direction,
      kind,
      value: Math.round(raw * SCALE) / SCALE,
      measuredOn,
      dayKey: dayKeyOf(measuredOn),
      season: seasonOf(measuredOn),
      remarks: clean(body.remarks, 500),
      evidence,
      recordedBy: user._id,
      recordedByRole: user.role,
    });
    return {
      id: String(created._id),
      indicatorCode: created.indicatorCode,
      indicatorName: created.indicatorName,
      kind: created.kind,
      value: created.value,
      unit: created.unit,
      measuredOn: created.measuredOn,
      projectCode: created.projectCode,
    };
  } catch (err) {
    if (evidence) deleteFile(evidence.publicId);
    if (err?.code === 11000) {
      throw conflict(kind === OUTCOME_KIND.BASELINE
        ? `The baseline of ${indicator.name} is already recorded.`
        : `A reading of ${indicator.name} is already recorded for that date.`, 'DUPLICATE');
    }
    throw err;
  }
};

/** Strike out a wrong reading. It stays in the database with the reason. */
export const voidOutcome = async (projectId, entryId, reason, user) => {
  const project = await loadProject(projectId);
  if (!isValidId(entryId)) throw notFound('Reading not found.');
  const entry = await ProjectOutcome.findOne({ _id: entryId, project: project._id });
  if (!entry) throw notFound('Reading not found.');
  const allowed = isOwnDistrict(project, user) || (isAssignedPia(project, user) && sameId(entry.recordedBy, user._id));
  if (!allowed) throw forbidden('Only the District Director, or the officer who recorded this reading, can strike it out.');
  if (entry.voided) throw conflict('This reading is already struck out.', 'ALREADY_VOID');
  const text = clean(reason, 500);
  if (text.length < 5) throw bad('Give the reason for striking out this reading.');
  if (entry.kind === OUTCOME_KIND.BASELINE) {
    const dependants = await ProjectOutcome.countDocuments({ project: project._id, indicatorCode: entry.indicatorCode, kind: OUTCOME_KIND.MEASUREMENT, voided: false });
    if (dependants > 0) throw conflict(`${dependants} later reading${dependants === 1 ? ' is' : 's are'} compared with this baseline. Strike ${dependants === 1 ? 'it' : 'them'} out first.`, 'BASELINE_IN_USE');
  }
  entry.voided = true;
  entry.voidedBy = user._id;
  entry.voidedAt = new Date();
  entry.voidReason = text;
  await entry.save();
  return { id: String(entry._id), indicatorCode: entry.indicatorCode, kind: entry.kind, value: entry.value, reason: text };
};

/** State-wide picture: for each indicator, how many projects were measured and how many improved. */
export const getOutcomeSummary = async ({ district, headCode } = {}) => {
  const projectFilter = { status: { $in: RECORDABLE } };
  if (district) projectFilter.district = district;
  if (headCode) projectFilter['head.code'] = headCode;
  const [indicators, projects] = await Promise.all([
    OutcomeIndicator.find({ isActive: true }).sort({ sortOrder: 1 }).lean(),
    ProjectSanction.find(projectFilter).select('projectId sanctionId projectTitle district head closure').lean(),
  ]);
  const projectById = new Map(projects.map((project) => [String(project._id), project]));
  const entries = await ProjectOutcome.find({ project: { $in: projects.map((p) => p._id) }, voided: false })
    .select('project indicatorCode kind value measuredOn').sort({ measuredOn: 1 }).lean();

  // project → indicator → { baseline, latest }
  const pairs = new Map();
  entries.forEach((entry) => {
    const key = `${entry.project}|${entry.indicatorCode}`;
    const pair = pairs.get(key) || { project: String(entry.project), code: entry.indicatorCode, baseline: null, latest: null, readings: 0 };
    if (entry.kind === OUTCOME_KIND.BASELINE) pair.baseline = entry;
    else { pair.latest = entry; pair.readings += 1; }
    pairs.set(key, pair);
  });
  const all = [...pairs.values()];

  const byIndicator = indicators.map((indicator) => {
    const applies = projects.filter((p) => !(indicator.headCodes || []).length || indicator.headCodes.includes(p.head?.code));
    const mine = all.filter((pair) => pair.code === indicator.code && pair.baseline);
    const measured = mine.filter((pair) => pair.latest).map((pair) => ({ ...pair, ...compare(pair.baseline.value, pair.latest.value, indicator.direction) }));
    const percents = measured.map((pair) => pair.changePercent).filter((value) => value !== null);
    const total = (key) => Math.round(measured.reduce((sumSoFar, pair) => sumSoFar + Math.round(pair[key].value * SCALE), 0)) / SCALE;
    return {
      code: indicator.code,
      name: indicator.name,
      unit: indicator.unit,
      direction: indicator.direction,
      applicableProjects: applies.length,
      withBaseline: mine.length,
      measured: measured.length,
      improved: measured.filter((pair) => pair.trend === 'IMPROVED').length,
      declined: measured.filter((pair) => pair.trend === 'DECLINED').length,
      unchanged: measured.filter((pair) => pair.trend === 'UNCHANGED').length,
      averageChangePercent: percents.length ? round2(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
      baselineTotal: total('baseline'),
      latestTotal: total('latest'),
      projects: measured.map((pair) => {
        const project = projectById.get(pair.project);
        return {
          id: pair.project,
          code: project?.projectId || project?.sanctionId || '',
          name: project?.projectTitle || '',
          district: project?.district || '',
          baseline: pair.baseline.value,
          latest: pair.latest.value,
          latestOn: pair.latest.measuredOn,
          change: pair.change,
          changePercent: pair.changePercent,
          trend: pair.trend,
        };
      }).sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity)),
    };
  });

  const districtNames = [...new Set(projects.map((p) => p.district))].sort();
  const byDistrict = districtNames.map((name) => {
    const ids = new Set(projects.filter((p) => p.district === name).map((p) => String(p._id)));
    const mine = all.filter((pair) => ids.has(pair.project));
    const measured = mine.filter((pair) => pair.baseline && pair.latest);
    const directionOf = (code) => indicators.find((i) => i.code === code)?.direction || 'INCREASE';
    return {
      district: name,
      projects: ids.size,
      projectsWithBaseline: new Set(mine.filter((pair) => pair.baseline).map((pair) => pair.project)).size,
      projectsMeasured: new Set(measured.map((pair) => pair.project)).size,
      readings: mine.reduce((count, pair) => count + pair.readings, 0),
      improved: measured.filter((pair) => compare(pair.baseline.value, pair.latest.value, directionOf(pair.code)).trend === 'IMPROVED').length,
      declined: measured.filter((pair) => compare(pair.baseline.value, pair.latest.value, directionOf(pair.code)).trend === 'DECLINED').length,
    };
  });

  const withBaseline = new Set(all.filter((pair) => pair.baseline).map((pair) => pair.project));
  const measuredProjects = new Set(all.filter((pair) => pair.baseline && pair.latest).map((pair) => pair.project));
  return {
    totals: {
      projects: projects.length,
      projectsWithBaseline: withBaseline.size,
      projectsMeasured: measuredProjects.size,
      projectsWithoutBaseline: projects.length - withBaseline.size,
      readings: entries.filter((entry) => entry.kind === OUTCOME_KIND.MEASUREMENT).length,
    },
    indicators: byIndicator,
    districts: byDistrict,
  };
};

export const listIndicators = async () => (await OutcomeIndicator.find({ isActive: true }).sort({ sortOrder: 1 }).lean())
  .map((indicator) => ({ code: indicator.code, name: indicator.name, nameHindi: indicator.nameHindi || '', unit: indicator.unit, direction: indicator.direction, headCodes: indicator.headCodes || [] }));


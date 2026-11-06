/**
 * One-time migration to the three-tier MIS/MPR workflow.
 *
 *   node scripts/migrate-workflow.js              apply
 *   node scripts/migrate-workflow.js --dry-run    only count what would change
 *   node scripts/migrate-workflow.js --purge-budget
 *                                                 also delete the old budget-allocation
 *                                                 collections and fields (cannot be undone)
 *
 * Safe to run more than once: every step only touches records still in the old shape.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import ProjectMPR from '../src/models/ProjectMPR.model.js';

const dryRun = process.argv.includes('--dry-run');
const purgeBudget = process.argv.includes('--purge-budget');

const log = (message) => console.log(`${dryRun ? '[dry-run] ' : ''}${message}`);

const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const db = mongoose.connection.db;
  const mprs = db.collection('projectmprs');
  const projects = db.collection('projectsanctions');
  const users = db.collection('users');
  const completions = db.collection('projectcompletions');

  const step = async (label, collection, filter, update, options = {}) => {
    const count = await collection.countDocuments(filter);
    if (!dryRun && count) await collection.updateMany(filter, update, options);
    log(`${label}: ${count}`);
  };

  // 1. Monthly progress reports: old statuses → the 12-status chain.
  //    Reports already at the district keep their place; nothing is sent back to the PIA.
  await step('MPR approved by State → Verified by State', mprs, { status: 'STATE_VERIFIED' }, [
    { $set: { status: 'VERIFIED_BY_STATE', 'steps.districtApprover': { by: '$reviewedBy', at: '$reviewedAt', note: '$reviewNote' }, 'steps.hqApprover': { by: '$verifiedBy', at: '$verifiedAt', note: '$verificationNote' } } },
  ]);
  await step('MPR approved by district → Submitted to HQ', mprs, { status: 'DISTRICT_APPROVED' }, [
    { $set: { status: 'SUBMITTED_TO_HQ', stageEnteredAt: { $ifNull: ['$reviewedAt', '$updatedAt'] }, 'steps.districtApprover': { by: '$reviewedBy', at: '$reviewedAt', note: '$reviewNote' } } },
  ]);
  await step('MPR submitted → Submitted to District', mprs, { status: 'SUBMITTED' }, [
    { $set: { status: 'SUBMITTED_TO_DISTRICT', stageEnteredAt: { $ifNull: ['$submittedAt', '$updatedAt'] } } },
  ]);
  await step('MPR returned to PIA → Returned for Correction', mprs, { status: 'RETURNED_TO_PIA' }, [
    { $set: { status: 'RETURNED_FOR_CORRECTION', stageEnteredAt: '$updatedAt' } },
  ]);
  await step('MPR without entry mode → PIA entry', mprs, { entryMode: { $exists: false } }, { $set: { entryMode: 'PIA' } });
  await step('MPR without rejection key → live', mprs, { rejectedKey: { $exists: false } }, { $set: { rejectedKey: null } });
  await step('MPR without stage time', mprs, { stageEnteredAt: { $exists: false } }, [{ $set: { stageEnteredAt: '$updatedAt' } }]);

  // 2. The old one-report-per-month index did not allow a rejected month to be reported again.
  const indexes = await mprs.indexes().catch(() => []);
  const old = indexes.find((index) => index.unique && index.name !== 'one_live_report_per_month' && index.key?.reportingMonth && !index.key?.rejectedKey);
  if (old) {
    if (!dryRun) await mprs.dropIndex(old.name);
    log(`Dropped old MPR unique index ${old.name}`);
  }
  if (!dryRun) await ProjectMPR.syncIndexes();
  log('MPR indexes synchronised');

  // 3. District and PIA accounts without a workflow role did all the work themselves: they become Makers.
  await step('District / PIA accounts without workflow role → Maker', users,
    { role: { $in: ['DD_LEVEL', 'PIA_OFFICER'] }, $or: [{ workflowRole: null }, { workflowRole: { $exists: false } }] },
    { $set: { workflowRole: 'MAKER' } });

  // 4. Every existing department reports through its PIA, as before.
  await step('Departments without reporting mode → PIA', projects,
    { departmentAllocations: { $elemMatch: { reportingMode: { $exists: false } } } },
    { $set: { 'departmentAllocations.$[d].reportingMode': 'PIA' } },
    { arrayFilters: [{ 'd.reportingMode': { $exists: false } }] });

  // 5. Closure and completion figures: balance = sanctioned − expenditure (releases no longer exist).
  await step('Closed projects without balance', projects, { 'closure.status': 'CLOSED', 'closure.balanceLakh': { $exists: false } }, [
    { $set: { 'closure.balanceLakh': { $max: [0, { $subtract: [{ $ifNull: ['$closure.sanctionedLakh', 0] }, { $ifNull: ['$closure.expenditureLakh', 0] }] }] } } },
  ]);
  await step('Completion reports without balance', completions, { balanceLakh: { $exists: false } }, [
    { $set: { balanceLakh: { $max: [0, { $subtract: [{ $ifNull: ['$sanctionedLakh', 0] }, { $ifNull: ['$expenditureLakh', 0] }] }] } } },
  ]);

  // 6. Optional: remove the budget-allocation data for good.
  if (purgeBudget) {
    for (const name of ['budgetallocationbatches', 'budgetallocationentries', 'budgetallocationdocuments', 'budgetallocationreversals']) {
      // eslint-disable-next-line no-await-in-loop
      const exists = (await db.listCollections({ name }).toArray()).length > 0;
      // eslint-disable-next-line no-await-in-loop
      if (exists && !dryRun) await db.dropCollection(name);
      log(`${exists ? 'Dropped' : 'No'} collection ${name}`);
    }
    await step('Projects with budget-allocation fields', projects,
      { $or: [{ budgetAllocation: { $exists: true } }, { budgetVersion: { $exists: true } }, { fundAllocationOrder: { $exists: true } }, { allocatedAmountLakh: { $exists: true } }] },
      { $unset: { budgetAllocation: '', budgetVersion: '', fundAllocationOrder: '', allocatedAmountLakh: '', 'closure.releasedLakh': '', 'closure.unspentLakh': '', 'closure.unreleasedLakh': '', 'closure.refundStatus': '', 'closure.refundReference': '', 'closure.refundRecordedAt': '', 'closure.refundRecordedBy': '' } });
    await step('Completion reports with release figures', completions, { $or: [{ releasedLakh: { $exists: true } }, { unspentLakh: { $exists: true } }] }, { $unset: { releasedLakh: '', unspentLakh: '' } });
  } else {
    log('Budget-allocation data left in place (run with --purge-budget to delete it).');
  }

  await mongoose.disconnect();
  log('Migration finished.');
};

run().catch(async (err) => {
  console.error(`Migration failed: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

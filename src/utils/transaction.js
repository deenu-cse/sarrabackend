import mongoose from 'mongoose';
import logger from '../config/logger.js';

const transactionsUnsupported = (err) => err?.code === 20
  || /Transaction numbers are only allowed|replica set/i.test(err?.message || '');

/**
 * Run `work(session)` in a MongoDB transaction: everything commits or nothing does.
 *
 * On a standalone server (local development without a replica set) transactions
 * are unavailable, so the work runs with `session = null` instead — callers must
 * stay safe in that mode (guard writes with conditions and undo on failure).
 */
export const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    if (!transactionsUnsupported(err)) throw err;
    logger.warn('MongoDB transactions unavailable (standalone server); continuing without a transaction.');
    return work(null);
  } finally {
    await session.endSession();
  }
};

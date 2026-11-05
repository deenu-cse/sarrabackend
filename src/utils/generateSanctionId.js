import ProjectSanction from '../models/ProjectSanction.model.js';
import Counter from '../models/Counter.model.js';
import ApiError from './ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Next Sanction ID for a district: SANC-<year>-<district code>-<sequence>.
 * The sequence comes from an atomic counter, so two approvals at the same
 * moment can never receive the same ID.
 */
const generateSanctionId = async (district) => {
  const currentYear = new Date().getFullYear();
  const districtCode = district.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase();
  const prefix = `SANC-${currentYear}-${districtCode}`;
  const counterId = `sanctionId:${prefix}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const counter = await Counter.findOneAndUpdate({ _id: counterId }, { $inc: { seq: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    const candidate = `${prefix}-${String(counter.seq).padStart(5, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await ProjectSanction.exists({ sanctionId: candidate }))) return candidate;

    // IDs issued before the counter existed: move the counter past the highest one.
    // eslint-disable-next-line no-await-in-loop
    const last = await ProjectSanction.findOne({ sanctionId: new RegExp(`^${prefix}-\\d{5}$`) }).sort({ sanctionId: -1 }).select('sanctionId').lean();
    const highest = Number(last?.sanctionId?.match(/-(\d{5})$/)?.[1] || 0);
    // eslint-disable-next-line no-await-in-loop
    await Counter.updateOne({ _id: counterId }, { $max: { seq: highest } });
  }
  throw new ApiError(HTTP_STATUS.CONFLICT, 'Could not generate a Sanction ID right now. Please try again.');
};

export default generateSanctionId;

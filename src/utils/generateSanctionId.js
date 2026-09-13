import ProjectSanction from '../models/ProjectSanction.model.js';

const generateSanctionId = async (district) => {
  const currentYear = new Date().getFullYear();
  const districtCode = district.substring(0, 3).toUpperCase();
  const prefix = `SANC-${currentYear}-${districtCode}`;

  const lastSanction = await ProjectSanction.findOne({
    sanctionId: new RegExp(`^${prefix}`)
  }).sort({ sanctionId: -1 });

  let nextSequence = 1;
  if (lastSanction && lastSanction.sanctionId) {
    const lastSequenceMatch = lastSanction.sanctionId.match(/-(\d{5})$/);
    if (lastSequenceMatch) {
      nextSequence = parseInt(lastSequenceMatch[1], 10) + 1;
    }
  }

  const paddedSequence = nextSequence.toString().padStart(5, '0');
  return `${prefix}-${paddedSequence}`;
};

export default generateSanctionId;

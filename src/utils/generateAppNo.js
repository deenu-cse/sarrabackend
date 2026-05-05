import SpringshedDPR from '../models/SpringshedDPR.model.js';

const generateAppNo = async (district) => {
  const currentYear = new Date().getFullYear();
  const districtCode = district.substring(0, 3).toUpperCase();
  
  const prefix = `SARRA-${currentYear}-${districtCode}`;
  
  const lastDPR = await SpringshedDPR.findOne({
    applicationNo: new RegExp(`^${prefix}`)
  }).sort({ applicationNo: -1 });

  let nextSequence = 1;
  if (lastDPR && lastDPR.applicationNo) {
    const lastSequenceMatch = lastDPR.applicationNo.match(/-(\d{5})$/);
    if (lastSequenceMatch) {
      nextSequence = parseInt(lastSequenceMatch[1], 10) + 1;
    }
  }

  const paddedSequence = nextSequence.toString().padStart(5, '0');
  return `${prefix}-${paddedSequence}`;
};

export default generateAppNo;

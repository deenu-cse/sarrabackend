const generateAppNo = async (district) => {
  const currentYear = new Date().getFullYear();
  const districtCode = district ? district.substring(0, 3).toUpperCase() : 'HQ';
  const prefix = `SARRA-${currentYear}-${districtCode}`;
  const randomSeq = Math.floor(10000 + Math.random() * 90000);
  return `${prefix}-${randomSeq}`;
};

export default generateAppNo;

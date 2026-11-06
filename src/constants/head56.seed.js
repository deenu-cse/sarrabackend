/**
 * Budget Head 56 — Non-Salary Grant (गैर वेतन हेतु अनुदान), from the SARRA
 * format "HEAD 56-MPR FORMAT" (Prarup-2) and the Head 56 workflow note.
 *
 * Seeded once per code: a code that already exists is never overwritten, so
 * anything HQ edits through the master screen stays as edited.
 *
 * `levels`: where the line can be allocated and reported. Posts marked (HQ)
 * belong to SARRA HQ and posts marked (DSC) to the District SARRA Centres;
 * capacity building follows the level it is organised at. HQ can change any
 * of this in the master.
 */
const HQ = ['HQ'];
const DSC = ['DISTRICT'];
const ALL = ['HQ', 'DISTRICT', 'PIA'];

const post = (n, name, levels) => ({
  code: `56-01(${String(n).padStart(2, '0')})`, parentCode: '56-01', name, levels,
  hasPhysical: true, unit: 'Person-months', allowsDecimal: true,
});

export const SEED_HEAD56 = [
  { code: '56-01', name: 'Honorarium of Contractual / Outsourced / Retired Personnel', nameHindi: 'अनुबंधित / आउटसोर्स / रिटायर्ड / कार्मिकों का मानदेय', levels: ['HQ', 'DISTRICT'] },
  post(1, 'GIS/RS Specialists (HQ)', HQ),
  post(2, 'Geo-Hydrologists (HQ)', HQ),
  post(3, 'Civil Engineer (HQ)', HQ),
  post(4, 'Monitoring & Evaluation Expert (HQ)', HQ),
  post(5, 'Social Institutional Expert (HQ)', HQ),
  post(6, 'MIS Expert (HQ)', HQ),
  post(7, 'Knowledge Management Expert (HQ)', HQ),
  post(8, 'Office Manager (HQ)', HQ),
  post(9, 'Data Entry Operator (HQ)', HQ),
  post(10, 'Multipurpose Workers (HQ)', HQ),
  post(11, 'Contractual / Outsourced / Retired Employee (HQ)', HQ),
  post(12, 'GIS Expert (DSC)', DSC),
  post(13, 'Geo-Hydrologists (DSC)', DSC),
  post(14, 'Civil Engineer Assistant (DSC)', DSC),
  post(15, 'Technical Expert – Planning & Monitoring (DSC)', DSC),
  post(16, 'Social Coordinator (DSC)', DSC),
  post(17, 'Data Entry Operator (DSC)', DSC),

  { code: '56-02', name: 'Travel Expenses', nameHindi: 'यात्रा व्यय', levels: ALL },

  { code: '56-03', name: 'Office Expenses', nameHindi: 'कार्यालय व्यय', levels: ALL },
  { code: '56-03(01)', parentCode: '56-03', name: 'Office Furniture & Equipment', nameHindi: 'कार्यालय फर्नीचर एवं उपकरण', levels: ALL },
  { code: '56-03(02)', parentCode: '56-03', name: 'Computer, Printer, Hardware, Software & Maintenance', nameHindi: 'कम्प्यूटर, प्रिंटर, हार्डवेयर, सॉफ्टवेयर व अनुरक्षण', levels: ALL },
  { code: '56-03(03)', parentCode: '56-03', name: 'Stationery', nameHindi: 'लेखन सामग्री', levels: ALL },
  { code: '56-03(04)', parentCode: '56-03', name: 'Professional & Special Services', nameHindi: 'व्यावसायिक एवं विशेष सेवाओं के लिए भुगतान', levels: ALL },
  { code: '56-03(05)', parentCode: '56-03', name: 'Utility Bills (Post, Telephone, Electricity, Water)', nameHindi: 'उपयोगिता बिलों का भुगतान (डाक, टेलीफोन, विद्युत, जलकर)', levels: ALL },
  { code: '56-03(06)', parentCode: '56-03', name: 'Building Rent, Rates & Taxes', nameHindi: 'भवन किराया, उपशुल्क और कर स्वामित्व', levels: ALL },
  { code: '56-03(07)', parentCode: '56-03', name: 'Advertising, Sales & Publication', nameHindi: 'विज्ञापन बिक्री, प्रकाशन', levels: ALL },

  { code: '56-04', name: 'Capacity Building Programme', nameHindi: 'क्षमता विकास कार्यक्रम', levels: ALL },
  { code: '56-04(01)', parentCode: '56-04', name: 'State-level Capacity Building Programme', nameHindi: 'राज्य स्तर पर आयोजित क्षमता विकास कार्यक्रम', levels: HQ, hasPhysical: true, unit: 'Programmes' },
  { code: '56-04(02)', parentCode: '56-04', name: 'Block-level Capacity Building Programme', nameHindi: 'विकासखण्ड स्तर पर आयोजित क्षमता विकास कार्यक्रम', levels: ['DISTRICT', 'PIA'], hasPhysical: true, unit: 'Programmes' },
  { code: '56-04(03)', parentCode: '56-04', name: 'District-level Capacity Building Programme', nameHindi: 'जनपद स्तर पर आयोजित क्षमता विकास कार्यक्रम', levels: DSC, hasPhysical: true, unit: 'Programmes' },

  { code: '56-05', name: 'Vehicle Expenses', nameHindi: 'वाहन व्यय', levels: ALL },
  { code: '56-06', name: 'Minor Construction / Convergence', nameHindi: 'लघु निर्माण, केन्द्राभिसरण (Convergence)', levels: ALL, hasPhysical: true, unit: 'Works' },
  { code: '56-07', name: 'Maintenance', nameHindi: 'अनुरक्षण', levels: ALL },
  { code: '56-08', name: 'Studies, Evaluation & Monitoring Report Expenses', nameHindi: 'अध्ययन (Studies) तथा मूल्यांकन एवं अनुश्रवण रिपोर्ट व्यय', levels: ALL, hasPhysical: true, unit: 'Studies' },
  { code: '56-09', name: 'Other Expenses', nameHindi: 'अन्य व्यय', levels: ALL },
];

/** Seed rows with defaults filled in and a stable order (the order of the format). */
export const head56SeedRows = () => SEED_HEAD56.map((row, index) => ({
  parentCode: null,
  nameHindi: '',
  hasPhysical: false,
  unit: '',
  allowsDecimal: false,
  ...row,
  sortOrder: index + 1,
  isActive: true,
}));

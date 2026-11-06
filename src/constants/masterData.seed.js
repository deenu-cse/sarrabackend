/**
 * First-run seed for the master collections (districts, blocks, departments,
 * budget heads and their activities). It is only applied to a collection that
 * is still empty, so anything added or edited later through the application is
 * never overwritten. After the first run the database is the source of truth.
 */
import { DISTRICTS } from './districts.constants.js';
import { DEPARTMENTS } from './departments.constants.js';

// Explicit codes: plain 3-letter prefixes would collide (Chamoli / Champawat).
const DISTRICT_CODES = {
  'Almora': 'ALM',
  'Bageshwar': 'BAG',
  'Chamoli': 'CHM',
  'Champawat': 'CHP',
  'Dehradun': 'DEH',
  'Haridwar': 'HAR',
  'Nainital': 'NAI',
  'Pauri Garhwal': 'PAU',
  'Pithoragarh': 'PIT',
  'Rudraprayag': 'RUD',
  'Tehri Garhwal': 'TEH',
  'Udham Singh Nagar': 'USN',
  'Uttarkashi': 'UTT',
};

export const SEED_DISTRICTS = DISTRICTS.map((name) => ({ name, code: DISTRICT_CODES[name] }));

export const SEED_BLOCKS_BY_DISTRICT = {
  'Dehradun': ['Chakrata', 'Vikasnagar', 'Sahaspur', 'Raipur', 'Doiwala', 'Rishikesh', 'Kalsi'],
  'Pauri Garhwal': ['Pauri', 'Kot', 'Srikot', 'Ekeshwar', 'Pabau', 'Bironkhal', 'Thalisain', 'Dwarikhal', 'Jaykhandani', 'Nainidanda', 'Yamkeshwar', 'Pokhara', 'Rikhnikhal', 'Kaljikhal'],
  'Tehri Garhwal': ['Tehri', 'Devprayag', 'Dhanolti', 'Chamba', 'Jakhnidhar', 'Narendra Nagar', 'Bhilangana', 'Pratapnagar'],
  'Uttarkashi': ['Bhatwari', 'Chinyalisaur', 'Dunda', 'Mori', 'Naugaon', 'Purola'],
  'Almora': ['Almora', 'Bhikiasain', 'Dhauladevi', 'Hawalbagh', 'Lamgara', 'Salt', 'Syaldeh', 'Takula'],
  'Nainital': ['Betalghat', 'Bhimtal', 'Dhari', 'Haldwani', 'Kotabagh', 'Okhalkanda', 'Ramnagar', 'Ramgarh'],
  'Chamoli': ['Gairsain', 'Gharat', 'Joshimath', 'Karnprayag', 'Narayanbagar', 'Pokhari', 'Tharali'],
  'Bageshwar': ['Bageshwar', 'Garur', 'Kapkot'],
  'Champawat': ['Barakot', 'Champawat', 'Lohaghat', 'Pati'],
  'Pithoragarh': ['Berinag', 'Dharchula', 'Gangolihat', 'Kanalichhina', 'Munsiari', 'Pithoragarh'],
  'Rudraprayag': ['Augustmuni', 'Jakoli', 'Rudraprayag', 'Ukhimath'],
  'Haridwar': ['Bahadrabad', 'Bhagwanpur', 'Haridwar', 'Khanpur', 'Laksar', 'Narsan', 'Roorkee'],
  'Udham Singh Nagar': ['Bazpur', 'Gadarpur', 'Jaspur', 'Kashipur', 'Khatima', 'Kichha', 'Rudrapur', 'Sitarganj'],
};

export const SEED_DEPARTMENTS = DEPARTMENTS;

const financialOnly = (code, name, nameHindi) => ({
  code, name, nameHindi, unit: 'Rs. Lakh', hasPhysical: false, allowsDecimal: true,
});
const counted = (code, name, nameHindi) => ({
  code, name, nameHindi, unit: 'No.', hasPhysical: true, allowsDecimal: false,
});
const area = (code, name, nameHindi) => ({
  code, name, nameHindi, unit: 'Ha.', hasPhysical: true, allowsDecimal: true,
});

// Heads 55-01 / 55-02 / 55-03 share the same treatment activities (as in MPR Praroop 1A-1C).
const treatmentActivities = (head) => [
  financialOnly(head, 'Expenditure on Detailed Project Report', 'विस्तृत परियोजना रिपोर्ट पर व्यय'),
  counted(`${head}(01)`, 'Contour Trenches', 'समोच्च खनियां / कन्टूर ट्रेंचेज'),
  counted(`${head}(02)`, 'Recharge Pit', 'रिचार्ज पिट'),
  counted(`${head}(03)`, 'Dugout Ponds', 'डग आउट पौण्ड'),
  counted(`${head}(04)`, 'Chal / Khal', 'चाल / खाल'),
  counted(`${head}(05)`, 'Brushwood Check Dam', 'ब्रशवुड चेक डेम'),
  counted(`${head}(06)`, 'Temporary Check Dam (Pirul etc.)', 'अस्थाई चेक डेम (पिरुल आदि)'),
  counted(`${head}(07)`, 'Loose Boulder Check Dam'),
  counted(`${head}(08)`, 'R.R. Dry Check Dam'),
  counted(`${head}(09)`, 'Gabion / Crate Wire Check Dam'),
  counted(`${head}(10)`, 'Cemented Check Dam'),
  area(`${head}(11)`, 'Vegetative Treatment Activities', 'वानस्पतिक उपचार गतिविधि'),
  area(`${head}(12)`, 'Afforestation Activities', 'वनीकरण गतिविधि'),
  area(`${head}(13)`, 'Fodder / Grass Plantation', 'चारा / घास रोपण'),
  area(`${head}(14)`, 'Natural Regeneration (ANR) Activities', 'प्राकृतिक पुनरोत्पादन गतिविधि'),
  area(`${head}(15)`, 'Plantation Activities', 'वृक्षारोपण गतिविधि'),
  area(`${head}(16)`, 'Total Catchment Area Treated', 'उपरोक्त गतिविधियों से कुल उपचारित जल संग्रहण क्षेत्र'),
  financialOnly(`${head}-ME`, 'Monitoring and Evaluation Cost', 'मूल्यांकन एवं अनुश्रवण पर व्यय'),
];

const groundwaterActivities = (head) => [
  financialOnly(head, 'Expenditure on Detailed Project Report', 'प्राथमिक / विस्तृत परियोजना रिपोर्ट पर व्यय'),
  counted(`${head}(01)`, 'Contour Trenches', 'समोच्च खन्तियां / कन्टूर ट्रेंच'),
  counted(`${head}(02)`, 'Recharge Pit', 'रिचार्ज पिट'),
  counted(`${head}(03)`, 'Recharge Shaft', 'रिचार्ज शॉफ्ट'),
  counted(`${head}(04)`, 'Dugout Pond', 'डग आउट पॉण्ड'),
  counted(`${head}(05)`, 'Chal / Khal', 'चाल / खाल'),
  counted(`${head}(06)`, 'Amrit Sarovar (Plains)', 'मैदानी क्षेत्रों में अमृत सरोवर'),
  counted(`${head}(07)`, 'Amrit Sarovar Restoration (Plains)', 'मैदानी क्षेत्रों में अमृत सरोवर का पुनरोद्धार'),
  counted(`${head}(08)`, 'Large Ponds (Plains)', 'मैदानी क्षेत्रों में बड़े तालाब'),
  counted(`${head}(09)`, 'Large Ponds Restoration (Plains)', 'मैदानी क्षेत्रों में बड़े तालाब का पुनरोद्धार'),
  financialOnly(`${head}-ME`, 'Monitoring and Evaluation Cost', 'मूल्यांकन एवं अनुश्रवण पर व्यय'),
];

// Head 55-05: pond and wetland rejuvenation (SARRA format Prarup-1, sheet "HEAD 55-05 FORMAT (PondWetland)").
const pondActivities = (head) => [
  financialOnly(head, 'Expenditure on Detailed Project Report', 'प्राथमिक / विस्तृत परियोजना रिपोर्ट पर व्यय'),
  counted(`${head}(01)`, 'Pre-treatment and Inlet Structures', 'प्री ट्रीटमेंट और इनलेट संरचनाएँ'),
  counted(`${head}(02)`, 'De-silting and Dredging', 'डी-सिल्टिंग और ड्रेजिंग करना'),
  counted(`${head}(03)`, 'Grit Chamber / Screening', 'ग्रिट चेम्बर / स्क्रीनिंग'),
  counted(`${head}(04)`, 'Sedimentation Tank / CW-NTS', 'अवसादन टैंक / CW-NTS'),
  counted(`${head}(05)`, 'Repair and Strengthening of Embankments', 'तटबंधों की मरम्मत एवं सुदृढ़ीकरण / मजबूतीकरण'),
  counted(`${head}(06)`, 'Outlet and Protection Structures', 'आउटलेट और सुरक्षा संरचनाएँ'),
  counted(`${head}(07)`, 'Miscellaneous Works (Sign Boards, Safety Railing, Paver Blocks etc.)', 'विविध कार्य (साइन बोर्ड, सुरक्षा रेलिंग, पेवर ब्लॉक आदि)'),
  area(`${head}(08)`, 'Plantation / Ecological Measures', 'वृक्षारोपण / पारिस्थितिक उपाय'),
  financialOnly(`${head}-ME`, 'Monitoring and Evaluation Cost', 'मूल्यांकन एवं अनुश्रवण पर व्यय'),
];

const withOrder = (activities) => activities.map((a, i) => ({ ...a, sortOrder: i + 1, allowsZero: true, isActive: true }));

export const SEED_HEADS = [
  { code: '55-01', name: 'Spring Treatment', description: 'Springshed rejuvenation works', projectType: 'SPRINGSHED', sortOrder: 1, activities: withOrder(treatmentActivities('55-01')) },
  { code: '55-02', name: 'Rain-fed Stream / River Treatment', description: 'Streamshed treatment works', projectType: 'STREAMSHED', sortOrder: 2, activities: withOrder(treatmentActivities('55-02')) },
  { code: '55-03', name: 'Major River Treatment', description: 'Treatment works on major rivers', projectType: 'STREAMSHED', sortOrder: 3, activities: withOrder(treatmentActivities('55-03')) },
  { code: '55-04', name: 'Groundwater Recharge', description: 'Groundwater recharge works', projectType: 'GROUNDWATER', sortOrder: 4, activities: withOrder(groundwaterActivities('55-04')) },
  { code: '55-05', name: 'Pond / Wetland Rejuvenation', description: 'Pond and wetland treatment works (तालाब / आर्द्रभूमि उपचार)', projectType: 'POND', sortOrder: 5, activities: withOrder(pondActivities('55-05')) },
];

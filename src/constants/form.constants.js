export const SPRING_TYPES = ['Naula', 'Dhara', 'Gadhera/Nala', 'Other'];
export const SPRING_NATURES = ['Perennial', 'Seasonal', 'Dried'];
export const CLEANLINESS_LEVELS = ['Satisfactory', 'Unsatisfactory'];
export const OWNERSHIPS = ['Public', 'Private'];
export const SCHEME_TYPES = ['Single Village', 'Multiple Village'];
export const TYPOLOGIES = ['Contact', 'Depression', 'Fracture/Fault', 'Karst', 'Thermal'];
export const ROCK_TYPES = [
  'Phyllite', 'Schist', 'Shale', 'Sandstone', 'Limestone', 'Granite', 'Gneiss', 'Basalt', 'Quartzite', 'Any other type'
];
export const AQUIFER_TYPES = ['Confined', 'Unconfined', 'Karst'];
export const TOPOGRAPHICAL_FEATURES = ['Hill top', 'Middle of the hill', 'Valley/Bottom of the hill'];
export const ACCESSIBILITIES = ['Easy', 'Moderate', 'Difficult'];
export const SEASONAL_VARIABILITIES = ['High', 'Low'];
export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];
export const DISCHARGE_TRENDS = ['Highly decreased', 'Slightly decreased', 'No change', 'Increased'];
export const WATER_COLOURS = ['Clean', 'Yellowish', 'Reddish', 'Brownish', 'Greyish', 'Greenish', 'Other'];
export const SMELL_ODOURS = ['Agreeable', 'Non-agreeable'];
export const TASTES = ['Objectionable', 'Unobjectionable'];
export const LAND_USES = ['Agriculture', 'Forest', 'Pasture', 'Shrubs', 'Settlement'];
export const DEGREE_OF_THREATS = ['Low', 'Moderate', 'High'];
export const WATER_USAGES = ['Drinking/Cooking', 'Washing/Sanitation', 'Cattles/Livestock', 'Irrigation', 'Industrial', 'Other'];
export const DEPENDENCY_LEVELS = ['Low', 'Moderate', 'High'];
export const OTHER_WATER_SOURCES = ['Other spring', 'Piped supply', 'Hand pump', 'Dugwell', 'Pond', 'Lifting scheme', 'None', 'Other'];
export const ACTIVITY_IDS = [
  'recharge_area', 'contour_trenches', 'recharge_pit', 'dugout_ponds', 'chal_khal',
  'brushwood_dam', 'temp_dam', 'boulder_dam', 'rr_dam', 'gabion_dam', 'cemented_dam',
  'vegetative', 'fodder', 'forestry', 'anr', 'plantation', 'catchment'
];

export const STREAM_DETAILS = [
  'Main Stream', 'Tributaries-1', 'Tributaries-2', 'Tributaries-3'
];
export const STREAM_NATURES = ['Perennial', 'Seasonal', 'Dried'];
export const WATER_USES_STREAM = [
  'Drinking Water', 'Lifting Scheme for Drinking Water',
  'Irrigation Scheme', 'Lift Irrigation Scheme', 'Other', 'None'
];
export const STREAM_ACTIVITY_IDS = [
  '1', '2', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8',
  '2.9', '2.10', '2.11', '2.12', '2.13', '2.14', '2.15', '2.17', '3'
];
export const STREAM_ACTIVITIES = [
  { id: '1', label: 'DPR Preparation', unit: 'Rs. in Lakh', isDPR: true },
  { id: '2', label: 'Interventions/ Activities', isHeader: true },
  { id: '2.1', label: 'Contour Trenches', unit: 'No.' },
  { id: '2.2', label: 'Recharge Pit', unit: 'No.' },
  { id: '2.3', label: 'Dugout Ponds', unit: 'No.' },
  { id: '2.4', label: 'Chal-Khal', unit: 'No.' },
  { id: '2.5', label: 'Brushwood check dam', unit: 'No.' },
  { id: '2.6', label: 'Temporary check dam(Pirul etc.)', unit: 'No.' },
  { id: '2.7', label: 'Loose Boulder check dam', unit: 'No.' },
  { id: '2.8', label: 'RR Dry Check Dam', unit: 'No.' },
  { id: '2.9', label: 'Gabion/ Crate wire check dam', unit: 'No.' },
  { id: '2.10', label: 'Cemented check dam', unit: 'No.' },
  { id: '2.11', label: 'Vegetative Treatment', unit: 'Ha.' },
  { id: '2.12', label: 'Fodder/ Grass Plantation', unit: 'Ha.' },
  { id: '2.13', label: 'Forestry Plantation', unit: 'Ha.' },
  { id: '2.14', label: 'ANR Activities', unit: 'Ha.' },
  { id: '2.15', label: 'Plantation Activities', unit: 'Ha.' },
  { id: '2.17', label: 'Estimated Area of Catchment Treated by above Activities', unit: 'Ha.' },
  { id: '3', label: 'Monitoring & Evaluation **', unit: 'Rs. in Lakh', isMonitoring: true }
];

export const ARS_DETAILS = ['ARS-1','ARS-2','ARS-3','ARS-4'];

export const LAND_OWNERSHIPS = ['Government','Private','Community','Mixed'];

export const LAND_TYPE_DESIGNATIONS = [
  'Revenue','Agricultural','Grazing','Forest',
  'Urban','Barren','Other'
];

export const GROUNDWATER_AVAILABILITY_STATUS = [
  'Safe','Semi-Critical','Critical','Over-exploited'
];

export const WATER_SOURCES_RECHARGE = [
  'Canal','River','Rainwater Runoff','Other'
];

export const GROUNDWATER_USES = [
  'Domestic','Irrigation','Industrial','Other'
];

export const VULNERABILITY_LEVELS = ['Low','Medium','High'];

export const GROUNDWATER_ACTIVITY_IDS = [
  'recharge_shaft','recharge_pit','dugout_ponds','catchment_treated'
];

export const GROUNDWATER_ACTIVITIES = [
  { id: 'recharge_shaft', label: 'Recharge Shaft', unit: 'No.' },
  { id: 'recharge_pit', label: 'Recharge Pit', unit: 'No.' },
  { id: 'dugout_ponds', label: 'Dugout Ponds', unit: 'No.' },
  { id: 'catchment_treated',
    label: 'Estimated Area of Catchment Treated by above Activities',
    unit: 'Ha.' },
];

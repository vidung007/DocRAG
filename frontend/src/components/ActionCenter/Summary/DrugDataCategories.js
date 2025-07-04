// Drug data categories and subcategories for summary display
// This file centralizes the structure of pharmaceutical study data

export const DRUG_CATEGORIES = {
  ProductOverview: 'Product Overview',
  StudyDetails: 'Study Details',
  EfficacyEndpoints: 'Efficacy Endpoints',
  AttackRates: 'Attack Rates',
  RescueMedicationUse: 'Rescue Medication Use',
  AttackParameters: 'Attack Parameters',
  PatientReportedOutcomes: 'Patient Reported Outcomes',
  PharmacokineticsPharmacodynamics: 'Pharmacokinetics and Pharmacodynamics',
  AdditionalExploratoryEndpointsDetails: 'Additional Exploratory Endpoints Details',
  ReferencesAndFootnotes: 'References and Footnotes'
};

// Trial Metadata Categories for page 2
export const TRIAL_METADATA_CATEGORIES = {
  TrialAndProduct: 'Trial and Product Information',
  PatientCriteria: 'Patient Criteria',
  Documentation: 'Documentation'
};

export const DRUG_SUBCATEGORIES = {
  // Product Overview subcategories
  DrugName: 'Drug Name',
  MechanismOfAction: 'Mechanism of Action',
  RouteOfAdministration: 'Route of Administration',
  Company: 'Company',
  LongTermClinicalTrialRegistryNumber: 'Long Term Clinical Trial Registry Number',

  // Study Details subcategories
  StudyType: 'Study Type',
  ClinicalTrialRegistryNumber: 'Clinical Trial Registry Number',
  LongTermStudyDetails: 'Long Term Study Details',
  StudyDesign: 'Study Design',
  EligibilityCriteria: 'Eligibility Criteria',
  TrialDurationWeeks: 'Trial Duration (Weeks)',
  NumberOfPatients: 'Number of Patients',
  StudyStatus: 'Study Status',

  // Efficacy Endpoints subcategories
  PrimaryEndpoints: 'Primary Endpoints',
  SecondaryEndpoints: 'Secondary Endpoints',
  ExploratoryEndpoints: 'Exploratory Endpoints',

  // Attack Rates subcategories
  MeanHAEAttacksPerMonth: 'Mean HAE Attacks/Month',
  LSMHAEAttacksPerMonth: 'LSM HAE Attacks/Month',
  MedianHAEAttacksPerMonth: 'Median HAE Attacks/Month',
  PercentReductionMeanActiveVsPlacebo: 'Percent Reduction Mean Active vs Placebo',
  PercentReductionLSMActiveVsPlacebo: 'Percent Reduction LSM Active vs Placebo',
  PercentReductionMedianActiveVsPlacebo: 'Percent Reduction Median Active vs Placebo',
  PercentReductionMeanFromBaseline: 'Percent Reduction Mean From Baseline',
  PercentReductionMedianFromBaseline: 'Percent Reduction Median From Baseline',
  NumericalReductionMeanFromBaseline: 'Numerical Reduction Mean From Baseline',
  PercentPatients100ReductionVsRunIn: 'Percent Patients 100% Reduction vs Run-In',
  PercentPatients90PlusReduction: 'Percent Patients 90%+ Reduction',
  PercentPatients70PlusReduction: 'Percent Patients 70%+ Reduction',
  PercentPatients50PlusReduction: 'Percent Patients 50%+ Reduction',
  AttackRateOtherTimeFrames: 'Attack Rate Other Time Frames',
  AttackRateByBaselineRate: 'Attack Rate By Baseline Rate',

  // Rescue Medication Use subcategories
  MeanRescueMedicationsPerMonth: 'Mean Rescue Medications/Month',
  AttacksPerMonthRequiringRescue: 'Attacks/Month Requiring Rescue',

  // Attack Parameters subcategories
  SeverityOfAttacks: 'Severity of Attacks',
  DurationOfAttacks: 'Duration of Attacks',
  DaysOfSwellingSymptoms: 'Days of Swelling/Symptoms',
  TimeToFirstAttack: 'Time to First Attack',
  AttacksByLocation: 'Attacks By Location',

  // Patient Reported Outcomes subcategories
  AEQOLScoreChange: 'AE-QoL Score Change',
  PercentRatingGoodOnSGART: 'Percent Rating Good on SG-ART',
  AECTScoreWeek25: 'AECT Score Week 25',
  TSQMDetails: 'TSQM Details',

  // Pharmacokinetics and Pharmacodynamics subcategories
  PKPDDataSummary: 'PK/PD Data Summary',

  // Additional Exploratory Endpoints Details subcategories
  Details: 'Details', // This is generic; consider if more specific sub-keys are needed based on actual data

  // References and Footnotes subcategories
  ReferencesList: 'References List',
  FootnotesList: 'Footnotes List',

  // Trial Metadata subcategories
  NCT: 'NCT Number',
  TrialName: 'Trial Name',
  ProductName: 'Product Name',
  StartDate: 'Start Date',
  EndDate: 'End Date',
  MechanismOfAction: 'Mechanism of Action',
  Age: 'Age',
  HAESubtype: 'HAE Subtype',
  GeographicalLocation: 'Geographical Location',
  SexRestriction: 'Sex Restriction',
  EthnicityRaceRestriction: 'Ethnicity/Race Restriction',
  OtherRelevantRestriction: 'Other Relevant Restriction',
  References: 'References',
  Footnotes: 'Footnotes'
};

// Color coding for different types of endpoints
export const ENDPOINT_COLORS = {
  PRIMARY: '#4CAF50',   // Green
  SECONDARY: '#FF9800', // Orange
  EXPLORATORY: '#FFEB3B' // Yellow
};

const drugData = {
  DRUG_CATEGORIES,
  TRIAL_METADATA_CATEGORIES,
  DRUG_SUBCATEGORIES,
  ENDPOINT_COLORS
};

export default drugData; 
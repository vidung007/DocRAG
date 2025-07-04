import os
import re
import json
import random
import time
from datetime import datetime, timezone
import boto3

# AWS clients
bedrock_agent_runtime_client = boto3.client('bedrock-agent-runtime')
s3_client = boto3.client('s3')

# Environment Variables
KB_ID                 = os.environ['KB_ID']
SUMMARY_MODEL_ID      = os.environ['BEDROCK_SUMMARY_MODEL_ID']
S3_BUCKET_NAME        = os.environ['S3_BUCKET_NAME']
S3_SUMMARY_PREFIX     = os.environ.get('S3_SUMMARY_PREFIX', 'folder-summaries')
AWS_REGION            = os.environ.get('AWS_REGION', boto3.session.Session().region_name)

# Configuration
MAX_RETRIES           = 3
BASE_SLEEP_SECONDS    = 3
PACING_DELAY_SECONDS  = 1.0

# --- Schema definitions (unchanged) ---
KEY_MAP_DEFINITION = {
    "PRODUCT_OVERVIEW_DRUG_NAME": ("ProductOverview", "DrugName"),
    "PRODUCT_OVERVIEW_MECHANISM_OF_ACTION": ("ProductOverview", "MechanismOfAction"),
    "PRODUCT_OVERVIEW_ROUTE_OF_ADMINISTRATION": ("ProductOverview", "RouteOfAdministration"),
    "PRODUCT_OVERVIEW_COMPANY": ("ProductOverview", "Company"),
    "PRODUCT_OVERVIEW_LONG_TERM_REGISTRY_NUMBER": ("ProductOverview", "LongTermClinicalTrialRegistryNumber"),
    "STUDY_DETAILS_STUDY_TYPE": ("StudyDetails", "StudyType"),
    "STUDY_DETAILS_REGISTRY_NUMBER": ("StudyDetails", "ClinicalTrialRegistryNumber"),
    "STUDY_DETAILS_LONG_TERM_DETAILS": ("StudyDetails", "LongTermStudyDetails"),
    "STUDY_DETAILS_DESIGN": ("StudyDetails", "StudyDesign"),
    "STUDY_DETAILS_ELIGIBILITY_CRITERIA": ("StudyDetails", "EligibilityCriteria"),
    "STUDY_DETAILS_TRIAL_DURATION_WEEKS": ("StudyDetails", "TrialDurationWeeks"),
    "STUDY_DETAILS_NUMBER_OF_PATIENTS": ("StudyDetails", "NumberOfPatients"),
    "STUDY_DETAILS_STATUS": ("StudyDetails", "StudyStatus"),
    "EFFICACY_PRIMARY_ENDPOINTS": ("EfficacyEndpoints", "PrimaryEndpoints"),
    "EFFICACY_SECONDARY_ENDPOINTS": ("EfficacyEndpoints", "SecondaryEndpoints"),
    "EFFICACY_EXPLORATORY_ENDPOINTS": ("EfficacyEndpoints", "ExploratoryEndpoints"),
    "ATTACK_RATES_MEAN_HAE_PER_MONTH": ("AttackRates", "MeanHAEAttacksPerMonth"),
    "ATTACK_RATES_LSM_HAE_PER_MONTH": ("AttackRates", "LSMHAEAttacksPerMonth"),
    "ATTACK_RATES_MEDIAN_HAE_PER_MONTH": ("AttackRates", "MedianHAEAttacksPerMonth"),
    "ATTACK_RATES_PERCENT_REDUCTION_MEAN_VS_PLACEBO": ("AttackRates", "PercentReductionMeanActiveVsPlacebo"),
    "ATTACK_RATES_PERCENT_REDUCTION_LSM_VS_PLACEBO": ("AttackRates", "PercentReductionLSMActiveVsPlacebo"),
    "ATTACK_RATES_PERCENT_REDUCTION_MEDIAN_VS_PLACEBO": ("AttackRates", "PercentReductionMedianActiveVsPlacebo"),
    "ATTACK_RATES_PERCENT_REDUCTION_MEAN_FROM_BASELINE": ("AttackRates", "PercentReductionMeanFromBaseline"),
    "ATTACK_RATES_PERCENT_REDUCTION_MEDIAN_FROM_BASELINE": ("AttackRates", "PercentReductionMedianFromBaseline"),
    "ATTACK_RATES_NUMERICAL_REDUCTION_MEAN_FROM_BASELINE": ("AttackRates", "NumericalReductionMeanFromBaseline"),
    "ATTACK_RATES_PERCENT_PATIENTS_100_REDUCTION_VS_RUNIN": ("AttackRates", "PercentPatients100ReductionVsRunIn"),
    "ATTACK_RATES_PERCENT_PATIENTS_90_PLUS_REDUCTION": ("AttackRates", "PercentPatients90PlusReduction"),
    "ATTACK_RATES_PERCENT_PATIENTS_70_PLUS_REDUCTION": ("AttackRates", "PercentPatients70PlusReduction"),
    "ATTACK_RATES_PERCENT_PATIENTS_50_PLUS_REDUCTION": ("AttackRates", "PercentPatients50PlusReduction"),
    "ATTACK_RATES_OTHER_TIME_FRAMES": ("AttackRates", "AttackRateOtherTimeFrames"),
    "ATTACK_RATES_BY_BASELINE_RATE": ("AttackRates", "AttackRateByBaselineRate"),
    "RESCUE_MED_MEAN_PER_MONTH": ("RescueMedicationUse", "MeanRescueMedicationsPerMonth"),
    "RESCUE_MED_ATTACKS_REQUIRING_RESCUE": ("RescueMedicationUse", "AttacksPerMonthRequiringRescue"),
    "ATTACK_PARAMETERS_SEVERITY": ("AttackParameters", "SeverityOfAttacks"),
    "ATTACK_PARAMETERS_DURATION": ("AttackParameters", "DurationOfAttacks"),
    "ATTACK_PARAMETERS_DAYS_SWELLING": ("AttackParameters", "DaysOfSwellingSymptoms"),
    "ATTACK_PARAMETERS_TIME_TO_FIRST_ATTACK": ("AttackParameters", "TimeToFirstAttack"),
    "ATTACK_PARAMETERS_BY_LOCATION": ("AttackParameters", "AttacksByLocation"),
    "PRO_DATA_AE_QOL_CHANGE": ("PatientReportedOutcomes", "AEQOLScoreChange"),
    "PRO_DATA_PERCENT_GOOD_ON_SGART": ("PatientReportedOutcomes", "PercentRatingGoodOnSGART"),
    "PRO_DATA_AECT_SCORE_WEEK_25": ("PatientReportedOutcomes", "AECTScoreWeek25"),
    "PRO_DATA_TSQM_DETAILS": ("PatientReportedOutcomes", "TSQMDetails"),
    "PK_PD_SUMMARY": ("PharmacokineticsPharmacodynamics", "PKPDDataSummary"),
    "ADDITIONAL_EXPLORATORY_ENDPOINTS_DETAILS": ("AdditionalExploratoryEndpointsDetails", "Details"),
    "REFERENCES_LIST": ("ReferencesAndFootnotes", "ReferencesList"),
    "FOOTNOTES_LIST": ("ReferencesAndFootnotes", "FootnotesList")
}

SECTION_BUCKETS_PART1 = {
    "EfficacyEndpoints": [
        "EFFICACY_PRIMARY_ENDPOINTS",
        "EFFICACY_SECONDARY_ENDPOINTS",
        "EFFICACY_EXPLORATORY_ENDPOINTS"
    ],
    "AttackRates": [
        "ATTACK_RATES_MEAN_HAE_PER_MONTH",
        "ATTACK_RATES_LSM_HAE_PER_MONTH",
        "ATTACK_RATES_MEDIAN_HAE_PER_MONTH",
        "ATTACK_RATES_PERCENT_REDUCTION_MEAN_FROM_BASELINE",
        "ATTACK_RATES_PERCENT_REDUCTION_MEDIAN_FROM_BASELINE",
        "ATTACK_RATES_NUMERICAL_REDUCTION_MEAN_FROM_BASELINE",
        "ATTACK_RATES_PERCENT_PATIENTS_100_REDUCTION_VS_RUNIN",
        "ATTACK_RATES_PERCENT_PATIENTS_90_PLUS_REDUCTION",
        "ATTACK_RATES_PERCENT_PATIENTS_70_PLUS_REDUCTION",
        "ATTACK_RATES_PERCENT_PATIENTS_50_PLUS_REDUCTION",
        "ATTACK_RATES_OTHER_TIME_FRAMES",
        "ATTACK_RATES_BY_BASELINE_RATE"
    ],
    "AttackParameters": [
        "ATTACK_PARAMETERS_SEVERITY",
        "ATTACK_PARAMETERS_DURATION",
        "ATTACK_PARAMETERS_DAYS_SWELLING",
        "ATTACK_PARAMETERS_TIME_TO_FIRST_ATTACK",
        "ATTACK_PARAMETERS_BY_LOCATION"
    ],
}

SECTION_BUCKETS_PART2 = {
    "StudyDetails": [
        "STUDY_DETAILS_STUDY_TYPE",
        "STUDY_DETAILS_REGISTRY_NUMBER",
        "STUDY_DETAILS_LONG_TERM_DETAILS",
        "STUDY_DETAILS_DESIGN",
        "STUDY_DETAILS_ELIGIBILITY_CRITERIA",
        "STUDY_DETAILS_TRIAL_DURATION_WEEKS",
        "STUDY_DETAILS_NUMBER_OF_PATIENTS",
        "STUDY_DETAILS_STATUS"
    ],
    "PatientReportedOutcomes": [
        "PRO_DATA_AE_QOL_CHANGE",
        "PRO_DATA_PERCENT_GOOD_ON_SGART",
        "PRO_DATA_AECT_SCORE_WEEK_25",
        "PRO_DATA_TSQM_DETAILS"
    ],
    "RescueMedicationUse": [
        "RESCUE_MED_MEAN_PER_MONTH",
        "RESCUE_MED_ATTACKS_REQUIRING_RESCUE"
    ],
    "PharmacokineticsPharmacodynamics": ["PK_PD_SUMMARY"],
    "AdditionalExploratoryEndpointsDetails": ["ADDITIONAL_EXPLORATORY_ENDPOINTS_DETAILS"],
    "ReferencesAndFootnotes": ["REFERENCES_LIST", "FOOTNOTES_LIST"],
}

METADATA_BUCKET = {
    "TrialAndProduct": ["NCT", "TrialName", "ProductName", "StartDate", "EndDate", "MechanismOfAction"],
    "PatientCriteria": ["Age", "HAESubtype", "GeographicalLocation", "SexRestriction", "EthnicityRaceRestriction", "OtherRelevantRestriction"],
    "Documentation": ["References", "Footnotes"]
}

# --- Helpers ---
def sanitize_filename(s):
    s = str(s)
    s = re.sub(r'\s+', '_', s)
    s = re.sub(r'[^A-Za-z0-9_\-\.]', '', s)
    s = re.sub(r'_+', '_', s)
    return s.strip('_.- ') or "unnamed"

def extract_json_from_response(text):
    try:
        start = text.find('{')
        end   = text.rfind('}')
        if start != -1 and end > start:
            return json.loads(text[start:end+1])
    except Exception:
        pass
    return {}

def invoke_bedrock_with_retry(prompt_text, filt, desc):
    model_arn = SUMMARY_MODEL_ID if SUMMARY_MODEL_ID.startswith("arn:") else f"arn:aws:bedrock:{AWS_REGION}::foundation-model/{SUMMARY_MODEL_ID}"
    for attempt in range(MAX_RETRIES):
        try:
            return bedrock_agent_runtime_client.retrieve_and_generate(
                input={'text': prompt_text},
                retrieveAndGenerateConfiguration={
                    'type': 'KNOWLEDGE_BASE',
                    'knowledgeBaseConfiguration': {
                        'knowledgeBaseId': KB_ID,
                        'modelArn': model_arn,
                        'retrievalConfiguration': {
                            'vectorSearchConfiguration': {'filter': filt, 'numberOfResults': 30}
                        }
                    }
                }
            )
        except bedrock_agent_runtime_client.exceptions.ThrottlingException:
            if attempt < MAX_RETRIES - 1:
                sleep_time = BASE_SLEEP_SECONDS * (2 ** attempt) + random.uniform(0, 1)
                time.sleep(sleep_time)
            else:
                raise
        except Exception:
            raise

# --- Lambda entry point ---
def lambda_handler(event, context):
    user_id      = event['userId']
    folder_id    = event['folderId']
    drug         = event['drugName']
    company      = event['companyName']
    moa          = event['mechanismOfAction']
    study        = event['studyName']
    source_files = event['sourceFiles']

    # Build the Bedrock filter
    dynamic_filter = {'andAll': [
        {'equals': {'key': 'user_id',    'value': user_id}},
        {'equals': {'key': 'folder_id',  'value': folder_id}},
        {'in':     {'key': 'file_name',  'value': source_files}}
    ]}

    # Base document skeleton
    summary_doc = {
        "ProductOverview": {
            "DrugName": drug,
            "Company": company,
            "MechanismOfAction": moa
        },
        "StudyDetails": {
            "StudyType": study
        }
    }

    # Part 1: Efficacy + Attack Rates
    prompt1_schema = {sec: {k: "" for k in keys} for sec, keys in SECTION_BUCKETS_PART1.items()}
    prompt1 = (
        f'For **{drug}** ({study}), extract the fields. '
        "Output **only** valid JSON.\n\n"
        f'{json.dumps(prompt1_schema, indent=2)}'
    )
    resp1 = invoke_bedrock_with_retry(prompt1, dynamic_filter, "Part1")
    data1 = extract_json_from_response(resp1["output"]["text"])
    citations1 = resp1.get("citations", [])
    time.sleep(PACING_DELAY_SECONDS)

    # Part 2: Study Details + Outcomes
    prompt2_schema = {sec: {k: "" for k in keys} for sec, keys in SECTION_BUCKETS_PART2.items()}
    prompt2 = (
        f'For **{drug}** ({study}), extract the fields. '
        "Output **only** valid JSON.\n\n"
        f'{json.dumps(prompt2_schema, indent=2)}'
    )
    resp2 = invoke_bedrock_with_retry(prompt2, dynamic_filter, "Part2")
    data2 = extract_json_from_response(resp2["output"]["text"])
    citations2 = resp2.get("citations", [])
    time.sleep(PACING_DELAY_SECONDS)

    # Part 3: High-Level Metadata
    prompt3_schema = {sec: {k: "" for k in keys} for sec, keys in METADATA_BUCKET.items()}
    prompt3 = (
        f'For study "{study}" ({drug}), extract metadata. '
        "Output **only** valid JSON.\n\n"
        f'{json.dumps(prompt3_schema, indent=2)}'
    )
    resp3 = invoke_bedrock_with_retry(prompt3, dynamic_filter, "Metadata")
    data3 = extract_json_from_response(resp3["output"]["text"])
    citations3 = resp3.get("citations", [])

    # Merge clinical data
    all_clinical = {**data1, **data2}
    for section, keys in {**SECTION_BUCKETS_PART1, **SECTION_BUCKETS_PART2}.items():
        top_key = KEY_MAP_DEFINITION[keys[0]][0]
        if top_key not in summary_doc:
            summary_doc[top_key] = {}
        bucket = all_clinical.get(section, {})
        if isinstance(bucket, dict):
            for llm_key, val in bucket.items():
                if llm_key in KEY_MAP_DEFINITION:
                    _, pretty = KEY_MAP_DEFINITION[llm_key]
                    summary_doc[top_key][pretty] = val

    # Override StudyType
    summary_doc["StudyDetails"]["StudyType"] = study

    # Merge metadata
    metadata_map = {}
    for sec, keys in METADATA_BUCKET.items():
        bucket = data3.get(sec, {})
        if isinstance(bucket, dict):
            metadata_map.update(bucket)
    summary_doc["trialMetadataSummary"] = metadata_map

    # Citations
    summary_doc["__citations__"] = {
        "clinical_part1_citations": citations1,
        "clinical_part2_citations": citations2,
        "metadata_citations": citations3
    }

    # Save JSON to S3
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_name = sanitize_filename(study)
    parts = folder_id.split("/", 1)
    prefix = f"{S3_SUMMARY_PREFIX}/{user_id}/{parts[0]}"
    if len(parts) > 1:
        prefix += f"/{parts[1]}"
    key = f"{prefix}/summary_{safe_name}_{ts}.json"

    s3_client.put_object(
        Bucket=S3_BUCKET_NAME,
        Key=key,
        Body=json.dumps(summary_doc, indent=2).encode("utf-8"),
        ContentType="application/json"
    )
    print(f"✅ Saved summary to s3://{S3_BUCKET_NAME}/{key}")

    # ←── **Return only the S3 pointer** ──→
    return {
        "s3_key":    key,
        "studyName": study
    }

import boto3
import os
import re
from datetime import datetime, timezone
import time
import json
import random

# Initialize AWS clients
bedrock_agent_runtime_client = boto3.client('bedrock-agent-runtime')
s3_client = boto3.client('s3')

# Environment Variables
KB_ID = os.environ.get('KB_ID')
SUMMARY_MODEL_ID = os.environ.get('BEDROCK_SUMMARY_MODEL_ID')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')
S3_SUMMARY_PREFIX = os.environ.get('S3_SUMMARY_PREFIX', 'folder-summaries')
AWS_REGION = os.environ.get('AWS_REGION', boto3.session.Session().region_name)

# Enhanced Configuration for retry and rate limiting
MAX_RETRIES = 3
BASE_SLEEP_SECONDS = 3
MAX_SLEEP_SECONDS = 30
PACING_DELAY_SECONDS = 1.0

# --- FINAL FIX: A more precise JSON extraction function ---
def extract_json_from_response(response_text):
    """
    Extracts a JSON object from a string by finding the first '{' and last '}'.
    This is more reliable than a greedy regex if there's trailing text.
    """
    try:
        start_index = response_text.find('{')
        end_index = response_text.rfind('}')
        
        if start_index != -1 and end_index != -1 and end_index > start_index:
            json_str = response_text[start_index:end_index+1]
            return json.loads(json_str)
        else:
            print(f"    ⚠️ Could not find valid start/end braces in the response.")
            return None
    except json.JSONDecodeError as e:
        print(f"    ⚠️ JSONDecodeError during parsing: {e}. Raw sliced string: {response_text[start_index:end_index+1][:500]}")
        return None
    except Exception as e:
        print(f"    ⚠️ An unexpected error occurred in extract_json_from_response: {e}")
        return None


# --- Global KEY_MAP_DEFINITION (Complete and Unabridged) ---
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

# Using the original two-part buckets for smaller, more reliable prompts
SECTION_BUCKETS_PART1 = {
    "EfficacyEndpoints": [
        "EFFICACY_PRIMARY_ENDPOINTS",
        "EFFICACY_SECONDARY_ENDPOINTS",
        "EFFICACY_EXPLORATORY_ENDPOINTS",
    ],
    "AttackRates": [
        "ATTACK_RATES_MEAN_HAE_PER_MONTH", "ATTACK_RATES_LSM_HAE_PER_MONTH",
        "ATTACK_RATES_MEDIAN_HAE_PER_MONTH", "ATTACK_RATES_PERCENT_REDUCTION_MEAN_FROM_BASELINE",
        "ATTACK_RATES_PERCENT_REDUCTION_MEDIAN_FROM_BASELINE", "ATTACK_RATES_NUMERICAL_REDUCTION_MEAN_FROM_BASELINE",
        "ATTACK_RATES_PERCENT_PATIENTS_100_REDUCTION_VS_RUNIN", "ATTACK_RATES_PERCENT_PATIENTS_90_PLUS_REDUCTION",
        "ATTACK_RATES_PERCENT_PATIENTS_70_PLUS_REDUCTION", "ATTACK_RATES_PERCENT_PATIENTS_50_PLUS_REDUCTION",
        "ATTACK_RATES_OTHER_TIME_FRAMES", "ATTACK_RATES_BY_BASELINE_RATE",
    ],
    "AttackParameters": [
        "ATTACK_PARAMETERS_SEVERITY", "ATTACK_PARAMETERS_DURATION", "ATTACK_PARAMETERS_DAYS_SWELLING",
        "ATTACK_PARAMETERS_TIME_TO_FIRST_ATTACK", "ATTACK_PARAMETERS_BY_LOCATION",
    ],
}
SECTION_BUCKETS_PART2 = {
    "StudyDetails": ["STUDY_DETAILS_STUDY_TYPE","STUDY_DETAILS_REGISTRY_NUMBER","STUDY_DETAILS_LONG_TERM_DETAILS","STUDY_DETAILS_DESIGN","STUDY_DETAILS_ELIGIBILITY_CRITERIA","STUDY_DETAILS_TRIAL_DURATION_WEEKS","STUDY_DETAILS_NUMBER_OF_PATIENTS","STUDY_DETAILS_STATUS"],
    "PatientReportedOutcomes": [
    "PRO_DATA_AE_QOL_CHANGE", "PRO_DATA_PERCENT_GOOD_ON_SGART",
    "PRO_DATA_AECT_SCORE_WEEK_25", "PRO_DATA_TSQM_DETAILS",
    ],
    "RescueMedicationUse": ["RESCUE_MED_MEAN_PER_MONTH", "RESCUE_MED_ATTACKS_REQUIRING_RESCUE"],
    "PharmacokineticsPharmacodynamics": ["PK_PD_SUMMARY"],
    "AdditionalExploratoryEndpointsDetails": ["ADDITIONAL_EXPLORATORY_ENDPOINTS_DETAILS"],
    "ReferencesAndFootnotes": ["REFERENCES_LIST", "FOOTNOTES_LIST"],
}

# Schema for the new metadata RAG call
METADATA_BUCKET = {
    "TrialAndProduct": [
        "NCT", "TrialName", "ProductName", "StartDate", "EndDate", "MechanismOfAction"
    ],
    "PatientCriteria": [
        "Age", "HAESubtype", "GeographicalLocation", "SexRestriction",
        "EthnicityRaceRestriction", "OtherRelevantRestriction"
    ],
    "Documentation": ["References", "Footnotes"]
}

def sanitize_filename(s):
    s = str(s)
    s = re.sub(r'\s+', '_', s)
    s = re.sub(r'[^A-Za-z0-9_\-\.]', '', s)
    s = re.sub(r'_+', '_', s)
    s = s.strip('_.- ')
    if not s:
        return "unnamed_study"
    return s
    
def get_filename_from_s3_uri(uri):
    """Extracts the filename from an S3 URI string."""
    if not isinstance(uri, str):
        return ""
    return uri.split('/')[-1]

def parse_product_overviews_text(text):
    products = []
    if "NO_PRIMARY_PRODUCTS_FOUND" in text:
        print("LLM indicated NO_PRIMARY_PRODUCTS_FOUND for product overviews.")
        return products
    product_blocks = text.split("###END_PRODUCT###")
    for i, block in enumerate(product_blocks):
        block = block.strip()
        if not block: continue
        product = {}
        drug_match = re.search(r"Drug:\s*(.*?)(?=\nMechanism of Action:|\nRoute of Administration:|\nCompany:|$)", block, re.IGNORECASE | re.DOTALL)
        moa_match = re.search(r"Mechanism of Action:\s*(.*?)(?=\nRoute of Administration:|\nCompany:|$)", block, re.IGNORECASE | re.DOTALL)
        roa_match = re.search(r"Route of Administration:\s*(.*?)(?=\nCompany:|$)", block, re.IGNORECASE | re.DOTALL)
        company_match = re.search(r"Company:\s*(.*)", block, re.IGNORECASE | re.DOTALL)
        
        if drug_match: product['drug_name'] = drug_match.group(1).strip()
        if moa_match: product['mechanism_of_action'] = moa_match.group(1).strip()
        else: product['mechanism_of_action'] = 'Not specified'
        if roa_match: product['route_of_administration'] = roa_match.group(1).strip()
        else: product['route_of_administration'] = 'Not specified'
        if company_match: product['company_name'] = company_match.group(1).strip()
        
        if product.get('drug_name') and product.get('company_name'):
            products.append(product)
        elif block.strip():
            print(f"     Warning: Could not fully parse product block {i+1}. Drug or Company missing. Block: {block[:200]}...")
    if not products and text.strip() and "NO_PRIMARY_PRODUCTS_FOUND" not in text:
        print(f"Warning: Product overview text present but no products parsed. LLM output: {text[:500]}...")
    return products

def parse_normalization_map_text(text):
    normalization_map = {}
    lines = text.strip().splitlines()
    if not lines and text.strip():
        print(f"Warning: Normalization map text not empty but yielded no lines. Raw text: {text[:500]}")
        return normalization_map
    for i, line in enumerate(lines):
        line = line.strip()
        if not line: continue
        parts = line.split('|', 1)
        if len(parts) == 2:
            original, normalized = parts[0].strip(), parts[1].strip()
            if original and normalized:
                normalization_map[original] = normalized
        elif line.strip():
            print(f"Warning: Could not parse normalization line {i+1} (format error): '{line}'")
    if not normalization_map and text.strip():
        print(f"Warning: Normalization map text processed but map is empty. Raw text: {text[:500]}")
    return normalization_map

def invoke_bedrock_retrieve_and_generate_with_retry(
        prompt_text, knowledge_base_id, model_arn, retrieval_filter, step_description="Bedrock RAG call"):
    """Enhanced retry mechanism with better throttling handling"""
    
    for attempt in range(MAX_RETRIES):
        try:
            response = bedrock_agent_runtime_client.retrieve_and_generate(
                input={'text': prompt_text},
                retrieveAndGenerateConfiguration={
                    'type': 'KNOWLEDGE_BASE',
                    'knowledgeBaseConfiguration': {
                        'knowledgeBaseId': knowledge_base_id,
                        'modelArn': model_arn,
                        'retrievalConfiguration': {
                            'vectorSearchConfiguration': {
                                'filter': retrieval_filter,
                                'numberOfResults':30
                            }
                        }
                    }
                }
            )
            
            response_text = response['output']['text']
            if ("sorry, i am unable to assist" in response_text.lower() or
                "i cannot assist" in response_text.lower() or
                "unable to provide" in response_text.lower()):
                print(f"Warning: LLM declined to assist for {step_description}. Response: {response_text[:200]}...")
                return {'text': 'LLM_DECLINED_TO_ASSIST', 'citations': []}
            
            return {
                'text': response_text,
                'citations': response.get('citations', [])
            }
            
        except bedrock_agent_runtime_client.exceptions.ThrottlingException as e_throttle:
            if attempt < MAX_RETRIES - 1:
                sleep_time = min(
                    (BASE_SLEEP_SECONDS * (2 ** attempt)) + random.uniform(0, 1),
                    MAX_SLEEP_SECONDS
                )
                print(f"ThrottlingException during {step_description} (attempt {attempt+1}/{MAX_RETRIES}). Retrying in {sleep_time:.2f}s...")
                time.sleep(sleep_time)
            else:
                print(f"ThrottlingException on final attempt for {step_description}. Error: {str(e_throttle)}")
                raise
                
        except bedrock_agent_runtime_client.exceptions.AccessDeniedException as e_access:
            print(f"AccessDeniedException during {step_description}: {str(e_access)}. Check IAM permissions for Bedrock, Knowledge Base, and S3 data source.")
            raise
            
        except bedrock_agent_runtime_client.exceptions.ValidationException as e_validation:
            print(f"ValidationException during {step_description}: {str(e_validation)}. Check prompt format and parameters.")
            raise
            
        except Exception as e_other:
            print(f"Unexpected error during {step_description} (attempt {attempt+1}): {str(e_other)}")
            import traceback
            traceback.print_exc()
            if attempt < MAX_RETRIES - 1:
                sleep_time = min(
                    (BASE_SLEEP_SECONDS * (2 ** attempt)) + random.uniform(0, 1),
                    MAX_SLEEP_SECONDS
                )
                print(f"Retrying {step_description} due to {type(e_other).__name__} in {sleep_time:.2f}s...")
                time.sleep(sleep_time)
                continue
            raise
    
    raise Exception(f"Failed {step_description} after {MAX_RETRIES} retries without specific exception.")


def lambda_handler(event, context):
    # 1. INITIAL SETUP & VALIDATION
    missing_env_vars = []
    if not KB_ID: missing_env_vars.append("KB_ID")
    if not SUMMARY_MODEL_ID: missing_env_vars.append("BEDROCK_SUMMARY_MODEL_ID")
    if not S3_BUCKET_NAME: missing_env_vars.append("S3_BUCKET_NAME")

    return_payload = {
        "summaryS3Keys": [], "structuredSummaries": [], "productOverviews": [],
        "message": "", "errorDetails": None, "textSummariesGenerated": 0,
        "normalizationAppliedCount": 0, "uniqueProductsForStudyTypes": 0
    }

    if missing_env_vars:
        error_msg = f"Missing critical environment variables: {', '.join(missing_env_vars)}"
        print(f"ERROR: {error_msg}")
        return_payload["errorDetails"] = error_msg; return_payload["message"] = error_msg
        return {"statusCode": 500, "body": json.dumps(return_payload)}

    user_id = event.get('userId')
    folder_id = event.get('folderId')

    if not user_id or not folder_id:
        error_details = "userId and folderId are required in the event."
        print(f"ERROR: {error_details}")
        return_payload["errorDetails"] = error_details; return_payload["message"] = error_details
        return {"statusCode": 400, "body": json.dumps(return_payload)}

    print(f"Processing request for User: {user_id}, Folder: {folder_id}")
    model_arn = SUMMARY_MODEL_ID if SUMMARY_MODEL_ID.startswith("arn:") else f"arn:aws:bedrock:{AWS_REGION}::foundation-model/{SUMMARY_MODEL_ID}"
    print(f"Using Model ARN: {model_arn}")

    base_retrieval_filter = {'andAll': [{'equals': {'key': 'user_id', 'value': user_id}}, {'equals': {'key': 'folder_id', 'value': folder_id}}]}

    normalization_applied_count = 0
    text_summaries_generated_count = 0
    all_summary_files = []
    aggregated_results_for_frontend = []
    product_overviews_for_output = []

    try:
        # 2. EXTRACT PRODUCT OVERVIEW DETAILS
        print("Step 1: Extracting initial primary product overview details...")
        product_overview_prompt_text = f"""
        You are a clinical research data extraction assistant focused on identifying primary investigational drug products.
        Your task: Identify the main drug products being studied in clinical trials.
        For each PRIMARY drug product (not incidental mentions), extract:
        - Drug Name
        - Mechanism of Action
        - Route of Administration
        - Company Name

        Format each product as:
        Drug: [exact drug name]
        Mechanism of Action: [mechanism or "Not specified"]
        Route of Administration: [route or "Not specified"]
        Company: [company name]
        ###END_PRODUCT###

If no primary products found, respond: NO_PRIMARY_PRODUCTS_FOUND
Focus only on drugs that are the main subject of clinical studies, not drugs mentioned in passing.
"""
        product_overview_result = invoke_bedrock_retrieve_and_generate_with_retry(
            product_overview_prompt_text, KB_ID, model_arn, base_retrieval_filter, "Step 1 Product Overview"
        )
        product_overviews_llm_text = product_overview_result['text']
        if (product_overviews_llm_text == 'LLM_DECLINED_TO_ASSIST' or "NO_PRIMARY_PRODUCTS_FOUND" in product_overviews_llm_text):
            error_details = "No primary products found in documents (Step 1)."
            print(error_details); return_payload["message"] = error_details
            return {"statusCode": 200, "body": json.dumps(return_payload)}

        extracted_products = parse_product_overviews_text(product_overviews_llm_text)
        if not extracted_products:
            error_details = "No product data parsed from LLM output (Step 1)."
            print(error_details); return_payload["message"] = error_details
            return {"statusCode": 200, "body": json.dumps(return_payload)}

        print(f"Found {len(extracted_products)} products before validation.")
        validated_products = [prod for prod in extracted_products if prod.get('drug_name', '').lower() != 'not specified' and prod.get('company_name', '').lower() != 'not specified']
        if not validated_products:
            error_details = "All products filtered out after validation (Step 1)."
            print(error_details); return_payload["message"] = error_details
            return {"statusCode": 200, "body": json.dumps(return_payload)}
        
        extracted_products = validated_products
        print(f"Have {len(extracted_products)} validated products after Step 1.")

        # 3. NORMALIZE COMPANY NAMES
        print("Step 2: Normalizing company names...")
        original_company_names = sorted(list(set(p['company_name'] for p in extracted_products if p.get('company_name'))))
        company_normalization_map = {name: name for name in original_company_names}
        if original_company_names:
            company_list_str = ", ".join(original_company_names)
            normalization_prompt_plain_text = f"""
Normalize these pharmaceutical company names to their standard forms: {company_list_str}
Provide one mapping per line in format: Original Name | Standard Name
"""
            time.sleep(PACING_DELAY_SECONDS)
            normalization_result = invoke_bedrock_retrieve_and_generate_with_retry(
                normalization_prompt_plain_text, KB_ID, model_arn, base_retrieval_filter, "Step 2 Company Normalization"
            )
            if normalization_result['text'] != 'LLM_DECLINED_TO_ASSIST':
                parsed_map = parse_normalization_map_text(normalization_result['text'])
                if parsed_map:
                    company_normalization_map.update(parsed_map)
        products_with_normalized_companies = []
        for prod in extracted_products:
            original_company = prod['company_name']
            normalized_company = company_normalization_map.get(original_company, original_company)
            if original_company != normalized_company:
                normalization_applied_count += 1
            prod["normalized_company_name"] = normalized_company
            products_with_normalized_companies.append(prod)
        return_payload["normalizationAppliedCount"] = normalization_applied_count
        unique_processed_products = {(p.get('drug_name', '').strip().lower(), p.get('normalized_company_name', '').strip().lower()): p for p in products_with_normalized_companies}
        final_products_for_study_type_extraction = list(unique_processed_products.values())
        if not final_products_for_study_type_extraction:
            error_details = "No unique products after normalization (Step 2)."
            print(error_details); return_payload["message"] = error_details
            return {"statusCode": 200, "body": json.dumps(return_payload)}

        # 4. FIND STUDY TYPES AND THEIR SOURCE FILES
        print("Step 3: Finding study types and their source files...")
        products_ready_for_summary_iteration = []
        for product in final_products_for_study_type_extraction:
            drug = product['drug_name']
            company = product.get('normalized_company_name', 'N/A')
            study_type_prompt = f"""
For the drug '{drug}' from '{company}', list *all* distinct study types mentioned, including any trial names or registry IDs (e.g. Phase 3 VANGUARD (NCT04656418), Phase 2 OLE).
Respond only with a comma-separated list—no extra commentary.
"""
            time.sleep(PACING_DELAY_SECONDS)
            study_types_result = invoke_bedrock_retrieve_and_generate_with_retry(
                study_type_prompt, KB_ID, model_arn, base_retrieval_filter, f"Step 3 Study Types ({drug})"
            )
            
            study_to_files_map = {}
            if study_types_result['text'] != 'LLM_DECLINED_TO_ASSIST':
                raw_text = study_types_result['text'].strip()
                if ':' in raw_text: raw_text = raw_text.split(':', 1)[1].strip()
                study_names = [s.strip() for s in raw_text.split(',') if s.strip()]

                citations = study_types_result.get('citations', [])
                for citation in citations:
                    for ref in citation.get('retrievedReferences', []):
                        file_name = ref.get('metadata', {}).get('file_name')
                        if not file_name: continue
                        
                        for study_name in study_names:
                            study_to_files_map.setdefault(study_name, set()).add(file_name)
            
            if study_to_files_map:
                product['study_to_files_map'] = {k: list(v) for k, v in study_to_files_map.items()}
                products_ready_for_summary_iteration.append(product)
                print(f"Found study-to-file map for {drug}: {product['study_to_files_map']}")
            else:
                print(f"No valid study types found for {drug}")

        if not products_ready_for_summary_iteration:
            return_payload["message"] = "Found products, but could not identify specific study types for them."
            return {"statusCode": 200, "body": json.dumps(return_payload)}

        # 5. GENERATE DETAILED SUMMARIES
        print("Step 4: Generating detailed summaries…")
        for product_data in products_ready_for_summary_iteration:
            drug = product_data["drug_name"]
            company = product_data["normalized_company_name"]
            moa = product_data["mechanism_of_action"]
            roa = product_data["route_of_administration"]
            study_map = product_data.get('study_to_files_map', {})
            
            product_overviews_for_output.append({
                "drug_name": drug, "company_name": company,
                "mechanism_of_action": moa, "route_of_administration": roa
            })

            for study, source_files in study_map.items():
                print(f"\n--- Processing {drug} / {study} (Sources: {source_files}) ---")
                
                # --- FIX: Changed 'values' to 'value' ---
                dynamic_filter = {
                    'andAll': [
                        {'equals': {'key': 'user_id', 'value': user_id}},
                        {'equals': {'key': 'folder_id', 'value': folder_id}},
                        {'in': {'key': 'file_name', 'value': source_files}}
                    ]
                }
                
                summary_doc = {"ProductOverview": {"DrugName": drug, "Company": company, "MechanismOfAction": moa, "RouteOfAdministration": roa}, "StudyDetails": {"StudyType": study}}
                all_citations = []
                
                prompt1_schema = {sec: {k: "" for k in keys} for sec, keys in SECTION_BUCKETS_PART1.items()}
                prompt1 = f'For **{drug}** ({study}), extract the fields. It is critically important to output a complete and valid JSON. Schema:\n\n{json.dumps(prompt1_schema, indent=2)}\n\nOutput **only** the JSON.'
                resp1 = invoke_bedrock_retrieve_and_generate_with_retry(prompt1, KB_ID, model_arn, dynamic_filter, f"Step4-Part1({drug}/{study})")
                all_citations.extend(resp1.get("citations", [])); data1 = extract_json_from_response(resp1["text"]) or {}

                time.sleep(PACING_DELAY_SECONDS)
                
                prompt2_schema = {sec: {k: "" for k in keys} for sec, keys in SECTION_BUCKETS_PART2.items()}
                prompt2 = f'For **{drug}** ({study}), extract the fields. It is critically important to output a complete and valid JSON. Schema:\n\n{json.dumps(prompt2_schema, indent=2)}\n\nOutput **only** the JSON.'
                resp2 = invoke_bedrock_retrieve_and_generate_with_retry(prompt2, KB_ID, model_arn, dynamic_filter, f"Step4-Part2({drug}/{study})")
                all_citations.extend(resp2.get("citations", [])); data2 = extract_json_from_response(resp2["text"]) or {}
                
                time.sleep(PACING_DELAY_SECONDS)

                prompt3_schema = {sec: {k: "" for k in keys} for sec, keys in METADATA_BUCKET.items()}
                prompt3 = f'For study "{study}" ({drug}), extract metadata. It is critically important to output a complete and valid JSON. Schema:\n\n{json.dumps(prompt3_schema, indent=2)}\n\nOutput **only** the JSON.'
                resp3 = invoke_bedrock_retrieve_and_generate_with_retry(prompt3, KB_ID, model_arn, dynamic_filter, f"Step4-GMetadata({drug}/{study})")
                all_citations.extend(resp3.get("citations", [])); data3 = extract_json_from_response(resp3["text"]) or {}
                
                # Assemble the final document
                all_clinical_data = {**data1, **data2}
                all_sections = {**SECTION_BUCKETS_PART1, **SECTION_BUCKETS_PART2}
                for sec, keys in all_sections.items():
                    bucket, mapped = all_clinical_data.get(sec, {}), {}
                    if isinstance(bucket, dict):
                        for llm_key, val in bucket.items():
                            if llm_key in KEY_MAP_DEFINITION: _, fld = KEY_MAP_DEFINITION[llm_key]; mapped[fld] = val
                    summary_doc[sec] = mapped

                metadata_summary_mapped = {}
                for sec, keys in METADATA_BUCKET.items():
                    bucket = data3.get(sec, {})
                    if isinstance(bucket, dict): metadata_summary_mapped.update(bucket)
                summary_doc["trialMetadataSummary"] = metadata_summary_mapped
                summary_doc["Citations"] = all_citations

                # Save file
                ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"); safe_study_name = sanitize_filename(study)
                session_part, run_part = folder_id.split('/', 1) if '/' in folder_id else (folder_id, "")
                prefix = f"{S3_SUMMARY_PREFIX}/{user_id}/{session_part}"; 
                if run_part: prefix = f"{prefix}/{run_part}"
                key = f"{prefix}/summary_{safe_study_name}_{ts}.json"
                s3_client.put_object(Bucket=S3_BUCKET_NAME, Key=key, Body=json.dumps(summary_doc, indent=2).encode("utf-8"), ContentType="application/json")
                print("     ✅ Saved", key)
                all_summary_files.append(key); aggregated_results_for_frontend.append(summary_doc); text_summaries_generated_count += 1
        
        # 6. FINALIZE AND RETURN
        return_payload.update({"textSummariesGenerated": text_summaries_generated_count, "summaryS3Keys": all_summary_files, "structuredSummaries": aggregated_results_for_frontend, "productOverviews": list({tuple(sorted(po.items())): po for po in product_overviews_for_output}.values()), "message": f"Processing complete. Generated {text_summaries_generated_count} summaries."})
        return return_payload

    except Exception as e_critical:
        critical_error = f"Critical error during lambda execution: {e_critical}"; print(critical_error); import traceback; traceback.print_exc()
        return_payload["errorDetails"] = critical_error; return_payload["message"] = "A critical error occurred."
        raise e_critical
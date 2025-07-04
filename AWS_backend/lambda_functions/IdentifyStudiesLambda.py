import boto3
import os
import re
import time
import json
import random

# AWS Clients and Environment variables
bedrock_agent_runtime_client = boto3.client('bedrock-agent-runtime')
KB_ID = os.environ.get('KB_ID')
SUMMARY_MODEL_ID = os.environ.get('BEDROCK_SUMMARY_MODEL_ID')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Configuration
MAX_RETRIES = 3
BASE_SLEEP_SECONDS = 3
PACING_DELAY_SECONDS = 1.0

def invoke_bedrock_with_retry(prompt_text, filter, step_description):
    model_arn = SUMMARY_MODEL_ID if SUMMARY_MODEL_ID.startswith("arn:") else f"arn:aws:bedrock:{AWS_REGION}::foundation-model/{SUMMARY_MODEL_ID}"
    for attempt in range(MAX_RETRIES):
        try:
            response = bedrock_agent_runtime_client.retrieve_and_generate(
                input={'text': prompt_text},
                retrieveAndGenerateConfiguration={
                    'type': 'KNOWLEDGE_BASE',
                    'knowledgeBaseConfiguration': {
                        'knowledgeBaseId': KB_ID,
                        'modelArn': model_arn,
                        'retrievalConfiguration': {
                            'vectorSearchConfiguration': {
                                'filter': filter,
                                'numberOfResults': 30
                            }
                        }
                    }
                }
            )
            return response
        except bedrock_agent_runtime_client.exceptions.ThrottlingException as e:
            if attempt < MAX_RETRIES - 1:
                sleep_time = (BASE_SLEEP_SECONDS * (2 ** attempt)) + random.uniform(0, 1)
                print(f"ThrottlingException during {step_description}. Retrying in {sleep_time:.2f}s...")
                time.sleep(sleep_time)
            else:
                raise e
        except Exception as e:
            print(f"Error during {step_description}: {e}")
            raise e
    raise Exception(f"Failed {step_description} after retries.")

def parse_product_overviews_text(text):
    products = []
    if "NO_PRIMARY_PRODUCTS_FOUND" in text:
        return products
    for block in text.split("###END_PRODUCT###"):
        if not block.strip():
            continue
        product = {}
        drug_match = re.search(r"Drug:\s*(.*?)(?=\nMechanism of Action:|\nCompany:|$)", block, re.IGNORECASE | re.DOTALL)
        moa_match = re.search(r"Mechanism of Action:\s*(.*?)(?=\nCompany:|$)", block, re.IGNORECASE | re.DOTALL)
        company_match = re.search(r"Company:\s*(.*)", block, re.IGNORECASE | re.DOTALL)
        if drug_match:
            product['drug_name'] = drug_match.group(1).strip()
        if moa_match:
            product['mechanism_of_action'] = moa_match.group(1).strip()
        if company_match:
            product['company_name'] = company_match.group(1).strip()
        if product.get('drug_name') and product.get('company_name'):
            products.append(product)
    return products

def lambda_handler(event, context):
    user_id = event['userId']
    folder_id = event['folderId']
    print(f"Identifying studies for User: {user_id}, Folder: {folder_id}")
    base_filter = {'andAll': [{'equals': {'key': 'user_id', 'value': user_id}}, {'equals': {'key': 'folder_id', 'value': folder_id}}]}

    # Step 1: Extract Products
    product_prompt = "Identify the main drug products and companies. Format each as:\nDrug: [name]\nMechanism of Action: [moa]\nCompany: [name]\n###END_PRODUCT###\nIf none, respond: NO_PRIMARY_PRODUCTS_FOUND"
    product_result = invoke_bedrock_with_retry(product_prompt, base_filter, "Product Identification")
    extracted_products = parse_product_overviews_text(product_result['output']['text'])
    
    if not extracted_products:
        return {"studies": [], "productOverviews": []}

    main_product = extracted_products[0]
    drug, company, moa = main_product['drug_name'], main_product['company_name'], main_product.get('mechanism_of_action', '')
    product_overview = [{"drug_name": drug, "company_name": company, "mechanism_of_action": moa}]

    # Step 2: Get a unique list of all study names
    all_found_study_names = set()
    study_type_prompt = f"For drug '{drug}', list *all* distinct study types mentioned (e.g., Phase 3 VANGUARD). Respond only with a comma-separated list."
    study_types_result = invoke_bedrock_with_retry(study_type_prompt, base_filter, f"Study Type for {drug}")
    raw_text = study_types_result['output']['text'].strip()
    if ':' in raw_text:
        raw_text = raw_text.split(':', 1)[1].strip()
    study_names = [s.strip() for s in raw_text.split(',') if s.strip()]
    for name in study_names:
        all_found_study_names.add(name)
        
    # Step 3: For each unique study name, find its specific source file(s)
    study_to_files_map = {}
    for study_name in all_found_study_names:
        source_file_prompt = f"Which source file name contains the exact phrase or study identifier '{study_name}'? Respond with only the filename(s)."
        time.sleep(PACING_DELAY_SECONDS)
        source_file_result = invoke_bedrock_with_retry(source_file_prompt, base_filter, f"Source File for {study_name}")
        
        source_files = set()
        citations = source_file_result.get('citations', [])
        if citations:
            for citation in citations:
                for ref in citation.get('retrievedReferences', []):
                    if file_name := ref.get('metadata', {}).get('file_name'):
                        source_files.add(file_name)
        
        if source_files:
            study_to_files_map[study_name] = list(source_files)
    
    print(f"Final, accurate study-to-file map: {study_to_files_map}")

    # Step 4: Create the final to-do list for the Map state
    studies_to_process = []
    for study_name, files in study_to_files_map.items():
        studies_to_process.append({
            "userId": user_id, "folderId": folder_id,
            "drugName": drug, "companyName": company, "mechanismOfAction": moa,
            "studyName": study_name, "sourceFiles": files
        })
    
    return {"studies": studies_to_process, "productOverviews": product_overview}
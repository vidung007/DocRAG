import json
import boto3
import os
import time
import traceback
import uuid
from io import BytesIO
from datetime import datetime, timezone

# Import Textractor and related classes
from textractor import Textractor
from textractor.data.constants import TextractFeatures
from textractor.entities.bbox import BoundingBox
from textractor.entities.document_entity import DocumentEntity
from textractor.entities.table import Table

# --- Configuration (Environment Variables) ---
DYNAMODB_TABLE_NAME     = os.environ['DYNAMODB_TABLE_NAME']
S3_BUCKET_NAME          = os.environ['S3_BUCKET_NAME']
BEDROCK_REGION          = os.environ.get('BEDROCK_REGION', 'us-east-1')
DESTINATION_S3_BUCKET   = os.environ.get('DESTINATION_S3_BUCKET')
DESTINATION_S3_PREFIX   = os.environ.get('DESTINATION_S3_PREFIX', 'kb-data-source/').strip('/')
KNOWLEDGE_BASE_ID       = os.environ.get('KNOWLEDGE_BASE_ID')
DATA_SOURCE_ID          = os.environ.get('DATA_SOURCE_ID')
MAX_WORDS_PER_CHUNK     = int(os.environ.get('MAX_WORDS_PER_CHUNK', 200))

# --- Initialize AWS Clients ---
s3_client            = boto3.client('s3')
bedrock_agent_client = boto3.client('bedrock-agent', region_name=BEDROCK_REGION)
textractor_client    = Textractor(region_name=os.environ.get('AWS_REGION', BEDROCK_REGION))
dynamodb_resource    = boto3.resource('dynamodb')
file_metadata_table  = dynamodb_resource.Table(DYNAMODB_TABLE_NAME)


# -----------------------------------------------------------------------------
# 1. Helper to extract title/header context
# -----------------------------------------------------------------------------
def get_contextual_metadata(element: DocumentEntity, title_map: dict, header_map: dict) -> tuple[str, str]:
    current_title, current_header = "Default Document Title", "Default Section Header"
    element_pos = (element.page, element.bbox.y)

    for t_pos, t_text in sorted(title_map.items()):
        if t_pos <= element_pos:
            current_title = t_text
        else:
            break

    for h_pos, h_text in sorted(header_map.items()):
        if h_pos <= element_pos:
            current_header = h_text
        else:
            break

    return current_title, current_header


# -----------------------------------------------------------------------------
# 2. Hybrid extraction + chunking (MODIFIED)
# -----------------------------------------------------------------------------
def extract_text_chunks_from_document(s3_bucket_name, s3_object_key, parsed_user_id, parsed_folder_id):
    print(f"Starting Textract processing for s3://{s3_bucket_name}/{s3_object_key}")
    document_chunks_with_metadata = []
    processing_status = {
        "status": "Processing started",
        "error": None,
        "source_s3_bucket": s3_bucket_name,
        "source_s3_key": s3_object_key,
        "chunks_generated": 0
    }

    try:
        document = textractor_client.start_document_analysis(
            file_source=f"s3://{s3_bucket_name}/{s3_object_key}",
            features=[TextractFeatures.LAYOUT, TextractFeatures.TABLES],
            save_image=False
        )
        print(f"Textract analysis completed. Processing {len(document.pages)} pages.")

        if not document.pages:
            processing_status["status"] = "No pages found by Textract"
            return [], processing_status

        all_elements = []
        for page in document.pages:
            all_elements.extend(page.layouts)
            all_elements.extend(page.tables)

        all_elements.sort(key=lambda e: (e.page, e.bbox.y))

        # Build title/header position → text maps
        title_map, header_map = {}, {}
        for item in all_elements:
            if isinstance(item, Table):
                continue
            if item.layout_type == "LAYOUT_TITLE":
                title_map[(item.page, item.bbox.y)] = item.text.strip()
            elif item.layout_type == "LAYOUT_HEADER":
                header_map[(item.page, item.bbox.y)] = item.text.strip()

        # Group elements under the same title/header
        structured_groups = []
        current_group = {"title": "", "header": "", "elements": []}

        for element in all_elements:
            if not element.text.strip() or (not isinstance(element, Table) and element.layout_type == "LAYOUT_TITLE"):
                continue

            cur_title, cur_header = get_contextual_metadata(element, title_map, header_map)

            if (cur_title != current_group["title"] or cur_header != current_group["header"]) \
               and current_group["elements"]:
                structured_groups.append(current_group)
                current_group = {"title": cur_title, "header": cur_header, "elements": []}

            current_group["title"] = cur_title
            current_group["header"] = cur_header
            current_group["elements"].append(element)

        if current_group["elements"]:
            structured_groups.append(current_group)

        # For each group, emit table-chunks and text-chunks
        for group in structured_groups:
            # Collect word details with page numbers
            word_details = []

            for element in group["elements"]:
                if isinstance(element, Table):
                    md = element.to_markdown()
                    if md:
                        # Table chunks are handled separately
                        document_chunks_with_metadata.append({
                            "text": md,
                            "metadata": {
                                "document_title": group["title"],
                                "section_header": "Table",
                                "page_numbers": [element.page],
                                # Tables have a single bounding_boxes entry
                                "bounding_boxes": [{
                                    "page": element.page,
                                    "top": round(element.bbox.y, 4),
                                    "left": round(element.bbox.x, 4),
                                    "width": round(element.bbox.width, 4),
                                    "height": round(element.bbox.height, 4)
                                }],
                                "source_s3_bucket": s3_bucket_name,
                                "source_s3_key": s3_object_key,
                                "user_id": parsed_user_id,
                                "folder_id": parsed_folder_id
                            }
                        })
                else:
                    # For text, create a detailed list of words with their bbox and page
                    element_words = element.text.split()
                    if element_words:
                        word_bbox_width = element.bbox.width / len(element_words)
                        for i, w in enumerate(element_words):
                            word_details.append({
                                "word": w,
                                "page": element.page,
                                "bbox": BoundingBox(
                                    x=element.bbox.x + i * word_bbox_width,
                                    y=element.bbox.y,
                                    width=word_bbox_width,
                                    height=element.bbox.height
                                )
                            })

            # Chunk word_details and calculate per-page bounding boxes
            for i in range(0, len(word_details), MAX_WORDS_PER_CHUNK):
                chunk_slice = word_details[i:i+MAX_WORDS_PER_CHUNK]
                if not chunk_slice:
                    continue

                text = " ".join(item['word'] for item in chunk_slice)
                
                # Group bboxes by page number for this specific chunk
                bboxes_by_page = {}
                for item in chunk_slice:
                    page = item['page']
                    if page not in bboxes_by_page:
                        bboxes_by_page[page] = []
                    bboxes_by_page[page].append(item['bbox'])
                
                # Calculate the enclosing bbox for each page in the chunk
                final_per_page_bboxes = []
                for page, bboxes in bboxes_by_page.items():
                    enclosing_box = BoundingBox.enclosing_bbox(bboxes)
                    final_per_page_bboxes.append({
                        "page": page,
                        "top": round(enclosing_box.y, 4),
                        "left": round(enclosing_box.x, 4),
                        "width": round(enclosing_box.width, 4),
                        "height": round(enclosing_box.height, 4)
                    })
                
                # Get all unique pages for this chunk, sorted
                chunk_pages = sorted(list(bboxes_by_page.keys()))

                document_chunks_with_metadata.append({
                    "text": text,
                    "metadata": {
                        "document_title": group["title"],
                        "section_header": group["header"],
                        "page_numbers": chunk_pages,
                        "bounding_boxes": final_per_page_bboxes, # New metadata key
                        "source_s3_bucket": s3_bucket_name,
                        "source_s3_key": s3_object_key,
                        "user_id": parsed_user_id,
                        "folder_id": parsed_folder_id
                    }
                })

        processing_status["chunks_generated"] = len(document_chunks_with_metadata)
        processing_status["status"] = "Successfully processed and chunks generated"
        print(f"Generated {len(document_chunks_with_metadata)} text chunks with bounding boxes.")

    except Exception as e:
        print(f"Error processing document {s3_object_key}: {e}")
        traceback.print_exc()
        processing_status["error"] = str(e)
        processing_status["status"] = "Error during Textract processing"
        return [], processing_status

    return document_chunks_with_metadata, processing_status


# -----------------------------------------------------------------------------
# 3a. Find any active ingestion job
# -----------------------------------------------------------------------------
def _find_active_ingestion_job_id(knowledge_base_id, data_source_id):
    paginator = bedrock_agent_client.get_paginator('list_ingestion_jobs')
    for page in paginator.paginate(knowledgeBaseId=knowledge_base_id, dataSourceId=data_source_id):
        for job in page.get("ingestionJobSummaries", []):
            if job.get("status") in ("IN_PROGRESS", "STARTING"):
                return job["ingestionJobId"]
    return None


# -----------------------------------------------------------------------------
# 3b. Polling helper to wait for ingestion completion
# -----------------------------------------------------------------------------
def _wait_for_ingestion_completion(kb_id, ds_id, job_id, delay=30, max_attempts=20):
    for attempt in range(1, max_attempts+1):
        resp = bedrock_agent_client.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=ds_id,
            ingestionJobId=job_id
        )
        status = resp["ingestionJob"]["status"]
        print(f"[{attempt}/{max_attempts}] Job {job_id} status: {status}")
        if status in ("COMPLETE", "FAILED"):
            return status
        time.sleep(delay)
    raise TimeoutError(f"Ingestion job {job_id} did not complete after {delay*max_attempts} seconds.")


# -----------------------------------------------------------------------------
# 3c. Save chunks and start (or enqueue) ingestion (MODIFIED)
# -----------------------------------------------------------------------------
def save_chunks_for_kb_and_ingest(chunks, s3_object_key, processing_status_obj):
    if not all([DESTINATION_S3_BUCKET, KNOWLEDGE_BASE_ID, DATA_SOURCE_ID]):
        err = "Missing DESTINATION_S3_BUCKET, KNOWLEDGE_BASE_ID, or DATA_SOURCE_ID"
        print(f"CRITICAL: {err}")
        processing_status_obj["error"] = err
        return False

    if not chunks:
        print(f"No chunks to save for {s3_object_key}. Skipping ingestion.")
        return True

    file_name = os.path.basename(s3_object_key)
    prefix = os.path.join(DESTINATION_S3_PREFIX, s3_object_key)

    print(f"Saving {len(chunks)} chunks to s3://{DESTINATION_S3_BUCKET}/{prefix}/")
    for idx, chunk in enumerate(chunks):
        text_key = f"{prefix}/chunk_{idx:04d}.txt"
        meta_key = f"{text_key}.metadata.json"
        metadata = chunk["metadata"]
        
        # Handle the new 'bounding_boxes' list
        bboxes = metadata.get("bounding_boxes", [])

        kb_attrs = {
            "user_id": str(metadata.get("user_id", "N/A")).strip(),
            "folder_id": str(metadata.get("folder_id", "N/A")).strip(),
            "file_name": file_name,
            "original_s3_key": f"s3://{metadata.get('source_s3_bucket')}/{metadata.get('source_s3_key')}",
            "document_title": metadata.get("document_title", ""),
            "section_header": metadata.get("section_header", ""),
            "page_numbers": ", ".join(map(str, metadata.get("page_numbers", []))),
            # Serialize the list of bounding boxes into a JSON string for the metadata file
            "bounding_boxes": json.dumps(bboxes) if bboxes else None
        }
        
        # drop any None values
        kb_attrs = {k: v for k, v in kb_attrs.items() if v is not None}

        try:
            s3_client.put_object(
                Bucket=DESTINATION_S3_BUCKET,
                Key=text_key,
                Body=chunk["text"].encode("utf-8")
            )
            s3_client.put_object(
                Bucket=DESTINATION_S3_BUCKET,
                Key=meta_key,
                Body=json.dumps({"metadataAttributes": kb_attrs}, indent=2).encode("utf-8")
            )
        except Exception as e:
            print(f"Error saving chunk {idx}: {e}")
            processing_status_obj["error"] = str(e)
            return False

    # check for existing ingestion
    print("All chunks saved. Checking for active ingestion jobs…")
    active_id = _find_active_ingestion_job_id(KNOWLEDGE_BASE_ID, DATA_SOURCE_ID)
    if active_id:
        print(f"Found active job {active_id}; polling for completion…")
        try:
            final_status = _wait_for_ingestion_completion(
                KNOWLEDGE_BASE_ID, DATA_SOURCE_ID, active_id
            )
            print(f"Previous ingestion job {active_id} finished with status: {final_status}")
        except Exception as e:
            print(f"Polling error for job {active_id}: {e}")
            # we can continue to start a new one or choose to abort; here we continue

    # start a new ingestion job
    print("Starting new ingestion job.")
    try:
        resp = bedrock_agent_client.start_ingestion_job(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            dataSourceId=DATA_SOURCE_ID,
            clientToken=str(uuid.uuid4())
        )
        ingestion_job = resp.get("ingestionJob", {})
        processing_status_obj["ingestion_job_details"] = ingestion_job
        print(f"Ingestion started: {ingestion_job.get('ingestionJobId')}")
        return True
    except Exception as e:
        print(f"Error starting ingestion job: {e}")
        processing_status_obj["error"] = str(e)
        return False


# -----------------------------------------------------------------------------
# 4. Lambda entry point
# -----------------------------------------------------------------------------
def lambda_handler(event, context):
    original_key = event['s3Key']
    user_id      = event['userId']
    folder_id    = event['folderId']
    session_id   = event.get('sessionId', 'unknown_session')
    file_name    = event.get('fileName', os.path.basename(original_key))

    print(f"Triggered for file: {original_key} (user={user_id}, folder={folder_id})")

    status_rec = {
        "sessionId#fileName": f"{session_id}#{file_name}",
        "parsed_user_id":     user_id,
        "parsed_folder_id":   folder_id,
        "source_s3_key":      original_key
    }

    try:
        if not original_key.lower().endswith(('.pdf','.png','.jpg','.jpeg','.txt','.md','.html','.doc','.docx','.csv','.xls','.xlsx')):
            raise ValueError(f"Unsupported file type: {original_key}")

        chunks, ext_status = extract_text_chunks_from_document(
            S3_BUCKET_NAME, original_key, user_id, folder_id
        )
        if ext_status.get("error") or not chunks:
            raise RuntimeError(f"Extraction error: {ext_status.get('status')}")

        save_ok = save_chunks_for_kb_and_ingest(chunks, original_key, status_rec)
        if not save_ok:
            raise RuntimeError(f"Save/ingest error: {status_rec.get('error')}")

        job_details = status_rec.get("ingestion_job_details", {})
        file_metadata_table.put_item(Item={
            'sessionId#fileName': status_rec["sessionId#fileName"],
            'ingestionJobId':     job_details.get("ingestionJobId"),
            'userId':             user_id,
            'folderId':           folder_id,
            'sourceS3Key':        original_key,
            'chunksCount':        len(chunks),
            'startedAtUtc':       datetime.now(timezone.utc).isoformat(),
            'status':             job_details.get("status", "STARTED")
        })

        return {
            'statusCode': 200,
            'body': json.dumps(f"Ingestion started for {original_key}")
        }

    except Exception as e:
        print(f"Lambda handler failed for {original_key}: {e}")
        traceback.print_exc()
        file_metadata_table.put_item(Item={
            'sessionId#fileName': status_rec["sessionId#fileName"],
            'userId':             user_id,
            'folderId':           folder_id,
            'sourceS3Key':        original_key,
            'status':             'FAILED',
            'error':              str(e),
            'startedAtUtc':       datetime.now(timezone.utc).isoformat()
        })
        # re-raise to mark the Lambda as failed
        raise
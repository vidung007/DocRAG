import os
import json
import boto3
from datetime import datetime, timezone

# AWS client
s3_client = boto3.client('s3')

# Environment
S3_BUCKET_NAME    = os.environ['S3_BUCKET_NAME']
S3_SUMMARY_PREFIX = os.environ.get('S3_SUMMARY_PREFIX', 'folder-summaries')

def lambda_handler(event, context):
    """
    event == [
      { "s3_key": "folder-summaries/…/summary_studyA_20250622T...Z.json", "studyName": "Study A" },
      …
    ]
    """
    structured = []

    for ptr in event:
        key = ptr.get('s3_key')
        if not key:
            print(f"⚠️ Missing s3_key in {ptr}")
            continue
        obj = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=key)
        structured.append(json.loads(obj['Body'].read().decode('utf-8')))

    # Write the aggregated list back to S3
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    agg_key = f"{S3_SUMMARY_PREFIX}/aggregated-summaries/{ts}.json"

    s3_client.put_object(
        Bucket=S3_BUCKET_NAME,
        Key=agg_key,
        Body=json.dumps(structured, indent=2).encode('utf-8'),
        ContentType="application/json"
    )
    print(f"✅ Wrote aggregated summaries to s3://{S3_BUCKET_NAME}/{agg_key}")

    # ←── **Return only a small pointer + count** ──→
    return {
        "summaryCount":     len(structured),
        "aggregatedS3Key": agg_key,
        "message":          f"Aggregated {len(structured)} summaries"
    }

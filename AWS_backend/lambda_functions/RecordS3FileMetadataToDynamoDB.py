import json
import boto3
import os
import urllib.parse
from datetime import datetime, timezone

# DynamoDB setup
dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'FileMetadata')
table = dynamodb.Table(TABLE_NAME)

# SYSTEM prefixes to skip entirely
EXCLUDE_PREFIXES = [
    "kb-source/",
    "verification/",
    "textract-output/",
    # add more system prefixes here if needed
]

def lambda_handler(event, context):
    print("Received S3 event:", json.dumps(event, indent=2))
    
    for record in event.get('Records', []):
        try:
            key = urllib.parse.unquote_plus(record['s3']['object']['key'])
            bucket_name = record['s3']['bucket']['name']
            file_size = record['s3']['object'].get('size', 0)

            # 1) Skip any system prefixes
            if any(key.startswith(p) for p in EXCLUDE_PREFIXES):
                print(f"Skipping system object: {key}")
                continue

            # 2) Determine fileType + strip the appropriate prefix
            if key.startswith("folder-summaries/"):
                file_type = "folder_summaries"
                path_after_prefix = key[len("folder-summaries/"):]
            else:
                file_type = "main"
                path_after_prefix = key

            # 3) Expect path_after_prefix = userId/sessionId/userFolder/fileName[...]
            parts = path_after_prefix.split('/', 3)
            if len(parts) < 4 or path_after_prefix.endswith('/'):
                print(f"Skipping invalid structure (needs ≥4 segments): {key}")
                continue

            user_id, session_id, user_folder, file_name = parts

            # 4) Build your sort key and timestamps
            sort_key = f"{session_id}#{user_folder}#{file_name}"
            upload_ts = datetime.now(timezone.utc).isoformat()

            # 5) Compose the DynamoDB item
            item = {
                'userId': user_id,
                'sessionId#fileName': sort_key,
                'originalS3Key': key,
                's3Bucket': bucket_name,
                'sessionId': session_id,
                'userFolder': user_folder,
                'fileName': file_name,
                'fileSize': int(file_size),
                'uploadTimestamp': upload_ts,
                'lastStatusUpdateTimestamp': upload_ts,
                'status': "unprocessed",
                'fileType': file_type
            }

            print("Storing item:", json.dumps(item, indent=2))
            table.put_item(Item=item)
            print(f"Stored metadata for {file_type} → {key}")

        except Exception as e:
            print(f"Error processing record for key={record.get('s3',{}).get('object',{}).get('key')}: {e}", 
                  exc_info=True)
            # Depending on your retry strategy you might choose to continue on error
            raise

    return {
        'statusCode': 200,
        'body': json.dumps('Successfully processed S3 event records.')
    }

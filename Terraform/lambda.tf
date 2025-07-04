# terraform/lambda.tf

# --- Helper to package Lambda code ---
data "archive_file" "record_s3_metadata_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/RecordS3FileMetadataToDynamoDB.py"
  output_path = "${path.module}/lambda_zips/RecordS3FileMetadataToDynamoDB.zip"
}

data "archive_file" "delete_s3_metadata_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/DeleteS3FileMetadataFromDynamoDB.py"
  output_path = "${path.module}/lambda_zips/DeleteS3FileMetadataFromDynamoDB.zip"
}

data "archive_file" "list_user_files_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/ListUserFilesFromDynamoDB.py"
  output_path = "${path.module}/lambda_zips/ListUserFilesFromDynamoDB.zip"
}

data "archive_file" "initiate_folder_processing_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/InitiateFolderProcessingLambda.py"
  output_path = "${path.module}/lambda_zips/InitiateFolderProcessingLambda.zip"
}

data "archive_file" "ingest_file_to_bedrock_kb_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/IngestFileToBedrockKBLambda.py"
  output_path = "${path.module}/lambda_zips/IngestFileToBedrockKBLambda.zip"
}

data "archive_file" "summarize_folder_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/SummarizeFolderLambda.py"
  output_path = "${path.module}/lambda_zips/SummarizeFolderLambda.zip"
}

data "archive_file" "update_folder_metadata_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/UpdateFolderMetadataLambda.py"
  output_path = "${path.module}/lambda_zips/UpdateFolderMetadataLambda.zip"
}

# --- ADDED: Archive files for the new Lambda functions ---
data "archive_file" "identify_studies_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/IdentifyStudiesLambda.py"
  output_path = "${path.module}/lambda_zips/IdentifyStudiesLambda.zip"
}

data "archive_file" "summarize_single_study_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/SummarizeSingleStudyLambda.py"
  output_path = "${path.module}/lambda_zips/SummarizeSingleStudyLambda.zip"
}

data "archive_file" "aggregate_results_zip" {
  type        = "zip"
  source_file = "../AWS_backend/lambda_functions/AggregateResultsLambda.py"
  output_path = "${path.module}/lambda_zips/AggregateResultsLambda.zip"
}


# --- Lambda Functions ---

resource "aws_lambda_function" "record_s3_metadata_lambda" {
  function_name    = "${var.project_name}-RecordS3FileMetadata"
  handler          = "RecordS3FileMetadataToDynamoDB.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 3
  memory_size      = 128
  filename         = data.archive_file.record_s3_metadata_zip.output_path
  source_code_hash = data.archive_file.record_s3_metadata_zip.output_base64sha256
  environment {
    variables = { DYNAMODB_TABLE_NAME = aws_dynamodb_table.file_metadata_table.name }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "delete_s3_metadata_lambda" {
  function_name    = "${var.project_name}-DeleteS3FileMetadata"
  handler          = "DeleteS3FileMetadataFromDynamoDB.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 3
  memory_size      = 128
  filename         = data.archive_file.delete_s3_metadata_zip.output_path
  source_code_hash = data.archive_file.delete_s3_metadata_zip.output_base64sha256
  environment {
    variables = { DYNAMODB_TABLE_NAME = aws_dynamodb_table.file_metadata_table.name }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "list_user_files_lambda" {
  function_name    = "${var.project_name}-ListUserFiles"
  handler          = "ListUserFilesFromDynamoDB.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 603
  memory_size      = 128
  filename         = data.archive_file.list_user_files_zip.output_path
  source_code_hash = data.archive_file.list_user_files_zip.output_base64sha256
  environment {
    variables = { DYNAMODB_TABLE_NAME = aws_dynamodb_table.file_metadata_table.name }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "initiate_folder_processing_lambda" {
  function_name    = "${var.project_name}-InitiateFolderProcessing"
  handler          = "InitiateFolderProcessingLambda.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 243
  memory_size      = 500
  filename         = data.archive_file.initiate_folder_processing_zip.output_path
  source_code_hash = data.archive_file.initiate_folder_processing_zip.output_base64sha256
  environment {
    variables = {
      S3_BUCKET_NAME    = aws_s3_bucket.main_bucket.bucket
      STATE_MACHINE_ARN = aws_sfn_state_machine.folder_processing_state_machine.id
    }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "ingest_file_to_bedrock_kb_lambda" {
  function_name    = "${var.project_name}-IngestToBedrockKB"
  handler          = "IngestFileToBedrockKBLambda.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 900
  memory_size      = 3008
  filename         = data.archive_file.ingest_file_to_bedrock_kb_zip.output_path
  source_code_hash = data.archive_file.ingest_file_to_bedrock_kb_zip.output_base64sha256
  ephemeral_storage { size = 3000 }

  layers = [
    aws_lambda_layer_version.textractor.arn,
    "arn:aws:lambda:${var.aws_region}:336392948345:layer:AWSSDKPandas-Python312:17",
    aws_lambda_layer_version.json_repair.arn,
  ]
  
  environment {
    variables = {
      BEDROCK_REGION        = var.aws_region
      DYNAMODB_TABLE_NAME   = aws_dynamodb_table.file_metadata_table.name
      KB_ID                 = var.knowledge_base_id
      KB_DATASOURCE_ID      = var.data_source_id
      KB_S3_SOURCE_BUCKET   = aws_s3_bucket.main_bucket.bucket
      KB_S3_SOURCE_PREFIX   = var.s3_kb_source_prefix
      S3_BUCKET_NAME        = aws_s3_bucket.main_bucket.bucket
      DATA_SOURCE_ID        = var.data_source_id
      DESTINATION_S3_BUCKET = aws_s3_bucket.main_bucket.bucket
      DESTINATION_S3_PREFIX = "${var.s3_kb_source_prefix}/"
      KNOWLEDGE_BASE_ID     = var.knowledge_base_id
    }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "summarize_folder_lambda" {
  function_name    = "${var.project_name}-SummarizeFolder"
  handler          = "SummarizeFolderLambda.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 900
  memory_size      = 3000
  filename         = data.archive_file.summarize_folder_zip.output_path
  source_code_hash = data.archive_file.summarize_folder_zip.output_base64sha256

  ephemeral_storage { size = 3000 }

  # UPDATED: Layer is now attached.
  layers = [aws_lambda_layer_version.json_repair.arn]

  environment {
    variables = {
      BEDROCK_SUMMARY_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"
      DYNAMODB_TABLE_NAME      = aws_dynamodb_table.file_metadata_table.name
      S3_BUCKET_NAME           = aws_s3_bucket.main_bucket.bucket
      S3_SUMMARY_PREFIX        = var.s3_folder_summaries_prefix
      SUMMARY_MODEL_ID         = "anthropic.claude-3-sonnet-20240229-v1:0"
      KB_ID                    = var.knowledge_base_id
    }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "update_folder_metadata_lambda" {
  function_name    = "${var.project_name}-UpdateFolderMetadata"
  handler          = "UpdateFolderMetadataLambda.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 243
  memory_size      = 500
  filename         = data.archive_file.update_folder_metadata_zip.output_path
  source_code_hash = data.archive_file.update_folder_metadata_zip.output_base64sha256
  environment {
    variables = { DYNAMODB_TABLE_NAME = aws_dynamodb_table.file_metadata_table.name }
  }
  tags = { Project = var.project_name }
}

# --- ADDED: New Lambda function resources ---

resource "aws_lambda_function" "identify_studies_lambda" {
  function_name    = "${var.project_name}-IdentifyStudiesLambda"
  handler          = "IdentifyStudiesLambda.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 900
  memory_size      = 200
  filename         = data.archive_file.identify_studies_zip.output_path
  source_code_hash = data.archive_file.identify_studies_zip.output_base64sha256
  environment {
    variables = {
      BEDROCK_SUMMARY_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"
      KB_ID                    = var.knowledge_base_id
    }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "summarize_single_study_lambda" {
  function_name    = "${var.project_name}-SummarizeSingleStudyLambda"
  handler          = "SummarizeSingleStudyLambda.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 900
  memory_size      = 1000
  filename         = data.archive_file.summarize_single_study_zip.output_path
  source_code_hash = data.archive_file.summarize_single_study_zip.output_base64sha256

  ephemeral_storage { size = 1000 }

  environment {
    variables = {
      BEDROCK_SUMMARY_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"
      KB_ID                    = var.knowledge_base_id
      S3_BUCKET_NAME           = aws_s3_bucket.main_bucket.bucket
    }
  }
  tags = { Project = var.project_name }
}

resource "aws_lambda_function" "aggregate_results_lambda" {
  function_name    = "${var.project_name}-AggregateResultsLambda"
  handler          = "AggregateResultsLambda.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec_role.arn
  timeout          = 900
  memory_size      = 200
  filename         = data.archive_file.aggregate_results_zip.output_path
  source_code_hash = data.archive_file.aggregate_results_zip.output_base64sha256

  environment {
    variables = {
      S3_BUCKET_NAME           = aws_s3_bucket.main_bucket.bucket
    }
  }

  tags = { Project = var.project_name }
}

# --- Asynchronous Invocation Configuration for all functions ---
resource "aws_lambda_function_event_invoke_config" "record_s3_metadata_config" {
  function_name          = aws_lambda_function.record_s3_metadata_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "delete_s3_metadata_config" {
  function_name          = aws_lambda_function.delete_s3_metadata_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "list_user_files_config" {
  function_name          = aws_lambda_function.list_user_files_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "initiate_folder_processing_config" {
  function_name          = aws_lambda_function.initiate_folder_processing_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "ingest_file_to_bedrock_kb_config" {
  function_name          = aws_lambda_function.ingest_file_to_bedrock_kb_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "summarize_folder_config" {
  function_name          = aws_lambda_function.summarize_folder_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "update_folder_metadata_config" {
  function_name          = aws_lambda_function.update_folder_metadata_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "identify_studies_config" {
  function_name          = aws_lambda_function.identify_studies_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "summarize_single_study_config" {
  function_name          = aws_lambda_function.summarize_single_study_lambda.function_name
  maximum_retry_attempts = 2
}

resource "aws_lambda_function_event_invoke_config" "aggregate_results_config" {
  function_name          = aws_lambda_function.aggregate_results_lambda.function_name
  maximum_retry_attempts = 2
}

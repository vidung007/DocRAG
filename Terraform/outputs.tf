# terraform/outputs.tf

output "cognito_user_pool_id" {
  description = "The ID of the Cognito User Pool."
  value       = aws_cognito_user_pool.app_user_pool.id
}

output "cognito_user_pool_client_id" {
  description = "The ID of the Cognito User Pool App Client."
  value       = aws_cognito_user_pool_client.app_client.id
}

output "cognito_user_pool_client_secret" {
  description = "The secret of the Cognito User Pool App Client (use with caution)."
  value       = aws_cognito_user_pool_client.app_client.client_secret
  sensitive   = true
}

output "cognito_domain_prefix" {
  description = "The domain prefix for your Cognito User Pool."
  value       = var.cognito_domain_prefix
}

output "main_s3_bucket_name" {
  description = "Name of the main S3 bucket."
  value       = aws_s3_bucket.main_bucket.bucket
}

output "s3_uploads_prefix" {
  description = "The S3 prefix for user uploaded files."
  value       = var.s3_uploads_prefix
}

output "s3_kb_source_prefix" {
  description = "The S3 prefix for Bedrock KB data source files."
  value       = var.s3_kb_source_prefix
}

output "s3_folder_summaries_prefix" {
  description = "The S3 prefix for generated summaries."
  value       = var.s3_folder_summaries_prefix
}

# output "s3_textract_output_prefix" {
#  description = "The S3 prefix for Textract raw output."
#  value       = var.s3_textract_output_prefix
#}


output "api_gateway_invoke_url_prod" {
  description = "The invoke URL for the production stage of the API Gateway."
  # UPDATED: Now references the new HTTP API stage resource.
  value       = aws_apigatewayv2_stage.rag_api_stage.invoke_url
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table for file metadata."
  value       = aws_dynamodb_table.file_metadata_table.name
}

output "bedrock_knowledge_base_id" {
  description = "ID of the Amazon Bedrock Knowledge Base."
  value       = var.knowledge_base_id
}

output "bedrock_knowledge_base_data_source_id" {
  description = "ID of the Amazon Bedrock Knowledge Base Data Source."
  value       = var.data_source_id
}

output "step_functions_state_machine_arn" {
  description = "ARN of the Step Functions State Machine."
  value       = aws_sfn_state_machine.folder_processing_state_machine.id
}

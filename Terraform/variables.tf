# terraform/variables.tf

variable "aws_region" {
  description = "The AWS region to deploy resources in."
  type        = string
  # default     = "us-east-1"
}

variable "project_name" {
  description = "A short name for the project to prefix resource names."
  type        = string
  # default     = "rag-app-new"
}

# --- New Variables for Manually Created Resources ---
variable "knowledge_base_id" {
  type        = string
  description = "The ID of the Bedrock Knowledge Base created manually in the AWS Console."
}

variable "data_source_id" {
  type        = string
  description = "The ID of the Data Source associated with the manual Knowledge Base."
}
# --- End New Variables ---

variable "main_s3_bucket_name" {
  description = "Globally unique name for the single main S3 bucket."
  type        = string
  # default     = "testragbucket1"
}

variable "s3_uploads_prefix" {
  description = "The S3 prefix for user uploaded files within the main bucket."
  type        = string
  default     = ""
}

variable "s3_kb_source_prefix" {
  description = "The S3 prefix for Bedrock KB data source files."
  type        = string
  # default     = "kb-source"
}

variable "s3_folder_summaries_prefix" {
  description = "The S3 prefix for generated summaries within the main bucket."
  type        = string
  # default     = "folder-summaries"
}

# variable "s3_textract_output_prefix" {
#   description = "The S3 prefix for Textract raw output within the main bucket."
#  type        = string
#  default     = "textract-output"
#}

variable "dynamodb_table_name" {
  description = "Name for the DynamoDB metadata table."
  type        = string
  # default     = "FileMetadata"
}

variable "cognito_user_pool_name" {
  description = "Name for the Cognito User Pool."
  type        = string
  # default     = "rag-app-users"
}

variable "cognito_app_client_name" {
  description = "Name for the Cognito User Pool App Client."
  type        = string
  # default     = "rag-app-frontend"
}

# ADDED: Variable for the Cognito domain prefix.
variable "cognito_domain_prefix" {
  description = "A unique domain prefix for the Cognito Hosted UI."
  type        = string
  # IMPORTANT: This must be globally unique across AWS.
  # default     = "test-rag-app-auth-12345" # Change this to something unique
}

# UPDATED: Callback URLs now match your working version.
variable "cognito_redirect_uris" {
  description = "List of allowed callback URLs for Cognito."
  type        = list(string)
  default     = ["http://localhost:3001/callback"]
}

# UPDATED: Logout URLs now match your working version.
variable "cognito_logout_uris" {
  description = "List of allowed logout URLs for Cognito."
  type        = list(string)
  default     = ["http://localhost:3000", "http://localhost:3001"]
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  # default     = "dev2"
}

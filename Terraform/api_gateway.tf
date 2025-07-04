# terraform/api_gateway.tf

# This resource defines the new HTTP API, which is simpler and more modern.
resource "aws_apigatewayv2_api" "rag_api" {
  name          = "${var.project_name}-HttpApi"
  protocol_type = "HTTP"

  # The CORS configuration is now defined directly on the API resource.
  cors_configuration {
    allow_origins = ["http://localhost:3000", "https://meddocs.sriganesh.blog"] # Added both known URLs
    allow_methods = ["GET", "OPTIONS", "POST"]
    allow_headers = ["authorization", "content-type", "x-amz-date", "x-api-key", "x-amz-security-token"]
    max_age       = 3600
  }

  tags = {
    Project = var.project_name
  }
}

# This defines the JWT Authorizer using your Cognito User Pool.
resource "aws_apigatewayv2_authorizer" "cognito_authorizer" {
  api_id           = aws_apigatewayv2_api.rag_api.id
  name             = "${var.project_name}-CognitoAuthorizer"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.app_client.id]
    # UPDATED: The issuer URL now includes the "https://" prefix to be a valid URL.
    issuer   = "https://${aws_cognito_user_pool.app_user_pool.endpoint}"
  }
}

# --- Integrations for Lambda Functions ---

resource "aws_apigatewayv2_integration" "list_files_integration" {
  api_id                 = aws_apigatewayv2_api.rag_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_user_files_lambda.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_integration" "process_folder_integration" {
  api_id                 = aws_apigatewayv2_api.rag_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.initiate_folder_processing_lambda.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

# --- Routes for the API ---

resource "aws_apigatewayv2_route" "myfiles_get_route" {
  api_id    = aws_apigatewayv2_api.rag_api.id
  route_key = "GET /myfiles"
  target    = "integrations/${aws_apigatewayv2_integration.list_files_integration.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_authorizer.id
}

resource "aws_apigatewayv2_route" "processfolder_post_route" {
  api_id    = aws_apigatewayv2_api.rag_api.id
  route_key = "POST /processfolder"
  target    = "integrations/${aws_apigatewayv2_integration.process_folder_integration.id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_authorizer.id
}

# This defines the default stage and enables auto-deployment.
resource "aws_apigatewayv2_stage" "rag_api_stage" {
  api_id      = aws_apigatewayv2_api.rag_api.id
  name        = "$default"
  auto_deploy = true

  # No logging or throttling is configured, matching your working version.

  tags = {
    Project = var.project_name
  }
}

# --- Permissions for API Gateway to invoke Lambdas ---

# Note: The older 'aws_lambda_permission' resource is still used for this.
# The source_arn format is specific to HTTP APIs.

resource "aws_lambda_permission" "apigw_invoke_list_files_lambda" {
  statement_id  = "AllowAPIGWInvokeListFiles"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_user_files_lambda.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_apigatewayv2_api.rag_api.execution_arn}/*"
}

resource "aws_lambda_permission" "apigw_invoke_initiate_folder_processing_lambda" {
  statement_id  = "AllowAPIGWInvokeInitiateFolderProcessing"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.initiate_folder_processing_lambda.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_apigatewayv2_api.rag_api.execution_arn}/*"
}


# REMOVED: All S3 event notification resources have been moved to s3.tf

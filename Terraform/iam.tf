# terraform/iam.tf

# IAM Role for all Lambda functions
resource "aws_iam_role" "lambda_exec_role" {
  name = "${var.project_name}-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      },
    ]
  })

  tags = {
    Project = var.project_name
  }
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Policy for S3, DynamoDB, Bedrock, etc. access for Lambdas
resource "aws_iam_policy" "lambda_custom_policy" {
  name   = "${var.project_name}-lambda-custom-policy"
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow",
        Action   = [
          "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem",
          "dynamodb:Query", "dynamodb:DeleteItem"
        ],
        Resource = aws_dynamodb_table.file_metadata_table.arn
      },
      {
        Effect   = "Allow",
        Action   = [
          "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"
        ],
        Resource = [
          aws_s3_bucket.main_bucket.arn,
          "${aws_s3_bucket.main_bucket.arn}/*"
        ]
      },
      {
        Effect   = "Allow",
        Action   = [
          "bedrock:RetrieveAndGenerate",
          # ADDED: The specific bedrock:Retrieve permission is required.
          "bedrock:Retrieve",
          "bedrock:InvokeModel",
          "bedrock:GetIngestionJob",
          "bedrock:StartIngestionJob",
          "bedrock:ListIngestionJobs"
        ],
        Resource = [
          "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:knowledge-base/*",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/*",
          "arn:aws:bedrock:${var.aws_region}::inference-profile/*"
        ]
      },
      {
        Effect   = "Allow",
        Action   = [
          "textract:StartDocumentTextDetection", "textract:GetDocumentTextDetection",
          "textract:StartDocumentAnalysis", "textract:GetDocumentAnalysis"
        ],
        Resource = "*"
      },
      {
        Effect   = "Allow",
        Action   = "states:StartExecution",
        Resource = aws_sfn_state_machine.folder_processing_state_machine.id
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_custom_policy_attachment" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = aws_iam_policy.lambda_custom_policy.arn
}

# IAM role for Step Functions execution
resource "aws_iam_role" "sfn_exec_role" {
  name = "${var.project_name}-sfn-exec-role"

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
      },
    ]
  })

  tags = {
    Project = var.project_name
  }
}

# Policy for Step Functions to invoke Lambdas and start its own executions.
resource "aws_iam_policy" "sfn_lambda_invoke_policy" {
  name   = "${var.project_name}-sfn-lambda-invoke-policy"
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Sid    = "LambdaInvoke"
        Effect = "Allow"
        Action = "lambda:InvokeFunction"
        Resource = [
          aws_lambda_function.ingest_file_to_bedrock_kb_lambda.arn,
          aws_lambda_function.update_folder_metadata_lambda.arn,
          aws_lambda_function.identify_studies_lambda.arn,
          aws_lambda_function.summarize_single_study_lambda.arn,
          aws_lambda_function.aggregate_results_lambda.arn
        ]
      },
      {
        Sid      = "StepFunctionsStartExecution"
        Effect   = "Allow"
        Action   = "states:StartExecution"
        Resource = aws_sfn_state_machine.folder_processing_state_machine.id
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "sfn_lambda_invoke_attachment" {
  role       = aws_iam_role.sfn_exec_role.name
  policy_arn = aws_iam_policy.sfn_lambda_invoke_policy.arn
}

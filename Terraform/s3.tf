# terraform/s3.tf

# This resource generates a random 6-character string.
resource "random_string" "bucket_suffix" {
  length  = 6
  special = false
  upper   = false
  lower   = true
  numeric = true
}

# This resource creates the main S3 bucket with a unique name.
resource "aws_s3_bucket" "main_bucket" {
  bucket = "${var.main_s3_bucket_name}-${random_string.bucket_suffix.result}"

  tags = {
    Project = var.project_name
    Purpose = "MainApplicationBucket"
  }
}

# This resource sets modern bucket ownership controls.
resource "aws_s3_bucket_ownership_controls" "main_bucket_ownership" {
  bucket = aws_s3_bucket.main_bucket.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# --- CORRECTED: S3 Event Triggers for Lambdas ---

# This single notification resource now handles both create and delete events.
resource "aws_s3_bucket_notification" "main_bucket_notifications" {
  bucket = aws_s3_bucket.main_bucket.id

  # Notification for when an object is created.
  lambda_function {
    lambda_function_arn = aws_lambda_function.record_s3_metadata_lambda.arn
    events              = ["s3:ObjectCreated:*"]
  }

  # Notification for when an object is deleted.
  lambda_function {
    lambda_function_arn = aws_lambda_function.delete_s3_metadata_lambda.arn
    events              = ["s3:ObjectRemoved:*"]
  }

  # This resource must depend on both permissions being created first.
  depends_on = [
    aws_lambda_permission.allow_s3_to_invoke_record_metadata,
    aws_lambda_permission.allow_s3_to_invoke_delete_metadata
  ]
}

# This permission allows S3 to invoke the RecordS3FileMetadataLambda function.
resource "aws_lambda_permission" "allow_s3_to_invoke_record_metadata" {
  statement_id  = "AllowS3InvokeRecordMetadata"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.record_s3_metadata_lambda.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.main_bucket.arn
}

# This permission allows S3 to invoke the DeleteS3FileMetadataLambda function.
resource "aws_lambda_permission" "allow_s3_to_invoke_delete_metadata" {
  statement_id  = "AllowS3InvokeDeleteMetadata"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_s3_metadata_lambda.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.main_bucket.arn
}

# terraform/dynamodb.tf

resource "aws_dynamodb_table" "file_metadata_table" {
  name         = "${var.dynamodb_table_name}-${var.environment}-metadata"
  billing_mode = "PAY_PER_REQUEST"

  # UPDATED: The primary key now matches your working project's schema
  # from the provided screenshot.
  hash_key  = "userId"
  range_key = "sessionId#fileName"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "sessionId#fileName"
    type = "S"
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

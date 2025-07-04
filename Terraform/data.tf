# Get current AWS account ID, region, and other metadata
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
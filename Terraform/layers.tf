# terraform/layers.tf

# This resource creates the json_repair layer from a local zip file.
resource "aws_lambda_layer_version" "json_repair" {
  # Assumes 'json_repair.zip' is in a 'lambda_layers' sub-directory.
  filename            = "${path.module}/lambda_layers/json_repair.zip"
  layer_name          = "${var.project_name}-json_repair"
  compatible_runtimes = ["python3.12"]
}

# This resource creates the textractor layer from a local zip file.
resource "aws_lambda_layer_version" "textractor" {
  # Assumes 'textractor-layer-py312.zip' is in a 'lambda_layers' sub-directory.
  filename            = "${path.module}/lambda_layers/textractor-layer-py312.zip"
  layer_name          = "${var.project_name}-textractor-py312"
  compatible_runtimes = ["python3.12"]
}

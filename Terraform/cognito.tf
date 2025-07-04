# terraform/cognito.tf

resource "aws_cognito_user_pool" "app_user_pool" {
  name = var.cognito_user_pool_name

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  mfa_configuration = "OFF"

  # UPDATED: Allows users to sign in with their email address as an alias to their username.
  alias_attributes = ["email"]
  
  # When username_attributes is not specified, Cognito defaults to using a separate username.
  # This config makes usernames case-insensitive (standard practice).
  username_configuration {
    case_sensitive = false
  }

  # This ensures the email address is verified upon sign-up.
  auto_verified_attributes = ["email"]
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  # This schema defines the standard email attribute required for sign-up.
  schema {
    attribute_data_type = "String"
    name                = "email"
    mutable             = true
    required            = true
  }
}

resource "aws_cognito_user_pool_client" "app_client" {
  name = var.cognito_app_client_name
  user_pool_id = aws_cognito_user_pool.app_user_pool.id
  generate_secret = true
  
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "phone", "profile"]
  
  callback_urls = var.cognito_redirect_uris
  logout_urls   = var.cognito_logout_uris

  supported_identity_providers = ["COGNITO"]

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_CUSTOM_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]
}

resource "aws_cognito_user_pool_domain" "app_user_pool_domain" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.app_user_pool.id
}
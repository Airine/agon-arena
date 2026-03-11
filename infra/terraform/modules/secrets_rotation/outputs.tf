output "lambda_function_arn" {
  value = aws_lambda_function.rotation.arn
}

output "lambda_role_arn" {
  value = aws_iam_role.rotation_lambda.arn
}

output "jwt_rotation_enabled" {
  value = true
}

output "db_rotation_enabled" {
  value = true
}

output "ed25519_rotation_enabled" {
  value = var.ed25519_key_secret_id != ""
}

output "rotation_errors_alarm_arn" {
  value = aws_cloudwatch_metric_alarm.rotation_errors.arn
}

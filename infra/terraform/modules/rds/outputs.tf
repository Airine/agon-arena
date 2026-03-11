output "endpoint" {
  value     = aws_db_instance.main.endpoint
  sensitive = true
}

output "connection_url" {
  description = "PostgreSQL connection URL for the application"
  value       = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${var.db_name}"
  sensitive   = true
}

output "security_group_id" {
  value = aws_security_group.db.id
}

output "password_secret_arn" {
  value = aws_secretsmanager_secret.db_password.arn
}

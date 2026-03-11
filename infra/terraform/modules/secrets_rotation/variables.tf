variable "name_prefix" {
  type = string
}

variable "secret_arns" {
  description = "List of Secrets Manager secret ARNs the rotation Lambda can access"
  type        = list(string)
}

variable "jwt_secret_id" {
  description = "Secrets Manager secret ID for JWT secret"
  type        = string
}

variable "db_password_secret_id" {
  description = "Secrets Manager secret ID for DB password"
  type        = string
}

variable "db_instance_id" {
  description = "RDS DB instance identifier for password rotation"
  type        = string
}

variable "db_instance_arn" {
  description = "RDS DB instance ARN for IAM policy"
  type        = string
}

variable "jwt_rotation_days" {
  description = "Number of days between JWT secret rotations"
  type        = number
  default     = 30
}

variable "db_rotation_days" {
  description = "Number of days between DB password rotations"
  type        = number
  default     = 90
}

variable "ed25519_key_secret_id" {
  description = "Secrets Manager secret ID for Ed25519 webhook signing key"
  type        = string
  default     = ""
}

variable "ed25519_rotation_days" {
  description = "Number of days between Ed25519 key rotations"
  type        = number
  default     = 90
}

variable "vpc_config" {
  description = "Optional VPC configuration for the rotation Lambda"
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  default = null
}

variable "kms_key_arn" {
  description = "KMS key ARN used to encrypt secrets (Lambda needs decrypt/encrypt access)"
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name for force-new-deployment after DB password rotation"
  type        = string
  default     = ""
}

variable "ecs_service_name" {
  description = "ECS service name for force-new-deployment after DB password rotation"
  type        = string
  default     = ""
}

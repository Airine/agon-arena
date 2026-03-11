variable "name_prefix" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_name" {
  type = string
}

variable "rds_instance_id" {
  type = string
}

variable "elasticache_cluster_id" {
  type = string
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix for CloudWatch metrics (e.g. app/my-alb/1234567890)"
  type        = string
}

variable "target_group_arn_suffix" {
  description = "Target group ARN suffix for CloudWatch metrics"
  type        = string
}

variable "api_log_group_name" {
  description = "CloudWatch log group name for the API container"
  type        = string
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for alarm notifications (empty = no notifications)"
  type        = string
  default     = ""
}

variable "api_cloudfront_distribution_id" {
  description = "CloudFront distribution ID for API"
  type        = string
  default     = ""
}

variable "web_cloudfront_distribution_id" {
  description = "CloudFront distribution ID for web"
  type        = string
  default     = ""
}

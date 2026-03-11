variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project name used as prefix for resources"
  type        = string
  default     = "agon-arena"
}

# VPC
variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ECS
variable "api_cpu" {
  description = "CPU units for API task (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Memory (MiB) for API task"
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Desired number of API tasks"
  type        = number
  default     = 2
}

variable "api_image_tag" {
  description = "Docker image tag for the API"
  type        = string
  default     = "latest"
}

# RDS
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "agon_arena"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "agon"
  sensitive   = true
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Max allocated storage in GB for autoscaling"
  type        = number
  default     = 100
}

# ElastiCache
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_num_cache_nodes" {
  description = "Number of cache nodes"
  type        = number
  default     = 1
}

# Domain
variable "domain_name" {
  description = "Primary domain name"
  type        = string
  default     = "agon.win"
}

variable "api_subdomain" {
  description = "API subdomain"
  type        = string
  default     = "api"
}

# TLS
variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS on ALB"
  type        = string
  default     = ""
}

# CloudFront
variable "cloudfront_acm_certificate_arn" {
  description = "ACM certificate ARN for CloudFront (must be in us-east-1)"
  type        = string
  default     = ""
}

# Route53
variable "create_route53_zone" {
  description = "Whether to create a new Route53 hosted zone (false = use existing)"
  type        = bool
  default     = false
}

# Monitoring
variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarm notifications (empty = alarms fire silently)"
  type        = string
  default     = ""
}

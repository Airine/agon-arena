variable "name_prefix" {
  type = string
}

variable "alb_dns_name" {
  description = "ALB DNS name for the API origin"
  type        = string
}

variable "web_s3_bucket_regional_domain" {
  description = "S3 bucket regional domain name for the web origin"
  type        = string
}

variable "api_domain" {
  description = "Custom domain for the API distribution (e.g., api.agon.win)"
  type        = string
  default     = ""
}

variable "web_domain" {
  description = "Custom domain for the web distribution (e.g., agon.win)"
  type        = string
  default     = ""
}

variable "api_acm_certificate_arn" {
  description = "ACM certificate ARN for the API domain (must be in us-east-1)"
  type        = string
  default     = ""
}

variable "web_acm_certificate_arn" {
  description = "ACM certificate ARN for the web domain (must be in us-east-1)"
  type        = string
  default     = ""
}

variable "waf_acl_arn" {
  description = "WAF Web ACL ARN to associate with CloudFront distributions"
  type        = string
  default     = ""
}

variable "response_headers_policy_id" {
  description = "CloudFront response headers policy ID"
  type        = string
  default     = null
}

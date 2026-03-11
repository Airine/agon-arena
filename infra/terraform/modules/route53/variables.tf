variable "name_prefix" {
  type = string
}

variable "domain_name" {
  description = "Root domain name (e.g., agon.win)"
  type        = string
}

variable "api_subdomain" {
  description = "API subdomain (e.g., api)"
  type        = string
  default     = "api"
}

variable "create_zone" {
  description = "Whether to create a new hosted zone or use an existing one"
  type        = bool
  default     = false
}

variable "web_cloudfront_domain" {
  description = "CloudFront distribution domain name for the web frontend"
  type        = string
  default     = ""
}

variable "web_cloudfront_hosted_zone_id" {
  description = "CloudFront distribution hosted zone ID for the web frontend"
  type        = string
  default     = ""
}

variable "api_cloudfront_domain" {
  description = "CloudFront distribution domain name for the API"
  type        = string
  default     = ""
}

variable "api_cloudfront_hosted_zone_id" {
  description = "CloudFront distribution hosted zone ID for the API"
  type        = string
  default     = ""
}

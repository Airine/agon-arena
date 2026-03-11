variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS. Create with: aws acm request-certificate --domain-name api.agon.win"
  type        = string
  default     = ""
}

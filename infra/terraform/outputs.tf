output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "alb_dns_name" {
  description = "ALB DNS name for the API"
  value       = module.alb.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = module.ecr.repository_url
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.rds.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = module.elasticache.endpoint
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs.service_name
}

output "cloudfront_api_domain" {
  description = "CloudFront distribution domain for the API"
  value       = module.cloudfront.api_distribution_domain
}

output "cloudfront_api_distribution_id" {
  description = "CloudFront distribution ID for the API"
  value       = module.cloudfront.api_distribution_id
}

output "cloudfront_web_domain" {
  description = "CloudFront distribution domain for the web frontend"
  value       = module.cloudfront.web_distribution_domain
}

output "cloudfront_web_distribution_id" {
  description = "CloudFront distribution ID for the web frontend"
  value       = module.cloudfront.web_distribution_id
}

output "web_s3_bucket" {
  description = "S3 bucket name for web static assets"
  value       = module.s3_web.bucket_id
}

output "route53_zone_id" {
  description = "Route53 hosted zone ID"
  value       = module.route53.zone_id
}

output "waf_acl_arn" {
  description = "WAF Web ACL ARN"
  value       = module.waf.acl_arn
}

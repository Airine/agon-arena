output "api_distribution_id" {
  value = aws_cloudfront_distribution.api.id
}

output "api_distribution_domain" {
  value = aws_cloudfront_distribution.api.domain_name
}

output "api_distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.api.hosted_zone_id
}

output "web_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_distribution_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "web_distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.web.hosted_zone_id
}

output "web_distribution_arn" {
  value = aws_cloudfront_distribution.web.arn
}

output "api_distribution_arn" {
  value = aws_cloudfront_distribution.api.arn
}

output "web_oac_id" {
  value = aws_cloudfront_origin_access_control.web.id
}

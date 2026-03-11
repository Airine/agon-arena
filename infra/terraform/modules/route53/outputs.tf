output "zone_id" {
  value = local.zone_id
}

output "web_fqdn" {
  value = length(aws_route53_record.web) > 0 ? aws_route53_record.web[0].fqdn : ""
}

output "api_fqdn" {
  value = length(aws_route53_record.api) > 0 ? aws_route53_record.api[0].fqdn : ""
}

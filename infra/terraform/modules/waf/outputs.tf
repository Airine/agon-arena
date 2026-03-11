output "acl_arn" {
  value = aws_wafv2_web_acl.cloudfront.arn
}

output "acl_id" {
  value = aws_wafv2_web_acl.cloudfront.id
}

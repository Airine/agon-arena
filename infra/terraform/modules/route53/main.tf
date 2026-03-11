# --- Route53 Hosted Zone ---
# Import existing zone or create new one
resource "aws_route53_zone" "main" {
  count = var.create_zone ? 1 : 0

  name    = var.domain_name
  comment = "${var.name_prefix} DNS zone"
}

data "aws_route53_zone" "existing" {
  count = var.create_zone ? 0 : 1

  name         = var.domain_name
  private_zone = false
}

locals {
  zone_id = var.create_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.existing[0].zone_id
}

# --- Web Domain (agon.win → CloudFront Web) ---
resource "aws_route53_record" "web" {
  count = var.web_cloudfront_domain != "" ? 1 : 0

  zone_id = local.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.web_cloudfront_domain
    zone_id                = var.web_cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "web_ipv6" {
  count = var.web_cloudfront_domain != "" ? 1 : 0

  zone_id = local.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = var.web_cloudfront_domain
    zone_id                = var.web_cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

# --- API Domain (api.agon.win → CloudFront API) ---
resource "aws_route53_record" "api" {
  count = var.api_cloudfront_domain != "" ? 1 : 0

  zone_id = local.zone_id
  name    = "${var.api_subdomain}.${var.domain_name}"
  type    = "A"

  alias {
    name                   = var.api_cloudfront_domain
    zone_id                = var.api_cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api_ipv6" {
  count = var.api_cloudfront_domain != "" ? 1 : 0

  zone_id = local.zone_id
  name    = "${var.api_subdomain}.${var.domain_name}"
  type    = "AAAA"

  alias {
    name                   = var.api_cloudfront_domain
    zone_id                = var.api_cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

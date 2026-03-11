# --- CloudFront Origin Access Control (for S3) ---
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# --- API Distribution (ALB origin) ---
resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} API CDN"
  aliases         = var.api_domain != "" ? [var.api_domain] : []
  web_acl_id      = var.waf_acl_arn
  price_class     = "PriceClass_100"

  origin {
    domain_name = var.alb_dns_name
    origin_id   = "alb-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  # Default: API requests
  default_cache_behavior {
    target_origin_id       = "alb-api"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # No caching for API -- forward everything to ALB
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer

    # WebSocket upgrade support
    response_headers_policy_id = var.response_headers_policy_id
  }

  # Health endpoint -- short cache
  ordered_cache_behavior {
    path_pattern           = "/health"
    target_origin_id       = "alb-api"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 10
    max_ttl     = 30
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.api_acm_certificate_arn == "" ? true : false
    acm_certificate_arn            = var.api_acm_certificate_arn != "" ? var.api_acm_certificate_arn : null
    ssl_support_method             = var.api_acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = { Name = "${var.name_prefix}-api-cdn" }
}

# --- Web Distribution (S3 origin) ---
resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${var.name_prefix} Web CDN"
  aliases             = var.web_domain != "" ? [var.web_domain] : []
  web_acl_id          = var.waf_acl_arn
  price_class         = "PriceClass_100"

  origin {
    domain_name              = var.web_s3_bucket_regional_domain
    origin_id                = "s3-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
    origin_request_policy_id = "88a5eaf4-2f7a-4d2b-b694-103afbdbde13" # CORS-S3Origin

    response_headers_policy_id = var.response_headers_policy_id
  }

  # Static assets -- long cache
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 86400
    default_ttl = 31536000
    max_ttl     = 31536000
  }

  # SPA fallback: serve index.html for 403/404
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.web_acm_certificate_arn == "" ? true : false
    acm_certificate_arn            = var.web_acm_certificate_arn != "" ? var.web_acm_certificate_arn : null
    ssl_support_method             = var.web_acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = { Name = "${var.name_prefix}-web-cdn" }
}

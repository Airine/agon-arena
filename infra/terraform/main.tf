locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

# --- VPC & Networking ---
module "vpc" {
  source = "./modules/vpc"

  name_prefix        = local.name_prefix
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

# --- ECR Repository ---
module "ecr" {
  source = "./modules/ecr"

  name_prefix = local.name_prefix
}

# --- RDS PostgreSQL ---
module "rds" {
  source = "./modules/rds"

  name_prefix           = local.name_prefix
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  db_instance_class     = var.db_instance_class
  db_name               = var.db_name
  db_username           = var.db_username
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  ecs_security_group_id = module.ecs.service_security_group_id
}

# --- ElastiCache Redis ---
module "elasticache" {
  source = "./modules/elasticache"

  name_prefix           = local.name_prefix
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  node_type             = var.redis_node_type
  num_cache_nodes       = var.redis_num_cache_nodes
  ecs_security_group_id = module.ecs.service_security_group_id
}

# --- ALB ---
module "alb" {
  source = "./modules/alb"

  name_prefix         = local.name_prefix
  vpc_id              = module.vpc.vpc_id
  public_subnet_ids   = module.vpc.public_subnet_ids
  acm_certificate_arn = var.acm_certificate_arn
}

# --- ECS Fargate ---
module "ecs" {
  source = "./modules/ecs"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  alb_target_group_arn = module.alb.target_group_arn

  ecr_repository_url = module.ecr.repository_url
  api_image_tag      = var.api_image_tag
  api_cpu            = var.api_cpu
  api_memory         = var.api_memory
  api_desired_count  = var.api_desired_count

  database_url       = module.rds.connection_url
  redis_url          = module.elasticache.connection_url
  jwt_secret_arn     = aws_secretsmanager_secret.jwt_secret.arn

  alb_security_group_id = module.alb.security_group_id
}

# --- KMS (secrets encryption key) ---
module "kms" {
  source = "./modules/kms"

  name_prefix                 = local.name_prefix
  ecs_task_execution_role_arn = module.ecs.task_execution_role_arn
}

# --- Secrets Manager ---
resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${local.name_prefix}-jwt-secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id = aws_secretsmanager_secret.jwt_secret.id
  secret_string = jsonencode({
    JWT_SECRET = "CHANGE_ME_ON_FIRST_DEPLOY"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# --- Ed25519 Webhook Signing Key ---
resource "aws_secretsmanager_secret" "ed25519_key" {
  name                    = "${local.name_prefix}-ed25519-key"
  recovery_window_in_days = 7
  kms_master_key_id       = module.kms.key_arn
}

resource "aws_secretsmanager_secret_version" "ed25519_key" {
  secret_id = aws_secretsmanager_secret.ed25519_key.id
  secret_string = jsonencode({
    PRIVATE_KEY = "GENERATE_ON_FIRST_DEPLOY"
    PUBLIC_KEY  = "GENERATE_ON_FIRST_DEPLOY"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# --- WAF (must be us-east-1 for CloudFront) ---
module "waf" {
  source = "./modules/waf"

  name_prefix = local.name_prefix
}

# --- S3 for Web Static Assets ---
module "s3_web" {
  source = "./modules/s3_web"

  name_prefix = local.name_prefix
}

# --- CloudFront CDN ---
module "cloudfront" {
  source = "./modules/cloudfront"

  name_prefix                   = local.name_prefix
  alb_dns_name                  = module.alb.dns_name
  web_s3_bucket_regional_domain = module.s3_web.bucket_regional_domain_name

  api_domain              = var.api_subdomain != "" ? "${var.api_subdomain}.${var.domain_name}" : ""
  web_domain              = var.domain_name
  api_acm_certificate_arn = var.cloudfront_acm_certificate_arn
  web_acm_certificate_arn = var.cloudfront_acm_certificate_arn
  waf_acl_arn             = module.waf.acl_arn
}

# --- S3 Bucket Policy (CloudFront OAC access) ---
resource "aws_s3_bucket_policy" "web_cloudfront" {
  bucket = module.s3_web.bucket_id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${module.s3_web.bucket_arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = module.cloudfront.web_distribution_arn
        }
      }
    }]
  })
}

# --- Monitoring (CloudWatch Dashboard + 10 Alarms) ---
module "monitoring" {
  source = "./modules/monitoring"

  name_prefix             = local.name_prefix
  ecs_cluster_name        = module.ecs.cluster_name
  ecs_service_name        = module.ecs.service_name
  rds_instance_id         = module.rds.instance_id
  elasticache_cluster_id  = module.elasticache.cluster_id
  alb_arn_suffix          = module.alb.arn_suffix
  target_group_arn_suffix = module.alb.target_group_arn_suffix
  api_log_group_name      = module.ecs.log_group_name
  alarm_sns_topic_arn     = var.alarm_sns_topic_arn
  alarm_email             = var.alarm_email

  api_cloudfront_distribution_id = module.cloudfront.api_distribution_id
  web_cloudfront_distribution_id = module.cloudfront.web_distribution_id
}

# --- Secrets Rotation (Lambda: JWT / DB password / Ed25519 key) ---
module "secrets_rotation" {
  source = "./modules/secrets_rotation"

  name_prefix = local.name_prefix

  secret_arns = [
    aws_secretsmanager_secret.jwt_secret.arn,
    module.rds.password_secret_arn,
    aws_secretsmanager_secret.ed25519_key.arn,
  ]

  jwt_secret_id         = aws_secretsmanager_secret.jwt_secret.id
  db_password_secret_id = module.rds.password_secret_arn
  ed25519_key_secret_id = aws_secretsmanager_secret.ed25519_key.id

  db_instance_id  = module.rds.instance_id
  db_instance_arn = module.rds.instance_arn
  kms_key_arn     = module.kms.key_arn

  ecs_cluster_name = module.ecs.cluster_name
  ecs_service_name = module.ecs.service_name

  vpc_config = {
    subnet_ids         = module.vpc.private_subnet_ids
    security_group_ids = [module.ecs.service_security_group_id]
  }
}

# --- Route53 DNS ---
module "route53" {
  source = "./modules/route53"

  name_prefix   = local.name_prefix
  domain_name   = var.domain_name
  api_subdomain = var.api_subdomain
  create_zone   = var.create_route53_zone

  web_cloudfront_domain         = module.cloudfront.web_distribution_domain
  web_cloudfront_hosted_zone_id = module.cloudfront.web_distribution_hosted_zone_id
  api_cloudfront_domain         = module.cloudfront.api_distribution_domain
  api_cloudfront_hosted_zone_id = module.cloudfront.api_distribution_hosted_zone_id
}

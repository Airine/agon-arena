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

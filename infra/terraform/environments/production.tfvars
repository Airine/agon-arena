# Production environment — agon-arena
aws_region   = "us-east-1"
environment  = "production"
project_name = "agon-arena"

# Networking
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# ECS — 1 vCPU / 2 GB, 2 tasks for HA
api_cpu           = 1024
api_memory        = 2048
api_desired_count = 2
api_image_tag     = "latest"

# RDS — r6g.large for production OLTP workloads
db_instance_class        = "db.r6g.large"
db_name                  = "agon_arena"
db_username              = "agon"
db_allocated_storage     = 100
db_max_allocated_storage = 500

# ElastiCache
redis_node_type         = "cache.r6g.large"
redis_num_cache_nodes   = 1

# DNS
domain_name   = "agon.win"
api_subdomain = "api"

# TLS (populate after ACM certificate is issued)
acm_certificate_arn             = ""
cloudfront_acm_certificate_arn  = ""

# Route53
create_route53_zone = false

# Monitoring — SNS topic ARN populated after AGO-98 apply
alarm_sns_topic_arn = ""

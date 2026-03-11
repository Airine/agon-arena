# Staging environment — agon-arena
aws_region   = "us-east-1"
environment  = "staging"
project_name = "agon-arena"

# Networking
vpc_cidr           = "10.1.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# ECS — 0.5 vCPU / 1 GB, 1 task to minimise cost
api_cpu           = 512
api_memory        = 1024
api_desired_count = 1
api_image_tag     = "latest"

# RDS — t3.medium for staging
db_instance_class        = "db.t3.medium"
db_name                  = "agon_arena"
db_username              = "agon"
db_allocated_storage     = 20
db_max_allocated_storage = 100

# ElastiCache
redis_node_type         = "cache.t4g.micro"
redis_num_cache_nodes   = 1

# DNS
domain_name   = "staging.agon.win"
api_subdomain = "api"

# TLS (populate after ACM certificate is issued)
acm_certificate_arn             = ""
cloudfront_acm_certificate_arn  = ""

# Route53
create_route53_zone = false

# Monitoring — SNS topic ARN populated after AGO-98 apply
alarm_sns_topic_arn = ""

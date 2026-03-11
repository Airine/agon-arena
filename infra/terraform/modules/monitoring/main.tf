locals {
  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

# =============================================================================
# CloudWatch Dashboard
# =============================================================================
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.name_prefix}-overview"

  dashboard_body = jsonencode({
    widgets = concat(
      # --- Row 1: ECS Service ---
      [
        {
          type   = "text"
          x      = 0
          y      = 0
          width  = 24
          height = 1
          properties = {
            markdown = "## ECS API Service"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 1
          width  = 8
          height = 6
          properties = {
            title   = "CPU & Memory Utilization"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 300
            metrics = [
              ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.ecs_service_name, { stat = "Average", label = "CPU %" }],
              ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.ecs_service_name, { stat = "Average", label = "Memory %" }],
            ]
            yAxis = { left = { min = 0, max = 100 } }
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 1
          width  = 8
          height = 6
          properties = {
            title   = "Running Task Count"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 60
            metrics = [
              ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.ecs_cluster_name, "ServiceName", var.ecs_service_name, { stat = "Average" }],
            ]
          }
        },
        {
          type   = "log"
          x      = 16
          y      = 1
          width  = 8
          height = 6
          properties = {
            title  = "API Error Logs (last 1h)"
            query  = "SOURCE '${var.api_log_group_name}' | fields @timestamp, @message | filter @message like /error|Error|ERROR/ | sort @timestamp desc | limit 20"
            region = data.aws_region.current.name
            view   = "table"
          }
        },
      ],

      # --- Row 2: ALB ---
      [
        {
          type   = "text"
          x      = 0
          y      = 7
          width  = 24
          height = 1
          properties = {
            markdown = "## Application Load Balancer"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 8
          width  = 8
          height = 6
          properties = {
            title   = "Request Count & Latency"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 60
            metrics = [
              ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", label = "Requests" }],
              ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p99", label = "P99 Latency", yAxis = "right" }],
              ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p50", label = "P50 Latency", yAxis = "right" }],
            ]
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 8
          width  = 8
          height = 6
          properties = {
            title   = "HTTP Error Rates"
            view    = "timeSeries"
            stacked = true
            region  = data.aws_region.current.name
            period  = 60
            metrics = [
              ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", label = "4xx" }],
              ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", label = "5xx", color = "#d62728" }],
            ]
          }
        },
        {
          type   = "metric"
          x      = 16
          y      = 8
          width  = 8
          height = 6
          properties = {
            title   = "Healthy/Unhealthy Hosts"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 60
            metrics = [
              ["AWS/ApplicationELB", "HealthyHostCount", "TargetGroup", var.target_group_arn_suffix, "LoadBalancer", var.alb_arn_suffix, { stat = "Average", label = "Healthy" }],
              ["AWS/ApplicationELB", "UnHealthyHostCount", "TargetGroup", var.target_group_arn_suffix, "LoadBalancer", var.alb_arn_suffix, { stat = "Average", label = "Unhealthy", color = "#d62728" }],
            ]
          }
        },
      ],

      # --- Row 3: RDS ---
      [
        {
          type   = "text"
          x      = 0
          y      = 14
          width  = 24
          height = 1
          properties = {
            markdown = "## RDS PostgreSQL"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 15
          width  = 8
          height = 6
          properties = {
            title   = "CPU & Connections"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 300
            metrics = [
              ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Average", label = "CPU %" }],
              ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Average", label = "Connections", yAxis = "right" }],
            ]
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 15
          width  = 8
          height = 6
          properties = {
            title   = "IOPS"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 300
            metrics = [
              ["AWS/RDS", "ReadIOPS", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Average", label = "Read IOPS" }],
              ["AWS/RDS", "WriteIOPS", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Average", label = "Write IOPS" }],
            ]
          }
        },
        {
          type   = "metric"
          x      = 16
          y      = 15
          width  = 8
          height = 6
          properties = {
            title   = "Free Storage & Memory"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 300
            metrics = [
              ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Average", label = "Free Storage (bytes)" }],
              ["AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", var.rds_instance_id, { stat = "Average", label = "Freeable Memory (bytes)", yAxis = "right" }],
            ]
          }
        },
      ],

      # --- Row 4: Redis ---
      [
        {
          type   = "text"
          x      = 0
          y      = 21
          width  = 24
          height = 1
          properties = {
            markdown = "## ElastiCache Redis"
          }
        },
        {
          type   = "metric"
          x      = 0
          y      = 22
          width  = 8
          height = 6
          properties = {
            title   = "CPU & Memory"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 300
            metrics = [
              ["AWS/ElastiCache", "CPUUtilization", "CacheClusterId", var.elasticache_cluster_id, { stat = "Average", label = "CPU %" }],
              ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "CacheClusterId", var.elasticache_cluster_id, { stat = "Average", label = "Memory %" }],
            ]
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 22
          width  = 8
          height = 6
          properties = {
            title   = "Cache Hit Rate"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 300
            metrics = [
              ["AWS/ElastiCache", "CacheHits", "CacheClusterId", var.elasticache_cluster_id, { stat = "Sum", label = "Hits" }],
              ["AWS/ElastiCache", "CacheMisses", "CacheClusterId", var.elasticache_cluster_id, { stat = "Sum", label = "Misses" }],
            ]
          }
        },
        {
          type   = "metric"
          x      = 16
          y      = 22
          width  = 8
          height = 6
          properties = {
            title   = "Connections & Evictions"
            view    = "timeSeries"
            stacked = false
            region  = data.aws_region.current.name
            period  = 300
            metrics = [
              ["AWS/ElastiCache", "CurrConnections", "CacheClusterId", var.elasticache_cluster_id, { stat = "Average", label = "Connections" }],
              ["AWS/ElastiCache", "Evictions", "CacheClusterId", var.elasticache_cluster_id, { stat = "Sum", label = "Evictions", yAxis = "right" }],
            ]
          }
        },
      ],
    )
  })
}

data "aws_region" "current" {}

# =============================================================================
# CloudWatch Alarms
# =============================================================================

# --- ECS CPU High ---
resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  alarm_name          = "${var.name_prefix}-ecs-cpu-high"
  alarm_description   = "ECS API service CPU utilization > 85% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }
}

# --- ECS Memory High ---
resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  alarm_name          = "${var.name_prefix}-ecs-memory-high"
  alarm_description   = "ECS API service memory utilization > 85% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }
}

# --- ALB 5xx Error Rate ---
resource "aws_cloudwatch_metric_alarm" "alb_5xx_high" {
  alarm_name          = "${var.name_prefix}-alb-5xx-high"
  alarm_description   = "ALB 5xx error count > 10 in 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }
}

# --- ALB P99 Latency ---
resource "aws_cloudwatch_metric_alarm" "alb_latency_high" {
  alarm_name          = "${var.name_prefix}-alb-latency-p99"
  alarm_description   = "ALB P99 target response time > 2 seconds for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 2
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }
}

# --- ALB Unhealthy Hosts ---
resource "aws_cloudwatch_metric_alarm" "alb_unhealthy_hosts" {
  alarm_name          = "${var.name_prefix}-alb-unhealthy-hosts"
  alarm_description   = "ALB has unhealthy targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    TargetGroup  = var.target_group_arn_suffix
    LoadBalancer = var.alb_arn_suffix
  }
}

# --- RDS CPU High ---
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU utilization > 80% for 10 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }
}

# --- RDS Free Storage Low ---
resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${var.name_prefix}-rds-storage-low"
  alarm_description   = "RDS free storage space < 5 GB"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120 # 5 GB in bytes
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }
}

# --- RDS Connections High ---
resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${var.name_prefix}-rds-connections-high"
  alarm_description   = "RDS database connections > 80"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }
}

# --- Redis Memory High ---
resource "aws_cloudwatch_metric_alarm" "redis_memory_high" {
  alarm_name          = "${var.name_prefix}-redis-memory-high"
  alarm_description   = "Redis memory usage > 80%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    CacheClusterId = var.elasticache_cluster_id
  }
}

# --- Redis Evictions ---
resource "aws_cloudwatch_metric_alarm" "redis_evictions" {
  alarm_name          = "${var.name_prefix}-redis-evictions"
  alarm_description   = "Redis evictions detected (memory pressure)"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    CacheClusterId = var.elasticache_cluster_id
  }
}

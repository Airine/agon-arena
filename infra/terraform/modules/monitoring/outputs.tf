output "alarm_sns_topic_arn" {
  description = "ARN of the SNS topic used for CloudWatch alarm notifications"
  value       = aws_sns_topic.alarms.arn
}

output "dashboard_arn" {
  value = aws_cloudwatch_dashboard.main.dashboard_arn
}

output "alarm_arns" {
  value = {
    ecs_cpu_high       = aws_cloudwatch_metric_alarm.ecs_cpu_high.arn
    ecs_memory_high    = aws_cloudwatch_metric_alarm.ecs_memory_high.arn
    alb_5xx_high       = aws_cloudwatch_metric_alarm.alb_5xx_high.arn
    alb_latency_high   = aws_cloudwatch_metric_alarm.alb_latency_high.arn
    alb_unhealthy      = aws_cloudwatch_metric_alarm.alb_unhealthy_hosts.arn
    rds_cpu_high       = aws_cloudwatch_metric_alarm.rds_cpu_high.arn
    rds_storage_low    = aws_cloudwatch_metric_alarm.rds_storage_low.arn
    rds_connections    = aws_cloudwatch_metric_alarm.rds_connections_high.arn
    redis_memory_high  = aws_cloudwatch_metric_alarm.redis_memory_high.arn
    redis_evictions    = aws_cloudwatch_metric_alarm.redis_evictions.arn
  }
}

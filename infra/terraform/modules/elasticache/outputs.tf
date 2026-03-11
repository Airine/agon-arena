output "endpoint" {
  value = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "connection_url" {
  description = "Redis connection URL for the application"
  value       = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379"
}

output "security_group_id" {
  value = aws_security_group.redis.id
}

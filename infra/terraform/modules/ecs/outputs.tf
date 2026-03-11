output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "service_security_group_id" {
  value = aws_security_group.service.id
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}

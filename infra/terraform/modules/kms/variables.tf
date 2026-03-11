variable "name_prefix" {
  type = string
}

variable "ecs_task_execution_role_arn" {
  description = "ECS task execution role ARN that needs decrypt access"
  type        = string
}

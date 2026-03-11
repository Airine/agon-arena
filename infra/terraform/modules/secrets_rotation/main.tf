# --- Lambda Execution Role ---
resource "aws_iam_role" "rotation_lambda" {
  name = "${var.name_prefix}-secret-rotation"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rotation_lambda_basic" {
  role       = aws_iam_role.rotation_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "rotation_lambda_secrets" {
  name = "${var.name_prefix}-rotation-secrets"
  role = aws_iam_role.rotation_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage"
        ]
        Resource = var.secret_arns
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetRandomPassword"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey",
          "kms:DescribeKey"
        ]
        Resource = var.kms_key_arn
      },
      {
        Effect = "Allow"
        Action = [
          "rds:ModifyDBInstance"
        ]
        Resource = var.db_instance_arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "rotation_lambda_ecs" {
  count = var.ecs_cluster_name != "" ? 1 : 0
  name  = "${var.name_prefix}-rotation-ecs"
  role  = aws_iam_role.rotation_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecs:UpdateService"
      ]
      Resource = "*"
      Condition = {
        StringEquals = {
          "ecs:cluster" = var.ecs_cluster_name
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "rotation_lambda_vpc" {
  count = var.vpc_config != null ? 1 : 0
  name  = "${var.name_prefix}-rotation-vpc"
  role  = aws_iam_role.rotation_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ]
      Resource = "*"
    }]
  })
}

# --- Lambda Function ---
data "archive_file" "rotation_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/rotate-secrets"
  output_path = "${path.module}/../../../lambda/rotate-secrets.zip"
}

resource "aws_lambda_function" "rotation" {
  function_name    = "${var.name_prefix}-secret-rotation"
  role             = aws_iam_role.rotation_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 60
  memory_size      = 128
  filename         = data.archive_file.rotation_lambda.output_path
  source_code_hash = data.archive_file.rotation_lambda.output_base64sha256

  environment {
    variables = {
      DB_INSTANCE_ID   = var.db_instance_id
      ECS_CLUSTER_NAME = var.ecs_cluster_name
      ECS_SERVICE_NAME = var.ecs_service_name
    }
  }

  dynamic "vpc_config" {
    for_each = var.vpc_config != null ? [var.vpc_config] : []
    content {
      subnet_ids         = vpc_config.value.subnet_ids
      security_group_ids = vpc_config.value.security_group_ids
    }
  }

  tags = { Name = "${var.name_prefix}-secret-rotation" }
}

# --- Secrets Manager Rotation Permission ---
resource "aws_lambda_permission" "secretsmanager" {
  statement_id  = "AllowSecretsManagerInvocation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
}

# --- JWT Secret Rotation Schedule ---
resource "aws_secretsmanager_secret_rotation" "jwt" {
  secret_id           = var.jwt_secret_id
  rotation_lambda_arn = aws_lambda_function.rotation.arn

  rotation_rules {
    automatically_after_days = var.jwt_rotation_days
  }

  depends_on = [aws_lambda_permission.secretsmanager]
}

# --- DB Password Rotation Schedule ---
resource "aws_secretsmanager_secret_rotation" "db" {
  secret_id           = var.db_password_secret_id
  rotation_lambda_arn = aws_lambda_function.rotation.arn

  rotation_rules {
    automatically_after_days = var.db_rotation_days
  }

  depends_on = [aws_lambda_permission.secretsmanager]
}

# --- Ed25519 Key Rotation Schedule ---
resource "aws_secretsmanager_secret_rotation" "ed25519" {
  count               = var.ed25519_key_secret_id != "" ? 1 : 0
  secret_id           = var.ed25519_key_secret_id
  rotation_lambda_arn = aws_lambda_function.rotation.arn

  rotation_rules {
    automatically_after_days = var.ed25519_rotation_days
  }

  depends_on = [aws_lambda_permission.secretsmanager]
}

# --- CloudWatch Alarm: Rotation Lambda Errors ---
resource "aws_cloudwatch_metric_alarm" "rotation_errors" {
  alarm_name          = "${var.name_prefix}-secret-rotation-errors"
  alarm_description   = "Secrets rotation Lambda is failing — manual intervention required"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.rotation.function_name
  }

  tags = { Name = "${var.name_prefix}-rotation-errors-alarm" }
}

# --- CloudWatch Alarm: Rotation Lambda Duration (near timeout) ---
resource "aws_cloudwatch_metric_alarm" "rotation_duration" {
  alarm_name          = "${var.name_prefix}-secret-rotation-duration"
  alarm_description   = "Secrets rotation Lambda approaching timeout (>45s of 60s limit)"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Maximum"
  threshold           = 45000
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.rotation.function_name
  }

  tags = { Name = "${var.name_prefix}-rotation-duration-alarm" }
}

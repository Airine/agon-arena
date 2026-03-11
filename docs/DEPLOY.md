# Agon Arena — Production Deployment Runbook

> **Audience**: Engineers performing production or staging deployments.
> **Infra**: AWS ECS Fargate · RDS PostgreSQL · ElastiCache Redis · CloudFront · Kong Gateway
> **IaC**: Terraform (./infra/terraform) · CI/CD via GitHub Actions

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Infrastructure Setup](#2-first-time-infrastructure-setup)
3. [Environment Configuration](#3-environment-configuration)
4. [Database Migration](#4-database-migration)
5. [Build & Push Docker Image](#5-build--push-docker-image)
6. [Deploy API to ECS](#6-deploy-api-to-ecs)
7. [Deploy Web Frontend](#7-deploy-web-frontend)
8. [Kong API Gateway](#8-kong-api-gateway)
9. [Health Checks & Verification](#9-health-checks--verification)
10. [Rollback Procedure](#10-rollback-procedure)
11. [Monitoring & Alerts](#11-monitoring--alerts)

---

## 1. Prerequisites

### Tools

| Tool | Version | Install |
|------|---------|---------|
| AWS CLI | ≥ 2.x | `brew install awscli` |
| Terraform | ≥ 1.7 | `brew install terraform` |
| Docker | ≥ 25 | Docker Desktop |
| pnpm | ≥ 10.6 | `npm i -g pnpm` |
| Node.js | 20 LTS | `nvm use 20` |

### AWS Access

- IAM role with permissions: ECR, ECS, RDS, ElastiCache, S3, CloudFront, Route53, ACM, Secrets Manager
- OIDC trust policy configured for GitHub Actions (see `infra/terraform/bootstrap/`)
- Local profile: `aws configure --profile agon-production`

### Required Secrets (GitHub Actions)

| Secret Name | Description |
|------------|-------------|
| `AWS_ROLE_ARN` | IAM role ARN for OIDC authentication |
| `AWS_REGION` | e.g. `us-east-1` |

---

## 2. First-Time Infrastructure Setup

> Skip this section if infrastructure already exists. Jump to [§4](#4-database-migration).

### 2.1 Bootstrap Terraform State

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

This creates the S3 bucket and DynamoDB table for remote state.

### 2.2 Request ACM Certificates

Two certificates are required — both must be DNS-validated:

```bash
# ALB certificate (any region)
aws acm request-certificate \
  --domain-name api.agon.win \
  --validation-method DNS \
  --region us-east-1

# CloudFront certificate (MUST be us-east-1)
aws acm request-certificate \
  --domain-name "*.agon.win" \
  --subject-alternative-names "agon.win" \
  --validation-method DNS \
  --region us-east-1
```

Add the DNS CNAME records to your registrar and wait for `ISSUED` status:

```bash
aws acm describe-certificate --certificate-arn <ARN> --query 'Certificate.Status'
```

### 2.3 Configure tfvars

```bash
cp infra/terraform/production.tfvars.example infra/terraform/production.tfvars
```

Edit `production.tfvars` and fill in:

```hcl
acm_certificate_arn             = "arn:aws:acm:us-east-1:…:certificate/…"
cloudfront_acm_certificate_arn  = "arn:aws:acm:us-east-1:…:certificate/…"
create_route53_zone             = true   # true only on first run
```

### 2.4 Provision Infrastructure

```bash
cd infra/terraform
terraform init -backend-config="bucket=agon-arena-terraform-state"
terraform plan -var-file=production.tfvars -out=production.plan
terraform apply production.plan
```

Note the outputs — you'll need them later:

```bash
terraform output ecr_repository_url   # e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/agon-arena-production-api
terraform output ecs_cluster_name     # e.g. agon-arena-production-cluster
terraform output ecs_service_name     # e.g. agon-arena-production-api
terraform output rds_endpoint         # private endpoint (sensitive)
```

### 2.5 Create Secrets in AWS Secrets Manager

```bash
# Database password
aws secretsmanager create-secret \
  --name "agon-arena-production/db-password" \
  --secret-string "$(openssl rand -base64 32)"

# JWT secret
aws secretsmanager create-secret \
  --name "agon-arena-production/jwt-secret" \
  --secret-string "$(openssl rand -base64 64)"

# Ed25519 webhook key (hex)
aws secretsmanager create-secret \
  --name "agon-arena-production/webhook-private-key" \
  --secret-string "$(openssl genpkey -algorithm ed25519 | openssl pkey -outform DER | xxd -p -c 256)"
```

---

## 3. Environment Configuration

### Required Environment Variables

All variables are injected into ECS tasks via Secrets Manager / Terraform. Reference:

| Variable | Source | Description |
|----------|--------|-------------|
| `NODE_ENV` | Literal | `production` |
| `PORT` | Literal | `4000` |
| `DATABASE_URL` | Secrets Manager | `postgresql://agon:<password>@<rds-endpoint>:5432/agon_arena` |
| `REDIS_URL` | Literal (from Terraform output) | `redis://<elasticache-endpoint>:6379` |
| `JWT_SECRET` | Secrets Manager | 64-byte random string |
| `JWT_EXPIRES_IN` | Literal | `7d` |
| `CORS_ORIGIN` | Literal | `https://agon.win` |
| `WEBHOOK_PRIVATE_KEY` | Secrets Manager | Ed25519 private key hex |

### Local Development

```bash
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your local values
docker compose up -d postgres redis
```

---

## 4. Database Migration

Migrations run via Drizzle ORM (`pnpm drizzle-kit`).

### 4.1 Generate Migration (when schema changes)

```bash
pnpm --filter @agon/api db:generate
# Review generated SQL in apps/api/src/db/migrations/
git add apps/api/src/db/migrations/ && git commit -m "db: add migration <description>"
```

### 4.2 Apply Migrations to Production

Connect via SSM Session Manager (no public RDS exposure):

```bash
# Start port-forward through a bastion ECS task (if configured)
aws ssm start-session \
  --target <ecs-task-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=<rds-endpoint>,portNumber=5432,localPortNumber=5433"

# In another terminal — run migrations
DATABASE_URL="postgresql://agon:<password>@localhost:5433/agon_arena" \
  pnpm --filter @agon/api db:migrate
```

Or if running via CI/CD pipeline (see `deploy.yml`), the `api` container automatically runs `drizzle-kit migrate` on startup when `RUN_MIGRATIONS=true` is set.

---

## 5. Build & Push Docker Image

### 5.1 Authenticate to ECR

```bash
ECR_URL=$(terraform -chdir=infra/terraform output -raw ecr_repository_url)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin "$ECR_URL"
```

### 5.2 Build and Tag

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)

docker build \
  -f apps/api/Dockerfile \
  -t "${ECR_URL}:${IMAGE_TAG}" \
  -t "${ECR_URL}:latest" \
  .
```

### 5.3 Push

```bash
docker push "${ECR_URL}:${IMAGE_TAG}"
docker push "${ECR_URL}:latest"
```

---

## 6. Deploy API to ECS

### Option A — GitHub Actions (recommended)

Trigger the `Deploy` workflow manually from the GitHub Actions UI:

- **Repository** → Actions → **Deploy** → Run workflow
- Select `environment: production`, `image_tag: <git-sha>`, enable `deploy_api`

### Option B — Manual AWS CLI

```bash
CLUSTER=$(terraform -chdir=infra/terraform output -raw ecs_cluster_name)
SERVICE=$(terraform -chdir=infra/terraform output -raw ecs_service_name)

aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment

# Wait for stable
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE"

echo "Deployment complete."
```

### Option C — Update Image Tag via Terraform

```bash
# Edit production.tfvars: api_image_tag = "<new-tag>"
terraform -chdir=infra/terraform apply \
  -var-file=production.tfvars \
  -target=module.ecs
```

---

## 7. Deploy Web Frontend

### 7.1 Build

```bash
NEXT_PUBLIC_API_URL=https://api.agon.win \
NEXT_PUBLIC_WS_URL=wss://api.agon.win \
  pnpm --filter @agon/web build
```

### 7.2 Sync to S3

```bash
S3_BUCKET="agon-arena-production-web"

# Static assets — long cache
aws s3 sync apps/web/out/_next/static/ "s3://${S3_BUCKET}/_next/static/" \
  --cache-control "public, max-age=31536000, immutable"

# Everything else — no cache
aws s3 sync apps/web/out/ "s3://${S3_BUCKET}/" \
  --exclude "_next/static/*" \
  --cache-control "public, max-age=0, must-revalidate"
```

### 7.3 Invalidate CloudFront

```bash
DIST_ID=$(terraform -chdir=infra/terraform output -raw cloudfront_web_distribution_id)

aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*"
```

---

## 8. Kong API Gateway

Kong runs in DB-less mode with declarative config (`infra/kong/kong.production.yml`).

### 8.1 Update Kong Config

Edit `infra/kong/kong.production.yml`, then redeploy the ECS kong service (if containerized) or reload:

```bash
# Reload running Kong container
docker exec kong kong reload
```

### 8.2 Verify Kong Routes

```bash
# List all routes via Admin API
curl -s http://localhost:8001/routes | jq '.data[].name'

# Health check via proxy
curl -i http://localhost:8000/healthz
```

---

## 9. Health Checks & Verification

Run these checks after every deployment:

### API Health

```bash
curl -s https://api.agon.win/healthz | jq .
# Expected: {"status":"ok","db":"ok","redis":"ok"}
```

### WebSocket Connectivity

```bash
# Requires wscat: npm i -g wscat
wscat -c wss://api.agon.win/socket.io/?EIO=4&transport=websocket
# Should connect without error
```

### Authentication Flow

```bash
TOKEN=$(curl -s -X POST https://api.agon.win/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"smoke-test","email":"smoke@agon.win","password":"smoke1234"}' \
  | jq -r .token)

curl -s https://api.agon.win/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .username
# Should print: "smoke-test"
```

### Web Frontend

```bash
curl -si https://agon.win | head -5
# Expected: HTTP/2 200 and Content-Type: text/html
```

### ECS Task Health

```bash
CLUSTER=$(terraform -chdir=infra/terraform output -raw ecs_cluster_name)
SERVICE=$(terraform -chdir=infra/terraform output -raw ecs_service_name)

aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --query 'services[0].{running:runningCount,desired:desiredCount,status:status}'
```

---

## 10. Rollback Procedure

### API Rollback — Redeploy Previous Image

```bash
# Find the previous stable image tag from ECR
aws ecr describe-images \
  --repository-name agon-arena-production-api \
  --query 'sort_by(imageDetails, &imagePushedAt)[-2].imageTags[0]' \
  --output text

# Force-redeploy with previous tag
ECR_URL=$(terraform -chdir=infra/terraform output -raw ecr_repository_url)
PREV_TAG=<previous-tag>

# Update ECS task definition image via tfvars + apply, or via AWS console
aws ecs update-service \
  --cluster agon-arena-production-cluster \
  --service agon-arena-production-api \
  --task-definition <previous-task-definition-arn> \
  --force-new-deployment

aws ecs wait services-stable \
  --cluster agon-arena-production-cluster \
  --services agon-arena-production-api
```

### Web Rollback — Redeploy from Git

```bash
git checkout <previous-sha>
# Re-run §7 (Build → S3 sync → CloudFront invalidation)
```

### Database Rollback

> Migrations are forward-only. If a migration causes data issues, apply a corrective migration — never run raw SQL on production without a plan reviewed by at least one other engineer.

---

## 11. Monitoring & Alerts

### CloudWatch Dashboards

| Dashboard | What it shows |
|-----------|---------------|
| `agon-arena-production-api` | ECS CPU/memory, ALB 4xx/5xx, RDS connections |
| `agon-arena-production-web` | CloudFront cache hit rate, error rate |

### Key Alarms

| Alarm | Threshold | Action |
|-------|-----------|--------|
| ECS CPU > 80% | 5 min sustained | SNS → PagerDuty |
| ALB 5xx rate > 1% | 2 min | SNS → Slack #incidents |
| RDS FreeStorageSpace < 5 GB | Immediate | SNS → on-call |
| Redis EngineCPUUtilization > 90% | 5 min | SNS → Slack |

### Logs

```bash
# Stream API logs
aws logs tail /ecs/agon-arena-production-api --follow --format short

# Filter for errors only
aws logs filter-log-events \
  --log-group-name /ecs/agon-arena-production-api \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s000)
```

---

*Last updated: 2026-03-12 — Canvas (Frontend Engineer)*

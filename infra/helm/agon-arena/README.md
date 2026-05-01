# Agon Arena OrbStack Deployment

This chart deploys Agon Arena to the local OrbStack Kubernetes cluster behind
the existing Traefik ingress controller.

## Prerequisites

- Kubernetes context: `orbstack`
- Traefik ingress class: `traefik`
- cert-manager `ClusterIssuer`: `cloudflare-dns01`
- Local Docker images built for API and Web
- External secrets:
  - `agon-arena-app`
  - `agon-arena-postgres`

The `cloudflare-dns01` issuer must be able to manage the `agon.win` zone.
The live cluster can be checked with:

```bash
CF_TOKEN=$(kubectl -n cert-manager get secret cloudflare-api-token -o jsonpath='{.data.api-token}' | base64 -d)
curl -sS -H "Authorization: Bearer ${CF_TOKEN}" \
  "https://api.cloudflare.com/client/v4/zones?name=agon.win"
```

## Build Images

```bash
IMAGE_TAG="orbstack-$(date +%Y%m%d-%H%M%S)"

docker build -t "agon-arena-api:${IMAGE_TAG}" -f apps/api/Dockerfile .
docker build -t "agon-arena-web:${IMAGE_TAG}" \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://agon.win/api \
  --build-arg NEXT_PUBLIC_WS_URL=https://agon.win \
  .
```

## Create Secrets

`AGON_ED25519_PRIVATE_KEY` is a 32-byte Ed25519 seed encoded as 64 hex
characters. It is not a PKCS8 DER key. Production email-code auth also
requires a Resend API key and a verified sender address.

```bash
kubectl create namespace agon-arena --dry-run=client -o yaml | kubectl apply -f -

kubectl -n agon-arena create secret generic agon-arena-app \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=AGON_ED25519_PRIVATE_KEY="$(openssl rand -hex 32)" \
  --from-literal=RESEND_API_KEY="re_xxx" \
  --from-literal=RESEND_FROM_EMAIL="Agon Arena <login@agon.win>"

kubectl -n agon-arena create secret generic agon-arena-postgres \
  --from-literal=password="$(openssl rand -hex 24)"
```

Use hex for the PostgreSQL password because the chart embeds it in
`DATABASE_URL`.

## Deploy

```bash
helm upgrade --install agon-arena infra/helm/agon-arena \
  -n agon-arena \
  -f infra/helm/agon-arena/values-orbstack-public.yaml \
  --set "image.api.tag=${IMAGE_TAG}" \
  --set "image.web.tag=${IMAGE_TAG}"
```

## Verify

```bash
kubectl -n agon-arena rollout status deployment/agon-arena-api
kubectl -n agon-arena rollout status deployment/agon-arena-web
kubectl -n agon-arena rollout status deployment/agon-arena-worker

curl --noproxy '*' -k https://agon.win/api/health
curl --noproxy '*' -k https://api.agon.win/health
curl --noproxy '*' -k -I https://agon.win/
```

Once cert-manager has issued `agon-win-tls`, the same HTTPS checks should pass
without `-k`.

If Cloudflare zone access was fixed after the first certificate attempt, force a
fresh ACME order:

```bash
kubectl -n agon-arena delete certificaterequest agon-win-tls-1 --ignore-not-found
kubectl -n agon-arena get certificate,order,challenge
```

#!/usr/bin/env bash
# Build, push and roll out LendLoop to the k3s cluster (namespace: lendloop).
#
#   ./deploy.sh            # tag = timestamp, plus the git sha once there are commits
#   ./deploy.sh mytag      # explicit tag
#
# Before the first run: k8s/set-clerk.sh (Clerk keys and admin emails).
#
# The image is pushed to the local registry (localhost:5000 on this machine),
# which the cluster nodes pull as registry.lan:5000. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

NS=lendloop
HOST=lendloop.creativelogik.net   # also in k8s/10-convex.yaml and k8s/30-ingress.yaml
PUSH_REG=localhost:5000
IMAGE=lendloop-web
TAG=${1:-$(date +%Y%m%d%H%M%S)$(git rev-parse --short --verify -q HEAD | sed 's/^/-/' || true)}

# In-cluster addresses: Convex and n8n talk to each other without leaving the cluster.
N8N_WEBHOOK_URL=http://n8n.n8n.svc.cluster.local/webhook/lendloop/loan-events
CONVEX_SITE_URL=http://convex.$NS.svc.cluster.local:3211

# Prints nothing when the secret or the key does not exist.
secret() { kubectl -n "$NS" get secret "$1" -o jsonpath="{.data.$2}" 2>/dev/null | base64 -d || true; }

kubectl apply -f k8s/00-namespace.yaml

# Generated on the first run and then left alone.
if ! kubectl -n "$NS" get secret lendloop-secrets >/dev/null 2>&1; then
  kubectl -n "$NS" create secret generic lendloop-secrets \
    --from-literal=convex-instance-secret="$(openssl rand -hex 32)" \
    --from-literal=webhook-secret="$(openssl rand -hex 32)" \
    --from-literal=api-secret="$(openssl rand -hex 32)"
fi
if ! kubectl -n "$NS" get secret lendloop-clerk >/dev/null 2>&1; then
  echo "secret lendloop-clerk missing in namespace $NS; run k8s/set-clerk.sh first" >&2
  exit 1
fi

PUBLISHABLE_KEY=$(secret lendloop-clerk publishable-key)
ADMIN_EMAILS=$(secret lendloop-clerk admin-emails)
# A publishable key is "pk_<env>_" + base64("<Clerk Frontend API host>$"), and
# that host is the issuer of the tokens Convex verifies.
CLERK_ISSUER="https://$(printf %s "${PUBLISHABLE_KEY#pk_*_}" | base64 -d 2>/dev/null | tr -d '$' || true)"
if ! [[ $CLERK_ISSUER =~ ^https://[a-z0-9.-]+\.[a-z]+$ ]]; then
  echo "could not read the Clerk domain from the publishable key; re-run k8s/set-clerk.sh" >&2
  exit 1
fi

echo "▸ Convex backend"
kubectl apply -f k8s/10-convex.yaml
kubectl -n "$NS" rollout status deploy/convex --timeout=300s
printf '%s\n' \
  "CLERK_JWT_ISSUER_DOMAIN=$CLERK_ISSUER" \
  "ADMIN_EMAILS=$ADMIN_EMAILS" \
  "N8N_WEBHOOK_URL=$N8N_WEBHOOK_URL" \
  "LENDLOOP_WEBHOOK_SECRET=$(secret lendloop-secrets webhook-secret)" \
  "LENDLOOP_API_SECRET=$(secret lendloop-secrets api-secret)" \
  | k8s/convex.sh env set --force
k8s/convex.sh deploy --yes

echo "▸ Web app ($IMAGE:$TAG)"
docker build -t "$PUSH_REG/$IMAGE:$TAG" \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" \
  --build-arg NEXT_PUBLIC_CONVEX_URL="https://$HOST" \
  .
docker push "$PUSH_REG/$IMAGE:$TAG"
sed "s/__TAG__/$TAG/g" k8s/20-web.yaml | kubectl apply -f -
kubectl apply -f k8s/30-ingress.yaml
kubectl -n "$NS" rollout status deploy/web --timeout=300s

echo "▸ n8n workflows"
# Workflow emails go to the cluster's MailHog catcher unless Secret
# lendloop-smtp (host, port, user, pass, secure, from) says otherwise.
SMTP_HOST=$(secret lendloop-smtp host)
FROM_EMAIL=$(secret lendloop-smtp from)
LENDLOOP_WEBHOOK_SECRET=$(secret lendloop-secrets webhook-secret) \
LENDLOOP_API_SECRET=$(secret lendloop-secrets api-secret) \
LENDLOOP_CONVEX_SITE_URL=$CONVEX_SITE_URL \
LENDLOOP_FROM_EMAIL=${FROM_EMAIL:-LendLoop <no-reply@creativelogik.net>} \
LENDLOOP_ALERT_EMAIL=${ADMIN_EMAILS%%,*} \
SMTP_HOST=${SMTP_HOST:-mailhog.mailhog.svc.cluster.local} \
SMTP_PORT=$(secret lendloop-smtp port) \
SMTP_USER=$(secret lendloop-smtp user) \
SMTP_PASSWORD=$(secret lendloop-smtp pass) \
SMTP_SECURE=$(secret lendloop-smtp secure) \
  node scripts/n8n-k8s.mjs

echo "deployed $IMAGE:$TAG -> https://$HOST"

#!/usr/bin/env bash
# Run the Convex CLI against the backend in the cluster, for example:
#
#   k8s/convex.sh logs
#   k8s/convex.sh data tools
#   k8s/convex.sh run users:setRole '{"email":"you@example.com","role":"admin"}'
#
# It opens a temporary port-forward and derives an admin key from the instance
# secret each time, so no Convex credential is kept on this machine.
set -euo pipefail
cd "$(dirname "$0")/.."

NS=lendloop
PORT=${CONVEX_FORWARD_PORT:-13210}

kubectl -n "$NS" port-forward svc/convex "$PORT:3210" >/dev/null 2>&1 &
FORWARD=$!
trap 'kill "$FORWARD" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/version" 2>/dev/null && break
  kill -0 "$FORWARD" 2>/dev/null || { echo "port-forward to svc/convex failed (is port $PORT free?)" >&2; exit 1; }
  sleep 0.2
done

# The CLI takes its target from an env file. Passing one explicitly also stops
# it from picking up the development deployment named in .env.local. The file
# lives on the per-user tmpfs and is removed when this script exits.
TARGET=$(umask 077 && mktemp -p "${XDG_RUNTIME_DIR:-/tmp}" lendloop-convex.XXXXXX)
trap 'kill "$FORWARD" 2>/dev/null || true; rm -f "$TARGET"' EXIT
{
  echo "CONVEX_SELF_HOSTED_URL=http://127.0.0.1:$PORT"
  echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$(kubectl -n "$NS" exec deploy/convex -- ./generate_admin_key.sh 2>/dev/null | tail -n1)"
} > "$TARGET"

npx convex "$@" --env-file "$TARGET"

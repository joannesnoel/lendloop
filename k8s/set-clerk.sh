#!/usr/bin/env bash
# Store the Clerk keys and the admin list in Secret lendloop/lendloop-clerk.
# Run in a terminal; the secret key is read without echo and never written to
# disk. Run ./deploy.sh afterwards to apply the change.
set -euo pipefail
cd "$(dirname "$0")"

read -rp  'Clerk publishable key (pk_test_... or pk_live_...): ' PUBLISHABLE_KEY
read -rsp 'Clerk secret key (hidden): ' SECRET_KEY; echo
read -rp  'Admin emails, comma-separated (verified addresses become admins on sign-in): ' ADMIN_EMAILS

case "$PUBLISHABLE_KEY" in pk_test_*|pk_live_*) ;; *) echo "That is not a Clerk publishable key." >&2; exit 1 ;; esac
case "$SECRET_KEY"      in sk_test_*|sk_live_*) ;; *) echo "That is not a Clerk secret key." >&2; exit 1 ;; esac
[ -n "$ADMIN_EMAILS" ] || { echo "Give at least one admin email." >&2; exit 1; }

kubectl apply -f 00-namespace.yaml
kubectl -n lendloop create secret generic lendloop-clerk \
  --from-literal=publishable-key="$PUBLISHABLE_KEY" \
  --from-literal=secret-key="$SECRET_KEY" \
  --from-literal=admin-emails="$ADMIN_EMAILS" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Saved. Now run ./deploy.sh"

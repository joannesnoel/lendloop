#!/usr/bin/env bash
# Store the SMTP account for workflow emails in Secret lendloop/lendloop-smtp.
# Run in a terminal; the key is read without echo and never written to disk.
# Run ./deploy.sh afterwards: it loads the account into n8n as an encrypted
# credential.
#
#   k8s/set-smtp.sh             # asks for the Brevo SMTP login, key and sender
#   k8s/set-smtp.sh --from-n8n  # reuses the Brevo account n8n already sends
#                               # its own emails with (Secret n8n/n8n-smtp)
set -euo pipefail
cd "$(dirname "$0")"

HOST=smtp-relay.brevo.com
PORT=587   # STARTTLS

if [ "${1:-}" = "--from-n8n" ]; then
  from_n8n() { kubectl -n n8n get secret n8n-smtp -o jsonpath="{.data.$1}" | base64 -d; }
  SMTP_USER=$(from_n8n user)
  SMTP_PASS=$(from_n8n pass)
  # The same verified address, with LendLoop as the display name.
  SENDER="LendLoop <$(from_n8n sender | sed -E 's/.*<([^>]+)>.*/\1/')>"
else
  read -rp  'Brevo SMTP login (e.g. 1a2b3c001@smtp-brevo.com): ' SMTP_USER
  read -rsp 'Brevo SMTP key (hidden): ' SMTP_PASS; echo
  read -rp  'Sender, verified in Brevo (e.g. LendLoop <noreply@creativelogik.net>): ' SENDER
fi

[ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ] || { echo "The SMTP login and key are both required." >&2; exit 1; }
case "$SENDER" in
  *"'"*|*\\*) echo "The sender must not contain quotes or backslashes." >&2; exit 1 ;;
  *@*) ;;
  *) echo "The sender needs an email address." >&2; exit 1 ;;
esac

kubectl apply -f 00-namespace.yaml
kubectl -n lendloop create secret generic lendloop-smtp \
  --from-literal=host="$HOST" \
  --from-literal=port="$PORT" \
  --from-literal=secure=false \
  --from-literal=user="$SMTP_USER" \
  --from-literal=pass="$SMTP_PASS" \
  --from-literal=from="$SENDER" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Saved. Emails will be sent as: $SENDER"
echo "Now run ./deploy.sh"

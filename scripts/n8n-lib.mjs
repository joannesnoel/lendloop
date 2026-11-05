// Shared by the two n8n loaders: scripts/n8n-setup.mjs (docker compose, local)
// and scripts/n8n-k8s.mjs (kubectl, the cluster).

// Ids referenced by the workflow files in n8n/workflows.
export const WORKFLOWS = [
  // The error handler goes first so the others can point at it.
  { id: "LendLoopErrors01", file: "error-handler.json" },
  { id: "LendLoopNotify01", file: "request-notification.json" },
  { id: "LendLoopRemind01", file: "overdue-reminders.json" },
];

export function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

export function checkSecrets(env, source) {
  for (const name of ["LENDLOOP_WEBHOOK_SECRET", "LENDLOOP_API_SECRET"]) {
    if (!env[name] || env[name].length < 32) {
      fail(`${name} in ${source} must be at least 32 characters. Generate one with: openssl rand -hex 32`);
    }
  }
  if (env.LENDLOOP_WEBHOOK_SECRET === env.LENDLOOP_API_SECRET) {
    fail("Use two different secrets for LENDLOOP_WEBHOOK_SECRET and LENDLOOP_API_SECRET.");
  }
}

/** The three credentials the workflows reference by id. */
export function buildCredentials(env) {
  return [
    {
      id: "LendLoopHmacIn01",
      name: "LendLoop webhook signing secret (Convex to n8n)",
      type: "crypto",
      data: { hmacSecret: env.LENDLOOP_WEBHOOK_SECRET },
    },
    {
      id: "LendLoopHmacOut1",
      name: "LendLoop API signing secret (n8n to Convex)",
      type: "crypto",
      data: { hmacSecret: env.LENDLOOP_API_SECRET },
    },
    {
      id: "LendLoopSmtp0001",
      name: "LendLoop SMTP",
      type: "smtp",
      data: {
        host: env.SMTP_HOST || "mailpit",
        port: Number(env.SMTP_PORT || 1025),
        user: env.SMTP_USER || "",
        password: env.SMTP_PASSWORD || "",
        secure: env.SMTP_SECURE === "true",
      },
    },
  ];
}

/**
 * Shell for the n8n container: read stdin into a private temp file, hand it
 * to an n8n import command, and remove it again. For credentials, n8n
 * encrypts the values with its own key when it stores them.
 */
export function importFromStdin(command) {
  return `umask 077 && f=$(mktemp) && cat > "$f" && n8n ${command} --input="$f"; s=$?; rm -f "$f"; exit $s`;
}

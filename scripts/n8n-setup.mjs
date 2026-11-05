#!/usr/bin/env node
// Brings up the n8n stack and loads LendLoop's credentials and workflows.
// Safe to re-run: credentials and workflows are imported by fixed id, so a
// second run updates them in place instead of creating copies.
//
//   npm run n8n:setup
//
// Secrets are read from n8n/.env and piped to n8n over stdin. They are never
// written to disk on the host, passed on a command line, or put in the
// workflow files.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKFLOWS,
  buildCredentials,
  checkSecrets,
  fail,
  importFromStdin,
} from "./n8n-lib.mjs";

const n8nDir = join(dirname(fileURLToPath(import.meta.url)), "..", "n8n");
const envFile = join(n8nDir, ".env");

function readEnv(path) {
  if (!existsSync(path)) {
    fail("n8n/.env not found. Copy n8n/.env.example to n8n/.env and fill it in.");
  }
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

function compose(args, { input, quiet = false } = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: n8nDir,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) fail(`Could not run docker: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`docker compose ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
  if (!quiet && result.stdout.trim()) console.log(result.stdout.trim());
  return result.stdout;
}

/** Runs the n8n CLI inside the running container. */
function n8n(args, options) {
  return compose(["exec", "-T", "n8n", "n8n", ...args], options);
}

async function waitForN8n(port) {
  // "readiness" only reports ok once the database is migrated and connected.
  const url = `http://localhost:${port}/healthz/readiness`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`n8n did not become healthy at ${url}.`);
}

/**
 * Published workflows register their webhooks shortly after n8n reports
 * ready. Wait for ours, and confirm it turns away an unsigned request.
 */
async function waitForWebhook(port) {
  const url = `http://localhost:${port}/webhook/lendloop/loan-events`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) return;
      if (response.status !== 404) {
        fail(`The webhook answered an unsigned request with HTTP ${response.status}; expected 401.`);
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`The notification webhook never went live at ${url}. Check the workflows in the n8n editor.`);
}

const env = readEnv(envFile);
checkSecrets(env, "n8n/.env");
const port = env.N8N_PORT || "5678";

console.log("▸ Starting n8n and Mailpit…");
compose(["up", "-d"], { quiet: true });
await waitForN8n(port);

console.log("▸ Importing credentials into n8n's encrypted store…");
compose(
  ["exec", "-T", "n8n", "sh", "-c", importFromStdin("import:credentials")],
  { input: JSON.stringify(buildCredentials(env)) },
);

console.log("▸ Importing workflows…");
for (const { file } of WORKFLOWS) {
  n8n(["import:workflow", `--input=/workflows/${file}`], { quiet: true });
}
for (const { id } of WORKFLOWS) {
  n8n(["publish:workflow", `--id=${id}`], { quiet: true });
}

console.log("▸ Restarting n8n so the published workflows go live…");
compose(["restart", "n8n"], { quiet: true });
await waitForN8n(port);
await waitForWebhook(port);

const base = env.N8N_PUBLIC_URL || `http://localhost:${port}`;
console.log(`
✔ n8n is ready and the webhook rejects unsigned requests.

  Editor            http://localhost:${port}
  Mail inbox        http://localhost:${env.MAILPIT_UI_PORT || "8025"}
  Webhook URL       ${base}/webhook/lendloop/loan-events

Point Convex at the webhook (the secrets must match n8n/.env):

  npx convex env set N8N_WEBHOOK_URL ${base}/webhook/lendloop/loan-events
  npx convex env set LENDLOOP_WEBHOOK_SECRET <same as n8n/.env>
  npx convex env set LENDLOOP_API_SECRET <same as n8n/.env>
`);

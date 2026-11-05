#!/usr/bin/env node
// Loads LendLoop's credentials and workflows into the n8n that runs in the
// cluster. Called by deploy.sh, which supplies everything through the
// environment; secrets are piped to n8n over stdin and never touch a command
// line or the host's disk.
//
// n8n has to restart for newly published workflows to go live, so this only
// does anything when the workflows or credentials differ from what the last
// run loaded (FORCE_N8N=1 overrides). Workflows edited in the n8n editor are
// overwritten the next time that happens: change n8n/workflows instead.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKFLOWS,
  buildCredentials,
  checkSecrets,
  fail,
  importFromStdin,
} from "./n8n-lib.mjs";

const env = process.env;
const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "n8n", "workflows");
const n8nNamespace = env.N8N_NAMESPACE || "n8n";
const n8nTarget = `deploy/${env.N8N_DEPLOYMENT || "n8n"}`;
const appNamespace = env.APP_NAMESPACE || "lendloop";
// Remembers what was last loaded, as a hash.
const stateConfigMap = "n8n-sync";

// The local setup lets workflows read these from $env. The cluster's n8n keeps
// environment access from workflows switched off, so they are written into
// the workflows as literals instead. None of them is a secret.
const SETTINGS = ["LENDLOOP_CONVEX_SITE_URL", "LENDLOOP_FROM_EMAIL", "LENDLOOP_ALERT_EMAIL"];

function kubectl(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("kubectl", args, { input, encoding: "utf8" });
  if (result.error) fail(`Could not run kubectl: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowFailure) return null;
    fail(`kubectl ${args.slice(0, 6).join(" ")} … failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

/** Runs a shell command inside the n8n container. */
function inN8n(shell, options) {
  return kubectl(["-n", n8nNamespace, "exec", "-i", n8nTarget, "--", "sh", "-c", shell], options);
}

function render(file) {
  let text = readFileSync(join(workflowsDir, file), "utf8");
  for (const name of SETTINGS) {
    const value = env[name];
    if (!value) fail(`${name} is not set.`);
    if (/['\\\r\n]/.test(value)) fail(`${name} must not contain quotes, backslashes, or line breaks.`);
    // The reference sits inside an n8n expression inside a JSON string, so the
    // value goes in as a single-quoted JavaScript string, JSON-escaped.
    text = text.replaceAll(`$env.${name}`, `'${JSON.stringify(value).slice(1, -1)}'`);
  }
  if (text.includes("$env.")) fail(`${file} still reads from $env after rendering.`);
  JSON.parse(text);
  return text;
}

async function waitForWebhook() {
  // Asked from inside the pod, so it does not depend on the public route.
  const probe =
    "fetch('http://127.0.0.1:5678/webhook/lendloop/loan-events'," +
    "{method:'POST',headers:{'content-type':'application/json'},body:'{}'})" +
    ".then(r=>console.log(r.status),()=>console.log(0))";
  let status = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    status = (inN8n(`node -e "${probe}"`, { allowFailure: true }) ?? "").trim();
    if (status === "401") return;
    if (status !== "404" && status !== "0" && status !== "") {
      fail(`The webhook answered an unsigned request with HTTP ${status}; expected 401.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  fail(`The notification webhook never went live (last status: ${status || "none"}). Check the workflows in the n8n editor.`);
}

checkSecrets(env, "the lendloop-secrets Secret");
const credentials = JSON.stringify(buildCredentials(env));
const workflows = WORKFLOWS.map(({ id, file }) => ({ id, json: render(file) }));

const hash = createHash("sha256")
  .update(credentials)
  .update(workflows.map((workflow) => workflow.json).join("\n"))
  .digest("hex");
const loaded = kubectl(
  ["-n", appNamespace, "get", "configmap", stateConfigMap, "-o", "jsonpath={.data.hash}"],
  { allowFailure: true },
);
const present = inN8n("n8n list:workflow") ?? "";
const allPresent = WORKFLOWS.every(({ id }) => present.includes(`${id}|`));

if (loaded === hash && allPresent && env.FORCE_N8N !== "1") {
  console.log("  n8n already has the current workflows and credentials; left as is.");
  process.exit(0);
}

console.log("  Importing credentials into n8n's encrypted store…");
inN8n(importFromStdin("import:credentials"), { input: credentials });

console.log("  Importing and publishing workflows…");
for (const { json } of workflows) {
  inN8n(importFromStdin("import:workflow"), { input: json });
}
for (const { id } of workflows) {
  inN8n(`n8n publish:workflow --id=${id}`);
}

console.log("  Restarting n8n so the published workflows go live (about a minute)…");
kubectl(["-n", n8nNamespace, "rollout", "restart", n8nTarget]);
kubectl(["-n", n8nNamespace, "rollout", "status", n8nTarget, "--timeout=300s"]);
await waitForWebhook();

kubectl(["apply", "-f", "-"], {
  input: JSON.stringify({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: stateConfigMap, namespace: appNamespace },
    data: { hash },
  }),
});
console.log("  n8n is serving the workflows and the webhook rejects unsigned requests.");

import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { toIsoDate } from "./lib/domain";
import { verifySignedRequest } from "./lib/signing";

// HTTP endpoints called by n8n. Every request must carry a valid HMAC
// signature made with LENDLOOP_API_SECRET (see lib/signing.ts); anything else
// is rejected before it touches the database.

const http = httpRouter();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Reads the body and checks the signature. Returns the body or an error response. */
async function authenticate(
  request: Request,
): Promise<{ body: string } | { response: Response }> {
  const secret = process.env.LENDLOOP_API_SECRET;
  if (!secret) {
    console.error("LENDLOOP_API_SECRET is not set; rejecting n8n request.");
    return { response: json({ error: "Endpoint is not configured." }, 503) };
  }
  const body = await request.text();
  const result = await verifySignedRequest(request, body, secret);
  if (!result.ok) {
    console.warn(`Rejected n8n request: ${result.reason}`);
    return { response: json({ error: result.reason }, 401) };
  }
  return { body };
}

function parseObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

// Overdue loans that still need today's reminder.
http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if ("response" in auth) return auth.response;

    const today = toIsoDate(new Date());
    const loans = await ctx.runQuery(internal.reminders.overdue, { today });
    return json({ today, loans });
  }),
});

// Write back the outcome of one reminder. Idempotent on loanId + reminderDate.
http.route({
  path: "/n8n/reminders",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if ("response" in auth) return auth.response;

    const input = parseObject(auth.body);
    if (
      !input ||
      typeof input.loanId !== "string" ||
      typeof input.reminderDate !== "string" ||
      (input.status !== "sent" && input.status !== "failed")
    ) {
      return json(
        { error: "Expected { loanId, reminderDate, status: sent|failed }." },
        400,
      );
    }

    const result = await ctx.runMutation(internal.reminders.record, {
      loanId: input.loanId,
      reminderDate: input.reminderDate,
      status: input.status,
      channel: optionalString(input.channel, 40) ?? "email",
      error: optionalString(input.error, 500),
      executionId: optionalString(input.executionId, 100),
    });
    return result.ok ? json(result) : json({ error: result.reason }, 422);
  }),
});

// Failed n8n executions, reported by the error workflow. Idempotent on executionId.
http.route({
  path: "/n8n/workflow-errors",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(request);
    if ("response" in auth) return auth.response;

    const input = parseObject(auth.body);
    const executionId = optionalString(input?.executionId, 100);
    const workflowName = optionalString(input?.workflowName, 200);
    if (!input || !executionId || !workflowName) {
      return json({ error: "Expected { executionId, workflowName, message }." }, 400);
    }

    const result = await ctx.runMutation(internal.automation.recordError, {
      executionId,
      workflowName,
      nodeName: optionalString(input.nodeName, 200),
      message: optionalString(input.message, 1000) ?? "Unknown error",
      executionUrl: optionalString(input.executionUrl, 500),
    });
    return json({ ok: true, ...result });
  }),
});

export default http;

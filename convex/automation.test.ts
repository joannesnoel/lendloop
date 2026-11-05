import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
  hmacSha256Hex,
  requestSigningString,
  verifyHmacSha256Hex,
} from "./lib/signing";
import { day, drill, setup, signIn } from "./test.setup";

const WEBHOOK_SECRET = "test-webhook-secret";
const API_SECRET = "test-api-secret";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("N8N_WEBHOOK_URL", "https://n8n.test/webhook/lendloop");
  vi.stubEnv("LENDLOOP_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("LENDLOOP_API_SECRET", API_SECRET);
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type T = ReturnType<typeof setup>;

/** A tool owned by Owner with a request from Borrower, optionally approved. */
async function loanScenario(t: T, range = { startDate: day(0), endDate: day(2) }) {
  const owner = await signIn(t, "Owner");
  const borrower = await signIn(t, "Borrower");
  const toolId = await owner.as.mutation(api.tools.create, drill);
  const loanId = await borrower.as.mutation(api.loans.request, { toolId, ...range });
  return { owner, borrower, toolId, loanId };
}

function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return await respond();
    }),
  );
  return calls;
}

async function signedFetch(
  t: T,
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
  overrides: { secret?: string; timestamp?: number } = {},
) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = String(overrides.timestamp ?? Date.now());
  const signature = await hmacSha256Hex(
    overrides.secret ?? API_SECRET,
    requestSigningString(timestamp, method, path, body),
  );
  return await t.fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": timestamp,
      "X-LendLoop-Signature": `sha256=${signature}`,
    },
    body: method === "POST" ? body : undefined,
  });
}

describe("request notification webhook", () => {
  test("sends a signed, minimal payload to n8n", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const t = setup();
    const { borrower, loanId } = await loanScenario(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://n8n.test/webhook/lendloop");
    const body = init.body as string;
    const headers = init.headers as Record<string, string>;
    const signature = headers["X-LendLoop-Signature"].replace("sha256=", "");
    expect(await verifyHmacSha256Hex(WEBHOOK_SECRET, body, signature)).toBe(true);
    expect(await verifyHmacSha256Hex("wrong-secret", body, signature)).toBe(false);
    expect(await verifyHmacSha256Hex(WEBHOOK_SECRET, body + " ", signature)).toBe(false);

    const payload = JSON.parse(body);
    expect(payload).toEqual({
      eventId: expect.any(String),
      type: "request.created",
      sentAt: expect.any(Number),
      recipient: { name: "Owner", email: "owner@example.com" },
      actorName: "Borrower",
      loan: {
        id: loanId,
        toolName: "Cordless drill",
        startDate: day(0),
        endDate: day(2),
        status: "pending",
      },
    });
    // The borrower's contact details are not needed to notify the owner.
    expect(body).not.toContain("borrower@example.com");

    const [loan] = await borrower.as.query(api.loans.myRequests, {});
    expect(loan.activity).toMatchObject([
      { label: "New request notification sent", tone: "ok" },
    ]);
  });

  test("notifies the right person on every status change", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const t = setup();
    const { owner, loanId } = await loanScenario(t);
    await owner.as.mutation(api.loans.decide, { loanId, decision: "approved" });
    await owner.as.mutation(api.loans.markReturned, { loanId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const sent = calls.map(({ init }) => JSON.parse(init.body as string));
    expect(sent.map((p) => [p.type, p.recipient.email])).toEqual([
      ["request.created", "owner@example.com"],
      ["request.approved", "borrower@example.com"],
      ["loan.returned", "borrower@example.com"],
    ]);
  });

  test("retries with backoff, then surfaces a permanent failure to admins", async () => {
    const calls = stubFetch(() => new Response("nope", { status: 500 }));
    const t = setup();
    const admin = await signIn(t, "Admin");
    const { borrower } = await loanScenario(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(5);
    const { notifications } = await admin.as.query(api.automation.overview, {});
    expect(notifications).toMatchObject([
      {
        status: "failed",
        attempts: 5,
        lastError: "n8n responded with HTTP 500",
        toolName: "Cordless drill",
      },
    ]);
    const [loan] = await borrower.as.query(api.loans.myRequests, {});
    expect(loan.activity[0]).toMatchObject({
      label: "New request notification failed",
      tone: "problem",
    });

    // An admin can re-queue it once n8n is healthy again.
    vi.mocked(fetch).mockImplementation(async () => new Response("{}"));
    await admin.as.mutation(api.automation.retryNotification, {
      eventId: notifications[0]._id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await admin.as.query(api.automation.overview, {})).notifications).toEqual([]);
  });

  test("a network error is retried and then succeeds", async () => {
    let attempt = 0;
    const calls = stubFetch(() => {
      attempt += 1;
      if (attempt === 1) throw new Error("connect ECONNREFUSED");
      return new Response("{}", { status: 200 });
    });
    const t = setup();
    const { borrower } = await loanScenario(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(2);
    // Same event id on the retry, so the receiver could de-duplicate.
    const ids = calls.map(({ init }) => JSON.parse(init.body as string).eventId);
    expect(ids[0]).toBe(ids[1]);
    const [loan] = await borrower.as.query(api.loans.myRequests, {});
    expect(loan.activity[0].label).toBe("New request notification sent");
  });

  test("is skipped, visibly, when the webhook is not configured", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "");
    const calls = stubFetch(() => new Response("{}"));
    const t = setup();
    const admin = await signIn(t, "Admin");
    await loanScenario(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(0);
    const { notifications } = await admin.as.query(api.automation.overview, {});
    expect(notifications).toMatchObject([{ status: "skipped" }]);
  });
});

describe("n8n HTTP endpoints", () => {
  beforeEach(() => {
    stubFetch(() => new Response("{}", { status: 200 }));
  });

  /** An approved loan that was due `daysAgo` days ago. */
  async function overdueLoan(t: T, daysAgo: number) {
    const scenario = await loanScenario(t, { startDate: day(0), endDate: day(1) });
    await scenario.owner.as.mutation(api.loans.decide, {
      loanId: scenario.loanId,
      decision: "approved",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(scenario.loanId, {
        startDate: day(-daysAgo - 2),
        endDate: day(-daysAgo),
      });
    });
    return scenario;
  }

  test("reject unsigned, wrongly signed, and stale requests", async () => {
    const t = setup();
    const path = "/n8n/overdue-loans";

    expect((await t.fetch(path, { method: "GET" })).status).toBe(401);
    expect((await signedFetch(t, "GET", path, undefined, { secret: "wrong" })).status).toBe(401);
    const stale = Date.now() - 10 * 60 * 1000;
    expect((await signedFetch(t, "GET", path, undefined, { timestamp: stale })).status).toBe(401);
    expect((await signedFetch(t, "GET", path)).status).toBe(200);

    // A signature is bound to its method and path.
    const timestamp = String(Date.now());
    const signature = await hmacSha256Hex(
      API_SECRET,
      requestSigningString(timestamp, "GET", path, ""),
    );
    const replayed = await t.fetch("/n8n/reminders", {
      method: "POST",
      headers: { "X-LendLoop-Timestamp": timestamp, "X-LendLoop-Signature": signature },
      body: "",
    });
    expect(replayed.status).toBe(401);
  });

  test("refuse to run when the secret is not configured", async () => {
    vi.stubEnv("LENDLOOP_API_SECRET", "");
    const t = setup();
    expect((await signedFetch(t, "GET", "/n8n/overdue-loans")).status).toBe(503);
  });

  test("list only overdue, approved loans with the fields a reminder needs", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t, 3);

    const response = await signedFetch(t, "GET", "/n8n/overdue-loans");
    expect(await response.json()).toEqual({
      today: day(0),
      loans: [
        {
          loanId,
          reminderDate: day(0),
          toolName: "Cordless drill",
          dueDate: day(-3),
          daysOverdue: 3,
          borrower: { name: "Borrower", email: "borrower@example.com" },
        },
      ],
    });
  });

  test("loans that are not overdue, or already returned, are left out", async () => {
    const t = setup();
    const { owner, loanId } = await overdueLoan(t, 2);
    await t.run(async (ctx) => {
      await ctx.db.patch(loanId, { endDate: day(0) }); // due today: not overdue yet
    });
    let body = await (await signedFetch(t, "GET", "/n8n/overdue-loans")).json();
    expect(body.loans).toEqual([]);

    await t.run(async (ctx) => {
      await ctx.db.patch(loanId, { endDate: day(-2) });
    });
    await owner.as.mutation(api.loans.markReturned, { loanId });
    body = await (await signedFetch(t, "GET", "/n8n/overdue-loans")).json();
    expect(body.loans).toEqual([]);
  });

  test("reminder write-back is idempotent and stops repeat reminders", async () => {
    const t = setup();
    const { borrower, loanId } = await overdueLoan(t, 2);
    const reminder = { loanId, reminderDate: day(0), status: "sent", channel: "email" };

    const first = await signedFetch(t, "POST", "/n8n/reminders", reminder);
    expect(await first.json()).toEqual({ ok: true, created: true, status: "sent" });
    // n8n retries the same write-back: no second record.
    const retry = await signedFetch(t, "POST", "/n8n/reminders", reminder);
    expect(await retry.json()).toEqual({ ok: true, created: false, status: "sent" });
    // A late "failed" report never downgrades a reminder that was sent.
    const late = await signedFetch(t, "POST", "/n8n/reminders", { ...reminder, status: "failed" });
    expect(await late.json()).toEqual({ ok: true, created: false, status: "sent" });

    const rows = await t.run((ctx) => ctx.db.query("reminders").collect());
    expect(rows).toHaveLength(1);

    // Re-running the workflow today finds nothing left to remind.
    const again = await (await signedFetch(t, "GET", "/n8n/overdue-loans")).json();
    expect(again.loans).toEqual([]);

    const [loan] = await borrower.as.query(api.loans.myRequests, {});
    expect(loan.activity).toContainEqual(
      expect.objectContaining({ label: "Overdue reminder sent", tone: "ok" }),
    );
  });

  test("a failed reminder stays due and can later be recorded as sent", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t, 1);
    const reminder = { loanId, reminderDate: day(0), status: "failed", error: "SMTP down" };

    await signedFetch(t, "POST", "/n8n/reminders", reminder);
    const due = await (await signedFetch(t, "GET", "/n8n/overdue-loans")).json();
    expect(due.loans).toHaveLength(1);

    const fixed = await signedFetch(t, "POST", "/n8n/reminders", { ...reminder, status: "sent" });
    expect(await fixed.json()).toEqual({ ok: true, created: false, status: "sent" });
    expect(await t.run((ctx) => ctx.db.query("reminders").collect())).toHaveLength(1);
  });

  test("reminder write-back validates its input", async () => {
    const t = setup();
    const bad = await signedFetch(t, "POST", "/n8n/reminders", { loanId: "x" });
    expect(bad.status).toBe(400);
    const unknown = await signedFetch(t, "POST", "/n8n/reminders", {
      loanId: "not-a-loan",
      reminderDate: day(0),
      status: "sent",
    });
    expect(unknown.status).toBe(422);
  });

  test("workflow errors are recorded once per execution and shown to admins", async () => {
    const t = setup();
    const admin = await signIn(t, "Admin");
    const report = {
      executionId: "231",
      workflowName: "LendLoop - Overdue reminders",
      nodeName: "Send reminder email",
      message: "Connection refused",
    };
    const first = await signedFetch(t, "POST", "/n8n/workflow-errors", report);
    expect(await first.json()).toEqual({ ok: true, created: true });
    const retry = await signedFetch(t, "POST", "/n8n/workflow-errors", report);
    expect(await retry.json()).toEqual({ ok: true, created: false });

    const { errors } = await admin.as.query(api.automation.overview, {});
    expect(errors).toMatchObject([{ workflowName: report.workflowName, message: report.message }]);
    await admin.as.mutation(api.automation.resolveError, { errorId: errors[0]._id });
    expect((await admin.as.query(api.automation.overview, {})).errors).toEqual([]);
  });
});

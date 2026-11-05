import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { day, drill, setup, signIn } from "./test.setup";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public access", () => {
  test("landing list exposes only name and category of available tools", async () => {
    const t = setup();
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    const drillId = await ana.as.mutation(api.tools.create, drill);
    const sawId = await ana.as.mutation(api.tools.create, { ...drill, name: "Hand saw" });
    await ana.as.mutation(api.tools.create, { ...drill, name: "Removed ladder" }).then(
      (toolId) => ana.as.mutation(api.tools.remove, { toolId }),
    );
    // Put the saw on loan so it is no longer "available".
    const loanId = await ben.as.mutation(api.loans.request, {
      toolId: sawId,
      startDate: day(0),
      endDate: day(2),
    });
    await ana.as.mutation(api.loans.decide, { loanId, decision: "approved" });

    const tools = await t.query(api.tools.listPublic, {});
    expect(tools).toEqual([
      { _id: drillId, name: "Cordless drill", category: "power_tools" },
    ]);
  });

  test("signed-out callers cannot read or write anything else", async () => {
    const t = setup();
    await expect(t.query(api.tools.list, {})).rejects.toThrow("Sign in");
    await expect(t.query(api.tools.mine, {})).rejects.toThrow("Sign in");
    await expect(t.query(api.loans.myRequests, {})).rejects.toThrow("Sign in");
    await expect(t.query(api.loans.incoming, {})).rejects.toThrow("Sign in");
    await expect(t.query(api.loans.listAll, {})).rejects.toThrow("Sign in");
    await expect(t.mutation(api.tools.create, drill)).rejects.toThrow("Sign in");
    await expect(t.mutation(api.users.ensure, {})).rejects.toThrow("Sign in");
    expect(await t.query(api.users.me, {})).toBeNull();
  });
});

describe("roles", () => {
  test("new users are plain users and cannot choose their role", async () => {
    const t = setup();
    const ana = await signIn(t, "Ana");
    const me = await ana.as.query(api.users.me, {});
    expect(me).toMatchObject({ role: "user", trustedLender: false });
    // `ensure` takes no arguments, so there is nothing to tamper with.
    // @ts-expect-error role is not an accepted argument
    await expect(ana.as.mutation(api.users.ensure, { role: "admin" })).rejects.toThrow();
  });

  test("ADMIN_EMAILS promotes only verified addresses", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com, other@example.com");
    const t = setup();
    const spoof = await signIn(t, "Spoof", { email: "boss@example.com", emailVerified: false });
    expect(await spoof.as.query(api.users.me, {})).toMatchObject({ role: "user" });
    const boss = await signIn(t, "Boss", { email: "Boss@Example.com" });
    expect(await boss.as.query(api.users.me, {})).toMatchObject({ role: "admin" });
  });

  test("admin-only functions reject regular users", async () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    const t = setup();
    const admin = await signIn(t, "Admin");
    const ana = await signIn(t, "Ana");

    await expect(ana.as.query(api.loans.listAll, {})).rejects.toThrow("Admins only");
    await expect(ana.as.query(api.users.list, {})).rejects.toThrow("Admins only");
    await expect(ana.as.query(api.automation.overview, {})).rejects.toThrow("Admins only");
    await expect(
      ana.as.mutation(api.users.setTrustedLender, { userId: ana.userId, trusted: true }),
    ).rejects.toThrow("Admins only");

    await admin.as.mutation(api.users.setTrustedLender, { userId: ana.userId, trusted: true });
    expect(await ana.as.query(api.users.me, {})).toMatchObject({ trustedLender: true });
    expect(await admin.as.query(api.loans.listAll, {})).toEqual([]);
    expect(await admin.as.query(api.users.list, {})).toHaveLength(2);
  });
});

describe("listings", () => {
  test("users can edit and delete only their own; admin can remove any", async () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    const t = setup();
    const admin = await signIn(t, "Admin");
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    const toolId = await ana.as.mutation(api.tools.create, drill);

    await expect(
      ben.as.mutation(api.tools.update, { toolId, ...drill, name: "Mine now" }),
    ).rejects.toThrow("only edit your own");
    await expect(ben.as.mutation(api.tools.remove, { toolId })).rejects.toThrow(
      "only remove your own",
    );
    // Admins may remove a listing but not rewrite it.
    await expect(
      admin.as.mutation(api.tools.update, { toolId, ...drill, name: "Edited" }),
    ).rejects.toThrow("only edit your own");

    await ana.as.mutation(api.tools.update, { toolId, ...drill, name: "Drill v2" });
    expect((await ana.as.query(api.tools.mine, {}))[0].name).toBe("Drill v2");

    await admin.as.mutation(api.tools.remove, { toolId });
    expect(await ana.as.query(api.tools.mine, {})).toEqual([]);
    expect(await ben.as.query(api.tools.list, {})).toEqual([]);
  });

  test("board hides owner contact details and filters by category", async () => {
    const t = setup();
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    await ana.as.mutation(api.tools.create, drill);
    await ana.as.mutation(api.tools.create, { ...drill, name: "Tent", category: "camping" });

    const all = await ben.as.query(api.tools.list, {});
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ ownerName: "Ana", isMine: false, status: "available" });
    expect(JSON.stringify(all)).not.toContain("ana@example.com");

    const camping = await ben.as.query(api.tools.list, { category: "camping" });
    expect(camping.map((tool) => tool.name)).toEqual(["Tent"]);
  });

  test("input is validated on the server", async () => {
    const t = setup();
    const ana = await signIn(t, "Ana");
    await expect(ana.as.mutation(api.tools.create, { ...drill, name: " " })).rejects.toThrow(
      "Name must be",
    );
    await expect(
      // @ts-expect-error not a known category
      ana.as.mutation(api.tools.create, { ...drill, category: "weapons" }),
    ).rejects.toThrow();
  });
});

describe("loans", () => {
  async function scenario() {
    const t = setup();
    const owner = await signIn(t, "Owner");
    const borrower = await signIn(t, "Borrower");
    const stranger = await signIn(t, "Stranger");
    const toolId = await owner.as.mutation(api.tools.create, drill);
    const loanId = await borrower.as.mutation(api.loans.request, {
      toolId,
      startDate: day(1),
      endDate: day(3),
    });
    return { t, owner, borrower, stranger, toolId, loanId };
  }

  test("requests are validated", async () => {
    const { owner, borrower, stranger, toolId } = await scenario();
    const range = { startDate: day(1), endDate: day(3) };
    await expect(owner.as.mutation(api.loans.request, { toolId, ...range })).rejects.toThrow(
      "your own tool",
    );
    await expect(borrower.as.mutation(api.loans.request, { toolId, ...range })).rejects.toThrow(
      "already have a pending request",
    );
    await expect(
      stranger.as.mutation(api.loans.request, { toolId, startDate: day(3), endDate: day(1) }),
    ).rejects.toThrow("end date");
    await expect(
      stranger.as.mutation(api.loans.request, { toolId, startDate: day(-5), endDate: day(1) }),
    ).rejects.toThrow("in the past");
    await expect(
      stranger.as.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(60) }),
    ).rejects.toThrow("limited to");
    await expect(
      stranger.as.mutation(api.loans.request, { toolId, startDate: "tomorrow", endDate: day(1) }),
    ).rejects.toThrow("valid start and end date");
  });

  test("only the owner can approve or decline", async () => {
    const { owner, borrower, stranger, loanId } = await scenario();
    for (const who of [borrower, stranger]) {
      await expect(
        who.as.mutation(api.loans.decide, { loanId, decision: "approved" }),
      ).rejects.toThrow("Only the tool's owner");
    }
    await owner.as.mutation(api.loans.decide, { loanId, decision: "approved" });
    await expect(
      owner.as.mutation(api.loans.decide, { loanId, decision: "declined" }),
    ).rejects.toThrow("already been handled");
  });

  test("only the borrower can cancel, and only while pending", async () => {
    const { owner, borrower, stranger, loanId } = await scenario();
    for (const who of [owner, stranger]) {
      await expect(who.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(
        "only cancel your own",
      );
    }
    await borrower.as.mutation(api.loans.cancel, { loanId });
    await expect(borrower.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(
      "Only pending",
    );
  });

  test("only the owner can mark an active loan returned", async () => {
    const { owner, borrower, stranger, toolId, loanId } = await scenario();
    await expect(owner.as.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(
      "Only an active loan",
    );
    await owner.as.mutation(api.loans.decide, { loanId, decision: "approved" });
    for (const who of [borrower, stranger]) {
      await expect(who.as.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(
        "Only the tool's owner",
      );
    }

    // While on loan, nobody else can request or be approved for it.
    const board = await stranger.as.query(api.tools.list, {});
    expect(board[0]).toMatchObject({ status: "on_loan", dueDate: day(3) });
    await expect(
      stranger.as.mutation(api.loans.request, { toolId, startDate: day(5), endDate: day(6) }),
    ).rejects.toThrow("currently on loan");

    await owner.as.mutation(api.loans.markReturned, { loanId });
    expect((await stranger.as.query(api.tools.list, {}))[0].status).toBe("available");
  });

  test("each side sees only loans they are part of", async () => {
    const { owner, borrower, stranger } = await scenario();
    expect(await borrower.as.query(api.loans.myRequests, {})).toHaveLength(1);
    expect(await borrower.as.query(api.loans.incoming, {})).toHaveLength(0);
    expect(await owner.as.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await owner.as.query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await stranger.as.query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await stranger.as.query(api.loans.incoming, {})).toHaveLength(0);
  });

  test("removing a listing declines its pending requests", async () => {
    const { owner, borrower, toolId } = await scenario();
    await owner.as.mutation(api.tools.remove, { toolId });
    const [loan] = await borrower.as.query(api.loans.myRequests, {});
    expect(loan).toMatchObject({ status: "declined", toolRemoved: true });
  });
});

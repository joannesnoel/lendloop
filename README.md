# LendLoop

**Borrow what you need. Lend what you don't.**

A neighborhood tool-lending board. Neighbors list tools they are willing to
lend, request to borrow from each other, and get notifications and overdue
reminders from n8n workflows.

- **Next.js 16** (App Router) + **TypeScript** + Tailwind CSS
- **Clerk** for authentication
- **Convex** for data, backend logic, and access control
- **n8n** (self-hosted) for workflow automation
- Runs locally with Docker, or on Kubernetes with a self-hosted Convex backend

**Live demo:** https://lendloop.creativelogik.net (sign up with any email to
try it).

| Looking for | Where |
| --- | --- |
| Local setup, including n8n with Docker | [Getting started](#getting-started), `n8n/docker-compose.yml` |
| Environment variables | [Environment variables](#environment-variables) |
| Architecture | [Architecture](#architecture), [Automation](#automation) |
| Access control | [Roles and access control](#roles-and-access-control), `convex/lib/auth.ts`, `convex/access.test.ts` |
| Security decisions | [Security, both directions](#security-both-directions) |
| Data-minimization decisions | [Data minimization](#data-minimization) |
| Idempotency, retries, error workflow | [Idempotency](#idempotency), [Failures are visible](#failures-are-visible) |
| Exported n8n workflows | `n8n/workflows/` |
| What I would change for production | [Running this in production](#running-this-in-production) |

## What's in the app

| Page | Who | What |
| --- | --- | --- |
| `/` | Everyone | Tagline, read-only list of available tools (name and category only), "Sign in to lend or borrow" |
| `/board` | Signed in | All tools with availability, filter by category, request to borrow for a date range |
| `/listings` | Signed in | My listings: create, edit, delete |
| `/requests` | Signed in | My requests: status, cancel while pending |
| `/incoming` | Signed in | Requests on my tools: approve, decline, mark returned |
| `/admin` | Admins | All loans, remove any listing, mark Trusted Lenders, automation failures |

Every loan card shows its recent automation activity, for example
"Approval notification sent 3 hours ago" or "Overdue reminder sent 2 days ago".

On phones the navigation is a tab bar fixed to the bottom of the screen; on
wider screens it is a row of tabs under the header.

## Architecture

```
 Browser ──▶ Next.js (App Router)        pages, Clerk session, no business logic
    │
    │ websocket + Clerk JWT
    ▼
 Convex                                  data, every rule, the outbox
    │  ▲
    │  │ signed HTTP (overdue loans, reminder results, error reports)
    ▼  │
 n8n                                     notifications, daily reminders, error handler
    │
    ▼
 SMTP
```

- **Next.js** renders the pages and holds the Clerk session. It never talks
  to the database on a user's behalf: the browser calls Convex directly with
  the user's Clerk token.
- **Convex** is the only place rules are decided. Each function authenticates
  the caller from the verified token, then checks role and ownership of the
  record it touches. The UI hides what you cannot do; Convex refuses it.
- **n8n** does the slow, failure-prone work (email) outside the request path.
  Convex writes an outbox row in the same transaction as the change and
  delivers it to n8n with retries, so a slow or broken n8n never blocks or
  loses a user action.
- Convex and n8n authenticate each other with HMAC signatures, one secret per
  direction. Details are under [Automation](#automation).

## Getting started

You need Node 20+, Docker, a [Clerk](https://clerk.com) app, and a
[Convex](https://convex.dev) account (or a local Convex deployment).

### 1. Install and connect Convex

```bash
npm install
npx convex dev        # creates the deployment, writes .env.local, keeps running
```

The first push stops with a message that `CLERK_JWT_ISSUER_DOMAIN` is not set.
That is expected; step 2 sets it.

### 2. Connect Clerk

1. In the Clerk dashboard, create a **JWT template** from the **Convex** preset
   and keep its name `convex`. The app relies on the `name`, `email`, and
   `email_verified` claims that preset includes.
2. Copy the template's **Issuer** URL (your Clerk Frontend API URL) and give it
   to Convex:

   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
   ```

3. Copy `.env.example` to `.env.local` (keep the Convex lines already there)
   and add your Clerk keys:

   ```bash
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```

### 3. Choose your admins

```bash
npx convex env set ADMIN_EMAILS you@example.com
```

Anyone who signs in with a **verified** address on that list becomes an admin.
You can also promote or demote someone who has already signed in:

```bash
npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
```

### 4. Start n8n

```bash
cp n8n/.env.example n8n/.env
# Put two different secrets in n8n/.env, each from:  openssl rand -hex 32
npm run n8n:setup
```

The script starts n8n and [Mailpit](https://mailpit.axllent.org) (a local inbox
that catches every email), stores the secrets as encrypted n8n credentials,
and imports and publishes the three workflows. It is safe to re-run.

Then give Convex the same two secrets and the webhook URL the script prints:

```bash
npx convex env set N8N_WEBHOOK_URL http://localhost:5678/webhook/lendloop/loan-events
npx convex env set LENDLOOP_WEBHOOK_SECRET <LENDLOOP_WEBHOOK_SECRET from n8n/.env>
npx convex env set LENDLOOP_API_SECRET <LENDLOOP_API_SECRET from n8n/.env>
```

Convex and n8n have to reach each other:

- **Convex cloud + n8n on your machine:** set `LENDLOOP_CONVEX_SITE_URL` in
  `n8n/.env` to `https://<deployment>.convex.site`, and expose n8n through a
  tunnel (or use n8n Cloud) so Convex can call the webhook. Use the public URL
  in `N8N_WEBHOOK_URL`.
- **Everything local:** run Convex with a local deployment
  (`npx convex dev --configure new --dev-deployment local`). The defaults in
  `n8n/.env.example` already point at it.

The first time you open the n8n editor at http://localhost:5678 it asks you to
create an owner account for that instance.

### 5. Run the app

```bash
npm run dev           # http://localhost:3000
```

Sent emails appear at http://localhost:8025.

## Environment variables

| Variable | Lives in | Secret | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` | No | Clerk, browser side |
| `CLERK_SECRET_KEY` | `.env.local` | Yes | Clerk, server side |
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` | `.env.local` (written by `npx convex dev`) | No | Which Convex deployment to use |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | No | Whose tokens Convex accepts |
| `ADMIN_EMAILS` | Convex | No | Verified addresses that become admins |
| `N8N_WEBHOOK_URL` | Convex | No | Where notifications are delivered |
| `LENDLOOP_WEBHOOK_SECRET` | Convex, and `n8n/.env` → n8n credential | Yes | Signs Convex → n8n |
| `LENDLOOP_API_SECRET` | Convex, and `n8n/.env` → n8n credential | Yes | Signs n8n → Convex |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | `n8n/.env` → n8n credential | Password | Outgoing mail (defaults to Mailpit) |
| `LENDLOOP_CONVEX_SITE_URL`, `LENDLOOP_FROM_EMAIL`, `LENDLOOP_ALERT_EMAIL` | `n8n/.env` → n8n container | No | Workflow settings |
| `N8N_PORT`, `MAILPIT_UI_PORT`, `TZ` | `n8n/.env` | No | Local ports and the schedule's timezone |

`.env.example` and `n8n/.env.example` list them with comments. Both real files
are git-ignored. Convex variables are set with `npx convex env set`, never
through a file in the repository.

## Deploying to Kubernetes

`./deploy.sh` rolls the whole thing out to the k3s cluster, namespace
`lendloop`, at https://lendloop.creativelogik.net.

```
 Cloudflare Tunnel ─▶ ingress-nginx ─┬─ /     ─▶ web     (Next.js, this repo's Dockerfile)
                                     └─ /api  ─▶ convex  (self-hosted Convex, SQLite on Longhorn)

 convex ──signed webhook──▶ n8n (namespace n8n) ──signed HTTP──▶ convex:3211
          both hops stay inside the cluster
```

| File | What |
| --- | --- |
| `Dockerfile` | Next.js standalone image |
| `k8s/10-convex.yaml` | Convex backend: PVC, Deployment, Service |
| `k8s/20-web.yaml` | Web Deployment and Service |
| `k8s/30-ingress.yaml` | The public hostname |
| `k8s/set-clerk.sh` | Stores the Clerk keys and admin emails as a Secret |
| `k8s/set-smtp.sh` | Stores the SMTP account for workflow emails as a Secret |
| `k8s/convex.sh` | Convex CLI pointed at the cluster backend |
| `scripts/n8n-k8s.mjs` | Loads credentials and workflows into the cluster's n8n |

### First time

1. In Clerk, create the `convex` JWT template (step 2 of *Getting started*).
2. Store the Clerk keys and the admin emails, then deploy:

   ```bash
   k8s/set-clerk.sh
   ./deploy.sh
   ```

   The admin emails have to be addresses you actually sign in with. If you
   sign in with a different one, promote that account afterwards with
   `users:setRole` (see *Operating it*).

3. In the Cloudflare Zero Trust dashboard, add a public hostname to the
   tunnel: `lendloop.creativelogik.net` → `http://192.168.0.241`.

`deploy.sh` is safe to re-run and is also how you ship a change. Each run:

- generates the signing secrets and the Convex instance secret once, into
  Secret `lendloop-secrets`, and never changes them afterwards;
- sets the Convex environment variables (the Clerk issuer is read from the
  publishable key) and pushes the functions in `convex/`;
- builds the web image, pushes it to the local registry, and rolls it out;
- loads the n8n credentials and workflows, but only when they changed, because
  n8n has to restart (about a minute) for published workflows to go live.

### Where things live in the cluster

- **Secrets** (none in git): `lendloop-secrets` (generated), `lendloop-clerk`
  (`k8s/set-clerk.sh`), and `lendloop-smtp` (`k8s/set-smtp.sh`). The HMAC
  secrets reach Convex as environment variables and n8n as encrypted
  credentials, and so does the SMTP account on the n8n side.
- **Convex's HTTP endpoints for n8n** (port 3211) have no ingress. Only the
  client API under `/api` is public, so the Next.js app must not define
  routes under `/api`.
- **n8n's webhook** is public, like the rest of n8n, at
  `https://n8n.creativelogik.net/webhook/lendloop/loan-events`. It answers 401
  to anything not signed with the webhook secret.
- **Workflow settings:** the cluster's n8n does not let workflows read `$env`,
  so `scripts/n8n-k8s.mjs` writes the three non-secret settings into the
  workflows as literals when it imports them. Edit `n8n/workflows/`, not the
  copies in the n8n editor: the next import overwrites those.
- **The overdue check** runs at 09:00 Asia/Manila, the cluster n8n's timezone.

### Clerk instance

The deployment runs on a Clerk **development** instance (`pk_test_` keys). It
works on any domain with no DNS setup, but shows a "Development mode" badge on
the sign-in screens and has Clerk's development usage limits. To move to a
production instance, create one in Clerk (it asks for DNS records on the
domain), add the `convex` JWT template there too, and re-run `k8s/set-clerk.sh`
and `./deploy.sh` with the `pk_live_` / `sk_live_` keys. Accounts do not carry
over from the development instance.

### Email

Workflow emails are sent through Brevo (`smtp-relay.brevo.com`, port 587,
STARTTLS) as `LendLoop <lendloop@creativelogik.net>`. The account is in Secret
`lendloop-smtp`; `deploy.sh` copies it into n8n as an encrypted credential.

```bash
k8s/set-smtp.sh             # asks for the Brevo SMTP login, key and sender
k8s/set-smtp.sh --from-n8n  # or reuse the Brevo account n8n already has
./deploy.sh
```

To change only the sender address:

```bash
kubectl -n lendloop patch secret lendloop-smtp --type merge \
  -p '{"stringData":{"from":"LendLoop <someone@creativelogik.net>"}}'
./deploy.sh
```

- **Deliverability:** `creativelogik.net` is authenticated with Brevo (DKIM
  and DMARC pass). A new sender address can still land in Gmail's junk at
  first; marking the first messages "Not spam" usually fixes that per recipient.
- **Replies:** incoming mail for the domain is handled by iCloud Mail, so the
  sender address only receives replies if it exists there as an alias.
- **Testing:** every notification is a real email. Do not run test
  requests between accounts with made-up addresses: the bounces count against
  the sender.
- **Without `lendloop-smtp`**, emails fall back to the cluster's MailHog
  catcher (`mailhog.mailhog`), which is a shared test inbox. Do not leave a
  deployment with real users in that state.

Failure alerts from the error workflow go to the first admin email.

### Operating it

```bash
k8s/convex.sh logs                       # function logs
k8s/convex.sh data loans                 # look at a table
k8s/convex.sh run users:setRole '{"email":"you@example.com","role":"admin"}'
kubectl -n lendloop get pods
```

The data is the `convex-data` volume. `k8s/convex.sh export --path backup.zip`
takes a snapshot; `k8s/convex.sh import backup.zip` restores one.

## Roles and access control

Roles live in the Convex `users` table and are checked inside Convex
functions, so they hold no matter what a client sends. The UI only hides what
you could not do anyway.

| Action | User | Admin |
| --- | --- | --- |
| Create a listing | Yes | Yes |
| Edit a listing | Own only | Own only |
| Delete a listing | Own only | Any |
| Request to borrow | Not own tools | Not own tools |
| Cancel a request | Own, while pending | Own, while pending |
| Approve / decline | Requests on own tools | Requests on own tools |
| Mark returned | Loans of own tools | Loans of own tools |
| See loans | Own borrowing and lending | All |
| Mark Trusted Lender | No | Yes |
| See automation failures, retry notifications | No | Yes |

How it is enforced:

- `convex/lib/auth.ts` has `requireUser` and `requireAdmin`. Every non-public
  function starts with one of them, then checks ownership of the specific
  record it touches.
- `users.ensure` takes no arguments. Name, email, and identity come from the
  verified Clerk token, so nobody can pick their own role.
- The public landing query returns only `_id`, `name`, and `category`. The
  signed-in board shows an owner's display name and badge, never their email.
- Role changes and everything n8n calls are `internal` functions, unreachable
  from the browser.
- `convex/access.test.ts` covers these rules, including the negative cases.

A few rules the brief left open, and what I chose:

- The **lender** marks a loan returned (they are the one who has the tool back).
- A tool can be requested only while it is available, and approving a request
  puts it on loan until it is returned.
- Deleting a listing hides it, declines its pending requests, and keeps any
  active loan open so it can still be returned.

## Automation

```
 Convex mutation ──▶ outbox row ──▶ signed webhook ──▶ n8n: Request notification ──▶ email
                                                              │ on failure
                                                              ▼
 Convex /n8n/workflow-errors ◀── signed ── n8n: Error handler ──▶ alert email

 n8n: Overdue reminders (daily 09:00)
   ├─ signed GET  /n8n/overdue-loans  ──▶ Convex
   ├─ email each borrower
   └─ signed POST /n8n/reminders      ──▶ Convex (idempotent)
```

The exported workflows are in `n8n/workflows/`.

### Request notification

When a request is created, approved, declined, cancelled, or returned, the
mutation writes a `notificationEvents` row in the same transaction and
schedules delivery. The notification therefore exists exactly when the change
committed, and a slow n8n never blocks a user.

The webhook body carries only what the message needs: the recipient's name and
email, the other person's display name, the tool name, the dates, and the
status. The workflow verifies the signature, composes the message, and emails
the relevant person (the owner for a new or cancelled request, the borrower
for a decision or a return).

### Overdue reminders

Runs daily. It fetches approved loans past their end date, emails each
borrower, and writes the outcome back. The workflow also has a manual trigger
so you can run it from the editor.

### Security, both directions

| | Convex → n8n | n8n → Convex |
| --- | --- | --- |
| Secret | `LENDLOOP_WEBHOOK_SECRET` | `LENDLOOP_API_SECRET` |
| Header | `X-LendLoop-Signature: sha256=<hex>` | same, plus `X-LendLoop-Timestamp` |
| Signed content | The raw request body, which includes `sentAt` | `timestamp.METHOD.path.body` |
| Verified by | Crypto node (HMAC of the raw body) + constant-time compare | `convex/lib/signing.ts` via Web Crypto `verify` |
| Replay window | 5 minutes | 5 minutes |

- Two different secrets, so a message signed for one direction is never valid
  in the other.
- Signing the method and path means a signature for one endpoint cannot be
  replayed against another.
- **Where secrets live:** in Convex environment variables and in n8n's
  encrypted credential store (two *Crypto* credentials and one *SMTP*
  credential). They are not in the code, not in the workflow JSON (which
  references credentials by id only), and not in the n8n container's
  environment. The setup script pipes them to n8n over stdin.
- The workflows read three non-secret settings (`LENDLOOP_CONVEX_SITE_URL`,
  `LENDLOOP_FROM_EMAIL`, `LENDLOOP_ALERT_EMAIL`) from `$env`. The local Docker
  setup turns `N8N_BLOCK_ENV_ACCESS_IN_NODE` off to allow that. The cluster's
  n8n keeps it on, so `scripts/n8n-k8s.mjs` writes the values in as literals
  on import. On n8n Cloud, where `$env` is not available either, replace the
  three expressions by hand.

### Data minimization

Each hop gets only what it needs to do its job.

- **Signed-out visitors** get a tool's name and category, nothing else: no
  owner, description, or condition. The query returns only those fields, so
  it is not a matter of the page hiding them.
- **Members** see a lender's display name and Trusted Lender badge. Email
  addresses never reach another member's browser; only admins can list them.
- **The `users` table** holds a name, an email, a role, the trusted flag, and
  Clerk's identifier. Passwords and sessions stay with Clerk.
- **The notification webhook** carries the recipient's name and email, the
  other person's display name (not their email), the tool name, the dates,
  and the status. The workflow's first step after verifying the signature
  drops everything except those fields.
- **The overdue endpoint** returns, per loan, the tool name, the due date,
  the days overdue, and the borrower's name and email. Nothing about the
  lender, and no loan that was already reminded today.
- **Error reports** from n8n contain the execution id, workflow and node
  names, the error message, and a link. The payload that triggered the run
  is not included.
- **Browsers** get the app's own error messages but not server logs or stack
  traces (`REDACT_LOGS_TO_CLIENT` on the cluster's Convex).

What is not minimized yet: n8n keeps the input of each execution, which
includes recipient addresses. See the production notes.

### Idempotency

- **Reminder write-back** is keyed on `loanId:reminderDate`. A retried POST
  finds the existing row and returns `created: false`. Convex mutations are
  serializable transactions, so two concurrent retries cannot both insert.
  `sent` is final; a `failed` row can later become `sent`.
- **Reminders themselves:** the overdue endpoint leaves out any loan already
  reminded successfully today, so re-running the workflow sends nothing twice.
- **Workflow error reports** are keyed on the n8n execution id.
- **Notifications** are at-least-once. Convex retries only when n8n did not
  answer 2xx, and the workflow answers only after the email is sent, so a
  duplicate needs a lost response. Each event carries a stable `eventId`.

One edge remains: if an email is sent and every write-back retry then fails,
the next run that day sends that reminder again. Closing it would need a
claim step before sending, at the cost of sometimes skipping a reminder.

### Failures are visible

- **Convex → n8n:** up to 5 attempts with backoff (30 s, 2 min, 10 min, 1 h).
  After that the event is marked `failed`, shows on the loan and in the admin
  page, and an admin can retry it. If the webhook is not configured the event
  is marked `skipped` rather than dropped.
- **Inside n8n:** email and HTTP nodes retry on failure. A reminder email that
  still fails is written back as `failed` (it shows on the loan) and the run
  is deliberately failed.
- **Error workflow:** both workflows name *LendLoop - Error handler* as their
  error workflow. It reports the failed execution to Convex, where it appears
  under **Admin → Automation issues** with a link to the n8n execution, and
  emails `LENDLOOP_ALERT_EMAIL`.

## Running this in production

What exists is sized for a take-home and a small live demo. Before real
neighbors depended on it I would change the following.

**Data and availability**

- Convex is one replica on SQLite with one volume. Move to Convex Cloud, or
  self-hosted Convex on managed Postgres, with scheduled snapshot exports
  kept somewhere else and a tested restore.
- n8n likewise: Postgres instead of SQLite, queue mode with separate workers,
  and execution data pruned after a few days because it contains addresses.
- Two web replicas behind a disruption budget.

**Security**

- Secrets in a managed store (AWS Secrets Manager through External Secrets,
  for example) instead of hand-made Kubernetes Secrets, with a rotation
  routine. HMAC rotation needs a window where the receiver accepts both the
  old and the new secret; today a rotation briefly rejects in-flight calls.
- The n8n editor off the public internet (SSO or an access proxy), with only
  the webhook path exposed.
- A network policy so only n8n can reach Convex's HTTP endpoints. They are
  already unexposed and signed; this adds a second layer.
- A content security policy and the usual security headers on the web app,
  and rate limits on creating listings and requests.
- A production Clerk instance, with sign-up restricted to the neighborhood
  (invitations or an allow-list) rather than open to anyone.

**Privacy and audit**

- An append-only audit log of who approved, declined, removed, or changed a
  role, and when. Today the loan and listing rows record the outcome but not
  a full history.
- Account deletion that removes a member's data in Convex when Clerk reports
  the user deleted, a retention period for finished loans, and a way to turn
  notification emails off.

**Reliability and observability**

- Error tracking and structured logs (Sentry, Datadog) for the web app and
  Convex functions, and alerts on what the admin page already shows: failed
  notifications and failed workflow runs.
- Close the remaining duplicate-reminder edge with a claim step before
  sending, and handle bounces from the mail provider.
- Mail from a dedicated subdomain with a stricter DMARC policy.

**Product**

- Loans are due in UTC days. A real neighborhood needs its own timezone.
- One loan per tool at a time. Real use needs future reservations with
  overlap checks.

**Process**

- CI that runs the tests, typecheck, and lint on every pull request, builds
  the image, and deploys on merge, plus browser tests for the signed-in flows
  using Clerk's testing tokens.

## Development

```bash
npm test             # Convex function tests (access rules, signing, idempotency)
npm run typecheck
npm run lint
npm run build
```

## Project layout

```
app/                  Pages: landing, and the signed-in views under (app)/
components/           UI building blocks
convex/
  schema.ts           Tables and indexes
  lib/auth.ts         requireUser / requireAdmin
  lib/signing.ts      HMAC signing and verification
  tools.ts loans.ts users.ts   Queries and mutations
  notifications.ts    Outbox and signed webhook delivery to n8n
  reminders.ts        Overdue query and idempotent write-back
  automation.ts       Admin view of automation failures
  http.ts             Signed HTTP endpoints called by n8n
n8n/
  docker-compose.yml  n8n + Mailpit (local)
  workflows/          Exported workflow JSON
scripts/
  n8n-setup.mjs       Loads credentials and workflows into the local n8n
  n8n-k8s.mjs         The same for the n8n in the cluster
  n8n-lib.mjs         What the two loaders share
Dockerfile deploy.sh k8s/   Kubernetes deployment
```

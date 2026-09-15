# Eventsli

Event ticketing platform with interactive seat and table maps.
Markets: Canada and the United States.

```
eventsli/
├── backend/              Express API — the only thing that touches the database
├── frontend/             Next.js 16 · React 19 · Tailwind 4 — see docs/FRONTEND-PLAN.md
├── supabase/migrations/  Timestamped migrations. One baseline, then forward only.
├── docs/                 Decisions that outlive a commit message
├── .github/workflows/    CI: units, integration on a local Supabase, migrations
└── ecosystem.config.js   pm2 — cluster for the API, fork for Next
```

## Getting started

```bash
npm install                      # installs both workspaces
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# fill both in — REVALIDATE_SECRET must hold the SAME value in each — then:
npm run dev:backend              # http://localhost:5000/api/v1/health
npm run dev:frontend             # http://localhost:3000
npm run test:backend
npm run check:frontend           # three static checks, no dev server needed
npm run test:frontend
```

The API refuses to boot on a bad configuration rather than failing later:

- a missing required secret,
- `PAYMENTS_STRIPE_ENABLED=true` without Stripe keys,
- `RESERVATION_TTL_MINUTES` shorter than a Stripe Checkout session.

## Conventions

| Rule | Why |
|---|---|
| Every amount is an **integer number of cents** | `parseFloat("19.99") * 100` is not 1999 |
| All money math goes through `utils/money.js` | One place to audit, one place to test |
| The browser never queries Supabase | Authorisation lives in middleware, where it is testable |
| One response envelope, one error-code table | The frontend switches on a code, not on English |
| Every list endpoint is paginated | Silently truncated arrays are not a feature |
| Every external write carries an idempotency key | Retries must not duplicate money |
| Business invariants are database constraints | A rule in a controller is one code path from not existing |
| Comments explain **why**, and record the bug that caused them | The reason is the part that cannot be re-derived |

Tests use Node's built-in runner. There is no Jest, no config file:

```bash
node --test "test/*.test.js"
```

## Money model

Four independent items, per event, admin-controlled unless noted:

| Item | Base | Borne by |
|---|---|---|
| Face | organizer's price | — |
| Event tax | % of face | buyer; organizer remits |
| Eventsli commission (1.5%) | % of face | **organizer, always** |
| Payment fee (% + fixed) | % of subtotal + fixed per order | **organizer's choice**: buyer or organizer |

The commission and the payment fee are deliberately separate. The commission is
margin; the payment fee recovers what Stripe costs us. Merged into one number,
neither question can be answered.

`describeOrder()` returns the real Stripe cost alongside the configured fee and
flags `belowCost` when the fee under-recovers — see the header of
`backend/utils/money.js` for the arithmetic trap this prevents.

### Payment fee: two modes, chosen deliberately

| Mode | Behaviour | Use it when |
|---|---|---|
| `auto` (default) | The fee is derived per order to match exactly what Stripe bills for that charge. Stored pct/fixed are ignored. | Always, unless there is a reason not to. The right number depends on the tax rate and on the fee itself — it is not one a person can set by hand. |
| `manual` | The admin's pct and fixed are used verbatim, never silently corrected. The real margin is computed and reported alongside. | A promotional rate, matching a competitor, or absorbing cost on a strategic event. |

`describeFeeConfig()` prices a configuration out across a range of ticket
prices so an admin can see what their numbers actually earn before saving them.

## Auth

Identity is ours, not Supabase Auth's. The browser never talks to Supabase, so
Supabase is a database here — leaning on `auth.users` while issuing our own
session cookie would mean two session systems layered on one login.

- Passwords: **PBKDF2-HMAC-SHA512**, 210k iterations, self-describing hash so the
  cost can be raised later and upgraded silently on next login.
- Sessions: our JWT in an httpOnly cookie, every one backed by a `sessions` row
  keyed on `jti`. That row is checked on every request, which is what makes
  "sign out everywhere", bans and stolen-device revocation actually work.
- Every check **fails closed**: a lookup error denies rather than allows.
- Lockout is account-scoped as well as IP-scoped — an IP limiter alone is
  bypassed by spreading attempts across addresses.
- **Email is verified before the first session.** Registering issues no cookie;
  it emails a six-digit code (`crypto.randomInt`, stored only as an HMAC keyed
  with `JWT_SECRET`, 10-minute TTL, 5 attempts, 60-second resend cooldown).
  Signing in to an unconfirmed account with the RIGHT password returns
  `403 EMAIL_NOT_VERIFIED` and sends a fresh code; a wrong password is still a
  plain 401, so the check leaks nothing to someone guessing. `verify_email_code`
  locks the row, so two parallel guesses cannot both spend attempt five.
  Resend answers identically for real and unknown addresses. Accounts that
  existed before migration `20260915090000` and Google sign-ins count as
  verified.

```
POST /auth/register  /auth/verify-email  /auth/resend-verification
POST /auth/login     /auth/logout  /auth/logout-all
GET  /auth/me        /auth/sessions
POST /auth/change-password        DELETE /auth/sessions/:jti
```

## Scripts

```bash
node scripts/verify-schema.js                        # does the DB match the migrations?
node scripts/apply-migration.js ../supabase/migrations/<file>.sql
```

## Events

An organizer submits; only an admin publishes (BRD §16). Only an admin cancels
— the organizer cannot (BRD §17) — and an admin may also suspend: a suspended
event may come back, a cancelled one never does, and nothing is ever deleted.

Two things are enforced structurally rather than by convention:

- **Field authority.** `services/eventRules.js` holds two maps: what an
  organizer may edit and what only an admin may. A field absent from both is
  un-editable by anyone, so adding a column never quietly becomes editable.
  Money rates are admin-only; `feeBearer` is the single financial field an
  organizer controls.
- **The status machine.** Allowed transitions are data, with a named actor per
  edge. `draft → published` simply does not exist.

`eventRules.js` has no imports at all, so both are testable with no database
and no environment.

**When an event stops selling.** Cancelling or suspending expires every open
Stripe Checkout Session on the event and releases its holds
(`services/openCheckouts.js`, best effort — the status change never waits on
Stripe). The session id is recorded on the reservation when checkout starts,
for exactly this. A payment that completes anyway is refused by
`fulfill_checkout`, which issues tickets only while the event is `published`;
the webhook files it as permanent and logs it at error level for review. BRD
§09 means no refund is issued or implied.

**Approving checks the organizer.** An event submitted before its organizer was
banned cannot be approved (`ORGANIZER_BANNED`).

**Edits and review (BRD §16).** The reviewer approves what they saw, so
`editConsequence` in `eventRules.js` decides what an organizer's PATCH does:

| Event is… | Effect of an organizer edit |
|---|---|
| draft, rejected | applied |
| pending_review | applied, and the event returns to **draft** (`meta.returnedToDraft`) — submit again |
| published, suspended | only `description`, `maxTicketsPerOrder`, `allowTicketTransfer`; anything else is `409` with `meta.lockedFields` and goes through Eventsli |
| any, once a ticket has sold | `listingType`, `purchaseMode`, `feeBearer` are fixed |

Admins are held to neither rule. The update is optimistically locked on the
status it read, so an edit racing an approval cannot undo it.

```
POST /organizer                      GET/PATCH /organizer/me
POST /events                         GET /events            GET/PATCH /events/:id
POST /events/:id/accept-terms        POST /events/:id/submit
GET  /admin/approvals
POST /admin/events/:id/approve   /reject   /suspend   /unsuspend   /cancel
```

## Seats and tables

A table and its seats are two views of one piece of stock (BRD 25), and buyers
reach them by different routes. The holds are therefore Postgres functions, not
API code: the check and the write have to be one indivisible act.

**Lock order.** Whenever the seats involved belong to a table, the table row is
locked first, and tables are locked in id order. Locking the table first
serialises every operation touching its stock whichever route it arrived by;
locking in a consistent order means two transactions can never each hold what
the other is waiting for. Table rows use plain FOR UPDATE -- the second buyer
should see the outcome, not be told to retry. Seat rows use SKIP LOCKED, where
"someone else has it" is the right answer.

| Rule | Where it lives |
|---|---|
| One seat sold individually closes the whole-table option | `trg_sync_table_status`, derived from seat state |
| A whole-table hold takes every seat with it | `hold_table` |
| Table price is independent, not the sum of its seats | `hold_table` charges `tables.price_cents` |
| All-or-nothing on a seat selection | `hold_seats` |
| Per-order limit | `hold_seats`, from `events.max_tickets_per_order` |

```
hold_seats(event, user, seat_ids[], ttl)   hold_table(event, user, table, ttl)
release_reservation(id)                    expire_stale_reservations()
```

**Ids are scoped to their event.** Table and seat ids are public — every
published seat map carries them — so an id in a request body is attacker
input. `save_venue_map` refuses a table that is not on the event's own map
(`MAP_CONFLICT`) and a ticket type or category from another event
(`MAP_INVALID`); `record_manual_sale` refuses seats or a table from another
event (`NOT_FOUND`), and `priceManualSale` checks the same in Node first.
`trg_seats_same_map_as_table` refuses any seat whose table sits on a different
map, whatever writes it. `verifyEventOwner` alone is not enough: it proves who
owns the event in the URL, not what the ids in the body point at.

**Ticket-type allocations.** `ticket_tiers.sold_count` is kept by
`trg_sync_tier_sold_count` — recounted from paid, non-void tickets on every
ticket insert, delete or status change, whatever issued it. A tier with a
`quantity` is enforced by `tier_allocation_exceeded`, called under a row lock on
the tier from `hold_seats`, `hold_table` and `record_manual_sale`; it counts sold
AND currently held seats, so the last allocation cannot be taken twice
(`TIER_SOLD_OUT`). A lapsed hold the sweeper has not reached yet still counts,
for at most a minute.

**Listing-only events sell nothing (BRD §12).** The three functions above refuse
a `display_only` event (`EVENT_NOT_PUBLISHED`), and the API refuses ticket
types, discount codes and seat maps for one.

**A discount-code use follows its hold.** Releasing or expiring a hold deletes
its claim and recounts the code; `claim_promo_code` counts only claims on a paid
order or an open, unexpired hold. `fulfill_checkout` writes the code onto the
order and the order onto the claim, and `release_promo_claim` only acts on an
open hold — so a code someone paid with cannot be freed for reuse.

**The sweeper claims rows in one statement.** `expire_stale_reservations` marks
`active` holds expired with a single UPDATE, which Postgres re-checks under the
row lock fulfilment holds — a checkout paid in the same instant is skipped
rather than flipped to expired.


### Private tables

A protected table is **omitted from the public payload entirely**, not returned
with a `locked` flag. A flag hides a table from the rendered page and from
nobody else: its label, price and seat count sit in the JSON one panel away.
Its seats are hidden with it, or they leak the table they belong to. The map
reports `hiddenTableCount` so it can say "3 reserved tables" without naming them.

Unlocking returns a signed token scoped to **one table, one event, 20 minutes**
-- guests have no session to hang the state on. The token carries a distinct
`typ` claim, so a session cookie cannot be replayed as a table key even though
both are signed with the same secret. The password gates the **purchase** as
well as the map; gating only the map would leave anyone who guessed the id free
to buy a table they could never see. That applies to holding individual
**seats** at a private table too — a seat id outlives the 20-minute token and
can be passed on, so the seat path checks the token for every private table the
selection touches (`TABLE_PASSWORD_REQUIRED`).

Every rejection is identical -- wrong password, table not private, no such
table. Distinguishable answers would make the endpoint a directory of which
tables are worth guessing at.

## The gate

Devices, not people. Door staff share a tablet and change between shifts, so a
device is registered once by the organizer, given a PIN, and is its own
principal -- a lost tablet is revoked without touching anyone's account. The
event comes from the device TOKEN, never from the request body.

Two properties decide whether this works with a queue outside:

- **One admission per ticket.** The ticket row is locked, so eight simultaneous
  scans produce one admission and seven refusals -- each carrying the time of
  the first scan, because "already used" starts an argument at the door and
  "already used at 19:04" ends one.
- **A replay is not a second scan.** Every scan carries a device-generated id.
  Re-uploading an offline queue returns the ORIGINAL answers, so a guest
  admitted an hour ago is still shown as admitted, not refused as a duplicate
  of themselves. The device's clock is kept, not the server's.

A refusal is a 200, not an error: the device has to render it, not show a
network failure and invite a retry. Only a locked gate is a 403.

**Rate limits are per device at the door.** Every tablet at a venue shares one
public IP, so the site-wide per-IP ceiling would count a whole entrance as one
client. `/scan/verify`, `/sync`, `/undo` and `/status` are exempt from it
(`utils/gateRoutes.js`) and limited to 600 requests a minute per authenticated
device instead. Device sign-in and the door-team routes stay under the IP
ceiling — that is where guessing happens.

**The commission lock (BRD 18)** is derived live from overdue invoices, not
cached as a flag -- an invoice can fall due between one scan and the next.
Paying it reopens the door with no separate unlock step. A super admin can
override, time-boxed, because a permanent override is a lock quietly removed.

## Two channels, two questions

`ledger_balance_cents(event, currency, 'stripe')` is always **0**.
`manual_commission_owed(event, currency)` is **what the organizer owes us**.

That difference is deliberate, not an inconsistency to tidy away. On the card
path the money passed through us and Stripe already handed us our fee, so the
position closes. On the manual path the money never came near us: the commission
is a receivable, and a receivable that reads as zero is one nobody collects.

So a manual sale writes commission and commission_tax as **credit** (earned, not
collected) and no sale, payment_fee or transfer entry -- there was no charge, no
processing cost, and nothing to move. Settling the invoice writes the matching
debit and the balance returns to zero. BRD is explicit that the two channels are
never netted against each other.

**The gate is derived from that balance**, so settling an invoice reopens the
door with no separate unlock step -- there is no way to settle and forget. And
submitting proof does *not* reopen it: reopening on the claim alone would make
the proof decorative.

## Tests

```bash
npm test                   # 73 unit tests — no network, no database, no env
npm run test:integration   # 212 end-to-end tests against a real database
```

**`--test-concurrency=2` on the integration script is load-bearing.** Registering
or signing in costs one PBKDF2 hash at 210,000 iterations — about 200ms of pure
CPU, deliberately. `node --test` otherwise runs test files in parallel at one
per core, and on a 4-core machine several files hashing at once saturate the CPU
until requests start timing out: a full run failed 12 tests, then passed 212/212
twice with nothing changed. A suite that fails at random is one people stop
reading. Raising `UV_THREADPOOL_SIZE` does NOT help — PBKDF2 is CPU-bound, not
pool-bound, so the only real fix is to stop oversubscribing the machine.
Three consecutive runs at concurrency 2: 212/212, in about five minutes.

The integration suite creates and removes its own rows, and asserts things a
mocked test cannot: that a revoked token is genuinely dead when replayed, that a
password change actually evicts other devices, that a refused map save leaves
nothing behind.

**Both suites run in CI**, which was not always true — the integration tests
existed and nothing ran them, so the properties that actually protect money and
stock were unguarded on every merge. CI now boots a local Supabase stack
(`supabase start`) and runs them against it: no secrets, so it works on a fork's
pull request, and no test row is ever written to the production database.

Locally the suite uses whatever `backend/.env` points at. To run it against a
throwaway stack instead:

```bash
supabase start                    # Postgres + PostgREST, migrations applied
supabase status -o env            # copy API_URL and SERVICE_ROLE_KEY into .env
```

Dependency advisories and the `overrides` that pin them: `docs/SECURITY-ADVISORIES.md`.

## Status

| Sprint | State |
|---|---|
| 01 Foundation | done -- API boots, health route, CI, pm2 config |
| 02 Auth | done -- register/login/logout, revocable sessions, RBAC context, lockout |
| 03 Money | done -- money.js, the ledger, and per-order margin |
| 04 Events | done -- organizers, events, review loop, terms v1, cancellation |
| 05 Seats | done -- holds, venue-map editing, public map, private tables |
| 06 Checkout | done -- quote, Stripe session, webhook, fulfilment, tickets |
| 07 Gate | done -- devices, scanning, offline sync, commission lock |
| 08 Manual | done -- door sales, commission invoices, proof and settlement |
| 09 Gaps | done -- Stripe Connect onboarding, email, scheduler, password reset |
| 10 Closeout | done -- promo codes, admin fee control, Google sign-in, Redis |
| 11 Frontend | **all nine phases done** — design system; the money path; auth and account; the organizer's events, seat map and operations; the admin console; the gate PWA; marketing, legal and SEO; hardening |
| — Hardening | done — audit findings closed, see below |
| — Catalogue | done — tiers, categories, sales, discovery |

96 routes. The frontend plan and its progress are in `docs/FRONTEND-PLAN.md`;
the conventions that govern it are in `frontend/AGENTS.md`.

### What the hardening pass changed

An audit of the whole backend turned up eleven findings; all are closed, and
each one has a test that fails if it comes back.

| Was | Now |
|---|---|
| A Stripe session id yielded QR codes forever | Time-boxed to 30 minutes, then a signed order token takes over |
| A guest ticket transfer accepted any claimant | Ownership fails **closed** — account id or the purchase address, nothing else |
| No route to retrieve a ticket | `GET /tickets`, `GET /public/t/:token`, and a resend that cannot be used as a directory |
| The ticket email sent the admission token to a public QR service | Rendered locally at `GET /public/qr/:token.png`, signature checked first |
| Saving a map was one transaction per table | One `save_venue_map` call; a refusal rolls back everything, including the layout bundled with it |
| Anyone holding a reservation id could release it | The hold hands back a signed token, and only that token releases it |
| An assertion compared a value to itself | Rewritten to assert the arithmetic it claimed to |
| `organizers.is_banned` was read by nothing | `requireActiveOrganizer` — a banned organizer reads, but does not sell |
| Blocking a user meant hand-written SQL | `/admin/users`, with the role ladder enforced and every action audited |
| CI never ran the integration tests | It does, on a local Supabase stack, with no secrets |
| Five moderate advisories | Zero — one `overrides` pin and one unused dependency removed |

### The four gaps the hardening pass left

Four tables had no route reaching them. All four are closed, each with tests.

| Was | Now |
|---|---|
| `ticket_tiers` was readable and un-writable — every test created one with raw SQL, and a seat with no tier and no override **sold for nothing** | Full CRUD at `/events/:id/tiers`, with the delete refused while seats are priced by it |
| `table_categories` existed and nothing could create one, though `saveMap` accepted a `categoryId` | Full CRUD at `/events/:id/table-categories` |
| The organizer could see the cash taken at the door and **nothing sold online** — `/manual-sales` filters `channel = 'manual'` | `/events/:id/orders` (both channels, with totals over the whole filtered set) and `/events/:id/attendees` (the door list) |
| Nothing listed or searched published events — the platform could sell only to someone who already had the link | `/public/events` and `/public/events/:slug` |

## Selling

```
GET    /events/:id/tiers              POST /events/:id/tiers
PATCH  /events/:id/tiers/:tierId      DELETE /events/:id/tiers/:tierId
GET    /events/:id/table-categories   POST /events/:id/table-categories
PATCH  .../:categoryId                DELETE .../:categoryId
GET    /events/:id/orders             ?channel= ?status= ?q=
GET    /events/:id/attendees          ?checkedIn= ?status= ?q=
POST   /events/:id/cover-upload       PUT /events/:id/cover   DELETE ...
GET    /public/event-categories       GET /public/terms/:audience
GET    /public/events                 ?q= ?country= ?category= ?from= ?to= ?includePast=
GET    /public/events/:slug
```

Three decisions worth knowing before changing any of it:

- **A tier cannot be deleted while seats point at it.** `seats.tier_id` is
  ON DELETE SET NULL and `seat_price_cents` ends in `COALESCE(..., ..., 0)`, so
  the database would accept the delete and silently reprice every one of those
  seats to **zero**. A category has no price, so deleting one is allowed and
  merely reports how many tables it uncategorised.
- **The door list carries no QR codes.** It is paginated, screenshot-able and
  read by anyone the organizer shares a screen with; the admission credential
  for every ticket does not belong in it. Scanning has its own device auth.
- **Every unpublished state is invisible in the same way.** Draft, pending,
  rejected, suspended and cancelled all return a byte-identical 404 to a slug
  that never existed — a distinguishable answer lets anyone enumerate slugs and
  watch an event move through review.

## Cover art

A listing of untitled grey rectangles is not one anyone browses, so `events`
carries a `category` and a cover image. Both landed before the frontend, because
retrofitting an image into a card grid means rebuilding the card grid.

The upload is two steps, and the bytes never pass through this API:

```
POST /events/:id/cover-upload   → { uploadUrl, path, expiresIn, maxBytes }
     browser PUTs the file straight to uploadUrl — no Supabase client, no key
PUT  /events/:id/cover  { path } → the row is written
```

- **The server invents the object key** and signs an upload URL for exactly
  that key. `coverUrl` is in neither field-authority map, so no PATCH can set
  it. A client-supplied URL ends up inside an Open Graph tag on a public page,
  which makes it a link the platform vouches for pointing anywhere at all.
- **The confirm step verifies the object exists** before writing the row.
  Without it, a caller who skipped the PUT sets a `cover_url` pointing at a 404
  and the most-shared URL on the platform renders a broken image.
- **The key carries a random suffix.** Not secrecy — the bucket is public — but
  cache. Reusing `cover.jpg` means a replacement fights every CDN and social
  scraper that already cached the old bytes under that exact URL, and an
  organizer who fixes their poster watches the wrong one keep appearing for days.
- `cover_url` and `cover_path` are held together by a CHECK. A URL with no path
  cannot be cleaned up when it is replaced; a path with no URL is an object
  nothing points at.

`category` is an enum of thirteen, exported once from `eventRules.js` and
asserted against the migration by a test — a second copy is a second thing to
forget, and the drift shows up as either a 400 on a legal value or a 500 on an
illegal one.

## Administration

BRD §19. Admin-only, and the refusals are the design:

```
GET   /admin/users            ?q= ?role= ?blocked=
GET   /admin/users/:id
PATCH /admin/users/:id/role   POST /admin/users/:id/block|unblock
POST  /admin/organizers/:id/ban|unban
```

- Nobody acts on themselves, and nobody acts on an equal or a superior. A
  compromised admin account cannot disable every other admin and be the last one
  standing.
- Only a super admin grants a staff role, or `admin` is a role that mints more
  of itself.
- The last super admin cannot be demoted or blocked. The platform would have
  nobody able to administer it and no way back that does not involve a SQL
  console.
- **Blocking** revokes every session, because the access context is cached ten
  seconds per pm2 worker and invalidating it only clears the worker that handled
  the request. Session revocation is checked against the database on every
  request and cannot be cached around.
- **Banning an organizer** is not blocking their account. They still sign in and
  still see the commission invoice they owe — an organizer who cannot see the
  invoice cannot pay it — but nothing new goes on sale. Published events are not
  pulled automatically; the response says how many are live so an admin can
  suspend them deliberately.

Every action is written to `admin_audit` with its reason. "An admin did it" is
not an answer when the organizer telephones.

## The organizer dashboard and the admin console

Both run in one shell (`frontend/src/app/components/shell/AppShell.jsx`): a
sidebar from `lg` up, a drawer plus a bottom tab bar below it. The navigation is
data (`organizer/nav/organizerNav.js`, `admin/nav/adminNav.js`), so the sidebar,
the drawer and the bar can never disagree, and every existing route and deep link
underneath is unchanged. The per-event tab strip is gone; the event id stays in
the path, so switching events keeps the section you were in.

```
GET /organizer/dashboard ?days=7|30|90     GET /events/:id/stats ?days=
GET /admin/overview ?days=                 GET /admin/events ?status ?organizerId ?when ?q
GET /admin/events/:id                      GET /admin/organizers ?banned ?payouts ?q
```

Every number is ONE round trip: `organizer_dashboard_summary`,
`event_sales_summary` and `platform_overview` are SQL functions, and money is
grouped by currency — USD and CAD are never added together.

**Dead ends that are closed.**

- **Stripe onboarding returns to `/organizer/payouts`** — `?stripe=return` after
  finishing, `?stripe=refresh` when the one-time link expired (the page offers to
  continue). It used to return to `/dashboard/settings/payments`, a route from
  the previous frontend, so every organizer landed on a 404.
- **Events are editable after creation** (`EventDetailsEditor.jsx`, on the event
  overview). It sends only changed fields and follows `editConsequence`: under
  review it withdraws to draft; on sale only the description, tickets per order
  and transfers are editable. Times are shown and saved in the event's zone
  (`lib/eventTime.js` `toLocalInput`, the inverse of `toIso`).
- **Ticket types and table categories are editable**, not only add and delete.
- **Device ids stay visible** with a copy button; revoking asks first.
- **Overdue invoices** are overdue whether the hourly job has labelled them or
  not (`utils/invoices.js`), and one label set (`lib/invoiceStatus.js`) is used
  by Commission, Invoices and the admin event page — with an Overdue filter.
- **The admin event page previews what goes on sale** — description, venue,
  cover, ticket types, a seat-map summary and a count of seats that would sell
  for nothing. The public page 404s until an event is published.
- **Refusals are shown as the API wrote them** (`utils/errors.js` `messageFor`,
  used by `FormError` and the toasts), not replaced by a generic recovery line.
- **Order search matches account holders** by name and email, not only the
  guest columns.

**Correctness, money and the door** (migration
`20260915140000_money_totals_indexes_and_pin_lockout.sql`).

- **One meaning of "net": what the organizer keeps.** For a card order that is
  `organizer_net_cents`; for a door sale it is the total less the commission owed
  on it. Order totals, order rows, the event page and the organizer dashboard all
  use it — the dashboard used to count door sales at gross. The platform figure
  of what Eventsli keeps now includes door commission. The overview's money cards
  follow the 7/30/90 switch (`salesInWindow`). `receivables.uninvoicedCents` is
  door commission that no invoice covers yet.
- **Totals are summed in SQL** (`event_order_totals`, `admin_event_sales`,
  `admin_organizer_sales`). Three endpoints pulled every paid order and added the
  rows up in Node, so totals came out silently low past PostgREST's row cap.
- **Times are on the event's clock, with the zone named** (`lib/eventTime.js`
  `formatEventTime`). This covers orders, the door list, door sales, commission,
  the door team and the admin event page. The organizer dashboard counts each
  sale on its own event's calendar day, as the event page does.
- **Platform settings are checked per key** (`backend/utils/settingsSchema.js`)
  and edited through typed forms. Every key is listed with its default, plain
  admins get a read-only view, and saving asks for a reason. The migration seeds
  the base-schema defaults where no row exists; without `currencies`, no event can
  be created in any country.
- **One audit service** (`services/auditService.js`) checks the insert's result
  and logs a missing row loudly. These are recorded with before, after and the
  admin's reason:
  - raising an invoice
  - admin edits through `PATCH /events/:id` (`event.edited`)
  - fee changes
  - settings changes

  Block and ban write the audit row before ending sessions.
- **The scanner override** returns 404 for an unknown event, refuses a cancelled
  or finished one, checks its own write, and can be ended early with
  `POST /admin/events/:id/scanner-override/end`.
- **`FEATURE_DISABLED` (503)** covers card payments or Google sign-in being
  switched off. It was `PAYMENT_REQUIRED`, whose copy told people to try another
  card.
- **Organizers must be in CA or the US** (`utils/markets.js`). The route and CHECK
  constraints both enforce it, and the constraints also tie an event's currency to
  its country. A banned organizer cannot rename their profile or start Stripe
  onboarding.
- **Door PINs.** New PINs are 6–12 digits. After 10 wrong PINs a device is locked
  for 15 minutes, counted in the database (`record_device_pin_failure`).
  Switching a device back on clears the lock. Offline sync uploads 8 scans at a
  time and keeps scans of the same code in order.
- **Map saves** cap table passwords at 64 characters and new passwords at 50 per
  save, and are rate limited. The editor now:
  - asks before you leave with unsaved changes
  - has an Add table button
  - moves a focused table with the arrow keys
  - merges typing in one field into a single undo step
  - leaves Ctrl+Z to text fields
- **Door sales read the organizer's own map**, so private tables can be sold and a
  draft's map shows. The list of recorded sales is paginated.
- **Admin screens:**
  - Removing a cover image asks first.
  - Banning is one shared control (`admin/organizers/useOrganizerBan.jsx`) that
    says how many of the organizer's events are still selling.
  - Accounts has a Blocked filter and keeps its filters in the URL.
  - All events has an "On now" window and lists upcoming events soonest first.
  - The audit log shows each action's before and after, and can filter by any
    action.
- **One admin guard.** `routes/admin/index.js` mounts the three admin routers
  behind a single `requireAuth` + `requireRole('admin')`. Mount them only there.
- **Tailwind custom properties** use the v4 form, `rounded-(--token)`. The old
  `-[--token]` form compiled to invalid CSS, and `scripts/cssVarClassCheck.js`
  (part of `npm run check`) now fails on it.
- **New database functions are private by default.** The global default
  privileges no longer grant EXECUTE to PUBLIC, and `verify-schema.js` checks it,
  along with the new constraints and indexes.

**Cleanup** (dashboard audit phase 5). One helper per job, and nothing kept that
nothing uses:

- **Shared helpers.** `utils/search.js` (`safeSearch`, `escapeLike`) makes
  search text safe for PostgREST in every search. The organizer's event list
  used to pass `q` into `ilike` untouched. `utils/embed.js` (`one`),
  `utils/payouts.js` (`canReceivePayouts`) and `utils/roleLadder.js`
  (`mayActOn`) each replace several copies. On the frontend,
  `lib/eventTime.js` (`formatEventTime`, `formatDay`), `lib/periods.js` and
  `hooks/useUrlFilters.js` do the same.
- **Role ladder.** A super admin can now demote or block another super admin,
  never themselves. That makes the "last super admin" guard the real
  protection; before, a compromised super admin could only be removed with SQL.
  Admins still cannot act on other admins.
- **Removed as dead:**
  - the unused `framer-motion` and `react-international-phone` packages
  - `hooks/useMediaQuery.js` and `lib/breakpoints.js`
  - the unused impersonation plumbing: the `imp` claim, `impersonatorId` and
    the banner CSS
  - `sendRpcFailure`, `termsService.publishVersion`, `apiClient.logout`,
    `API_ORIGIN`, `Feedback.Stat`, `SHAPES_IN_ROOM` and `ICON_NAMES`
  - the error codes nothing sent: `EVENT_ENDED`, `ORPHAN_SEAT`,
    `INVOICE_OVERDUE`, `ALREADY_SCANNED`
  - 20 unused CSS classes
  - two scratch Stripe scripts, one of which created a real Stripe account
    when run
- **Smaller fixes:**
  - The accounts list reads payout readiness correctly.
  - Refusing to publish an event without accepted terms returns 403, matching
    `ERROR_STATUS`.
  - Fixed promo discounts show as money.
  - The event overview no longer skips a heading level.
- **Kept on purpose:**
  - Unused schema columns and ledger types. Dropping them is a destructive
    migration for no user-visible gain.
  - `eventRules.TRANSITION_ACTOR`, whose tests pin Rule 17.
  - `frontend/scripts/_computed.js` and `_fixEncoding.js`, and the
    `backend/scripts/probe-*.js` operator tools.
  - `docs/FRONTEND-PLAN.md`, a historical plan that still names the removed
    breakpoint files.
  - `globals.css` is still over 500 lines (about 2,200). Splitting it would
    change the cascade order that the contrast and `!important` checks read,
    so it is left for a dedicated change.

## Share & QR

```
GET /events/:id/share                      GET /events/:id/share/qr.png ?tier ?size=lg ?download=1
```

The server builds every URL from the event's slug (`services/shareLinks.js`);
the browser can only NAME a tier, and a tier that is not this event's is a 404,
never silently replaced with the event link. A client that chose what a QR
encodes could put any address on a poster under an organizer's name.

## The door team

People with their own Eventsli accounts, allowed to scan ONE event — beside PIN
devices, not instead of them. No new role: membership is a row in `event_staff`,
so the permission is per event by construction.

```
GET/POST /events/:id/staff    DELETE /events/:id/staff/:staffId
GET /scan/assignments         POST /scan/staff-login { eventId }
```

A member scans through a device row of their own, so check-in, undo, the scan log
and revocation need no second code path. Their token is `scan_staff`, lasts one
shift (16h), and is re-checked on every scan: removed from the team, or account
blocked, and the next scan is refused. PIN login refuses any device that belongs
to a person.

Adding someone — or re-adding someone who was removed — emails them the event,
its start time in the event's zone, and a link to `/gate/login`
(`sendDoorTeamAdded`). The email is sent after the row is written and never
awaited by the request, so a mail outage cannot fail the add.

`POST /events/:id/staff` answers `202` with the same body whether or not the
address has an account, never with a name, and is limited to 30 adds an hour per
organizer. Anyone can create an organizer profile, so a 404 for unknown addresses
made the endpoint a way to look up who uses Eventsli. The team list shows only
the addresses the organizer typed.

## The Data API is closed

The browser never talks to Supabase, so the `anon` and `authenticated` roles
have no legitimate caller. Until 2026-09-14 both could EXECUTE every SECURITY
DEFINER function — `fulfill_checkout`, `settle_invoice`, `check_in_ticket`
included — with the project's public anon key. Migration
`20260914090000_lock_down_api_roles.sql` revokes every table, sequence and
function grant from both roles, enables RLS explicitly (it had only come from a
project-level trigger), fixes default privileges, and rolls itself back if
anything is still reachable. `scripts/verify-schema.js` re-checks it.

`test/helpers/testEnv.js` refuses to run the integration suite against a
non-local database unless `EVENTSLI_TEST_REMOTE_DB` names the project ref, and
`reset-platform.js --commit` requires `--project=<ref>`.

## Before the first real sale

Stripe go-live is **deferred**, and what remains needs a human, not a code
change:

1. **Complete the platform profile** at
   `https://dashboard.stripe.com/connect/accounts/overview`. Live
   `accounts.create` currently fails with *"You must complete your platform
   profile to use Connect and create live connected accounts."*
2. **Create a live webhook endpoint** for
   `https://eventsli.com/api/v1/payments/webhook` and put its `whsec_` in
   `STRIPE_WEBHOOK_SECRET`. A secret from `stripe listen` is test-mode only.
3. **Verify Accounts v1 support** for live at
   `.../settings/features/feat_accounts_v1_support` — it is already on in test.

We stay on Accounts v1 deliberately: v2 is still a preview API, and a preview
API is a bad place for the path that moves other people's money. Until step 1 is
done no organizer can attach a payout destination and every checkout is refused.
The API turns that refusal into that instruction rather than a stack trace; it
cannot flip the switch itself.

All twenty-four migrations are **applied and verified** against the live
Supabase project. The verifier EXERCISES the ledger's append-only guard rather
than checking it exists — twice already, a checking tool has agreed with the
mistake it was meant to catch. Re-check any time with
`node scripts/verify-schema.js`.

# Production rollout — merchant-of-record payments (T-074 … T-077)

This release makes every card sale a **direct charge on the organizer's own
Stripe account**. Eventsli takes only its application fee. Organizers pay
Stripe's fees and own refunds and disputes. Stripe, not Eventsli, carries an
organizer's negative balance. Evidence: `docs/TECH-AUDIT-LOG.md`, T-074 to
T-077, including the production-safety review and rehearsal of 2026-11-06.

**Order is load-bearing.**

- Migrations go in **before** the code. This was proven: the code running in
  production today passes its own suite on the migrated schema with zero new
  failures.
- `STRIPE_CONNECT_WEBHOOK_SECRET` must be in the server's `.env` **before**
  the reload. The new API refuses to boot with card payments on without it.

**Owner** marks steps that need your Dashboard, server or legal access. The
development machine has no SSH key for the VPS and no production credentials.

---

## 0. Blockers — resolve before anything else (Owner)

| # | Item | Why it blocks |
|---|---|---|
| 0.1 | **Rotate the exposed live secrets (I-002)**: live Stripe secret key, existing webhook secret, Supabase `service_role` JWT, **DB password**. New values only in `/var/www/eventsli/backend/.env`. Then delete the plaintext Desktop file. | The leaked file gives full control of payments and the database. `apply-migration.js` uses `SUPABASE_DB_PASSWORD`, so rotate it first and migrate with the new one. |
| 0.2 | **Counsel**: Stripe agreements (connected-account loss allocation), and terms, privacy and receipt wording naming the **organizer** as seller. | Liability rests on the contract, not the code. |
| 0.3 | **Refund policy**: Stripe keeps Eventsli's fee on refunds organizers make in their own Dashboard, unless told otherwise. Keep it? | Product decision. The code records Stripe's outcome either way. |
| 0.4 | **Release the fixes from the safety review** (T-076, T-077). They are uncommitted on `payments/merchant-of-record`; commit, push, merge to `main` after a green CI run. | Without them the migration drops legacy ledger rows, and in-flight checkouts at deploy time can be charged without tickets. |

## 1. Back up (Owner)

Supabase → **Database → Backups** → take a manual backup, or confirm today's
scheduled one. **Check:** a backup with today's date is listed.

## 2. Read production's state — read-only (Owner)

**2a. Supabase SQL editor** (SELECTs only):

```sql
-- What apply-migration.js has recorded (SQL-editor applies are NOT listed here).
SELECT name FROM schema_migrations ORDER BY name;

-- Which of the nine are already in, by their effect.
SELECT (SELECT count(*) FROM event_categories)                         AS categories,          -- 24 once 20261015 is in
       to_regclass('public.ai_generations') IS NOT NULL                AS ai_table,            -- 20261018
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conname = 'ai_generations_feature') LIKE '%launch_kit%' AS launch_kit,          -- 20261103090000
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'orders' AND column_name = 'charge_model') AS direct_charges; -- 20261106090000

-- Rows that would make a re-added CHECK fail (the migration then rolls back,
-- changing nothing, but stops the rollout). All must be 0.
SELECT (SELECT count(*) FROM event_media
         WHERE NOT (url ~* '^https?://[^[:space:]]+$' AND length(url) BETWEEN 11 AND 2000))         AS bad_media_urls,
       (SELECT count(*) FROM event_sponsors
         WHERE link_url IS NOT NULL
           AND NOT (link_url ~* '^https?://[^[:space:]]+$' AND length(link_url) BETWEEN 11 AND 2000)) AS bad_sponsor_links;
```

If either `bad_*` count is above 0, stop and send me the count. Those rows
need fixing before `20261016090000` can apply.

**2b. On the VPS:**

```bash
cd /var/www/eventsli/backend
```

```bash
node scripts/verify-schema.js
```

```bash
node scripts/connect-audit.js
```

- `verify-schema.js` lists every check. Before step 3, expect `MISSING` **only**
  on items from the nine migrations: categories, launch_kit, the four
  dashboard functions, and the T-074 columns, constraints and functions. A
  `MISSING` table or function from **any older** migration means production
  is further behind than this runbook assumes: **stop**.
- `connect-audit.js` (read-only) lists organizers as `READY`, `RECONNECT` or
  `ONBOARDING`. Tell the `RECONNECT` organizers before step 6. Their card
  checkout pauses until they reconnect on the Payments page.

## 3. Apply the nine migrations, one at a time, in this order (Owner, VPS)

Run each command and read its last line before the next:

```bash
node scripts/apply-migration.js ../supabase/migrations/20261015090000_more_event_categories.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261016090000_fix_event_media_and_sponsor_url_checks.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261018090000_ai_generations.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261103090000_ai_launch_kit_feature.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261103120000_organizer_dashboard_trends.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261103130000_organizer_dashboard_insights.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261103140000_organizer_event_figures.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261104090000_event_overview_trends.sql
```

```bash
node scripts/apply-migration.js ../supabase/migrations/20261106090000_direct_charges_merchant_of_record.sql
```

| Last line | Meaning | Action |
|---|---|---|
| `applied <file>` | Done. | Next file. |
| `… already recorded as applied — nothing to do.` | Done before. | Next file. |
| `FAILED — rolled back, the schema is unchanged.` + `lock could not be taken in time` | A busy table. Nothing changed. | Rerun the same command at a quieter moment. |
| `FAILED — rolled back …` with anything else | Nothing changed. | **Stop**, send me the message. |

**Safety of these nine, as rehearsed on 2026-11-06:**

- Applied by this script in order onto a production-like database holding
  orders written by the current production code: all nine `applied`.
- Re-run through this script: all nine `already recorded`.
- Re-run as raw SQL, simulating a SQL-editor apply this script never saw: all
  nine re-applied with no error, and categories, orders and ledger were
  unchanged.
- Each file runs in one transaction with `lock_timeout 5s` and
  `statement_timeout 120s`, so it either fully applies or changes nothing, and
  it cannot stall the site waiting for a lock.

**Never run older migrations.** Production already runs code that depends on
everything older than these nine.

- The script **refuses** the two that would change live data on a re-run:
  `20260915090000_email_verification` (it would verify every unverified
  account) and `20260829120000_payment_fee_mode` (it would reset admin
  settings).
- It refuses any file with its own `BEGIN`/`COMMIT` or `CONCURRENTLY`.
- **Do not** use `--first-time` on production.

## 4. Check the migrations landed (Owner, VPS)

```bash
node scripts/verify-schema.js
```

**Expected last line: `Schema verified.`** It now checks *definitions*, not
just names: 24 categories, the media and sponsor URL checks (I-004), the
launch-kit feature list, `fulfill_checkout`'s direct-charge body, and the
T-074 columns, constraints, functions and index. Running `apply-migration.js`
also locks `schema_migrations` away from the Data API (T-077). Any `MISSING`:
stop.

The current code keeps working on this schema, so steps 5–6 can follow at
any time.

## 5. Stripe Dashboard, LIVE mode (Owner)

1. **Settings → Managed payments:** default **off**. (Sessions also send
   `managed_payments[enabled]=false`.)
2. **Connect → Platform profile:** do **not** accept platform responsibility
   for connected-account losses.
3. **Developers → Webhooks:** two endpoints at
   `https://eventsli.com/api/v1/payments/webhook`:

| Endpoint | Events from | Events |
|---|---|---|
| Connect | **Connected accounts** | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated` |
| Platform | **Your account** | `checkout.session.completed`, `checkout.session.expired` (for checkouts opened by the previous release during the switch, T-076), `application_fee.refunded` |

4. Copy each signing secret (`whsec_…`).

Verified in test mode with real deliveries at API version `2026-08-26.dahlia`.

## 6. Server environment, then the code (Owner, VPS)

```bash
nano /var/www/eventsli/backend/.env
```

```env
STRIPE_SECRET_KEY=<rotated live key, 0.1>
STRIPE_WEBHOOK_SECRET=<Platform endpoint secret, step 5>
STRIPE_CONNECT_WEBHOOK_SECRET=<Connect endpoint secret, step 5>
REVALIDATE_URL=http://127.0.0.1:3100/api/internal/revalidate
PAYMENTS_STRIPE_ENABLED=true
```

Then:

```bash
cd /var/www/eventsli
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
git pull
npm ci
npm run build --workspace=frontend
pm2 reload ecosystem.config.js --update-env
pm2 logs eventsli-backend --lines 40 --nostream
```

**Check:** `Payments: ENABLED (Stripe)` and no `FATAL: missing required
environment variables`.

Checkouts opened by the previous release, paid during or just after the
reload, are fulfilled as the destination charges they were (T-076): no
charged buyer is left without tickets.

## 7. Verify without a real payment (Owner)

```bash
curl -s https://eventsli.com/api/v1/health
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://eventsli.com/api/v1/payments/webhook
```

```bash
cd /var/www/eventsli/backend && node scripts/connect-audit.js
```

Expected:

- the health check answers;
- the unsigned webhook POST returns `400`;
- the audit lists every organizer.

Then:

- In Stripe → each webhook endpoint → **Send test event**: `200`.
- A `RECONNECT` organizer's Payments page shows "Reconnect Stripe to keep
  taking card payments."
- **First real sale:** `order fulfilled` in `pm2 logs`. The charge sits in the
  organizer's own Stripe account, with an application fee and no transfer.

## 8. Rollback

```bash
cd /var/www/eventsli && git log --oneline -5
```

```bash
git checkout <previous-sha> && npm ci && npm run build --workspace=frontend && pm2 reload ecosystem.config.js --update-env
```

The migrations do **not** need reversing. They only add rows, columns,
constraints, functions and an index, and replace function bodies. The
previous code was proven to run on them (304/311, the 7 being the known
stale tests, T-071).

Direct-charge orders sold while the new code ran stay valid: they live on the
organizers' accounts. Their later refunds and disputes would not be recorded
by the old code. Roll forward instead where possible.

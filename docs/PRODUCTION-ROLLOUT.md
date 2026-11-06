# Production rollout — merchant-of-record payments (T-074, T-075)

The release that makes every card sale a **direct charge on the organizer's own
Stripe account**. Eventsli takes only its application fee. Organizers pay
Stripe's fees and own refunds and disputes. Stripe, not Eventsli, carries an
organizer's negative balance. Evidence: `docs/TECH-AUDIT-LOG.md`, T-074 and
T-075.

**Order matters.** The new API refuses to boot with card payments on unless
`STRIPE_CONNECT_WEBHOOK_SECRET` is set (step 5 before step 6), and the
migration must land before the code (step 3 before step 6). The migration is
backward-compatible: the code running today keeps working on it.

Each step says who does it. **Owner** means it needs your Dashboard, server
or legal access; none of it can be done from the development machine (it has
no SSH key for the VPS and no live keys).

---

## 0. Blockers — decide before anything else (Owner)

| # | Item | Why it blocks |
|---|---|---|
| 0.1 | **Rotate the exposed live secrets (I-002)**: live Stripe secret key, existing webhook secret, Supabase `service_role` JWT, DB password. Put the new values only in `/var/www/eventsli/backend/.env`. Then delete the plaintext Desktop file. | The leaked file gives full control of payments and the database. Your own rule: no production with exposed secrets. |
| 0.2 | **Counsel review**: Stripe agreements (who carries connected-account losses), and the terms, privacy and receipt wording that must name the **organizer** as the seller. | Liability rests on the contract, not the code (T-074 "remaining liabilities"). |
| 0.3 | **Refund policy**: when an organizer refunds from their own Stripe Dashboard, Stripe keeps Eventsli's fee by default. Keep that, or refund the fee? | Product decision. The code records whatever Stripe does, either way. |

## 1. Back up production (Owner, VPS)

Supabase → **Database → Backups**: take a manual backup (or confirm today's
scheduled one exists and note its time). If you also keep `pg_dump` copies,
use the connection string from Supabase → **Project Settings → Database**;
this repo stores no full DB URL. **Check:** the backup is listed with
today's date before you continue.

## 2. See what production is missing (Owner, VPS, read-only)

```bash
cd /var/www/eventsli/backend
node scripts/verify-schema.js
node scripts/connect-audit.js          # READ-ONLY: who must reconnect after this release
```

`connect-audit.js` prints, for each organizer with a Stripe account, `READY`,
`RECONNECT` (old Express account: card checkout will be refused until they
reconnect) or `ONBOARDING`. **Note the RECONNECT count**: those organizers
must be told before step 6.

## 3. Apply migrations, in filename order (Owner, VPS)

Every migration newer than the last one production has, in order. That means
at least these known-pending ones (I-003, I-004, D-030) and the new one last:

```bash
cd /var/www/eventsli/backend
node scripts/apply-migration.js ../supabase/migrations/20261015090000_more_event_categories.sql
node scripts/apply-migration.js ../supabase/migrations/20261016090000_fix_event_media_and_sponsor_url_checks.sql
# … every other file newer than production's last applied migration …
node scripts/apply-migration.js ../supabase/migrations/20261106090000_direct_charges_merchant_of_record.sql
node scripts/verify-schema.js
```

`apply-migration.js` wraps each file in a transaction, so a failure changes
nothing. **Check:** `orders` has `charge_model`, `stripe_account_id`,
`refunded_cents` and `dispute_status`; the functions `record_stripe_refund`,
`record_application_fee_refund` and `record_stripe_dispute` exist.

The two edited migrations (`20260905090000`, `20260916100000`: storage guard,
T-069) behave identically where storage exists. **Do not re-run them** if
production already has them.

## 4. Stripe Dashboard, LIVE mode (Owner)

1. **Settings → Managed payments:** default **off**. (Every session also
   sends `managed_payments[enabled]=false`.)
2. **Connect → Platform profile:** do **not** accept platform responsibility
   for connected-account losses. Organizer accounts are created with Stripe as
   the losses collector; the code refuses any other kind.
3. **Developers → Webhooks:** create **two** endpoints, both at
   `https://eventsli.com/api/v1/payments/webhook`:

| Endpoint | Events from | Events |
|---|---|---|
| Connect | **Connected accounts** | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated` |
| Platform | **Your account** | `application_fee.refunded` |

4. Copy each endpoint's signing secret (`whsec_…`).

Verified in test mode with event payloads at API version `2026-08-26.dahlia`.

## 5. Server environment (Owner, VPS)

```bash
nano /var/www/eventsli/backend/.env
```

```env
STRIPE_SECRET_KEY=<rotated live key, step 0.1>
STRIPE_WEBHOOK_SECRET=<Platform endpoint secret, step 4>
STRIPE_CONNECT_WEBHOOK_SECRET=<Connect endpoint secret, step 4>
REVALIDATE_URL=http://127.0.0.1:3100/api/internal/revalidate   # already set
PAYMENTS_STRIPE_ENABLED=true                                   # only when ready to sell
```

Do **not** reload yet. The running build ignores the new variable.

## 6. Deploy the code (Owner, VPS)

The branch must be merged to `main` first (see §9).

```bash
cd /var/www/eventsli
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
git pull
npm ci                                  # exactly the tested tree (not npm install)
npm run build --workspace=frontend
pm2 reload ecosystem.config.js --update-env
pm2 logs eventsli-backend --lines 40 --nostream
```

**Check the boot lines:** `Payments: ENABLED (Stripe)`, and no `FATAL:
missing required environment variables`. If it says FATAL, step 5 is
incomplete; the old process keeps serving until the new one boots.

## 7. Verify without taking a real payment (Owner)

```bash
curl -s https://eventsli.com/api/v1/health
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://eventsli.com/api/v1/payments/webhook   # 400: unsigned refused
cd /var/www/eventsli/backend && node scripts/connect-audit.js                                  # read-only
```

- In Stripe → Webhooks, each endpoint → **Send test event**: expect `200`.
- An organizer with `RECONNECT` opens **Payments** and sees "Reconnect Stripe
  to keep taking card payments."
- The **first real sale** is the live proof. Watch `pm2 logs` for
  `order fulfilled`, then check the order in Admin and the charge in that
  organizer's Stripe account. It should carry an application fee and no
  transfer.

## 8. Rollback

Code:

```bash
cd /var/www/eventsli && git log --oneline -5
git checkout <previous-sha> && npm ci && npm run build --workspace=frontend
pm2 reload ecosystem.config.js --update-env
```

The migration does **not** need reversing. It only adds columns and
functions, and the previous code runs on it (its `fulfill_checkout` calls
take the legacy path). Orders sold as direct charges while the new code ran
stay correct: they live on the organizers' own accounts.

## 9. Release mechanics (development machine)

- Commit on branch `payments/merchant-of-record`. Nothing is pushed until the
  owner says so.
- Push, open a PR, and let CI run: dependency audit, units, frontend,
  integration on a local Supabase (CLI pinned 2.122.1), migrations check.
- Merge to `main` only when CI is green, then step 6.

## Status of each step

| Step | State |
|---|---|
| 0.1 Rotate secrets | **Owner — open** |
| 0.2 Counsel | **Owner — open** |
| 0.3 Refund policy | **Owner — open** |
| 1–7 | Owner, in order, after 0 |
| Code, tests, runbook, audit script | Done locally (see the preflight in TECH-AUDIT-LOG) |

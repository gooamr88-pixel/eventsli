# Global SMS — operator runbook

Eventsli had no SMS code before this. Everything SMS lives in
`backend/services/sms/`, `backend/routes/{smsRoutes,admin/smsRoutes}.js`,
`frontend/src/app/admin/sms/` and migration `20261116090000_sms_platform.sql`.
The console is **Admin → Messaging → SMS overview** (`/admin/sms`).

## What it guarantees

| Rule | Where it is enforced |
|---|---|
| No country sends until a person verified its route, sender rules and restrictions | `sms_country_enabled_is_verified` CHECK + `sms_country_enable_guard` trigger; the API explains what is missing |
| A message is sent at most once | `idempotency_key` UNIQUE; `sms_claim_batch` uses `SKIP LOCKED`; an attempt row is written before every provider call |
| An uncertain send is never resent automatically | `outcome.js`: timeout / 5xx / reset → `unknown`. Resolved only by a receipt or a positive provider lookup; a super admin may retry with `acceptDuplicateRisk` |
| Fallback only when a provider *definitely* did not send | provider-side refusal or never-connected → next verified route; recipient-side refusal → failed |
| Marketing needs recorded consent, an opt-out line and a second admin | `policy.js`, `sms_marketing_needs_consent` CHECK, `sms_campaign_four_eyes` CHECK |
| STOP stops everything, and only the person can undo it | inbound webhook → `sms_suppressions` (`stop_keyword`); the API refuses admin removal |
| Credentials never reach the browser or the database | adapters read env vars; the console sees `configured` + missing variable **names** only |

Transactional (participant, event notifications) and marketing (campaigns,
segmentation) traffic use separate categories, senders (`traffic_classes`),
queue priorities, consent rules and caps.

## Deploying

1. Apply the migration (after every earlier one, per PRODUCTION-ROLLOUT):
   `node scripts/apply-migration.js ../supabase/migrations/20261116090000_sms_platform.sql`.
   It is idempotent. It seeds 243 countries **unverified**, both providers **off**,
   and `sending_enabled = false`, so deploying sends nothing.
2. Server environment (never in the database):

   | Variable | Needed for |
   |---|---|
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio sends + webhook signature checks |
   | `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | optional: API calls without the auth token |
   | `VONAGE_API_KEY`, `VONAGE_API_SECRET` | Vonage sends + pricing |
   | `VONAGE_SIGNATURE_SECRET`, `VONAGE_SIGNATURE_METHOD` | optional: Vonage signed webhooks |
   | `VONAGE_CURRENCY` | the Vonage account's billing currency (default EUR) |
   | `SMS_WEBHOOK_BASE_URL` | public API origin for receipts (falls back to `BACKEND_URL`) |
   | `SMS_WEBHOOK_SECRET` | key for webhook and unsubscribe tokens (falls back to `JWT_SECRET`) |
   | `SMS_DRY_RUN=true` | development only: log instead of send. Ignored in production |

3. Print the inbound webhook URLs on the server and paste them into each
   provider dashboard: `node scripts/sms-webhook-urls.js`.

## Going live, per country

On `/admin/sms/countries/<ISO>`:

1. Open the linked Twilio / Vonage guideline page for the country.
2. Record the sender-ID rules, registration requirement, marketing allowance,
   double opt-in, quiet hours and restrictions. **Nothing is pre-filled.**
3. Add the sender under Sender IDs (registered with the provider first; record
   the reference, e.g. a US 10DLC campaign ID).
4. Per provider route: "Fetch price", pick the sender, tick **Verified**.
5. "Record verification" with what you checked. Then **Turn on SMS**.
6. Under Compliance, turn **Sending** on (once, platform-wide).

Send a test from the Delivery log first; it goes through every real check.

## Background jobs (services/sms/jobs.js, one leader via job leases)

`sms-dispatch` 5s · `sms-campaigns` 30s · `sms-reminders` 10m · `sms-reconcile` 5m.

## Not done yet (owner decisions)

- **Marketing opt-in at checkout.** The consent API, keywords (YES/START),
  double opt-in and imports exist, but the checkout has no opt-in checkbox:
  its wording is a legal decision. Until then marketing audiences come only
  from imports and keyword replies.
- **Account-settings UI** for a person's own SMS preference
  (`GET/PUT /api/v1/sms/preferences` exist; no screen calls them).
- **Organizer-scoped campaigns.** Consent scope supports an organizer id; the
  console only runs platform campaigns.
- **Live provider verification.** Adapters are tested against mocked HTTP and
  the documented signature algorithms; no real Twilio or Vonage message has
  been sent from this code yet.

# Global SMS — reference, deployment checklist and runbook

Eventsli had no SMS code before this work. Everything SMS lives in:

| Area | Where |
|---|---|
| Pipeline (queue, policy, routing, providers, consent, campaigns, jobs) | `backend/services/sms/` |
| Public endpoints (webhooks, unsubscribe, preferences) | `backend/routes/smsRoutes.js`, `backend/controllers/smsWebhookController.js` |
| Admin console API | `backend/routes/admin/smsRoutes.js`, `backend/controllers/admin/sms*.js` |
| Organizer API | `backend/routes/organizerSmsRoutes.js`, `backend/controllers/organizerSmsController.js` |
| Admin console | `frontend/src/app/admin/sms/` (Admin → Messaging) |
| Organizer page / account page | `frontend/src/app/organizer/sms/`, `frontend/src/app/account/messages/` |
| Consent boxes (checkout, sign-up) | `frontend/src/app/components/forms/SmsConsentFields.jsx` |
| Schema | `supabase/migrations/20261116090000_sms_platform.sql`, `20261117090000_sms_consent_kinds_and_organizers.sql` |
| Server scripts | `backend/scripts/sms-preflight.js`, `sms-webhook-urls.js`, `verify-schema.js` |

## 1. What it guarantees

| Rule | Where it is enforced |
|---|---|
| No country sends until a person verified its route, sender rules and restrictions | `sms_country_enabled_is_verified` CHECK + `sms_country_enable_guard` trigger |
| A message is sent at most once | `idempotency_key` UNIQUE; claims use `SKIP LOCKED`; the attempt is recorded (strictly) before every provider call |
| An uncertain send is never resent automatically | timeout / 5xx / reset → `unknown`; resolved by a receipt or a positive lookup; a super admin may retry, accepting the duplicate risk |
| Fallback only when a provider definitely did not send | provider refusal or never-connected → next verified route; recipient refusal → failed |
| Transactional and marketing consent are separate | `sms_consents.kind`; transactional texts check transactional consent, campaigns check marketing consent to that sender |
| Marketing needs consent, an opt-out line and a second person | `policy.js`, `sms_marketing_needs_consent` CHECK, `sms_campaign_four_eyes` CHECK; organizer campaigns always need an Eventsli admin |
| STOP stops everything; only the person undoes it | inbound webhook → suppression; START restores only what STOP removed; the API refuses admin removal |
| A cancelled campaign or a banned organizer stops texting at once | send-time gate in the dispatcher |
| Secrets never reach the browser; stored ones are encrypted | env vars, or AES-256-GCM rows (`SMS_CREDENTIALS_KEY`); the API reports field names and sources only |
| Webhooks are authenticated | per-message HMAC token in callback URLs; X-Twilio-Signature; Vonage signature when configured |

## 2. Consent model

| Kind | Scope | Asked where | Decides |
|---|---|---|---|
| `transactional` | always Eventsli | checkout, sign-up, Account → Text messages | ticket confirmations, reminders, schedule changes, cancellations (when the category requires consent — the default) |
| `marketing` | Eventsli, or one organizer | checkout (a box per sender), sign-up, account page, YES/START, admin import | campaigns from that sender only |

- Boxes are separate and never pre-ticked. The exact wording is stored with every record (`services/sms/consentText.js`, versioned; the frontend mirror is test-checked). Change wording by adding a `.v2`, never by editing a `.v1`.
- Checkout choices are stored on the reservation and recorded **when the order is fulfilled**. The phone number is only sent if a box is ticked.
- Double opt-in (set per country) applies to marketing.
- Never subject to transactional consent: the YES request itself, the HELP reply, the STOP confirmation and admin console tests. Only the HELP reply and STOP confirmation reach a stopped number.

## 3. Organizer campaigns

1. A super admin grants access and a monthly allowance (SMS → Organizers).
2. The organizer builds audiences of their own buyers and drafts campaigns (Organizer → Text messages).
3. An Eventsli admin approves each one (SMS → Campaigns). Turning access off cancels unfinished campaigns; queued texts are refused at send time.

Only buyers who opted in to *that organizer* are reached. Texts open with the organizer's name.

## 4. Background jobs (`services/sms/jobs.js`, one leader via job leases)

| Job | Every | Does |
|---|---|---|
| `sms-dispatch` | 5 s | drain the queue (45 s budget per run) |
| `sms-campaigns` | 30 s | start, expand and close campaigns |
| `sms-reminders` | 10 min | queue event reminders (one per number per event) |
| `sms-reconcile` | 5 min | resolve `unknown` messages by positive provider lookup (Twilio) |
| `sms-health` | 5 min | log **ERROR**-level alerts: backlog ≥ 10 min, stuck sends, paused providers |
| `sms-retention` | daily | redact message text older than the retention period (if set) |

They run only with `SCHEDULER_ENABLED=true` (the default).

## 5. Deployment checklist

Nothing below sends a text until step 13. Steps marked **(owner)** need the
owner's accounts, decisions or approval.

### Before deploying
1. **(owner) Decide the release.** The SMS code is on top of every unreleased change since production's last release, including other teams' work. Production also lacks migrations `20261108090000` … `20261115090000` (Venue Studio, check-in, seating, ticket details, invoices). Deploying SMS means deploying all of it.
2. **(owner) Back up the production database** (PRODUCTION-ROLLOUT §1).
3. **(owner) Commit** the SMS work (re-stage everything first; see §9), push, and get CI green.

### Migrations (owner, on the server, with the release's scripts)
4. Apply every pending migration **in order**, one at a time, with `node scripts/apply-migration.js <file>`:
   `20261108090000` → `20261108100000` → `20261109090000` → `20261110090000` → `20261111090000` → `20261112090000` → `20261113090000` → `20261114090000` → `20261115090000` → `20261116090000_sms_platform` → `20261117090000_sms_consent_kinds_and_organizers`.
   Both SMS migrations are idempotent; the second refuses to run without the first. Both pass the tool's safety checks (no BEGIN/COMMIT or CONCURRENTLY). They seed 243 countries **unverified**, both providers **off**, and sending **off**.
5. `node scripts/verify-schema.js` → must end with `Schema verified.` (it now checks every SMS table, trigger and function).

### Server configuration (owner)
6. In `/var/www/eventsli/backend/.env` (template in `backend/.env.example`, SMS section):
   - `SMS_WEBHOOK_BASE_URL=https://eventsli.com` (or rely on `BACKEND_URL`, already that value)
   - `SMS_WEBHOOK_SECRET=` a new random value: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - Provider credentials, either as `TWILIO_*` / `VONAGE_*` variables, or set `SMS_CREDENTIALS_KEY` (same command; **keep a copy in your password manager**) and enter them in the console later.
   - Do **not** set `SMS_DRY_RUN` (ignored in production, with a warning).
7. Deploy the code and restart pm2. Read the boot log: any `SMS:` warning names a configuration problem.
8. `node scripts/sms-preflight.js` — read-only. Expect blockers until the console steps below are done.

### Provider dashboards (owner)
9. `node scripts/sms-webhook-urls.js` prints the inbound URLs.
   - **Twilio**: on each number (or the Messaging Service), set "A message comes in" → the printed Twilio URL, HTTP POST. Turn on **Advanced Opt-Out** on the Messaging Service so Twilio confirms STOP and HELP itself.
   - **Vonage**: Settings → SMS → inbound webhook → the printed Vonage URL (it carries a token: keep it private). Turn on signed webhooks and set `VONAGE_SIGNATURE_SECRET` / `VONAGE_SIGNATURE_METHOD` to match.
   - Delivery receipts need no dashboard setting: every message carries its own callback URL.

### Console (owner, as super admin)
10. **Providers**: check "Credentials set" (or enter them, then "Test connection"); enable the provider(s); set priority and messages/sec. "Find numbers" imports your numbers as senders that are **off**.
11. **Sender IDs**: for each sender, record its registration (US 10DLC brand + campaign, toll-free verification, alphanumeric sender ID registration), set countries and traffic, then turn it on.
12. **Countries**: for each country you will text, follow the country page top to bottom: read the provider guidelines, record the rules, fetch prices, verify routes, record the verification, turn on.
13. **Compliance**: set the retention period, the STOP-confirmation providers (only those that do not confirm by themselves), quiet hours, the hourly fraud limit and the marketing budget. **Categories**: decide which are on and whether transactional texts require consent.
14. `node scripts/sms-preflight.js --test-connection --check-webhooks` → **0 blockers**.
15. **(owner approval) First live send**: Delivery log → "Send a test" to your own phone. Then reply HELP, STOP and START from that phone and check each in the delivery log and Account → Text messages.
16. **(owner approval) Turn sending on** (Compliance). Watch the overview and the logs for the first hours.

## 6. Operations runbook

| Symptom | Where it shows | What to do |
|---|---|---|
| Texts not going out | overview "Sending needs attention"; log `SMS ALERT: queued messages are not being dispatched` | Is sending on? Is `SCHEDULER_ENABLED` true? Is pm2 running? Is a provider paused? |
| Provider paused | Providers page; log `provider paused after repeated failures` | Check its status page and credentials; "Resume" after it recovers. Traffic falls back to other verified routes meanwhile. |
| "Outcome unknown" messages | overview notice; Delivery log → Unknown | Wait for receipts (they resolve these). If none comes, decide each one: retry accepts a possible duplicate. |
| Country paused automatically | country page notice | Unusual volume (SMS pumping signal). Check the delivery log before resuming. |
| Someone asks to stop | — | They reply STOP, use the unsubscribe link, or untick on Account → Text messages. Admins can add a suppression; they cannot remove a person's own STOP. |
| Rotating `SMS_CREDENTIALS_KEY` | — | Stored credentials become unreadable: re-enter them in the console after rotating. |
| Rotating `SMS_WEBHOOK_SECRET` | — | Outstanding unsubscribe links and in-flight receipt callbacks stop verifying. Rotate in a quiet hour. |

The kill switch (Compliance → Sending) stops everything immediately: texts queue and wait.

## 7. Rollback

1. Turn **Sending** off (instant, no deploy).
2. If needed, disable the providers.
3. Reverting the API to the previous release is safe: the SMS tables are additive and simply go unused. Do not drop them (they hold consent evidence).

## 8. Local development and testing

- `SMS_DRY_RUN=true` (refused in production) logs instead of sending; the whole pipeline still runs.
- Tests: `backend/test/smsCore.test.js`, `smsProviders.test.js`, `smsConsentAndCredentials.test.js`, and `test/integration/sms.test.js` (which runs `smsFlows.part.js`: all four categories end to end, consent, keywords, organizer campaigns, credentials, countries, retention, health). Frontend: `test/smsFormat.test.js`, `test/smsConsent.test.jsx`.

## 9. Git state at hand-off

Someone staged part of an earlier SMS snapshot mid-development, so some files show both staged and unstaged changes. **Before committing, stage the SMS files again from the working tree** so the commit is consistent. Another team's admin-audit change (`frontend/src/app/admin/audit/*`, `admin/overview/RecentActivity.jsx`, `test/auditDetail.test.jsx`) is also staged: decide separately whether it belongs in the same commit.

## 10. Open owner decisions

- **Legal review of the consent wording** (draft below). In the US, marketing texts need prior express *written* consent with a clear disclosure, including "consent is not a condition of purchase". Carrier guidance (CTIA) also expects the program name, frequency, rates, HELP/STOP, and terms and privacy links.
- **Privacy policy and terms**: add SMS (what is sent, how to stop, retention, providers as processors).
- **Phone ownership** is not verified (no one-time code). Double opt-in per country is the available safeguard for marketing.
- **Door sales** (manual payments) record no SMS consent, so those buyers get no texts.
- **Organizer cost recovery**: organizer campaigns are paid by Eventsli today.
- **Retention period** for message text (setting exists, off by default).
- **STOP confirmation**: whether each provider account confirms STOP itself (then leave our confirmation off for it).
- **Vonage "unknown" sends** can only be resolved by their receipt or an admin (Vonage has no message lookup).

### Draft consent wording v2, for legal review (not active)

> **checkout.transactional.v2** — Text me my ticket confirmation, reminders and important changes to this event from Eventsli. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel. Terms: eventsli.com/terms · Privacy: eventsli.com/privacy
>
> **checkout.marketing_organizer.v2** — Send me news and offers from {organizer} by text (via Eventsli), using automated technology. Consent is not a condition of purchase. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel. Terms · Privacy
>
> **checkout.marketing_platform.v2** — Send me event news and offers from Eventsli by text, using automated technology. Consent is not a condition of purchase. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel. Terms · Privacy

To activate approved wording: add the `.v2` keys to `backend/services/sms/consentText.js` **and** `frontend/src/app/lib/smsConsentText.js` (a test keeps them identical), and point the version names in `consent.js` and `SmsConsentFields.jsx` at them.

# Privacy remediation, final — Eventsli Check-in, 2026-11-14

Follows `PRIVACY-AUDIT.md` (P-01..P-16, all still in place). This round closes
the six items left open. Each item says plainly whether it is
**implemented and tested**, **proposed** (written, not running anywhere), or
an **owner/legal decision**.

Nothing was committed, pushed or deployed. The production database, servers
and logs were **not** accessed: there is no access from this machine, and the
task forbids it. The new migration was applied to the **local** database
only.

## Summary

| # | Item | Status |
|---|---|---|
| F1 | Server retention for `scans` | **Implemented and tested, switched OFF.** Migration `20261118090000`, `services/scanRetention.js`, `scripts/scan-retention.js`, scheduler job gated by `SCAN_RETENTION_MODE` (default `off`). Needs owner approval of the period, then a production dry run. |
| F2 | nginx / API logs | **Investigated from the repository.** App logs are clean of query strings; **nginx's default access log writes the guest search text**. Fix **proposed** (config below), not applied — it is a change on the shared server. |
| F3 | Account deletion | **Proposed procedure:** `ACCOUNT-DELETION-RUNBOOK.md`. Not rehearsed in production. |
| F4 | Privacy policy | **Draft updated** in `PRIVACY.md`. Not published. |
| F5 | Expo and Sentry | **Verified from their published terms:** Sentry has a DPA that must be accepted; **no Expo DPA was found.** Google's "not shared" answer is therefore **not yet supportable for Expo**. |
| F6 | Offline scans after sign-out | **Implemented and tested.** Scans uploaded from a colleague's session stay under the device that took them; the uploader is recorded. |

## F1 — Server retention for check-in records

**What existed:** `scans` (ticket, event, door device, result, time, method,
conflict) was never deleted. No job, no policy.

**What is implemented** (`supabase/migrations/20261118090000_scan_attribution_and_retention.sql`):

- `scan_retention(keep_days, dry_run DEFAULT true, event_ids DEFAULT NULL)`:
  for each event that ended more than `keep_days` ago, deletes its per-scan
  log **unless**:
  - the row is a **conflict** (let in twice offline) — there is no resolution
    workflow, so conflicts count as unresolved and are kept;
  - an order of the event has an **open card dispute** (`dispute_status` not
    in won / lost / warning_closed / prevented);
  - the event has a **retention hold** (`scan_retention_holds`, with a reason):
    the documented way to keep records for a legal or operational need.
- `keep_days` under 30 is refused by the database.
- Every call, dry or not, writes counts (no personal data) to
  `scan_retention_runs`.
- Pending admissions do not exist on the server (they live on phones until
  uploaded). An upload after a purge writes new rows; nothing is lost.
- The ticket keeps its own `scanned_at` (part of the order record, retained
  for accounting). What is deleted is the per-scan log: which door, which
  attempts, refusals.
- **Delete, not anonymize:** `scans.ticket_id` is NOT NULL and the ticket
  itself identifies the guest through the order, so an "anonymized" scan row
  would still point at a person. Deleting is the honest option.

**Configuration** (backend `.env`): `SCAN_RETENTION_MODE=off|report|delete`
(default `off`), `SCAN_RETENTION_DAYS=90` (minimum 30). `report` logs a daily
dry run; only `delete` deletes.

**Tests:**
- `backend/test/integration/scanAttributionRetention.test.js` (9 tests,
  local database): an event inside the window is not touched; a dry run
  deletes nothing; a hold and an open dispute each keep the whole log;
  executing deletes the log, keeps the conflict and the ticket's `scanned_at`;
  under 30 days is refused. Every call is scoped to the test's own event.
- `backend/test/scanRetentionPolicy.test.js` (4 tests): the env parsing
  fails safe (unknown mode = off; under 30 days = off with an error).

**To enable (owner, in this order):**
1. Approve the period (proposed: 90 days after the event ends) and the
   exclusions above.
2. Apply the migration in production (after the pending ones; RELEASE.md).
3. Dry run: `node scripts/scan-retention.js --days 90` and keep the output.
4. Pilot one old event: `node scripts/scan-retention.js --event <uuid> --days 90 --execute --confirm-host <db host>`.
5. Set `SCAN_RETENTION_MODE=report` for a week; read the daily log lines.
6. Then `SCAN_RETENTION_MODE=delete`.

## F2 — Logs

Read from the repository (`backend/utils/logger.js`, `backend/app.js`,
`ecosystem.config.js`, `docs/DEPLOY.md` §6). **The production server was not
inspected**; everything marked *unverified* must be checked there.

| Log | What it records | Query strings / guest search? | Retention |
|---|---|---|---|
| API app log (pino → pm2 `logs/backend-out.log`, `backend-error.log`) | Explicit events only. No request logger (no morgan/pino-http). The error handler logs `req.path` (no query). Redacts password, token, authorization, cookies, guest email/phone. | **No** | **No rotation in the repository.** pm2 keeps appending unless `pm2-logrotate` is installed — *unverified* |
| Website (Next.js) pm2 logs | Server errors | Not reviewed in depth | Same as above |
| **nginx access log** | The documented server block sets no `access_log`/`log_format`, so nginx's default **`combined`** format applies: `"$request"` = method, **full URI with query string**, protocol | **Yes: `GET /api/v1/scan/attendees?q=Sara%20Ali`** (app and `/gate` PWA) | Ubuntu's default logrotate for nginx: daily, 14 kept — *unverified* |
| nginx error log | Errors; can include the request line | Sometimes | Same rotation — *unverified* |
| Supabase (database API) | The backend calls the guest search as an RPC (`event_door_list`), so the search text is in the POST body, not the URL | **No** in the URL | Per Supabase plan |
| Sentry | Off (no DSN). When on: scrubbed (P-04) | No | — |

**Recommended nginx change (proposed, not applied).** In
`/etc/nginx/nginx.conf` (http block):

```nginx
# The path without its query string: guest searches (?q=…) and tokens in
# query strings never reach the access log. No referrer (it can carry them too).
log_format eventsli_noquery '$remote_addr - [$time_local] "$request_method $uri $server_protocol" '
                            '$status $body_bytes_sent "$http_user_agent" $request_time';
```

and in the `eventsli` server block:

```nginx
access_log /var/log/nginx/eventsli.access.log eventsli_noquery;
```

Then `nginx -t && systemctl reload nginx`. Check with a search in the app and
`tail /var/log/nginx/eventsli.access.log` (no `?q=`). Old logs keep their
query strings until they rotate out; to remove them at once, delete the old
`access.log*` files after the reload (owner decision).

Also on the server (owner, read-only first):
- `cat /etc/logrotate.d/nginx` — confirm the period, write it into the policy.
- `pm2 ls` / `pm2 conf pm2-logrotate` — if no rotation, install
  `pm2-logrotate` with a set retention (for example 14 days).

**Not changed in the app:** moving the guest search from the URL to a POST
body would remove the problem at the source, but it changes the `/scan` API
shared with the website's `/gate` PWA. Proposed for a later API version.

## F3 — Account deletion

`ACCOUNT-DELETION-RUNBOOK.md`. Key facts it rests on (from the schema):
- No deletion feature exists; it is manual.
- `DELETE FROM profiles` is unsafe: `organizers.owner_user_id` cascades, and
  more than twenty NO ACTION references (audit, invoices, payments) block
  it. The runbook **anonymizes the profile in place** instead.
- Door staff: deleting `event_staff` cascades to their devices; their past
  scans stay with `device_id` NULL (anonymized, not deleted).
- Orders and tickets (with buyer contact details) are retained for the
  accounting period; backups keep everything until they expire. The runbook
  says so instead of claiming deletion.

## F4 — Privacy policy

`PRIVACY.md` → "The website's privacy policy: what has to change" now covers:
app data, Expo, Sentry, session lengths (24 h web / 14 days app), offline
storage, check-in retention (the proposed 90 days, marked as pending), log
retention (pending the server check), and how deletion works (anonymization,
retained records, backups). **Not published.**

## F5 — Expo and Sentry

Checked 2026-11-14 against the providers' own pages:

| | Sentry | Expo (EAS Update) |
|---|---|---|
| Receives | Crash reports and scan timings, scrubbed on the phone; only with a DSN | On every app start: a random install id (`EAS-Client-ID`), platform, app/runtime version, the IP address |
| DPA | **Exists** — [sentry.io/legal/dpa](https://sentry.io/legal/dpa/): Sentry is processor; effective "as of the date electronically agreed and accepted by you"; DPF with SCC fallback; subprocessors at sentry.io/legal/subprocessors | **None found.** [expo.dev/privacy](https://expo.dev/privacy) (updated 2026-11-10) says it "may collect the end-users' device operating system and randomized tokens … to determine if the end-user has downloaded an update", does not say processor or controller, and gives no retention period. The [compliance docs](https://docs.expo.dev/regulatory-compliance/data-and-privacy-protection.md) mention GDPR/DPF compliance but no DPA |
| Status | **Not in place**: there is no Sentry account yet. Accept the DPA when creating the organization, before setting a DSN | **Not in place**: ask Expo (contact form) for a DPA or written confirmation that it processes EAS Update data only on the customer's behalf |

**Declarations.** What the app *collects* is verified in code and stays as
declared (Apple: Device ID, not linked; Google: Device or other IDs). What is
**not** verified is Google's "not shared with third parties" for Expo: that
answer relies on Expo being a service provider. Until Expo confirms it, the
owner chooses one of:
1. answer Google **"shared"** for Device or other IDs (with Expo), or
2. switch EAS Update off (`"updates": { "enabled": false }` in app.json; store
   updates only) — then nothing goes to Expo at all, or
3. wait for Expo's answer before submitting.

`PRIVACY.md` marks the answer as pending accordingly. Apple's questionnaire is
not affected (it asks what is collected, including by partners, which is
declared).

## F6 — Offline scans after sign-out

**Problem (confirmed in code):** `syncBatch` recorded every uploaded scan under
the uploading door device (`req.device.deviceId`). Amira scans with no signal,
signs out; Ben signs in on the same phone; the queue uploads with Ben's token
and every scan became Ben's (`scan_devices.staff_id` → Ben).

**Fix (implemented and tested):**
- Phone: each scan row stores the door device that took it (schema v5,
  `device_id`); the upload sends it as `scannedByDeviceId`
  (`mobile/src/gate/queuePolicy.ts`, `scanLog.ts`, `(door)/_layout.tsx`).
- Server (`backend/services/scanService.js`): after the unchanged admission
  decision (`check_in_ticket_v2` is not touched), the row this upload wrote
  is moved to the claimed device — **only if that device belongs to the same
  event** — and the uploader is recorded in `scans.uploaded_by_device_id`. A
  replay changes nothing; an unknown or other-event device is ignored; a
  failure to attribute never fails the upload.
- Held scans are still never deleted before upload (P-07), and survive
  sign-out.

**Tests:**
- `mobile/test/attribution.test.ts` (6): rows are stamped; Amira → sign-out →
  Ben uploads with Ben's token naming Amira's device; Ben's own scans carry
  Ben's device; a retry after `error` keeps the device; old rows send none;
  a v4 phone database upgrades and keeps its held scans.
- `backend/test/integration/scanAttributionRetention.test.js` (4 of 9):
  attributed to Amira with Ben as uploader; another event's device, a random
  id and garbage are ignored; a replay changes nothing; an old app keeps the
  old behaviour.

**Limit:** the phone states which device took a scan. A dishonest member of
the same event's door team could name a colleague's device; they could
equally invent offline scans today. The uploader is always recorded, so it is
visible in the data.

## Test evidence (this round)

| Suite | Result |
|---|---|
| Mobile: typecheck, lint, Jest | clean, clean, **247/247** (19 suites) |
| Backend unit (`npm test`) | **597/597** |
| Backend integration, local database: checkin, checkinApp, dashboardsAndDoorTeam, offlineAdmission, scheduler, dataApiLockdown, scanAttributionRetention | **88/88** |

## Owner and legal decisions still required

1. **Retention period** for check-in logs (proposed 90 days after the event),
   and whether conflicts need a resolution workflow so they can expire too.
2. **Apply** migration `20261118090000` in production, run the dry run, then
   enable `report`, then `delete` (F1 steps).
3. **nginx**: apply the no-query log format; decide whether to delete existing
   access logs; confirm logrotate and pm2 log retention, and put the real
   numbers in the policy.
4. **Expo**: request a DPA / processor confirmation — or answer "shared", or
   turn EAS Update off. **Sentry**: accept its DPA before any DSN is set.
5. **Account deletion runbook**: counsel review, then one rehearsal on a copy
   of the database.
6. **Privacy policy**: counsel review of the draft in `PRIVACY.md`, then
   publish (with the app submission).
7. **Seller identity**: with individual developer accounts the stores show the
   owner's legal name; the policy must name the same responsible party.
8. Later: move the guest search into a POST body (API v2), so it can never be
   logged as a URL.

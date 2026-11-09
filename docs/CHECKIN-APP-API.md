# Eventsli Check-in — API contract

The API the native check-in app (iOS / Android) is built against. The `/gate`
web scanner uses the same door endpoints. All paths are under `/api/v1`.
Every response uses the platform envelope:

```
success → { success: true,  data, pagination? }
failure → { success: false, error: CODE, message, meta? }
```

**Deploy order.** Apply these migrations with
`backend/scripts/apply-migration.js` **before** deploying the API:
1. `20261108090000_checkin_v2.sql`. Required: the API calls
   `check_in_ticket_v2`.
2. `20261108100000_checkin_app_api.sql`. Sessions, sign-in codes, door
   settings and the read functions.
3. `20261109090000_door_list_search.sql`. Guest search by name in any word
   order, ignoring case and accents. It replaces `event_door_list` and adds
   `door_fold`, and needs no extension.
4. `20261110090000_offline_manifest.sql`. The offline ticket list
   (`event_door_manifest`), plus a trigger so that a cancelled or refunded
   order counts as a change to its tickets.

Then set `QR_SIGNING_KEY` and `QR_SIGNING_KID` on the server (section 7)
before restarting the API.

## 1. Signing in

There are two kinds of token. The app keeps both in secure storage
(Keychain / Keystore).

| Token | Got from | Lifetime | Used for |
|---|---|---|---|
| **Account session** | `/auth/app/login` or `/auth/app/token` | 14 days | `/auth/*`, `/scan/assignments`, `/scan/staff-login` |
| **Door token** | `/scan/staff-login` (person) or `/scan/login` (shared tablet) | 16 h (person), 7 d (tablet) | Every other `/scan/*` |

Send both as `Authorization: Bearer <token>`. The app never receives a
cookie.

A person's door token is tied to the account session that opened it. If that
session ends, the door closes on its next request with a 401
`SESSION_REVOKED`. A session can end by signing out, by signing out
everywhere, or by pressing **End** on the account's Security page (for a lost
phone). If the session check or the device lookup itself fails (a database
saturated by a rush, say), the door gets a 503 `SESSION_CHECK_FAILED`. The
app should hold the scan, or decide it offline, and not leave the door. Only
a 401 means the door is closed.

### Password
`POST /auth/app/login`

Request:
```json
{ "email": "...", "password": "...", "deviceName": "Sara's iPhone" }
```

Response:
```json
{ "token": "...", "expiresAt": "...", "user": { "id": "...", "email": "...", "fullName": "...", "role": "...", "accountTypes": [] } }
```

The refusals are the same as on the website:
- 401 `UNAUTHENTICATED`
- 403 `EMAIL_NOT_VERIFIED`
- 403 `ACCOUNT_BANNED`
- 429 `RATE_LIMITED`

### Sign in with Eventsli (authorization code + PKCE, S256)
1. The app creates a `verifier` (43–128 characters from `[A-Za-z0-9._~-]`)
   and computes `challenge = base64url(sha256(verifier))`.
2. It opens a system browser session (ASWebAuthenticationSession / Custom
   Tabs) at:
   `https://eventsli.com/app-auth?code_challenge=<challenge>&code_challenge_method=S256&redirect_uri=eventsli-checkin://auth/callback&state=<random>`
3. The person signs in on the site by any method, then presses **Allow**. The
   browser returns to `eventsli-checkin://auth/callback?code=…&state=…`, or
   with `?error=access_denied&state=…` if they cancel.
4. The app checks that `state` matches, then exchanges the code within 2
   minutes:
   - Request: `POST /auth/app/token`
     `{ "code": "...", "codeVerifier": "<verifier>", "redirectUri": "eventsli-checkin://auth/callback", "deviceName": "..." }`
   - Response: the same as a password login.
   - Each code works once. Any failure returns 400 `INVALID_CODE`, after
     which the person must start again.

### Signing out
`POST /auth/logout` with the account session revokes it on the server.

### Shared tablet with a PIN
1. Scan the pairing QR on the organizer's Devices page. It contains
   `eventsli-checkin://pair?device=<deviceId>`.
2. Send `POST /scan/login { deviceId, pin }`.
3. The response is `{ token, device: { id, label, eventId } }`.

The QR never contains the PIN.

## 2. Choosing an event

`GET /scan/assignments?scope=all` (account session)

Response:
```json
{
  "upcoming": [EventCard], "ongoing": [EventCard], "past": [EventCard]
}
EventCard = {
  "id", "title", "slug", "status", "startsAt", "endsAt", "timezone",
  "venue", "city", "coverUrl", "as": "organizer|staff",
  "scannable": true, "stats": { "issued": 0, "admitted": 0 }
}
```

- Past covers the last 30 days and is read-only (`scannable: false`).
- A door stays scannable until 12 hours after `endsAt`.

To open the door for an event, send `POST /scan/staff-login { eventId }`. The
response is `{ token, device, event }`, and `token` is the door token.

## 3. At the door (door token)

| Call | Returns |
|---|---|
| `GET /scan/me` | `{ device: { id, label, kind }, role, event: {…, coverUrl, city}, permissions, settings, gate, stats }` |
| `POST /scan/verify { qr, clientScanId?, occurredAt? }` | A scan answer (see below) |
| `POST /scan/sync { scans: [{ qr, clientScanId, occurredAt, method?, offlineVerdict? }] }` | `{ results: [answer + clientScanId], summary: { total, admitted, replayed, conflicts } }` |
| `POST /scan/undo { ticketId }` | `{ ok, result: 'undone', ticket_id }`. Returns 404 if the ticket is not for this event, 409 if it was never scanned |
| `GET /scan/status` | `{ gate: { locked, reason?, override? }, stats: { issued, admitted, pending, void } }`. Poll every 10 s while the dashboard is visible |
| `GET /scan/recent?limit=20&before=ISO&kind=admitted\|all` | `[{ id, result, method, conflict, at, ticketId, holder, tier, device, staff }]`, newest first |
| `GET /scan/attendees?q=&status=all\|in\|out&limit=50&offset=0` | Rows `{ ticketId, status, scannedAt, holder, holderIsBuyer, tier, seat, table }` plus `pagination { total, limit, offset, hasMore }`. `q` matches when every word in it appears in the guest's name or email, in any order, ignoring case and accents ("smith, john" and "chloe" both work), or when it is the start of the ticket ID. The email is matched but never returned. `status` filters as given; the app sends `all` whenever something is typed, so a guest already inside can still be found. Requires `permissions.viewGuests`, otherwise 403 `FORBIDDEN` |
| `POST /scan/manual-check-in { ticketId, clientScanId? }` | A scan answer with `method: 'manual'`. Requires `permissions.manualCheckIn` |
| `GET /scan/tickets/:ticketId` | `{ ticketId, status, orderPaid, scannedAt, qrVersion, transferred, holder, holderIsBuyer, tier, seat, table, history: [{ result, method, conflict, at, device, staff, detail }] }` |
| `GET /scan/analytics?bucket=15` | `{ bucketMinutes, stats, timeline: [{ at, admitted }], byTier, byDevice, byMethod, refusals, conflicts, lastFiveMinutes, peak, firstAt, lastAt }` |

### Roles and permissions
The server decides these. The app only displays them.

| `role` | What it means |
|---|---|
| `owner` | The event's organizer on their own phone. Sees everything. |
| `staff` | A door-team member signed in with their own account. |
| `pin` | A shared tablet. |

For `staff` and `pin` devices:
- They can always scan, undo, and see the counts and recent arrivals.
- Names are shortened ("Sara A.") unless the organizer turns on **Door team
  can search the guest list**. That setting also enables search and manual
  check-in.

`permissions = { viewGuests, manualCheckIn, fullNames, analytics, offlineAdmission, offlineNames }`.

### Scan answers
A refusal is a **200**. Read `result`, never the HTTP status. There are two
exceptions:
- A locked gate returns **403 `SCANNER_LOCKED`**.
- When the database did not answer, `/scan/verify` and `/scan/manual-check-in`
  return **503 `SCAN_UNAVAILABLE`**. That is not a decision: hold the scan, or
  decide it offline. In a `/scan/sync` upload, the same case is a row with
  `result: 'error'`; send that scan again later with the same `clientScanId`.
  The app stops after 5 tries.

| `result` | Tone | Meaning |
|---|---|---|
| `admitted` | admit | Let them in |
| `duplicate` | warn | Already admitted. `scanned_at` and `first_scan: { at, device, staff }` say when and where. `conflict: true` means two doors let them in while offline |
| `transferred` | refuse | The code predates a transfer. The new holder has the code that works |
| `void` | refuse | Refunded, voided, or the order is no longer paid |
| `event_cancelled` | refuse | The event was cancelled |
| `event_not_open` | refuse | The event is not open for entry (draft, suspended, completed) |
| `not_found` | refuse | No such ticket for this event |
| `invalid` | refuse | The code was not issued by Eventsli |
| `wrong_event` | refuse | A real ticket for another event |
| `scanner_locked` | refuse | The gate is closed. This one comes back as a 403 |
| `error` | warn | The server could not decide. Scan again |

An answer about a ticket also carries:
- `ticket_id`
- `attendee`: the holder, or the buyer when `holder_is_buyer` is true; null
  after a transfer
- `tier`, `tier_kind`, `seat`, `table`
- `event_title`, `event_starts_at`, `event_timezone`
- `method`

A replayed `clientScanId` returns the original answer with `replay: true`.

Every `result` value must have a screen in the app. A contract test reads
the backend SQL and services and fails if one is missing, as
`frontend/test/gateOutcomes.test.js` already does for the web gate.

## 4. App configuration

`GET /app/config` is public. Read it on launch:
```json
{ "minSupportedVersion": { "ios": "1.0.0", "android": "1.0.0" },
  "storeUrls": { "ios": null, "android": null }, "signInUrl": "https://eventsli.com/app-auth", "supportUrl": null }
```

If the installed version is below the minimum, show "Update required" and do
not scan.

## 5. Organizer (web) endpoints

- `GET` / `PATCH /events/:eventId/gate-settings` — `PATCH` takes
  `{ doorTeamCanViewGuests?, offlineAdmission?, offlineShowNames?, legacyQrOffline?: 'allow'|'hold' }`.
- `GET /events/:eventId/scan-devices/:deviceId/pairing.png` — the pairing QR.

## 6. Environment (backend)

| Variable | Purpose |
|---|---|
| `CHECKIN_APP_REDIRECT_URIS` | Allowed redirects for Sign in with Eventsli. Blank means `eventsli-checkin://auth/callback` |
| `CHECKIN_APP_MIN_VERSION_IOS`, `CHECKIN_APP_MIN_VERSION_ANDROID` | The minimum app versions |
| `CHECKIN_APP_IOS_URL`, `CHECKIN_APP_ANDROID_URL`, `CHECKIN_APP_SUPPORT_URL` | Store and support links |
| `QR_SIGNING_KEY`, `QR_SIGNING_KID` | The QR v2 signing key (section 7). Optional; a key that is set but unreadable stops the API at boot |
| `QR_SIGNING_RETIRED_KEYS` | Optional JSON `{"kid": "public PEM"}`: older keys whose codes are still valid |

## 7. Offline admission

With no signal, the app decides from its own copy of the event's tickets
instead of holding every scan. The organizer can switch this off per event
(section 5, `offlineAdmission`).

### Ticket codes: QR v2
- **New codes** are ES256 JWTs (ECDSA P-256, SHA-256), signed with
  `QR_SIGNING_KEY`. The header is `{ "alg": "ES256", "kid": "<QR_SIGNING_KID>" }`
  and the claims are `{ typ: 'ticket', tid, eid, v? }`, with no `iat`. The
  signature is the JOSE raw `r || s` (64 bytes).
- **Legacy codes** (HS256 with `QR_JWT_SECRET`, already in buyers' inboxes)
  keep working online. A phone cannot check their signature, so offline the
  organizer's `legacyQrOffline` decides: `allow` admits them on a list match,
  `hold` holds them.
- A buyer's ticket page shows a v2 code as soon as the key is configured,
  because codes are minted when a ticket is read.
- Without `QR_SIGNING_KEY`, codes stay legacy.

To make the key, run `node backend/scripts/qr-signing-key.js` and put its two
lines in the server's `.env`. To rotate: make a new key, move the old public
key into `QR_SIGNING_RETIRED_KEYS`, and drop it once the last event it signed
for is over.

### `GET /scan/keys` (door token)
```json
{ "keys": [{ "kid": "2026-11", "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "x": "…", "y": "…" }] }
```
These are public keys only. The app fetches them with the list and refetches
when it meets a `kid` it does not have.

### `GET /scan/manifest?cursor=&limit=` (door token)
Call with no cursor the first time. Then keep calling with the returned
`cursor` until `done: true`, and store that final cursor for the next refresh.

```json
{
  "rows": [{ "ticketId", "v", "status": "valid|scanned|void", "scannedAt", "tier", "seat", "table", "holder" }],
  "cursor": "…", "done": true, "reset": false, "names": false,
  "event": { "status", "startsAt", "endsAt" }, "gateLocked": false,
  "legacyQrOffline": "allow|hold", "serverTime": "…"
}
```
- **No cursor:** every ticket, with `reset: true`. The phone replaces its list.
- **With a cursor:** only tickets that changed since the last complete run.
  That run's start counts from the database clock, less a 30-second overlap,
  so a row may come twice; rows are idempotent.
- **What counts as a change:** a scan, an undo, a transfer (`v` goes up), a
  void, and any status change on the ticket's order. A ticket on an order
  that is no longer paid is listed as `void`.
- **Names:** `holder` is only filled when `names` is true. That is always the
  case for the organizer, and for the door team only if **Include names in that
  offline copy** is on. When that setting changes, the next call answers with
  `reset: true`.
- **Off switch:** if the organizer switches offline check-in off, the call
  returns 403 `FORBIDDEN` with `meta.reason: 'offline_admission_off'`. The
  app deletes its list.
- **Paging:** pages hold up to 1,000 rows by default; `limit` accepts 1–2000.
  A cursor this server did not write is treated as a fresh start.

### Deciding on the phone
The app checks in the same order as `check_in_ticket_v2`:
1. Signature: v2 is verified with the key, a legacy code follows `legacyQrOffline`.
2. Event: the code must be for this event.
3. Gate and event: not locked, not cancelled, open.
4. On the list.
5. Not void.
6. `v` is current.
7. Not already scanned. This includes the phone's own offline admissions that
   have not uploaded yet.
8. Admit.

| Result on the phone | What happens next |
|---|---|
| An offline **admission** | Queued and uploaded through `/scan/sync` with `method: 'offline'` and `offlineVerdict: 'admitted'`. If another door admitted the ticket first, the server flags the upload as a `conflict` |
| A **refusal** | Final, and never uploaded: the server must not later admit someone the door turned away |
| A ticket **not on the list** (bought after the last refresh), or a `kid` the phone does not have | Held, and uploaded for the server to decide |

### Keeping the list current, and removing it
- The app uploads, then refreshes the list, every 15 seconds, on reconnect,
  and when it returns to the foreground.
- The list is deleted when the phone leaves the door (switching event, signing
  out, or any 401), when the organizer switches offline check-in off, and 24
  hours after the event ends.
- Held scans are kept until they upload.

### Conflicts
`GET /events/:eventId/attendees` (organizer) marks each row with `conflict`.
`?checkedIn=conflict` lists only those tickets: two doors let the same ticket
in while offline, so both people may be inside.

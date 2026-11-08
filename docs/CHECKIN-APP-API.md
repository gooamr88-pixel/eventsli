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

## 1. Signing in

There are two kinds of token. The app keeps both in secure storage
(Keychain / Keystore).

| Token | Got from | Lifetime | Used for |
|---|---|---|---|
| **Account session** | `/auth/app/login` or `/auth/app/token` | 14 days | `/auth/*`, `/scan/assignments`, `/scan/staff-login` |
| **Door token** | `/scan/staff-login` (person) or `/scan/login` (shared tablet) | 16 h (person), 7 d (tablet) | Every other `/scan/*` |

Send both as `Authorization: Bearer <token>`. The app never receives a
cookie.

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
| `GET /scan/attendees?q=&status=all\|in\|out&limit=50&offset=0` | Rows `{ ticketId, status, scannedAt, holder, holderIsBuyer, tier, seat, table }` plus `pagination { total, limit, offset, hasMore }`. Requires `permissions.viewGuests`, otherwise 403 `FORBIDDEN` |
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
A refusal is a **200**. Read `result`, never the HTTP status. The only
exception is a locked gate, which returns **403 `SCANNER_LOCKED`**.

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

## 7. Coming in Phase 3 (offline)

- `GET /scan/manifest?cursor=`: the event's tickets for offline decisions.
- `GET /scan/keys`: public keys for verifying signed QR v2 on the device.

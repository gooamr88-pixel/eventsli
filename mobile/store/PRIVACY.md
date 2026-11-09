# Privacy answers — Eventsli Check-in

What the app collects, for Apple's App Privacy questionnaire and Google Play's
Data safety form, written from the code as it is. If the code changes, so must
these answers. Owner and legal review before submission.

## What the app handles

| Data | Where it comes from | Where it goes | Kept on the phone |
|---|---|---|---|
| The signed-in person's email and name | Their Eventsli account | Eventsli API (sign-in) | In the Keychain / Keystore until sign-out or 14 days |
| Account and door tokens | Eventsli API | Eventsli API, on every request | Keychain / Keystore, this device only, never backed up |
| Check-in records: which ticket, when, which door | Scanned on the phone | Eventsli API | Encrypted database (SQLCipher); 48 h, or 2,000 rows |
| The event's ticket list (offline check-in): ticket type, seat, status; guest names only if the organizer allows | Eventsli API | Nowhere | Encrypted database; deleted on leaving the door, when the organizer switches offline check-in off, and 24 h after the event |
| Crash reports and scan timings (only when a Sentry DSN is built in) | The app | Sentry, as Eventsli's processor | No |

The app reads guest names to show them at the door, on behalf of the event's
organizer. It shows no ads, does no tracking, and does not use the advertising
ID. The camera is used only to read QR codes: no photo or video is kept, and
nothing is recorded. Android backups are off (`allowBackup: false`).

Crash reports are scrubbed on the phone before they are sent
(`src/lib/monitoring.ts`): no tokens, no email addresses, no query strings
(the guest search carries names), no console output, and no user identity.

## Apple — App Privacy

Tracking: **No.**

| Data type | Collected | Linked to the user | Purpose |
|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | App Functionality |
| Contact Info → Name | Yes | Yes | App Functionality |
| User Content → Other User Content *(check-in records)* | Yes | Yes | App Functionality |
| Diagnostics → Crash Data *(if Sentry is on)* | Yes | No | App Functionality |
| Diagnostics → Performance Data *(if Sentry is on)* | Yes | No | App Functionality |

Everything else is **not collected**: location, contacts, photos, browsing,
purchases, financial info, health, identifiers for advertising.

## Google Play — Data safety

- Collected and transmitted: **yes**. Shared with third parties: **no** (Sentry
  processes crash reports on Eventsli's behalf, which Google does not count as
  sharing).
- Encrypted in transit: **yes** (HTTPS only in store builds).
- Users can request deletion: **yes**, from the website or by email (see the
  privacy policy).

| Category → type | Collected | Optional | Purposes |
|---|---|---|---|
| Personal info → Name | Yes | No | App functionality, Account management |
| Personal info → Email address | Yes | No | App functionality, Account management |
| App activity → Other actions *(check-ins)* | Yes | No | App functionality |
| App info and performance → Crash logs *(if Sentry is on)* | Yes | No | App functionality |
| App info and performance → Diagnostics *(if Sentry is on)* | Yes | No | App functionality |
| Device or other IDs *(Sentry's random install ID, if Sentry is on)* | Yes | No | App functionality |

## Permissions

| Platform | Permission | Why |
|---|---|---|
| iOS | Camera (`NSCameraUsageDescription`: "Eventsli Check-in uses the camera to scan tickets at the door.") | Reading ticket QR codes |
| Android | `CAMERA` | Reading ticket QR codes |
| Android | `INTERNET`, `VIBRATE`, `MODIFY_AUDIO_SETTINGS` | Normal permissions: the API, the vibration and the answer sounds |

Removed on purpose, and checked in the generated manifest: microphone
(`RECORD_AUDIO`), foreground media service, storage, Face ID text, background
audio. The libraries asked for them by default; the app uses none of them.

## The website's privacy policy needs an app section

`https://eventsli.com/privacy` does not cover the app yet. It also says
"Sign-in sessions: each lasts at most 24 hours", while an app session lasts 14
days. Draft for legal review (not published):

> **The Eventsli Check-in app.** Organizers and their door teams use the app to
> check guests in. It uses the camera only to read ticket codes; nothing is
> recorded. To check tickets when the venue has no signal, the app can keep an
> encrypted copy of the event's ticket list on the phone (ticket type, seat
> and status, and guest names only if the organizer allows it). The copy is
> deleted when the person leaves the event in the app, when the organizer
> switches offline check-in off, and 24 hours after the event. Check-in
> records (which ticket was scanned, when and by which door) are sent to
> Eventsli. If the app crashes, it may send a crash report that contains no
> names, email addresses or ticket codes. An app sign-in lasts up to 14 days
> and can be ended at any time from Account → Security.

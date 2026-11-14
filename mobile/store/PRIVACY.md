# Privacy answers — Eventsli Check-in

What the app collects, for Apple's App Privacy questionnaire and Google Play's
Data safety form, written from the code as it is (re-checked in the privacy
audit of 2026-11-14, `PRIVACY-AUDIT.md`). If the code changes, so must these
answers, and the iOS privacy manifest in `app.json` with them. Owner and legal
review before submission.

## What leaves the phone, and to whom

| Data | Sent to | When | Kept on the phone |
|---|---|---|---|
| The signed-in person's email and password (password sign-in only) | Eventsli API | Sign-in | No; the password is never stored |
| The phone's **model** ("Pixel 8"), to name the session on the web account page | Eventsli API | Sign-in | No |
| Account and door tokens | Eventsli API, on every request | Always | Keychain / Keystore, this device only, never backed up or transferred |
| Check-in records: which ticket, when, which door, how it was decided | Eventsli API | Each scan, or later if offline | Encrypted database; settled rows are deleted after 48 h or beyond the newest 2,000 (all events together), and keep no QR code once settled |
| Guest search text (a name typed into Find Guest) | Eventsli API, in the request address | Each search | No |
| The event's ticket list (offline check-in): ticket type, seat, status; guest names only if the organizer allows | (downloaded, never sent) | — | Encrypted database; deleted on leaving the event, signing out, when the door is closed by the server, when offline mode or the organizer's offline check-in is switched off, and 24 h after the event ends (checked when the app opens) |
| A random **update-check id** (`EAS-Client-ID`), the platform and app version, and the network address | **Expo** (u.expo.dev), Eventsli's update service | Every app start | Yes, a random id made by the app on first launch |
| Crash reports and scan timings — **only when a Sentry DSN is built in** | **Sentry**, Eventsli's processor | On a JavaScript crash; 20 % of scans | No |

Not collected: location, contacts, photos or files, browsing, purchases,
financial or health data, the advertising identifier, audio. The camera reads
QR codes on the phone; no image or video is kept or sent. The app does no
tracking and shows no ads.

**Sentry, as configured** (`src/lib/monitoring.ts`): JavaScript layer only
(`enableNative: false`), no session pings, no user, no install id, no IP
inference (`sendDefaultPii: false`). Every report and timing passes the
scrubber, which removes tokens, email addresses, ids, URL query strings, guest
fields and Sentry's own `http.query` span data. With no DSN — the state today —
nothing is sent to Sentry at all.

## Apple — App Privacy

Tracking: **No.** Data used to track you: **none.**

| Data type | Collected | Linked to the user | Purpose |
|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | App Functionality |
| Contact Info → Name | Yes | Yes | App Functionality |
| User Content → Other User Content *(check-in records)* | Yes | Yes | App Functionality |
| Search History *(Find Guest searches: sent with the door's token, and kept briefly in server request logs)* | Yes | Yes | App Functionality |
| Identifiers → Device ID *(Expo's random update-check id)* | Yes | No | App Functionality |
| Diagnostics → Crash Data *(only with a Sentry DSN)* | Yes | No | App Functionality |
| Diagnostics → Performance Data *(only with a Sentry DSN)* | Yes | No | App Functionality |

If the build ships **without** a Sentry DSN, Crash Data and Performance Data
may be answered "not collected". Answering "collected" anyway is safe; the
reverse is not. Keep the questionnaire and `ios.privacyManifests` in step.

## Google Play — Data safety

- Data collected: **yes**. Data shared with third parties: **PENDING — do not
  answer "no" yet** (PRIVACY-AUDIT-FINAL.md, F5, checked 2026-11-14):
  - **Sentry** has a DPA (processor), but it only applies once accepted in the
    Sentry organization. Accept it before any DSN is built in. Until then
    nothing is sent to Sentry.
  - **Expo** publishes no DPA, and its privacy policy does not say it is a
    processor of the EAS Update data. Until Expo confirms in writing, either
    answer **"shared"** for *Device or other IDs* (with Expo), or turn EAS
    Update off (`"updates": { "enabled": false }`), in which case nothing goes
    to Expo and "no" is correct.
- Encrypted in transit: **yes** (store builds refuse any address that is not
  HTTPS: `src/api/client.ts`, ATS, no cleartext on Android release builds).
- Users can ask for their data to be deleted: **yes**, by email (see the
  privacy policy). There is no in-app or self-service deletion; the manual
  procedure is `ACCOUNT-DELETION-RUNBOOK.md`. Records the law requires
  (orders, tickets, invoices) are anonymized or retained, not deleted.

| Category → type | Collected | Optional | Purposes |
|---|---|---|---|
| Personal info → Name | Yes | No | App functionality, Account management |
| Personal info → Email address | Yes | No | App functionality, Account management |
| App activity → In-app search history *(Find Guest)* | Yes | Yes | App functionality |
| App activity → Other actions *(check-ins)* | Yes | No | App functionality |
| Device or other IDs *(Expo's update-check id)* | Yes | No | App functionality |
| App info and performance → Crash logs *(only with a Sentry DSN)* | Yes | No | App functionality |
| App info and performance → Diagnostics *(only with a Sentry DSN)* | Yes | No | App functionality |

## The iOS privacy manifest

`ios.privacyManifests` in `app.json` declares exactly the Apple table above
(email, name, other user content, search history: linked; device id, crash
and performance data: not linked; all for app functionality), no tracking and
no tracking domains, plus the required-reason APIs the bundled SDKs use
(UserDefaults CA92.1; file timestamps C617.1, 0A2A.1, 3B52.1; system boot time
35F9.1; disk space E174.1, 85F4.1). The SDKs' own manifests (React Native,
expo-application, -constants, -device, -eas-client, -file-system, -system-ui,
Sentry) declare the same reasons; repeating them in the app's manifest covers
Apple not always reading manifests inside static pods.

## Permissions

| Platform | Permission | Why |
|---|---|---|
| iOS | Camera (`NSCameraUsageDescription`: "Eventsli Check-in uses the camera to scan tickets at the door.") | Reading ticket QR codes |
| Android | `CAMERA` | Reading ticket QR codes |
| Android | `INTERNET`, `ACCESS_NETWORK_STATE` | The API; knowing when the signal is gone |
| Android | `VIBRATE`, `MODIFY_AUDIO_SETTINGS` | The answer's vibration and sound |
| Android | `DETECT_SCREEN_CAPTURE` | Android 14+: expo-screen-capture registers a capture callback at start-up and crashes without it. Normal permission, no prompt; nothing is read. |

Removed on purpose (`android.blockedPermissions`), and checked in the
generated manifest on 2026-11-14: microphone (`RECORD_AUDIO`), foreground
media/microphone services, storage (`READ`/`WRITE_EXTERNAL_STORAGE`),
**photos and media (`READ_MEDIA_IMAGES`/`VIDEO`/`AUDIO` — expo-screen-capture
asked for them, and Google Play rejects apps that hold them without a core
need)**, and **draw over other apps (`SYSTEM_ALERT_WINDOW`, from the Expo
template)**. No location permission is requested by the app or any library.

## Backups and device transfer

- **iOS:** tokens and the database key are Keychain items marked
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: never in a backup, never moved to a new
  phone. The database file can be in an iCloud/computer backup, but it is
  SQLCipher-encrypted with that key, so a restored copy cannot be read (the
  app deletes it and starts fresh, `src/lib/db.ts`).
- **Android:** `allowBackup="false"` turns cloud and adb backups off. Device
  transfer on Android 12+ follows expo-secure-store's
  `data_extraction_rules`: only shared preferences, minus SecureStore. The
  database, the tokens and the keys stay on the old phone.

## The website's privacy policy: what has to change

`https://eventsli.com/privacy` (frontend/src/app/privacy/page.jsx) differs
from the app in these places. Draft wording for legal review is below. **Not
published.**

1. **No app section.** Nothing about the camera, the offline copy, or the
   check-in app at all.
2. **Sessions.** "Sign-in sessions: each lasts at most 24 hours." An app
   sign-in lasts up to **14 days** (`APP_SESSION_TTL_HOURS = 14 * 24`,
   backend/services/sessionService.js).
3. **Processors.** The "who we share with" list does not name **Expo**
   (update checks on every app start) or **Sentry** (crash reports, once
   switched on).
4. **Check-in records.** "Check-in at the door" is described as collected, but
   no retention is given. A retention job now exists, **off** until approved
   (PRIVACY-AUDIT-FINAL.md, F1): proposed 90 days after the event, except
   unresolved conflicts, open card disputes and events under a documented
   hold. The ticket keeps the fact that it was used, with the order.
5. **Logs.** "Server request logs: deleted automatically after a short
   period." The web server's access log currently records full request
   addresses, **including names typed into the door's guest search**; the
   period is not confirmed (Ubuntu's default is 14 days). Fix the log format
   (F2) and state the real period.
6. **Account deletion** is by email request and done by hand
   (`ACCOUNT-DELETION-RUNBOOK.md`). The policy should say that some records
   are anonymized or retained rather than deleted, and that backups keep data
   until they expire.

Draft app section:

> **The Eventsli Check-in app.** Organizers and their door teams use the app
> to check guests in. The camera only reads ticket codes on the phone; no
> photo or video is kept or sent. To check tickets where the venue has no
> signal, the app can keep an encrypted copy of the event's ticket list on the
> phone (ticket type, seat and status, and guest names only if the organizer
> allows it). That copy is deleted when you leave the event or sign out, when
> offline check-in is switched off, and 24 hours after the event. Check-in
> records (which ticket was scanned, when and at which door) are sent to
> Eventsli; the phone keeps its own copy for at most 48 hours, without the
> ticket code. Names typed into the guest search are sent to Eventsli to find
> the guest and are kept only in our short-lived server logs. When you sign
> in, the app sends your phone's model (for example "Pixel 8") so you can
> recognise the session on your account page. Each time it starts, the app
> asks Expo, our update service, whether a newer version is available; Expo
> sees a random identifier the app made for this purpose, the app version and
> your network address. If the app crashes, it may send a crash report to
> Sentry that contains no names, email addresses, ticket codes or searches. An
> app sign-in lasts up to 14 days and can be ended at any time from your
> account page.

Change in the sessions row:

> Sign-in sessions: on the website, each lasts at most 24 hours; in the
> Eventsli Check-in app, at most 14 days. Expired sessions are deleted
> automatically.

Retention rows to add or change (fill the bracketed values once decided and
checked on the server):

> Check-in records (which ticket was scanned, when, at which door): the
> detailed log is deleted [90] days after the event, unless it is needed for
> an unresolved dispute or a legal claim. That a ticket was used stays with
> the order record.
>
> Server request logs: kept for [14] days, without the search terms or other
> parts of the address after the "?".
>
> Your account: when you ask us to close it, we delete your sign-ins and door
> access and remove your name, email and phone from your profile. Orders,
> tickets and invoices that tax law requires us to keep are kept for that
> period, then deleted. Copies in our backups are deleted when the backups
> expire, within [N] days.

Add to the processors list:

> **Expo (650 Industries)** — delivers updates to the Eventsli Check-in app.
> Sees a random app identifier, the app version and the network address of
> each phone that checks for an update. United States. *(Wording depends on
> Expo's answer about its role — F5. If EAS Update is turned off, remove this
> entry and the Expo sentence in the app section.)*
>
> **Sentry (Functional Software)** — receives crash reports from the Eventsli
> Check-in app, with names, email addresses, ticket codes and searches removed
> on the phone first. United States. *(Only once crash reporting is switched
> on.)*

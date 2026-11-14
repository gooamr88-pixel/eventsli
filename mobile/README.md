# Eventsli Check-in

The native iOS and Android app for checking guests in at the door. It is
built with Expo SDK 58, React Native and TypeScript. It is a client of the
existing `/api/v1/scan/*` API; the contract is
[docs/CHECKIN-APP-API.md](../docs/CHECKIN-APP-API.md). The `/gate` web
scanner stays available as the version that needs no install, and both use
the same API.

This folder is a standalone npm package outside the root workspaces, because
Expo pins its own React version. Run every command from `mobile/`.

## Screens

The screens follow the owner's mockup (12 frames: opening screen, sign in, My
Events, event dashboard, camera, the three answers, You're Offline, Syncing
Data, Check-in Logs, Settings). Shared pieces are in `src/ui`: `layout.tsx`
(screen, header, cards, rows, sections, avatars, the status chip, the answer
icon), `TabBar.tsx`, `ScannerMark.tsx` (the mark and the city), `Splash.tsx`.

Every question and message is the app's own pop-up, never the system's alert
box: `src/ui/Dialog.tsx` has `dialog.alert` / `dialog.confirm` (a centred card
with a coloured icon), `dialog.actions` (a bottom sheet of choices) and
`<Sheet>` (a bottom sheet with any content: an event's preview, one log entry).
`<DialogHost/>` in the root layout shows them one at a time. A handler that
opens a dialog starts it and returns (`onPress={() => { void ask(); }}`); it
does not hand the pending answer back to the button.

| Route | Screen |
|---|---|
| (opening) | `src/ui/Splash.tsx` while the app starts |
| `sign-in` | Email and password, Forgot password; Sign in with Eventsli and the shared-device PIN as links |
| `device-pin` | A shared tablet: scan the organizer's pairing QR, then type the PIN |
| `(account)/events` | My Events: Assigned to me / All Events with counts, search, rows with a status chip; tapping one shows its preview sheet with the way in; tab bar |
| `(account)/account/*` | Settings while choosing an event, with My Profile, App Settings and Help & Support |
| `(door)/dashboard` | The event: cover with the live/offline chip, counts and progress, Start Check-in, quick tiles, Recent Check-ins, Event Details, Download Guest List, Offline Mode; the ••• sheet; tab bar |
| `(door)/event` | Event Details: cover, when and where (Open in Maps), progress ring, by ticket type, door settings, this device |
| `(door)/scan` | Check-in: the camera with torch, camera flip, frame and keep-awake |
| `(door)/result` | Check-in Successful / Already Checked In / Invalid Ticket (and every other answer) |
| `(door)/offline` | You're Offline: shown when the signal drops on the dashboard or camera |
| `(door)/sync` | Syncing Data… with progress |
| `(door)/logs` | Check-in Logs: All / Success / Failed, search, this-phone filter; a row opens its detail sheet; tab bar |
| `(door)/settings/*` | Settings (Profile tab): My Profile (with what this phone may do), App Settings (try the sound, About), Data & Sync, Language (sheet), Help & Support (questions and contact), Switch Event, Sign Out |
| `(door)/attendees` | Find a Guest, when the organizer allows it. Screenshots are blocked |
| `(door)/ticket/[ticketId]` | The ticket: guest card, details, door history as a timeline, manual check-in |
| `(door)/analytics` | Arrivals over time, current pace, by tier, by door, refusals |

Each state of the phone is a group guarded in `src/app/_layout.tsx`: signed
out (`sign-in`, `device-pin`), `(account)` and `(door)`. A screen changes the
session and nothing else; the guard and `index` move the phone.
`test/navigation.test.tsx` enforces that rule.

## Develop

```bash
npm ci
npm run typecheck   # app and tests
npx eslint .
npm test            # includes the backend contract test
npx expo-doctor
```

### Test it on a real phone against the local stack

[docs/CHECKIN-DEVICE-TEST.md](../docs/CHECKIN-DEVICE-TEST.md) covers this in
full: an isolated demo event with QR test tickets
(`backend/scripts/demo-checkin.js`), the three local servers on Wi-Fi,
installing the Android development build, and a checklist that ends with an
exactly-once check of the database.

### Run it on your phone

The camera scanner is a native module, so the app needs a **development
build**. The Expo Go app cannot run it.

1. Create a free account at [expo.dev](https://expo.dev). Then run
   `npx eas-cli@latest login` and `npx eas-cli@latest init`. `init` writes
   the project id into `app.json`.
2. Android: run `npx eas-cli@latest build --profile development --platform android`
   and install the APK from the link EAS gives you.
   iPhone: it needs the Apple Developer account first, then
   `npx eas-cli@latest device:create` and
   `npx eas-cli@latest build --profile development --platform ios`.
3. Run `npx expo start --dev-client`. Open the installed app and scan the QR
   code in the terminal, with the phone on the same Wi-Fi.

The app talks to production (`https://eventsli.com/api/v1`) by default. To
point it at a local stack, start Metro with:

```bash
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:5000/api/v1 \
EXPO_PUBLIC_SITE_URL=http://<your-LAN-IP>:3000 \
npx expo start --dev-client
```

### End-to-end flows (Maestro)

`maestro/` holds three flows: admit then duplicate, the refusals, and the
offline admission (airplane mode). They run on the development build over USB
and type codes into the test-builds field on the camera screen, which never
appears in a store build. They need the Maestro CLI and `adb`, with the local
API, Metro and the demo running:

```bash
cd backend && node scripts/demo-checkin.js rearm && cd ../mobile
node scripts/e2e.js                 # all flows
node scripts/e2e.js 03-offline.yaml # one flow
```

### Environment

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SITE_URL` | The API and the website, production unless set |
| `EXPO_PUBLIC_SENTRY_DSN` | Turns crash reports on (`src/lib/monitoring.ts`, scrubbed of guest data). Off when unset |
| `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | `production` unless set |
| `EXPO_PUBLIC_E2E` | `1` adds the test-code field to a non-development build. Never set it for the stores |

## Build and release

The full release order, store copy and privacy answers are in
[RELEASE.md](RELEASE.md) and [store/](store/).

`eas.json` has three profiles:

| Profile | Purpose |
|---|---|
| `development` | The dev client above |
| `preview` | Internal test builds: an APK, and ad-hoc builds for iOS |
| `production` | Store builds. Build numbers increment automatically |

Each profile has its own EAS Update channel, so JavaScript-only fixes can ship
without a store review. A change to native code or `app.json` needs a new
build.

```bash
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --platform ios      # App Store Connect
npx eas-cli@latest submit --platform android  # Google Play
```

App identity:
- Name: "Eventsli Check-in"
- Bundle ID / package: `com.eventsli.checkin`
- URL scheme: `eventsli-checkin`

## How it behaves at the door

- **The server decides.** `/scan/verify` answers within 4 seconds. A refusal
  is still a 200; the screen comes from `result`, and
  `src/gate/outcomes.ts` gives every value a screen.
- **No scan is lost.** Every scan is written to the phone's encrypted
  database before the request goes out. With no signal, the scan shows as
  **Held for upload**, never as an admission. It uploads through
  `/scan/sync` every 20 seconds, when the signal returns, and when the app
  comes back to the foreground.
- **At rest**, the database uses SQLCipher with a 32-byte key in the
  Keychain or Keystore. Tokens live only in SecureStore, are readable only
  while the phone is unlocked, and are never included in backups.
- **Revoked access** (device switched off, person removed from the door
  team): the phone leaves the door and says why. Queued scans are kept until
  someone signs back in.
- **Offline admission:** while it has signal, the phone keeps the event's
  ticket list in its encrypted database. It refreshes every 15 seconds, right
  after uploading, and gets the public keys for QR v2 codes at the same time.
  With no signal, or when the server takes more than 2.5 seconds, the phone
  decides itself (`src/gate/offlineDecision.ts`), in the server's order:
  - An admission is green, "checked on this phone", and uploads with
    `offlineVerdict: 'admitted'`. A clash with another door comes back as a
    conflict.
  - A refusal is final and never uploaded.
  - A ticket the list does not know is held ("Can't confirm offline").
  - Undo before upload cancels on the phone.

  The list is deleted when the door is left, when the organizer switches
  offline check-in off, and 24 hours after the event. The contract is
  [docs/CHECKIN-APP-API.md §7](../docs/CHECKIN-APP-API.md).

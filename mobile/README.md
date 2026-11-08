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

| Route | Screen |
|---|---|
| `sign-in` | Email and password, or **Sign in with Eventsli** (PKCE in the system browser) |
| `device-pin` | A shared tablet: scan the organizer's pairing QR, then type the PIN |
| `events` | Select event: Upcoming, Ongoing and Past, with covers and counts |
| `(door)/dashboard` | Live check-in: ring chart, quick actions, recent check-ins |
| `(door)/scan` | The camera, with frame, scan line, torch and keep-awake |
| `(door)/result` | The answer, shown full screen with the outcome's colour. An admission returns to the camera after 2 s |
| `(door)/attendees` | Guest search, available when the organizer allows it. Screenshots are blocked |
| `(door)/ticket/[ticketId]` | Ticket details, door history and manual check-in |
| `(door)/analytics` | Arrivals over time, current pace, by tier, by door, refusals |
| `(door)/recent` | All recent check-ins or all activity |
| `settings` | Sound, vibration, auto-continue, switch event, sign out |

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

## Build and release

`eas.json` has three profiles:

| Profile | Purpose |
|---|---|
| `development` | The dev client above |
| `preview` | Internal test builds: an APK, and ad-hoc builds for iOS |
| `production` | Store builds. Build numbers increment automatically |

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
- **Phase 3 (offline admission):** the device decides offline from an
  encrypted ticket list and signed QR v2.

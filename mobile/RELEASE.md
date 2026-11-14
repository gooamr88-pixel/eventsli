# Releasing Eventsli Check-in

The order matters: the API and database go first, because store builds talk
to `https://eventsli.com`. Steps marked **(owner)** need accounts or access only
the owner has. Steps marked **(approval)** change production.

## 0. Accounts and secrets (owner, once)

| What | Why | Status |
|---|---|---|
| Expo account `yousef424`, EAS project `582d60ea-…` | Builds, submissions, updates | Done (`eas init`) |
| Apple Developer Program, **individual** (owner's choice, 2026-11-14) | iOS builds, TestFlight, App Store. The store shows the owner's **legal name** as seller, not "Eventsli". | Owner has it |
| Google Play Console, **personal** account (owner's choice) | Android. A personal account made after Nov 2023 must run a **closed test: ≥ 12 testers opted in for 14 days in a row** before it can apply for production. Run the door-team pilot as that test (step 2). | Owner has it |
| Data processing agreements with Expo and Sentry | Lets the store forms say "not shared with third parties" (store/PRIVACY.md) | To confirm |
| Sentry organization and project (React Native) | Crash reports; gives the DSN and an auth token | To do |
| GitHub secret `EXPO_TOKEN` | Only if CI should start EAS builds | Optional |

Sentry, once it exists, on EAS (`eas env:create`, or expo.dev → Environment variables):
- `EXPO_PUBLIC_SENTRY_DSN` (production and preview). Without it, crash
  reporting stays off.
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (secret), for source
  maps.
- Then remove `SENTRY_DISABLE_AUTO_UPLOAD` from the profiles in `eas.json`.

## 1. Production backend (approval)

1. Apply EVERY migration production does not have yet, one at a time, in file
   name order, with `backend/scripts/apply-migration.js`
   (docs/PRODUCTION-ROLLOUT.md). First see what it has:
   `SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 15;`
   As of 2026-11-14 the files after the 11-06 release are `20261108090000`
   through `20261118090000` (twelve). `20261118090000` (scan attribution and
   retention) changes no data when applied; the retention job stays off until
   `SCAN_RETENTION_MODE` is set (store/PRIVACY-AUDIT-FINAL.md, F1). If the API
   is deployed before it, uploads still work and only the attribution step
   logs a warning. The app needs at least the four check-in
   ones (`20261108090000`, `20261108100000`, `20261109090000`,
   `20261110090000`); `20261114090000` and `20261115090000` add the reason a
   gate is closed, which the app shows. `20261112090000` refuses to run, changing nothing, if
   an earlier one is missing.
2. On the server, run `node scripts/qr-signing-key.js` and add the two lines to
   `.env` (docs/DEPLOY.md).
3. Optionally set `CHECKIN_APP_MIN_VERSION_IOS` / `_ANDROID` and the store URLs
   once the listings exist.
4. Deploy the API and the website.
5. Check:
   - `GET /api/v1/app/config` answers.
   - A new ticket's QR is ES256: its header is `{"alg":"ES256","kid":…}`.
   - The website's door list shows the **Let in twice** filter.

## 2. Test builds

```bash
cd mobile
npx eas-cli@latest build --profile preview --platform android   # an APK to share
npx eas-cli@latest build --profile production --platform ios    # then:
npx eas-cli@latest submit --platform ios                        # TestFlight
npx eas-cli@latest build --profile production --platform android
npx eas-cli@latest submit --platform android                    # Play internal testing
```
Run docs/CHECKIN-DEVICE-TEST.md on the TestFlight and internal-testing builds,
against production, using the review account (store/REVIEW.md).

## 3. Store pages (owner)

Use `store/LISTING.md` for the copy and screenshots, `store/PRIVACY.md` for the
privacy questionnaires (publish the website's privacy section first), and
`store/REVIEW.md` for the review account and reviewer notes.

## 4. Release

- **Apple:** submit for review, then a phased release over 7 days.
- **Google:** production track with a staged rollout: 10 %, then 50 %, then 100 %.
- Watch Sentry and the first real event (docs/CHECKIN-PILOT.md) before going
  to 100 %.

## 5. After release

**JavaScript-only fixes** go out with EAS Update, with no store review. Always
through the script, never a bare `eas update`:
```bash
node scripts/eas-update.js production "Fix: …"
```
- A bare `eas update` bundles on this computer and reads `mobile/.env.local`
  (the laptop address a development build uses); `eas.json`'s `env` applies to
  cloud builds only. The script uses the profile's own values, turns `.env`
  loading off and refuses anything but HTTPS. As a second guard, a store build
  ignores a non-HTTPS API address (`src/api/client.ts`).
- Updates download when the app starts and apply on the next cold start, never
  in the middle of scanning (`updates.checkAutomatically: ON_LOAD` in
  `app.json`).
- `runtimeVersion` is the native fingerprint, so an update is only offered to
  builds it can run on. Any change to native code or `app.json` needs a new
  store build.
- To roll back, republish the previous update from expo.dev, or run
  `eas update:rollback`.

**When an old build must stop scanning** (a breaking API change): raise
`CHECKIN_APP_MIN_VERSION_*` on the server. Those builds show "Update required"
and do not scan.

**Version numbers:** `version` in `app.json` is the public version. Build
numbers come from EAS (`appVersionSource: remote`, `autoIncrement` on
production).

## iOS settings decided in the 2026-11-14 audit (app.json)

| Setting | Value | Why |
|---|---|---|
| `ios.supportsTablet` | `false` | The iPad and landscape layouts were never designed or tested. iPads still run the app, in iPhone mode. Turning it on later needs iPad screenshots and landscape testing. |
| `ios.config.usesNonExemptEncryption` | `false` | The app's encryption is HTTPS and SQLCipher built with Apple's CommonCrypto (`SQLCIPHER_CRYPTO_CC` in expo-sqlite's podspec): encryption within the operating system, which Apple lists as exempt. **Owner to confirm**; if counsel disagrees, set `true` and answer the export questions in App Store Connect. |
| `NSAppTransportSecurity` | arbitrary loads off, local networking on | Store builds talk HTTPS only; local networking keeps a development build able to reach a laptop. |
| `ios.privacyManifests` | data types + required-reason APIs | Matches store/PRIVACY.md. The API reasons repeat those in the bundled SDKs' own manifests, because Apple does not always read manifests inside static pods. |
| Dev-client local-network keys | stripped in release | expo-dev-launcher removes `NSLocalNetworkUsageDescription` and `_expo._tcp` from Release builds itself (`withStripLocalNetworkKeysForRelease`). Check it in the first TestFlight build's Info.plist. |

## Not done yet

- **Universal links** ("Open in the app" from the door-team email). This needs
  the Apple Team ID and the Android signing certificate's SHA-256, which exist
  once the store accounts and EAS credentials do. The custom scheme
  `eventsli-checkin://` already works for pairing and sign-in.

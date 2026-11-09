# Releasing Eventsli Check-in

The order matters: the API and database go first, because store builds talk
to `https://eventsli.com`. Steps marked **(owner)** need accounts or access only
the owner has. Steps marked **(approval)** change production.

## 0. Accounts and secrets (owner, once)

| What | Why | Status |
|---|---|---|
| Expo account `yousef424`, EAS project `582d60ea-…` | Builds, submissions, updates | Done (`eas init`) |
| Apple Developer Program, **organization** (needs a D-U-N-S number; 1–3 weeks) | iOS builds, TestFlight, App Store | To do |
| Google Play Console, **organization** account | Avoids the 12-tester / 14-day closed-test rule for personal accounts | To do |
| Sentry organization and project (React Native) | Crash reports; gives the DSN and an auth token | To do |
| GitHub secret `EXPO_TOKEN` | Only if CI should start EAS builds | Optional |

Sentry, once it exists, on EAS (`eas env:create`, or expo.dev → Environment variables):
- `EXPO_PUBLIC_SENTRY_DSN` (production and preview). Without it, crash
  reporting stays off.
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (secret), for source
  maps.
- Then remove `SENTRY_DISABLE_AUTO_UPLOAD` from the profiles in `eas.json`.

## 1. Production backend (approval)

1. Apply the migrations with `backend/scripts/apply-migration.js`
   (docs/PRODUCTION-ROLLOUT.md), in order:
   `20261108090000_checkin_v2`, `20261108100000_checkin_app_api`,
   `20261109090000_door_list_search`, `20261110090000_offline_manifest`.
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

**JavaScript-only fixes** go out with EAS Update, with no store review:
```bash
npx eas-cli@latest update --channel production --message "Fix: …"
```
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

## Not done yet

- **Universal links** ("Open in the app" from the door-team email). This needs
  the Apple Team ID and the Android signing certificate's SHA-256, which exist
  once the store accounts and EAS credentials do. The custom scheme
  `eventsli-checkin://` already works for pairing and sign-in.

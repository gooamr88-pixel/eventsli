# iOS release log — Eventsli Check-in

What was done to put Eventsli Check-in on Apple's App Store, step by step,
in the order it happened, with every command, every question the tools asked
and the answer given — and how updates work from now on.

- Started: 2026-11-14. First build uploaded to App Store Connect: 2026-11-15.
- Scope: **iOS only.** Google Play is postponed (see the end).
- Companion documents: `RELEASE.md` (general release rules),
  `store/LISTING.md` (store text), `store/PRIVACY.md` (privacy answers),
  `store/REVIEW.md` (App Review account and notes),
  `docs/CHECKIN-DEVICE-TEST.md` (device test checklist).

---

## 1. Who is who

| Role | Who | What they can do |
|---|---|---|
| **Account Holder** | The owner of the **individual** Apple Developer account (Apple team ID `RS8ZS37M47`, type *Individual*). Works on a **Mac** and has an iPhone (receives the 2-factor codes). | Everything, including **Certificates, Identifiers & Profiles** on developer.apple.com, accepting Apple's agreements, the EU trader declaration, and turning on API access. |
| **Admin** | The Eventsli developer (Windows PC, no iPhone). Has the **Admin** role in App Store Connect of that account. | App Store Connect: apps, TestFlight, store page, App Privacy, submitting for review, API keys (once API access is on). **Cannot** open Certificates, Identifiers & Profiles — on an individual account only the Account Holder can. |
| **Expo account** | `yousef424` (owned by the Eventsli developer) | Builds (EAS Build), uploads (EAS Submit), over-the-air updates (EAS Update). |

**Consequence:** the App Store shows the **Account Holder's legal name** as the
seller, not "Eventsli". The privacy policy must name the same person as the
party responsible for the data.

## 2. Identifiers and where things live

| Thing | Value | Where |
|---|---|---|
| App name | Eventsli Check-in | `app.json` → `expo.name` |
| Bundle ID | `com.eventsli.checkin` | `app.json` → `ios.bundleIdentifier`; registered in the Apple team on 2026-11-15 |
| App version | `1.0.0` | `app.json` → `version` |
| Build number | managed by EAS (`appVersionSource: remote`, `autoIncrement`); first uploaded build = **2** | `eas.json` |
| EAS project | `@yousef424/eventsli-checkin`, id `582d60ea-1870-440e-b640-75241507628c` | `app.json` → `extra.eas.projectId` |
| App Store Connect app id | `6835016139` | https://appstoreconnect.apple.com/apps/6835016139 |
| Distribution certificate | serial `6AE719707CE1C149F5D24F7BBD0EDCCC`, **expires 2027-11-15** | stored by Expo (EAS credentials) |
| Provisioning profile | Developer Portal id `8PP3MJFW9C`, **expires 2027-11-15** | stored by Expo |
| Sentry | organization `via-aq`, project `eventsli-checkin`, data region **US** | sentry.io |
| Sentry DSN (public by design) | in `eas.json`, `preview` and `production` → `env.EXPO_PUBLIC_SENTRY_DSN` | `eas.json` |
| Sentry auth token (**secret**) | EAS environment variable `SENTRY_AUTH_TOKEN`, visibility *Secret*, environment *production* | expo.dev → project → Environment variables |
| Code built | commit `324abbe` on `main` | git |
| First build | EAS build `b7d6c855-ea39-4d46-9164-75cb66aa1c83` | expo.dev → Builds |
| First upload | EAS submission `cfd2e030-94f2-4779-8c9a-d801ab7ea94d` | expo.dev → Submissions |

**Secrets — never in git, never in chat:** the Account Holder's Apple ID
password, the Sentry auth token, the App Store Connect API key file (`.p8`).

---

## 3. Before the build (done 2026-11-14)

### 3.1 The code
- The app's redesign, the App Store hardening and the privacy work were
  committed and pushed (`04d8c67`, then `324abbe`). See `RELEASE.md` and
  `store/PRIVACY-AUDIT*.md` for what they contain.
- iOS settings that matter for the store, all in `app.json`:
  - `ios.supportsTablet: false` — iPhone only; iPads run it in iPhone mode,
    and no iPad screenshots are needed.
  - `ios.config.usesNonExemptEncryption: false` — App Store Connect does not
    ask the export-compliance question for each build.
  - `ios.privacyManifests` — the privacy manifest (matches `store/PRIVACY.md`).
  - HTTPS only (`NSAllowsArbitraryLoads: false`).

### 3.2 The new app icon
- The owner chose the **scanner mark** (white rounded frame on teal), the
  same drawing as the splash and sign-in screens.
- `node scripts/app-icons.js` (in `mobile/`) regenerates all icons from that
  drawing: `icon.png` (iOS, 1024², **no transparency**), the Android adaptive
  foreground and monochrome layers, and `favicon.png`.

### 3.3 Sentry (crash reports)
Done by the Eventsli developer in the browser:
1. Created an account at sentry.io, organization **via-aq**, data storage
   location **United States** (cannot be changed later).
2. Accepted the **Data Processing Addendum** (Settings → Legal & Compliance;
   only an organization Owner can).
3. Settings → Security & Privacy: **Prevent Storing of IP Addresses** on;
   **Data Scrubber** and **Use Default Scrubbers** on.
4. Created the project **eventsli-checkin**, platform **React Native**, and
   copied its **DSN**.
   - Sentry's setup page offers `npx @sentry/wizard …`. **It was NOT run, and
     must never be run:** it rewrites project files and would undo the
     privacy protections in `src/lib/monitoring.ts` (JavaScript-only,
     scrubbed, no IP, no device id).
5. Created an **Organization Token** (Settings → Developer Settings →
   Organization Tokens). It is shown once.
6. Stored the token in Expo: expo.dev → project **eventsli-checkin** →
   **Environment variables** → Add: name `SENTRY_AUTH_TOKEN`, visibility
   **Secret**, environment **production**.

Then in the code (commit `324abbe`):
- `eas.json`: the DSN and `EXPO_PUBLIC_SENTRY_ENVIRONMENT` in `preview` and
  `production`; each profile names its EAS `environment` explicitly, so the
  production build receives the secret token; `SENTRY_DISABLE_AUTO_UPLOAD`
  removed from `production` (kept in `preview`, which has no token).
- `app.json`: the `@sentry/react-native` plugin with `organization: via-aq`,
  `project: eventsli-checkin`, `url: https://sentry.io/`.

### 3.4 Preparing the Windows PC
In **cmd**:
```
cd D:\Projects\eventsli\mobile
git pull
npx eas-cli@latest login          (username yousef424, then the Expo password)
npx eas-cli@latest whoami         (must print yousef424)
```
Chrome Remote Desktop host installed from
https://remotedesktop.google.com/support (section **Get Support** → download →
install), so the Account Holder could type on this PC from his Mac.

---

## 4. The session with the Account Holder (2026-11-15)

Google Meet, the Account Holder on his Mac with his iPhone at hand.

### 4.1 In App Store Connect, on the Mac (he shared his screen)
1. **appstoreconnect.apple.com** → signed in with his Apple ID and the
   2-factor code from his iPhone.
2. **Business** (Agreements): any agreement marked *New / Pending / Action
   needed* → **View and Agree to Terms** → **Agree**. The *Apple Developer
   Program License Agreement* must be **Active**. (No paid-apps agreement,
   tax or banking is needed: the app is free.)
3. **Digital Services Act**: the trader-status declaration for the EU. His
   decision: *trader* publishes his address, phone and email on EU
   storefronts; without a declaration the app may not be offered in the EU.
4. **Users and Access → Integrations → App Store Connect API**: if a
   **Request Access** button is shown, the Account Holder clicks it once.
   After that the Admin can create API keys (section 8).

### 4.2 Remote control of the Windows PC
- Windows: https://remotedesktop.google.com/support → **Get Support** →
  **Generate Code** (12 digits, valid 5 minutes) → sent in the Meet chat.
- Mac: same address in Chrome → **Give Support** → code → **Connect**.
- Windows: **Share** in the dialog "allow … to see and control your
  computer". (Every ~30 minutes a dialog asks to continue → **Continue**.)

### 4.3 First attempt — wrong folder (failed, harmless)
The command was run from the **repository root** instead of the app folder:
```
D:\Projects\eventsli>npx eas-cli@latest build --profile production --platform ios
```
What happened: EAS found no app there, so it **generated a new `eas.json`**,
**created a new, empty EAS project `@yousef424/eventsli`** (id `01590b0d-…`),
asked for a bundle identifier (`com.yousef424.eventsli` was accepted) and
then failed with:
```
Failed to resolve iOS entitlements from Expo config using the bundled config fallback:
Cannot find 'expo-modules-autolinking' package in your project …
Error: build command failed.
```
Signs it was the wrong folder: the prompt `D:\Projects\eventsli>`, the
message *"Using the version specified in .nvmrc"* and the warning
*"Detected that your app uses Expo Go"*.

Clean-up: the stray `app.json` and `eas.json` at the repository root were
deleted (nothing reached Apple; the failure came before any Apple login).
The empty EAS project **eventsli** may still exist on expo.dev — it can be
deleted there (Projects → **eventsli** → Settings → Delete project). Do **not**
delete **eventsli-checkin**.

**Rule: every `eas` command runs from `D:\Projects\eventsli\mobile`.** Check
that the prompt ends in `\mobile>` before pressing Enter.

### 4.4 The build that worked
```
D:\Projects\eventsli\mobile>npx eas-cli@latest build --profile production --platform ios
```
Every question, and the answer given:

| Shown | Answer |
|---|---|
| `No environment variables with visibility "Plain text" and "Sensitive" found for the "production" environment on EAS.` | Nothing to do. Normal: the Sentry token is *Secret*, which is never shown locally. |
| `Environment variables loaded from the "production" build profile "env" configuration: EXPO_PUBLIC_API_URL, EXPO_PUBLIC_SENTRY_DSN, EXPO_PUBLIC_SENTRY_ENVIRONMENT.` | Nothing to do. Confirms the profile. |
| `Incremented buildNumber from 1 to 2.` | Nothing to do. |
| `Using remote iOS credentials (Expo server)` | Nothing to do. |
| `Do you want to log in to your Apple account?` | **yes** |
| `Apple ID:` | The Account Holder typed his Apple ID. (First try had a typo in the email domain → *"Invalid username and password combination"* → `Would you like to try again?` **yes** → typed correctly.) |
| `Password (for …):` | The Account Holder typed it (hidden). |
| `Saving Apple ID password to the local Keychain` | Nothing to do. |
| `How do you want to validate your account?` | **device** |
| `Please enter the 6 digit code` | The code shown on the Account Holder's Apple device. |
| `Team … (RS8ZS37M47)` / `Provider …` | Selected automatically (one team). |
| `Bundle identifier registered com.eventsli.checkin` | ✅ |
| `Generate a new Apple Distribution Certificate?` | **yes** → `Created distribution certificate` |
| `Generate a new Apple Provisioning Profile?` | **yes** → `Created provisioning profile` |

EAS then printed the credentials summary (certificate and profile valid until
2027-11-15, team *Individual*), compressed the project (49.6 MB), uploaded it
and built it in the cloud:
```
Build finished
iOS app: https://expo.dev/artifacts/eas/…ipa
```
Build `b7d6c855…`, version 1.0.0, build number 2, from commit `324abbe`.

After this, the Account Holder's part was over (remote control stopped with
**Stop Sharing**).

### 4.5 Sentry upload, checked in the build log
- The build environment contained `SENTRY_AUTH_TOKEN=********` (the secret
  reached the build).
- The Xcode phases **"Bundle React Native code and images"** (uploads the
  JavaScript source maps) and **"Upload Debug Symbols to Sentry"** ran
  without errors.
- Final confirmation on sentry.io: Settings → Projects → eventsli-checkin →
  **Source Maps** and **Debug Files** list uploads from 2026-11-15.
  **Confirmed by the Eventsli developer, 2026-11-15.**

---

## 5. Upload to App Store Connect (2026-11-15)

```
D:\Projects\eventsli\mobile>npx eas-cli@latest submit --platform ios --latest
```
- It reused the Apple login session saved during the build (no password
  asked), created the app record in App Store Connect, and **generated an App
  Store Connect API key for future uploads** (`[Expo] EAS Submit -iNYLyp5Qx`,
  section 8).
- Result:
  ```
  Submitted your app to Apple App Store Connect!
  Your binary has been successfully uploaded to App Store Connect!
  ```
- App: https://appstoreconnect.apple.com/apps/6835016139/testflight/ios
- Apple processes a new build in about 5–30 minutes and sends an email.

### 5.1 Remove the Account Holder's session from the PC
EAS saved the Account Holder's Apple login session in
`%USERPROFILE%\.app-store`. While it exists, this PC can act on his Apple
account without a password. After the upload it is no longer needed:
```
rmdir /s /q "%USERPROFILE%\.app-store"
```
**Status 2026-11-15: deleted** (checked: `%USERPROFILE%\.app-store` no longer
exists). This PC can no longer act on the Account Holder's Apple account.
Uploads use the API key EAS generated (section 8).

---

## 6. TestFlight (in progress)

### 6.1 Make the build installable (Admin, in App Store Connect)
1. App → **TestFlight** → wait until build **1.0.0 (2)** is no longer
   *Processing*.
2. If it shows **Missing Compliance**: click it → **None of the algorithms
   mentioned above** → **Save**. (Usually not shown, because
   `usesNonExemptEncryption: false` is in the build.)
3. **Internal Testing** → **+** → name `Team` → **Create**.
4. In the group: **Testers** → **+** → add the people (they must be users of
   this App Store Connect account) → **Add**.
5. In the group: **Builds** → **+** → **1.0.0 (2)** → **Add**.

### 6.2 Who tests — the Eventsli developer has no iPhone
The app has so far been device-tested on **Android only**, so one real
iPhone test is required before submitting for review. Options:

| Option | How |
|---|---|
| **A. The Account Holder** (recommended) | Already a user of the account; added as an internal tester; installs the **TestFlight** app on his iPhone → **Install**. A short Meet: he shows the iPhone screen via **iPhone Mirroring** (macOS 15+) or **QuickTime Player → File → New Movie Recording → choose the iPhone as camera**, then shares that window. |
| B. Someone else with an iPhone | The Admin invites them in **Users and Access** (+, email, a role); after they accept, add them as an internal tester. |
| C. External tester via a public link | Requires Apple's Beta App Review first (about a day) and the test information to be filled in. |

Tickets to scan: create a test event on eventsli.com, send its tickets as a
PDF, open the PDF on the Mac and scan it with the iPhone.

### 6.3 What to test
| # | Test | Expected |
|---|---|---|
| 1 | Home-screen icon | White rounded frame on teal |
| 2 | Sign in, choose an event | Works |
| 3 | Scan a ticket | Green — admitted |
| 4 | Scan the same ticket again | "Already checked in" |
| 5 | Airplane mode, scan another ticket | Accepted by the phone, "waiting to sync" shown |
| 6 | Airplane mode off | Uploads by itself, the counter clears |
| 7 | Find a guest by name | Found |
| 8 | After 10+ scans: sentry.io → Explore → Traces → `door.scan` | Timings appear, with **no** guest name or ticket code |

Full checklist: `docs/CHECKIN-DEVICE-TEST.md` (sections N and O cover the
redesign).

---

## 7. Before "Submit for Review" (open)

| Item | Owner | Notes |
|---|---|---|
| **Privacy policy live** at `https://eventsli.com/privacy` | Eventsli developer, then publication | Draft complete in `store/PRIVACY.md` (90-day check-in retention, 14-day logs, Sentry US 30 days, Expo, backups within 8 days). Needs legal review, the Account Holder named as the responsible party, then publishing. Required **before** submitting. |
| Review account on the live site | Eventsli developer | `store/REVIEW.md`: organizer account, "App Review Demo" event, 5–10 tickets as a PDF, offline check-in on. |
| Screenshots | Whoever has a large iPhone | The **6.9"** slot: 1320×2868 (16/17 Pro Max), 1290×2796 (14–15 Pro Max/Plus) are accepted. A smaller iPhone gives the wrong size → use the iOS Simulator on the Mac (Xcode) instead. Six screens, from the demo event — never real guest data. Order and captions in `store/LISTING.md`. |
| Store page | Admin | Subtitle, promotional text, description, keywords, support URL (`https://eventsli.com/contact`), marketing URL — all in `store/LISTING.md`. Category **Business**, age rating 4+, price free. |
| App Privacy | Admin | The Apple table in `store/PRIVACY.md`, row by row (tracking: No). |
| App Review Information | Admin | Sign-in details of the review account and the notes in `store/REVIEW.md`. |
| Submit | Admin | Version 1.0.0 → choose build 2 → **Submit for Review** → choose **phased release** (7 days). |

---

## 8. App Store Connect API key (one time, so nobody needs the Account Holder again)

Without it, the next `eas submit` asks for an Apple login.

**Status 2026-11-15 — already in place, made by EAS itself.** During the
first `eas submit` (section 5), EAS used the Account Holder's saved session to
**generate its own App Store Connect API key** and store it on Expo's servers:

| | |
|---|---|
| Name | `[Expo] EAS Submit -iNYLyp5Qx` |
| Developer Portal ID | `6SDBJ437CJ` |
| Role | ADMIN |
| Linked to | `eventsli-checkin`, iOS, production (`eas credentials -p ios` shows it) |

Its `.p8` file lives only on Expo's servers. Future `eas submit` runs use it;
no Apple login is needed. **Do not revoke this key** in App Store Connect.

A second key had also been created by hand by the Admin (Key ID starting
with `57`). It was not used, so on 2026-11-15 it was **revoked** (App Store
Connect → Users and Access → Integrations → Team Keys → that key → **Revoke**)
and its `.p8` file deleted. The only live key is EAS's. Steps 1–5 below are
kept for the day a key must be replaced.

1. App Store Connect → **Users and Access** → **Integrations** → **App Store
   Connect API** → **Team Keys**.
   - A **+** button → continue. A **Request Access** button instead → only
     the Account Holder can click it (once).
2. **+** → name `EAS Eventsli`, Access **Admin** → **Generate**.
3. **Download** the `.p8` file — **it can be downloaded only once.** Keep it
   outside the project, e.g. `D:\keys\AuthKey_XXXXXXXXXX.p8`.
4. Note the **Key ID** (next to the key) and the **Issuer ID** (top of the
   page).
5. Link it to Expo:
   ```
   cd D:\Projects\eventsli\mobile
   npx eas-cli@latest credentials -p ios
   ```
   profile **production** → **App Store Connect: Manage your API Key** → set
   up / add a new key → path to the `.p8`, Key ID, Issuer ID. If asked to log
   in to Apple: **no**.

From then on `eas submit` uploads with the key. The key also lets EAS renew
the certificate and profile in November 2027 without the Account Holder.

---

## 9. Updates after release

### 9.1 Type 1 — over-the-air (OTA): JavaScript changes
**When:** the change is only in the app's own code — texts, colours, screens,
logic (scanning, search, sync).

```
cd D:\Projects\eventsli\mobile
git pull
node scripts\eas-update.js production "Fix: what changed"
```
- Published to Expo in a minute or two. Every installed app downloads it
  **when it starts** and uses it **from the next start** — never in the
  middle of a door shift.
- **No Apple review, no Account Holder.**
- **Always use this script, never a plain `eas update`.** A plain
  `eas update` bundles on this PC and reads `mobile/.env.local` (the
  development address), which would point every phone in the field at a
  laptop. The script uses the production profile's values, ignores `.env`
  files, refuses anything that is not HTTPS, and carries the Sentry DSN.
- Bad update: expo.dev → project → **Updates** → republish the previous one
  (or `npx eas-cli@latest update:rollback`).
- An update is only delivered to builds with the same native "fingerprint"
  (`runtimeVersion: fingerprint`). If native code changed, the update simply
  does not reach older builds — it cannot break them.

### 9.2 Type 2 — a new store version: native changes
**When:** anything native — a new library with native code (camera,
notifications, Bluetooth…), the icon, the splash screen, permissions,
anything in `app.json`, an Expo SDK upgrade. *When unsure, ask.*

1. Raise `version` in `app.json` (e.g. `1.0.0` → `1.1.0`; Apple needs a new
   version number for each App Store release). Build numbers are raised by
   EAS automatically.
2. Build and upload (no Account Holder needed: credentials are stored until
   2027-11-15, and the API key handles the upload):
   ```
   cd D:\Projects\eventsli\mobile
   git pull
   npx eas-cli@latest build --profile production --platform ios
   npx eas-cli@latest submit --platform ios --latest
   ```
3. Test it on TestFlight (section 6).
4. App Store Connect → **+ Version** → the new number → **What's New** → choose
   the build → **Submit for Review** (usually 1–2 days) → phased release.

### 9.3 Other changes
| Change | How |
|---|---|
| Website or API (backend) | Deployed on the server as usual. Must stay compatible with app versions already installed. If a breaking change is unavoidable, set `CHECKIN_APP_MIN_VERSION_IOS` on the server: older builds then show "Update required" and stop scanning. |
| Promotional text on the store page | Editable any time in App Store Connect, no review. |
| Description, screenshots, keywords | Change together with a new version (9.2). |
| Apple publishes new agreements (about once or twice a year) | The Account Holder accepts them; uploads are blocked until he does. |
| Certificate / profile expiry (2027-11-15) | EAS renews them at the next build — with the API key, or with an Account Holder login. |

### 9.4 Who is needed for what
| Task | Admin alone | Account Holder |
|---|---|---|
| OTA update | ✅ | — |
| New build and upload | ✅ (after section 8) | — |
| TestFlight, store page, submit for review | ✅ | — |
| New Apple agreements, EU trader status | — | ✅ |
| Certificate renewal in Nov 2027 | ✅ with the API key | ✅ without it |

---

## 10. Troubleshooting seen so far

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find 'expo-modules-autolinking'`, "Expo Go" warning, `.nvmrc` message, EAS offering to create a project | Command run from `D:\Projects\eventsli` | `cd D:\Projects\eventsli\mobile` and run again |
| `Invalid username and password combination` | A typo in the Apple ID (e.g. the email domain) | Answer **yes** to try again, type carefully |
| `No environment variables with visibility "Plain text" and "Sensitive" found` | Normal — the token is *Secret* | Nothing |
| **Missing Compliance** in TestFlight | Export question | **None of the algorithms mentioned above** |
| A build error mentioning Sentry or `401` | Token missing or wrong | Check `SENTRY_AUTH_TOKEN` on expo.dev (Secret, production); send the log lines |
| `eas submit` asks for an Apple login | No API key yet, and the saved session was removed | Section 8 |

---

## 11. Google Play (postponed)

Not started. When it is: a **personal** Play Console account created after
November 2023 must run a **closed test with at least 12 testers opted in for
14 days in a row** before it can apply for production. The build command is
`npx eas-cli@latest build --profile production --platform android`; the first
upload to Play Console is manual (download the `.aab` from expo.dev). The Data
safety answers are in `store/PRIVACY.md` (the Expo update id is declared as
*shared*).

---

## 12. Timeline

| Date | What |
|---|---|
| 2026-11-14 | Redesign restored, App Store and privacy audits, server retention and logging fixes, Sentry set up, new icon; commits `04d8c67`, `324abbe` pushed. |
| 2026-11-15 | Session with the Account Holder: agreements, API access, first build (wrong-folder attempt, then build 2 succeeded); certificates created; uploaded to App Store Connect (app id 6835016139). |
| 2026-11-15 | Sentry source maps and debug files confirmed. Found that EAS had already generated and linked its own admin API key during the first upload; the hand-made key (`57…`) is unused. |
| 2026-11-15 | Unused `57…` key revoked and its `.p8` deleted; the Account Holder's saved Apple session removed from the Windows PC. |
| Next | TestFlight on a real iPhone (the Account Holder's); privacy policy published; review account; screenshots; store page; submit for review. |

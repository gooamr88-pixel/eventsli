# Eventsli Check-in — Android device test (local, isolated)

This tests the Phase 2 app on a real Android phone against **this computer's
local stack**: a local Supabase database in Docker, the local API and the
local website. Production is not involved. The demo data is created by
`backend/scripts/demo-checkin.js`, which refuses to run against anything that
is not a local database.

Commands are for **PowerShell**, run from the repo root (`D:\Projects\eventsli`).
This computer's Wi-Fi address is `192.168.1.6`. If it changes, replace it
everywhere below and in `mobile\.env.local`.

---

## 1. Start the local stack

1. **Docker Desktop must be running.** It stops when the computer sleeps.
   Start Docker Desktop, then check that the database is up:
   ```powershell
   docker ps --format "{{.Names}}: {{.Status}}"   # supabase_db_eventsli ... (healthy)
   ```
   If the `supabase_*` containers are missing, run `npx supabase@2 start`.

2. **The demo data.** It is already seeded; run this again for a clean slate:
   ```powershell
   cd backend; node scripts/demo-checkin.js seed --site http://192.168.1.6:3000; cd ..
   ```
   This writes **`.demo\checkin-demo.html`**. Open it in a browser on this
   computer. It holds every test ticket as a QR code with the answer the phone
   should give, the three demo accounts, and the pairing code for the shared
   door device.

3. **Three terminals.** Keep all three open while testing.

   **Terminal A, the API** (port 5000):
   ```powershell
   cd backend
   $env:FRONTEND_URL="http://localhost:3000,http://127.0.0.1:3000,http://192.168.1.6:3000"
   node server.js
   ```
   **Terminal B, the website** (port 3000). It is needed for *Sign in with
   Eventsli* and the organizer's door settings:
   ```powershell
   cd frontend
   $env:NEXT_PUBLIC_API_URL="http://192.168.1.6:5000/api/v1"
   $env:INTERNAL_API_URL="http://127.0.0.1:5000/api/v1"
   $env:NEXT_PUBLIC_SITE_URL="http://192.168.1.6:3000"
   $env:NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
   npx next dev -H 0.0.0.0 -p 3000
   ```
   It has to be `next dev`: a production build adds `upgrade-insecure-requests`
   and breaks plain HTTP over Wi-Fi. Next rewrites one heading in
   `frontend\AGENTS.md` each time it starts. That is harmless; undo it with
   `git checkout -- frontend/AGENTS.md`.

   **Terminal C, the app's JavaScript (Metro, port 8081).** It reads
   `mobile\.env.local`, which points the app at `192.168.1.6`:
   ```powershell
   cd mobile
   npx expo start --dev-client
   ```

4. **Check from the phone.** Join the **same Wi-Fi**, then open these in the
   phone's browser:
   - `http://192.168.1.6:5000/api/v1/health` shows `{"success":true,...}`
   - `http://192.168.1.6:3000/login` shows the Eventsli sign-in page

   If either does not load, the Windows firewall is blocking the phone. Run
   this once in an **administrator** PowerShell. It allows only the three dev
   ports, and only from your local network:
   ```powershell
   New-NetFirewallRule -DisplayName "Eventsli dev (LAN)" -Direction Inbound -Protocol TCP -LocalPort 3000,5000,8081 -RemoteAddress LocalSubnet -Action Allow
   ```
   Remove it after testing with `Remove-NetFirewallRule -DisplayName "Eventsli dev (LAN)"`.

## 2. Install the development build (once)

The camera scanner is native code, so the app runs as a **development build**,
not in Expo Go. EAS is already linked to this project: `owner` and
`extra.eas.projectId` are in `mobile\app.json`.

1. Build in the cloud. It takes about 10–20 minutes the first time:
   ```powershell
   cd mobile
   npx eas-cli@latest build --profile development --platform android
   ```
2. When it finishes, EAS prints a link and a QR code. Open it **on the
   phone**, download the `.apk`, and install it. Android asks you to allow
   *Install unknown apps* for your browser; allow it for this install.
3. Open **Eventsli Check-in**. The development launcher appears. Choose the
   server it finds on `192.168.1.6:8081`, or tap *Enter URL manually* and type
   `http://192.168.1.6:8081`. The app loads from Terminal C.

You only rebuild after changing `app.json`, plugins or native packages. Code
changes reload through Metro. Press `r` in Terminal C to reload.

## 3. The checklist

Tick each row. "Sheet" means the ticket on `.demo\checkin-demo.html`, shown on
this computer's screen with the brightness up and scanned from 20–40 cm.
Reset between runs with `cd backend; node scripts/demo-checkin.js rearm`.

| Account | Email | Password |
|---|---|---|
| Organizer (sees everything) | `organizer@demo.eventsli.test` | `Demo-Checkin-2026` |
| Door-team member | `door@demo.eventsli.test` | `Demo-Checkin-2026` |
| Account with no events | `outsider@demo.eventsli.test` | `Demo-Checkin-2026` |
| Shared device **North Door (demo)** | pairing QR on the sheet | PIN `482193` |

### A. Launch
| # | Do | Expect |
|---|---|---|
| A1 | Open the app | Teal splash with the white star, then the **Event Check-in** screen with the logo, tagline and skyline |
| A2 | Look for "Update required" | Not shown |

### B. Sign in
| # | Do | Expect |
|---|---|---|
| B1 | Organizer, wrong password | "That email or password is not right." Still on sign-in |
| B2 | Organizer, right password | **Select Event**, **Ongoing** tab open, *Annual Gala 2026 (Demo)* with the cover, date and Toronto |
| B3 | Settings → Sign out → sign in as the door-team member | Only the gala is listed |
| B4 | Sign out → sign in as the account with no events | "No ongoing events", with an explanation. No crash |
| B5 | Sign out → **Sign in with Eventsli** | The browser opens the website's sign-in page at 192.168.1.6:3000 |
| B6 | Sign in there as the organizer → **Allow and return to the app** | Back in the app and signed in, on Select Event |
| B7 | Repeat B5, press **Cancel** on the website | Back on the app's sign-in screen, with no error shown |
| B8 | On this computer, open `http://192.168.1.6:3000/account/security` signed in as the organizer | A session row "Eventsli Check-in · *your phone*". Press **End** on it. The app returns to sign-in on its next request (B10) |
| B9 | Sign-in screen → *Using a shared door device?* → **Scan pairing code**, then scan the sheet's pairing code, then enter PIN `482193` | The device ID fills in by itself; then the gala dashboard opens, labelled North Door |
| B10 | Wrong PIN on B9 | "That device ID or PIN is not right…" |

### C. Select event
| # | Do | Expect |
|---|---|---|
| C1 | Upcoming tab, choose *Tech Meetup* → Continue | "Doors are not open yet" with Cancel and Open anyway |
| C2 | Past tab, choose *Product Launch* | "3 of 4 checked in". The button reads *Finished — view only* and is disabled |
| C3 | Search (magnifier) "gala" | Only the gala |
| C4 | Ongoing → gala → Continue | The dashboard |

### D. Dashboard
| # | Do | Expect |
|---|---|---|
| D1 | Look at it (just after `rearm`) | A green **Live Check-in** pill and the ring at **1** (Lucas, scanned earlier at the North Door). Checked In 1 · Remaining 16 · Total 17. Then Scan / Attendees / Analytics, and Lucas Tremblay under Recent Check-ins. The refunded ticket and the cancelled order are not counted |
| D2 | On this computer: `cd backend; node scripts/demo-checkin.js door-scan "Emily"` | Within about 10 s the ring shows **2** and Emily Chen appears first under Recent Check-ins (or pull down to refresh) |
| D3 | As the door-team member, tap Attendees | "Guest list not shared" |

### E. Scanning and answers
Each answer must show the right colour, title and sound. After an admission
the screen returns to the camera by itself after 2 seconds.

| # | Scan (sheet) | Expect |
|---|---|---|
| E1 | John Smith · ticket 1 | **Green**, "Check-in Successful", John Smith, General Admission, the gala, date and time, "Admitted — Checked in at *time*", rising tone |
| E2 | John Smith · ticket 1 again | **Amber**, "Already checked in", "at *time*" on the phone's clock, "First scanned by …", two beeps |
| E3 | Sara Ahmed · VIP | Green, tier **VIP** |
| E4 | Mia's friend · NEW code | Green, **no name** (a transferred ticket shows no buyer name) |
| E5 | Mia Johnson · OLD code | **Red**, "Ticket was given away" |
| E6 | Noah Wilson · refunded | Red, "Cancelled ticket" |
| E7 | Ava Thompson · order cancelled | Red, "Cancelled ticket" (order cancelled or refunded) |
| E8 | Grace Lee · Tech Meetup | Red, "Wrong event" |
| E9 | Forged code | Red, "Not an Eventsli ticket" |
| E10 | Lucas Tremblay · already scanned | Amber, "Already checked in", first scanned at **North Door (demo)** |
| E11 | Hold one code steady in front of the camera for 10 s | One result only, not a stream |
| E12 | The torch button | The light turns on and off |
| E13 | Dim the room and scan at different distances and angles | Reads within about a second at 20–40 cm |

### F. After the answer
| # | Do | Expect |
|---|---|---|
| F1 | After E3, tap **View Details** (before 2 s pass) | Ticket screen, "Checked in · *time*", with the door history |
| F2 | Scan a fresh ticket (Ahmed Ali 1), then within 60 s tap *Scanned by mistake? Undo* | "Check-in reversed". Scanning again admits |
| F3 | Settings → turn off *Back to the camera after a check-in* | The result stays until you tap Scan Next |

### G. Sounds and vibration
| # | Do | Expect |
|---|---|---|
| G1 | Admit, refuse, duplicate | Three different tones. Media volume must be up |
| G2 | Turn the ringer to silent and scan | The tones still play (Android uses media volume) |
| G3 | Settings → Sound off | Silent. Vibration still works if it is on |

### H. Guest list and manual check-in
| # | Do | Expect |
|---|---|---|
| H1 | Organizer: Attendees → search "priya" | Priya Patel, VIP, "Not yet" |
| H2 | Tap her → **Check in by hand** → confirm | Green success; history says *Checked in by hand* |
| H3 | On the website (`http://192.168.1.6:3000/organizer` → the gala → Scanning devices), tick **Door team can search the guest list**; then as the door-team member, pull to refresh and open Attendees | The list opens with full names |
| H4 | Try a screenshot on Attendees | Blocked or black |

### I. Offline, persistence and exactly-once
| # | Do | Expect |
|---|---|---|
| I1 | **Airplane mode on.** Scan Michael Brown 1, 2, 3 | **Grey** "Held for upload" each time. The camera shows "No signal — scans are held" and "3 waiting to upload". **Never green** |
| I2 | Swipe the app away to close it, then reopen it (still airplane mode) | The dashboard shows "3 scans waiting to upload". The scans survived on the phone's encrypted database |
| I3 | Airplane mode **off** | Within about 20 s the banner goes; the ring rises by 3 |
| I4 | On this computer: `cd backend; node scripts/demo-checkin.js status` | Michael Brown 1–3 show **IN**, and **EXACTLY-ONCE: OK** |
| I5 | Close and reopen the app; tap *Upload now* if shown | Nothing uploads twice. Run `status` again: same counts, still OK |
| I6 | **Wi-Fi off mid-queue:** airplane on → scan Daniel Garcia 2 → airplane off and immediately on again → off | It ends uploaded once. `status` is OK |
| I7 | **API down:** Ctrl+C in Terminal A, scan Chloé Roy | Grey "Held for upload", **not** an error |
| I8 | Restart Terminal A | Uploads within about 20 s. Chloé Roy is IN. `status` is OK |
| I9 | **Another door got there first:** airplane on → scan Lucas Tremblay 2 (held) → on this computer `node scripts/demo-checkin.js door-scan "Lucas Tremblay · ticket 2"` → airplane off | The held scan settles as **Already checked in**, never as a second admission: Recent Check-ins → *All activity* shows it, and the ring rose by 1, not 2. `status` is OK |

### J. Losing the door
| # | Do | Expect |
|---|---|---|
| J1 | Signed in as the **North Door** device: airplane on, scan Olivia Martin (held), airplane off. Immediately on the website (Scanning devices) press **Revoke** on North Door (demo) | On its next request the phone shows "Signed out of this door … scans not yet uploaded are kept" and goes to sign-in |
| J2 | Press *Switch back on* on the website, then pair and sign in again with the PIN | The held scan uploads. `status` is OK |

### K. Optional: forced update
| # | Do | Expect |
|---|---|---|
| K1 | Stop Terminal A, run `$env:CHECKIN_APP_MIN_VERSION_ANDROID="9.0.0"`, start `node server.js` again, then force-close and reopen the app | "Update required". Clear the variable afterwards |

## 4. Checking from this computer

```powershell
cd backend
node scripts/demo-checkin.js status        # every ticket's state + EXACTLY-ONCE: OK / VIOLATION
node scripts/demo-checkin.js rearm         # reset the tickets to test again
node scripts/demo-checkin.js smoke --api http://192.168.1.6:5000/api/v1   # 31 API checks over Wi-Fi, then re-arms
node scripts/demo-checkin.js door-scan "Emily"   # a second door scans a ticket
node scripts/demo-checkin.js reset         # remove all demo data
```

## 5. If something fails

Note the row number, and capture:
1. a screenshot of the phone;
2. the output in **Terminal C** (Metro), which shows app errors and red screens;
3. the lines in **Terminal A** (API) around the same time;
4. the output of `node scripts/demo-checkin.js status`.

Common causes:
- **Network error on every call, but the phone's browser loads `/health`.**
  The build is not a development build. Rebuild with `--profile development`.
- **Nothing loads.** Docker stopped (the computer slept), or the phone is on a
  different Wi-Fi.
- **"Sign in with Eventsli" opens a page that cannot load.** Terminal B is not
  running, or it was started without the `192.168.1.6` variables.

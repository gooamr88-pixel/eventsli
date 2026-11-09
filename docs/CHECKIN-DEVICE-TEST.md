# Eventsli Check-in — Android device test (local, isolated)

This tests the app on a real Android phone (Phase 2, and Phase 3's offline
admission in section M) against **this computer's
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

**Phase 4 needs a new build.** It added two native packages (crash reports
and over-the-air updates) and changed `app.json`. Android now asks for the
camera only: the microphone, storage and media-service permissions the
libraries had added are gone, and backups are off. Rebuild with step 1 and
install the new APK over the old one. The app keeps its sign-in and its
database, which upgrades itself.

## 3. The checklist

Tick each row. "Sheet" means the ticket on `.demo\checkin-demo.html`, shown on
this computer's screen with the brightness up and scanned from 20–40 cm.
Reset between runs with `cd backend; node scripts/demo-checkin.js rearm`.

Keep Terminal C (Metro) in view the whole time. Any red or yellow message
there, or a LogBox banner at the bottom of the phone's screen, fails the row
you were on, even if the screen looked right.

| Account | Email | Password |
|---|---|---|
| Organizer (sees everything) | `organizer@demo.eventsli.test` | `Demo-Checkin-2026` |
| Door-team member | `door@demo.eventsli.test` | `Demo-Checkin-2026` |
| Account with no events | `outsider@demo.eventsli.test` | `Demo-Checkin-2026` |
| Shared device **North Door (demo)** | pairing QR on the sheet | PIN `482193` |

### A. Launch
| # | Do | Expect |
|---|---|---|
| A1 | Open the app | White splash with the teal mark, then the **Eventsli Scanner** opening screen ("Event Check-in Made Simple", the city at the bottom), then sign-in |
| A2 | Look for "Update required" | Not shown |

### B. Sign in
| # | Do | Expect |
|---|---|---|
| B1 | Organizer, wrong password | "That email or password is not right." Still on sign-in |
| B2 | Organizer, right password | **My Events**, **Assigned to me**, *Annual Gala 2026 (Demo)* with its photo, date and Toronto. The tab bar shows Events, Scan, Logs, Profile |
| B3 | Profile tab → **Sign Out** → confirm → sign in as the door-team member | Only the gala is listed |
| B4 | Sign out → sign in as the account with no events | "No events yet", with an explanation. No crash |
| B5 | Sign out → **Sign in with Eventsli** (small link at the bottom) | The browser opens the website's sign-in page at 192.168.1.6:3000 |
| B6 | Sign in there as the organizer → **Allow and return to the app** | Back in the app and signed in, on My Events |
| B7 | Repeat B5, press **Cancel** on the website | Back on the app's sign-in screen, with no error shown |
| B8 | On this computer, open `http://192.168.1.6:3000/account/security` signed in as the organizer | A session row "Eventsli Check-in · *your phone*". Press **End** on it. The app returns to sign-in on its next request |
| B9 | Sign-in screen → **Shared door device** (bottom) → **Scan pairing code**, scan the sheet's pairing code, then enter PIN `482193` | The device ID fills in by itself; then the gala dashboard opens, labelled North Door |
| B10 | Wrong PIN on B9 | "That device ID or PIN is not right…" |
| B11 | **Forgot password?** | The website's reset page opens in the browser |

### C. My Events
| # | Do | Expect |
|---|---|---|
| C1 | Tap *Tech Meetup* | A sheet rises: cover, a blue "In … days" chip, date and time, venue, "You organize this event", a Checked in bar, the amber note "Doors are not open yet…", and **Open Anyway**. Tap outside the sheet: it closes |
| C2 | **All Events** → tap *Product Launch* | The sheet with a grey **Finished** chip, "3 of 4 · 75%", "This event has finished. It can no longer be scanned." and **Close** |
| C3 | Search "gala" | Only the gala. The × in the search clears it |
| C4 | Tap the gala → **Start Check-in** in the sheet | Its dashboard |
| C5 | Look at the list | Each row has a status chip (Live now / Starts in … / In … / Finished); the tabs show counts, "Assigned to me (2)"; "Hi *first name*, pick an event…" under the title; your initials top right open Settings |

### D. Event dashboard
| # | Do | Expect |
|---|---|---|
| D1 | Look at it (just after `rearm`) | The cover photo with a green "Live Check-in" chip, the title, date and Toronto; a card with **Total 18 · Checked In 1 · Remaining 17** and a bar "6% of guests checked in"; **Start Check-in**; tiles Find Guest · Analytics · Logs · Details; **Recent Check-ins** with Lucas Tremblay and **View All**; Event Details, Download Guest List, Offline Mode (on) |
| D2 | On this computer: `cd backend; node scripts/demo-checkin.js door-scan "Emily"` | Within about 10 s Checked In shows **2** and Emily Chen tops Recent Check-ins (or pull down to refresh) |
| D3 | **Event Details** | The cover with a round back button; status chip; date and times in Toronto time; the venue with **Open in Maps** (opens the maps app); a ring with the % checked in and a legend; By ticket type; Door settings; This device |
| D4 | **•••** (top right) | A sheet titled with the event: Event Details, Find a Guest, Analytics, Check-in Logs, Data & Sync, and **Leave This Event** in red. As the door-team member: no Find a Guest (the list is not shared) |
| D5b | Turn Offline Mode off, then tap **Download Guest List** | A dialog "Offline Mode is off" with **Turn on Offline Mode**. Press it: the switch turns on and the list downloads |
| D5 | **Logs** tab | All / Success / Failed cards, Lucas Tremblay in the list. Search "lucas" finds him; the filter button shows this phone only |

### E. Scanning and answers
Start Check-in. Each answer must show the right colour, title and sound. After
an admission the screen returns to the camera by itself after 2 seconds.

| # | Scan (sheet) | Expect |
|---|---|---|
| E1 | John Smith · ticket 1 | Green tick, **Check-in Successful**, a card with John Smith, the ticket code (TKT-…), the seat and the time, **Scan Next**, rising tone |
| E2 | John Smith · ticket 1 again | Amber, **Already Checked In**, a card with "Checked in at *time*" and who and where; **View Details** and **Scan Another**; two beeps |
| E3 | Sara Ahmed · VIP | Green, her name and seat |
| E4 | Mia's friend · NEW code | Green, shown as "Guest" (a transferred ticket shows no buyer name) |
| E5 | Mia Johnson · OLD code | Red, **Ticket Transferred** |
| E6 | Noah Wilson · refunded | Red, **Cancelled Ticket** |
| E7 | Ava Thompson · order cancelled | Red, **Cancelled Ticket** |
| E8 | Grace Lee · Tech Meetup | Red, **Wrong Event** |
| E9 | Forged code | Red, **Invalid Ticket**, "This QR code is not valid for this event." |
| E10 | Lucas Tremblay · already scanned | Amber, Already Checked In, first scanned at **North Door (demo)** |
| E11 | Hold one code steady for 10 s | One answer only, not a stream |
| E12 | The lightning button | The torch turns on and off |
| E13 | The camera button | Switches to the front camera and back |
| E14 | Dim the room; scan at different distances and angles | Reads within about a second at 20–40 cm |

### F. After the answer
| # | Do | Expect |
|---|---|---|
| F1 | On E2's answer, **View Details** | The ticket screen with its door history |
| F2 | Scan a fresh ticket (Ahmed Ali 1), then within 60 s tap *Scanned by mistake? Undo* | **Check-in Reversed**. Scanning again admits |
| F3 | Profile → **App Settings** → turn off *Back to the camera* | An admission stays until you tap Scan Next |

### G. Sounds and vibration
| # | Do | Expect |
|---|---|---|
| G1 | Admit, refuse, duplicate | Three different tones. Media volume must be up |
| G2 | Turn the ringer to silent and scan | The tones still play (Android uses media volume) |
| G3 | Profile → App Settings → Sound off | Silent. Vibration still works if it is on |

### H. Guest list and manual check-in
Open it from the dashboard's **•••** → Find a guest, or from the camera's
"No code? Find the guest by name".

| # | Do | Expect |
|---|---|---|
| H1 | Organizer: search "priya" | Priya Patel, VIP, "Not yet" |
| H2 | Tap her → **Check in by hand** → confirm | Green success; history says *Checked in by hand* |
| H3 | On the website (`http://192.168.1.6:3000/organizer` → the gala → Scanning devices), tick **Door team can search the guest list**; then as the door-team member, pull to refresh and open Find a guest | The list opens with full names |
| H4 | Try a screenshot on the guest list | Blocked or black |
| H5 | After E1–E3: search "john" (filter still on **Not yet**) | Both John Smith tickets, each with its check-in time. The filter row hides while you type; "2 guests match “john”" |
| H6 | Search "smith john", then "smith, john" | The same two tickets |
| H7 | Search "chloe" | Chloé Roy |
| H8 | Search "zzz" | "Nobody on the guest list matches “zzz”" |
| H9 | Clear the search | The filter row comes back on **Not yet** |

### I. Offline with Offline Mode off (check-ins saved to sync)
Turn **Offline Mode** off on the dashboard first; turn it back on at the end.

| # | Do | Expect |
|---|---|---|
| I1 | Start Check-in, then **airplane mode on** | **You're Offline** appears, "Pending Check-ins 0". Tap **Continue Scanning** |
| I2 | Scan Michael Brown 1, 2, 3 | Grey **Saved to Sync** each time. The camera shows "Offline — check-ins are saved" and "3 waiting to sync". **Never green** |
| I3 | Swipe the app away, reopen it (still airplane mode) | The dashboard says "3 check-ins waiting to sync". They survived in the encrypted database |
| I4 | Airplane mode **off** | Within about 15 s the banner goes; Checked In rises by 3. `node scripts/demo-checkin.js status`: Michael 1–3 **IN**, **EXACTLY-ONCE: OK** |
| I5 | Close and reopen the app | Nothing uploads twice. `status` again: same counts, still OK |
| I6 | **Wi-Fi flaps:** airplane on → scan Daniel Garcia 2 → airplane off and immediately on again → off | It ends uploaded once. `status` is OK |
| I7 | **API down:** Ctrl+C in Terminal A, scan Chloé Roy | Grey "Saved to Sync", **not** an error |
| I8 | Restart Terminal A | It syncs within about 15 s. Chloé Roy is IN. `status` is OK |
| I9 | **Another door got there first:** airplane on → scan Lucas Tremblay 2 → on this computer `node scripts/demo-checkin.js door-scan "Lucas Tremblay · ticket 2"` → airplane off | It settles as **Already Checked In**, never a second admission: Logs shows it, Checked In rose by 1, not 2. `status` is OK |

### J. Losing the door
| # | Do | Expect |
|---|---|---|
| J1 | As the **North Door** device: airplane on, scan Olivia Martin, airplane off. Immediately on the website (Scanning devices) press **Revoke** on North Door (demo) | On its next request the phone shows "Signed out of this door … scans not yet uploaded are kept" and goes to sign-in |
| J2 | Press *Switch back on* on the website, then pair and sign in again with the PIN | The saved scan syncs. `status` is OK |

### K. Optional: forced update
| # | Do | Expect |
|---|---|---|
| K1 | Stop Terminal A, run `$env:CHECKIN_APP_MIN_VERSION_ANDROID="9.0.0"`, start `node server.js` again, then force-close and reopen the app | "Update required". Clear the variable afterwards |

### L. Moving between screens
Each row must end on the right screen with nothing in Terminal C.

| # | Do | Expect |
|---|---|---|
| L1 | My Events → the gala → Start Check-in (sheet) | The dashboard. No "The action 'ROUTE_NAMES_CHANGED' … was not handled" |
| L2 | The dashboard's back arrow → **Leave event** in the dialog | My Events. (**Cancel** stays on the dashboard) |
| L3 | My Events → **Profile** tab → **Sign Out** → confirm | The sign-in screen |
| L4 | Sign in → the gala → **Profile** tab → **Sign Out** → confirm | The sign-in screen |
| L5 | Pair the North Door tablet with its PIN (B9), then Profile → **Sign Out** | The dashboard after the PIN, then the sign-in screen |
| L6 | At the gala: **Logs** → **Profile** → **Events** | Back on the dashboard. Then Start Check-in → scan → Scan Next → back: each back goes one screen back |
| L7 | My Events → **Scan** tab | The dialog "Choose an event first" with **Got it** |
| L8 | At the gala: Profile → **Switch Event** → confirm | My Events |

### M. Offline admission (Phase 3)
Phase 3 needs the demo seeded **after** the QR signing key went into
`backend\.env`, so the sheet's codes are QR v2. Start with
`cd backend; node scripts/demo-checkin.js rearm`, signed in as the
**organizer**, on the gala dashboard, with signal and **Offline Mode on**.

| # | Do | Expect |
|---|---|---|
| M1 | Wait up to 15 s | **Download Guest List** shows "20 · *time*": the 18 counted, plus the refunded and cancelled tickets the phone needs to refuse. Tap it: "Guest list downloaded — 20 tickets". Profile → **Data & Sync** says **Ready** |
| M2 | Start Check-in, **airplane mode on** → **Continue Scanning** → scan Michael Brown 1 | Green **Check-in Successful** at once, with "Saved on this phone with no signal. It syncs automatically." The camera reads "Offline — checking on this phone" |
| M3 | Michael Brown 1 again | Amber **Already Checked In**, at the time of M2. Not a second upload |
| M4 | Noah Wilson · Mia Johnson OLD code · Forged code · Grace Lee | Red: Cancelled Ticket · Ticket Transferred · Invalid Ticket · Wrong Event, each "Checked on this phone with no signal" |
| M5 | Lucas Tremblay · already scanned | Amber Already Checked In (the list knows the North Door let him in) |
| M6 | On this computer: `node scripts/demo-checkin.js late-sale`, reload the sheet, scan **Late Buyer** | Amber **Can’t Confirm Offline**: bought after the phone's list. Saved to sync |
| M7 | Scan Michael Brown 2, then tap **Undo** within 60 s | **Check-in Reversed**. It is never uploaded (M10) |
| M8 | Zoë Martin · older code | Green: older codes are let in from the list by default |
| M9 | Swipe the app away, reopen it (still airplane mode) | The dashboard shows check-ins waiting to sync; Data & Sync still says **Ready**. Scan Michael Brown 3 → green |
| M10 | **Airplane mode off**, then open the dashboard banner "… waiting to sync" | **Syncing Data…** with a progress bar ("3 of 5 (60%)"), then **All Synced**. Checked In reaches **5** (Lucas, Michael 1 and 3, Zoë, Late Buyer). `status`: Michael 2 still **valid**, **EXACTLY-ONCE: OK** |
| M11 | **Two doors, no signal.** Airplane on → scan Daniel Garcia 2 (green) → `node scripts/demo-checkin.js door-scan "Daniel Garcia · ticket 2"` → airplane off | Within 15 s the dashboard says **1 guest let in at two doors offline**; Data & Sync lists Daniel. Website: the gala → Attendees → **Let in twice** shows him. `status`: conflicts 1, OK |
| M12 | Website → Scanning devices → Door settings → switch **offline check-in** off. Wait 15 s | Offline Mode is greyed with "Switched off by the organizer"; Download Guest List says "Off for this event". Airplane on → scan Chloé Roy → grey **Saved to Sync**. Turn the setting back on |
| M13 | As the **door-team member**, open the gala, wait 15 s, airplane on, scan Ahmed Ali 2 | Green, shown as "Guest" with the ticket and seat: names are off by default. Turn on **Include names in that offline copy**, airplane off, wait 15 s, airplane on, `rearm`, scan again: the name shows |
| M14 | Door settings → older codes: **wait for a connection**. Wait 15 s with signal, `rearm`, airplane on, scan Zoë Martin | Grey **Saved to Sync**: "An older ticket code. The organizer asked for these to wait…" |
| M15 | The dashboard's back arrow, then open the gala again | Download Guest List shows "Downloading…" then the count: leaving the event deleted the list |

### N. Matches the design
Hold each screen next to its frame in the mockup.

| # | Screen | Check |
|---|---|---|
| N1 | Opening screen (A1) | Mark, "Eventsli", "Scanner", "Event Check-in Made Simple", the city at dusk at the bottom |
| N2 | Sign in | Lockup at the top, "Sign in to Eventsli Scanner", email with a mail icon, password with a lock and an eye, Sign In, Forgot password? |
| N3 | My Events | Big title, the two-way switch, search, rows with photo, date, place and a chevron, the tab bar |
| N4 | Dashboard | Photo with title, date and place, the three counts in one card, Start Check-in, the three rows |
| N5 | Camera | Dark, "Check-in" centred, round torch and camera buttons, mint corners, the moving line, "Scan guest QR code to check in" |
| N6–N8 | Answers | Green tick with confetti; amber clock-arrow; red circled X; each with its card and buttons |
| N9 | You're Offline | "Offline Mode" pill at the top right, the wifi icon, "Pending Check-ins", Continue Scanning |
| N10 | Syncing Data… | The cloud icon, the progress bar, "x of y (z%)", Cancel |
| N11 | Check-in Logs | Search and filter, All / Success / Failed cards, rows with ticket code and time and a green tick |
| N12 | Settings | Profile card, My Profile, App Settings, Data & Sync, Language (English), Help & Support, Sign Out in red |

### O. Pages and pop-ups
No grey system boxes anywhere: every question and message is the app's own
card (a coloured round icon, a title, a sentence, buttons) or a sheet rising
from the bottom. Tapping outside, or the phone's back button, cancels.

| # | Do | Expect |
|---|---|---|
| O1 | Profile → **Sign Out** | A card with a red exit icon, "Sign out?", a red **Sign out** button and **Cancel**. Cancel: nothing changes |
| O2 | Offline Mode off, airplane mode on, scan one ticket (it is held). Then Profile → **Sign Out** | An amber card "Check-ins still waiting" with **Open Data & Sync**. Nobody is signed out. Airplane off afterwards |
| O3 | Profile → **Language** | A sheet with English ticked and "More languages are on the way." |
| O4 | Profile → **My Profile** | Big initials avatar, the role chip, Account (email, account type, signed in until), This door (event, device, role) and **What you can do here** with ticks and crosses. As the door-team member: Find guests by name is a cross |
| O5 | Profile → **App Settings** → **Try the check-in sound** | The admit tone and vibration. The About card shows version, build, server, Privacy Policy and Terms of Service (open the website) |
| O6 | Profile → **Help & Support** | "How can we help?", seven questions, the first open; tapping another opens it and closes the first. **Contact support** opens the website's contact page |
| O7 | **Logs** → tap any row | A sheet: the coloured result header with date and time, the guest with initials, Ticket, How, Door, Staff, and **View Ticket** (opens the ticket) |
| O8 | Open a ticket (from Logs or Find a Guest) | A card with initials, name, TKT code and tier, a status chip; Details (ticket type, seat, table, Order Paid in green, ticket code); **At the door** as a timeline with coloured dots |
| O9 | Find a Guest | Rows with initials (a small green tick on the avatar when in), TKT code and tier, and a chip with the check-in time or "Not in". The × clears the search |
| O10 | Organizer: a ticket not yet in → **Check in by hand** | A card "Check this guest in?" naming them and reminding to check ID; **Check in** shows the green answer |

## 4. Checking from this computer

```powershell
cd backend
node scripts/demo-checkin.js status        # every ticket's state + EXACTLY-ONCE: OK / VIOLATION
node scripts/demo-checkin.js rearm         # reset the tickets to test again
node scripts/demo-checkin.js smoke --api http://192.168.1.6:5000/api/v1   # re-arms, 35 API checks over Wi-Fi, re-arms again (clears the door log)
node scripts/demo-checkin.js late-sale     # sells one more gala ticket now (for M6), and adds it to the sheet
node scripts/load-gate.js run --rate 50 --seconds 60   # a doors-open rush on the local API, then exactly-once from the database
node scripts/pilot-report.js --event <eventId>         # door metrics for one event (read-only)
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

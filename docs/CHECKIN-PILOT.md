# Check-in app — pilot event

One real event, with the app and the `/gate` web scanner side by side, before
the stores go to 100 %. The goal is to learn how the app behaves at a real
door; it is not a demo.

## Choosing the event

- 150–1,000 guests, with doors that open at a fixed time, so there is a rush.
- An organizer who agrees to the pilot and has a supervisor at the door.
- At least two doors, or two phones at one door, so conflicts can happen.
- A venue whose signal is known to be weak is a plus.

## A week before

1. Production has the check-in release (mobile/RELEASE.md §1), and tickets are
   QR v2: open a ticket and check that its code's header says ES256.
2. The organizer, on the website:
   - adds the door team;
   - registers one shared tablet with a PIN;
   - in **Door settings**: offline check-in **on**, names in the offline copy
     **on** (a supervised pilot), older codes **allowed**.
3. Every door phone has the TestFlight or internal-testing build. Each person
   signs in once, opens the event, and checks that **Offline check-in ready**
   appears on the dashboard.
4. A spare phone stays on the `/gate` web scanner as the fallback.
5. Brief the door team (10 minutes):
   - green means in, amber means look, red means no, grey means held;
   - when to use **Find a guest by name**;
   - what "Can't confirm offline" means: bought in the last few minutes; let
     the supervisor decide;
   - Undo is for one minute after a mistake.

## On the night: three drills, done by the supervisor

| Drill | How | Pass |
|---|---|---|
| **Offline** | Mid-rush, one phone in airplane mode for 5 minutes, then off | It keeps admitting (green, "checked on this phone"). Within about 15 s of the signal returning, nothing is waiting to upload |
| **Revocation** | Switch the shared tablet off on the website (Scanning devices → Revoke) | Within one scan the tablet says "Signed out of this door". Switch it back on and pair again |
| **Conflict** (optional) | Two phones in airplane mode both scan the same test ticket, then reconnect | The second upload is flagged: "let in at two doors". The website's **Let in twice** filter lists it |

## Measures

The day after, on the server:
```bash
cd backend
node scripts/pilot-report.js --event <eventId>
```
It only reads data, and prints:
- admitted against issued;
- guests per minute per door, and each door's peak minute;
- the busiest 5 and 15 minutes at the whole gate;
- admissions by method (scan, manual, offline);
- how long offline admissions took to reach the server;
- refusals by reason;
- conflicts.

Sentry adds scan timings (`door.scan` spans) and any crashes.

| Target | Measure | Pass |
|---|---|---|
| Fast at the door | Sentry `door.scan` p95, online | under 800 ms |
| Offline is instant | Sentry `door.scan` p95, `offline:*` outcomes | under 150 ms |
| Throughput | pilot-report, peak minute per door | 10 or more guests a minute |
| Nothing lost | pilot-report admitted against the organizer's headcount; nothing left waiting to upload on any phone | They agree, and 0 waiting |
| Nobody in twice | pilot-report conflicts | 0 outside the drill |
| Offline catches up | pilot-report, offline upload p95 | under 1 minute after the signal returns |
| Stable | Sentry crash-free sessions | 99.5 % or more |

## After

- A 15-minute debrief with the door team: what was slow, what was unclear,
  what they did instead of using the app.
- File every crash and every "the app said X but it was Y" as an issue before
  the next release.
- Go to 100 % on both stores only when every target passes, or each miss has an
  owner and a fix.

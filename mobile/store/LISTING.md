# Store listing — Eventsli Check-in

Draft copy for App Store Connect and the Google Play Console. Owner to review
before it is entered; nothing here has been submitted.

| Field | Value |
|---|---|
| App name | Eventsli Check-in |
| Bundle ID / package | `com.eventsli.checkin` |
| Category | Business (both stores) |
| Age rating | 4+ (Apple) · Everyone (Google): no user content, no ads, no purchases |
| Price | Free, no in-app purchases |
| Support URL | `https://eventsli.com/contact` *(`/help` does not exist on the site; `/contact` does — checked 2026-11-14)* |
| Privacy policy URL | `https://eventsli.com/privacy` *(needs the app section, see PRIVACY.md)* |
| Marketing URL | `https://eventsli.com` |

## Apple

**Subtitle** (30 characters max): `Scan tickets at your event`

**Promotional text** (170 max):
> Doors open? Scan Eventsli tickets in a second, see who is in, and keep scanning when the venue's signal drops.

**Keywords** (100 max, comma-separated):
`check-in,tickets,scanner,QR,event,door,attendees,guest list,box office,organizer,entry,venue`

## Google

**Short description** (80 max):
> Scan Eventsli tickets at the door — fast, offline-ready, with live counts.

## Full description (both stores)

> **Eventsli Check-in is the door app for events sold on Eventsli.**
>
> Organizers and their door teams sign in with their Eventsli account, choose
> the event, and scan. Every ticket gets a clear, full-screen answer you can
> read at arm's length: green to let them in, amber when someone has already
> checked in, red when a ticket is refunded, transferred or for another event.
>
> **Fast at the door**
> • Point the camera at a ticket's QR code: the answer is on screen in about a second
> • Names, ticket type and seat on every admission
> • Sounds and vibration for each answer, even on silent
>
> **Keeps working without signal**
> • With offline check-in on, the phone checks tickets itself when the venue's
>   signal drops, from an encrypted copy of the event's ticket list
> • Every check-in uploads once the signal returns, never twice
> • If two doors let the same ticket in while offline, the organizer sees it
>
> **For the whole door team**
> • Organizers invite their door team on eventsli.com; each person signs in
>   with their own account
> • A shared tablet can be signed in with a PIN instead
> • The organizer decides whether the door team can search the guest list
>
> **Live at a glance**
> • How many are in, how many are still to come, and who just arrived
> • Arrivals over time, by ticket type and by door
>
> You need an Eventsli account that organizes an event, or that an organizer has
> added to a door team. Tickets are sold on eventsli.com.

**What's new (1.0.0):** `First release.`

## Screenshots

Six per platform, in this order, taken from the demo event (no real guest
data). Apple needs iPhone 6.9" (1320 × 2868); it scales those for smaller
iPhones. **No iPad screenshots:** the app is iPhone-only on iOS
(`ios.supportsTablet: false`; iPads run it in iPhone mode). Google needs phone
screenshots of at least 1080 px on the short side.

1. **Scan** — the camera with the frame. Caption: *Point, scan, done.*
2. **Check-in Successful** — a VIP admission. Caption: *A clear answer for every ticket.*
3. **Already checked in** — amber, with the time and door. Caption: *No ticket gets in twice.*
4. **Dashboard** — ring, counts, recent arrivals. Caption: *See who is in, live.*
5. **Offline check-in** — the "Ready" screen. Caption: *Keeps scanning when the signal drops.*
6. **Select event** — the Ongoing tab. Caption: *Every event you work, in one place.*

Take them on a real phone with the demo (`backend/scripts/demo-checkin.js seed`),
signed in as the demo organizer. Do not use a production event: screenshots are
public.

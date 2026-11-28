# Eventsli (the attendee app)

The consumer iOS and Android app: discover events, save them, book tickets,
and carry the QR code to the door. It is built with Expo SDK 58, React Native
and TypeScript, the same stack as the check-in app in `../mobile`. It is a
client of the existing `/api/v1` API.

This folder is a standalone npm package outside the root workspaces, because
Expo pins its own React version. Run every command from `attendee/`.

```bash
npm install
cp .env.example .env.local     # optional: point a dev build at your laptop
npx expo start                 # then a development build, or press i / a
npm run typecheck && npm run lint && npm test
```

## Screens

The screens follow the owner's mockup (the "Discover. Experience. Be There."
board, 18 frames).

| Route | Screen | API |
|---|---|---|
| (launch) | The mockup's first frame on every cold start: the stacked logo, "Discover. Experience. Be There.", a drawn crowd; fades after 1.3 s (`src/ui/LaunchSplash.tsx`) | — |
| `welcome` | Your City. Your Experiences. Get Started / Sign In (first launch only) | `/public/vip-events` (the photo) |
| `(tabs)/index` | Home: logo + inbox bell, city, search, Trending carousel, categories, upcoming (posters to swipe, then a list; a grid on a tablet) | `/public/vip-events`, `/public/event-categories`, `/public/events` |
| `(tabs)/explore` | Explore: search, category chips and tiles, When (today / weekend / week / month), Near me | `/public/events` (`from`/`to`), `/public/events/near` |
| `(tabs)/saved` | Saved Events | `/me/saved-events` |
| `(tabs)/tickets` | My Tickets: Upcoming / Past, a paper ticket per order on its event's cover | `/tickets` |
| `(tabs)/profile` | Profile: who, upcoming / saved / attended, the menu | `/tickets`, `/me/saved-events/ids` |
| `event/[slug]` | The event: cover, when/where, countdown, About, seat-map preview, ticket types, extras, Getting there, organizer, Select Tickets / Notify me | `/public/events/:slug`, `/seat-map`, `/notify` |
| `event/[slug]/seats` | Seating Map: the organizer's floor plan to pan, pinch and tap (the website's own geometry, `src/seating`); ticket-type chips; whole tables; a List view for screen readers | `/public/events/:slug/seat-map`, `/hold` |
| `event/[slug]/tickets` | Select Tickets (general admission): a quantity per type | `/public/events/:slug`, `/hold` |
| `checkout/[reservationId]` | Checkout: hold ring, the server's itemised quote, add-ons, promo code, details, a name per ticket, "whose guest", policies, terms + typed signature, Pay Now | `/quote`, `/addons`, `/promo`, `/checkout`, `/claim`, `/checkout/:sessionId` |
| `checkout/confirmed` | Booking Confirmed | — |
| `ticket/[orderId]` | The tickets of one order, a paper ticket + QR each; Add to Calendar; Directions; Give to someone | (from `/tickets`), `/tickets/:id/transfer` |
| `organizer/[slug]` | An organizer's page: about, contact, links, upcoming and past events | `/public/organizers/:slug` |
| `notifications` | The inbox, New and Earlier | `/me/notifications` |
| `settings` | Account, notifications, location, language, resend my tickets, privacy, help, Log Out | `/me/push-devices`, `/public/tickets/resend` |
| `city` | City picker with search | `/public/cities` |

**Every screen size.** `src/ui/layout.tsx` sets a centred content column and
grids whose column count follows the width. A wide screen (tablet sideways, a
browser) gets the tab bar as a left rail (`src/ui/TabBar.tsx`) and two-column
event, seat-map and checkout pages. Tablets turn freely; phones are locked
upright at launch (`src/lib/orientation.ts`, with `orientation: "default"` in
`app.json`).

**Matching the mockup.** The screens are compared with the board by rendering
the web build at phone size. A development web build accepts `?demo=signedin`
(an account and a hold) or `?demo=fresh` (first launch) in the URL, so the
signed-in frames can be drawn (`src/dev/renderDemo.ts`; never in a store
build). The extra sections (Near You, This Weekend, the countdown, lineup…)
sit below the part each frame shows. Where the board shows data Eventsli does
not have, the same spot carries real data: the price and organizer instead of
a star rating, "N tickets booked" instead of "Premium Member", and real event
covers on the category tiles.

**Tests.** `npm test` covers the helpers and, against a mocked API, the
checkout and sign-in screens and the session store (`test/*.screen.test.tsx`,
`test/session.test.ts`). Reanimated's own Jest mock does not load here; screen
tests use `test/mocks/reanimated.tsx`.

**The seat map never moves by itself** (owner, 2026-11-19): it opens fitted,
moves only under the person's fingers or the zoom buttons, and keeps their zoom
when its box resizes (`keepView`, tested in `test/seating.test.ts`).
| `sign-in`, `sign-up`, `verify` | Email + password; create account; the 6-digit code | `/auth/app/login`, `/auth/register`, `/auth/verify-email` |

Left out of the mockup on purpose: the star rating and review count (there are
no reviews in Eventsli, and a number would be invented) and the "Premium
Member" badge (there is no membership tier).

## How the parts fit

**Browsing needs no account.** Saving, the inbox and My Tickets do. Checkout
works either way: signed in, the order is on the account; as a guest, it is on
the email typed at checkout, and the tickets appear in My Tickets as soon as
someone signs in with that address.

**Paying is Stripe Checkout** — the website's own page, in an in-app browser
(`expo-web-browser`). Cards, Apple Pay and Google Pay work there, and no card
number touches the app. When the browser closes the app asks the API how the
session ended (`GET /public/checkout/:sessionId`, which also fulfils the order
if the webhook is late) and only then shows Booking Confirmed. Free orders are
claimed directly.

**Two credentials can travel together.** The session goes as
`Authorization: Bearer`; a hold's reservation token goes as `x-access-token`.
The API reads the hold's own header first (`accessTokens.reservationTokenFrom`,
added for this app — before it, a signed-in phone's session token was read as
the hold token and every checkout was refused as "not yours").

**The QR is drawn on the phone** from the signed token `/tickets` returns
(`src/ui/QrCode.tsx`), with the same library and error-correction level as the
emailed code, so a ticket opens with no signal.

**Navigation follows the session.** Screens change the session; the
`Stack.Protected` guards in `src/app/_layout.tsx` drop the sign-in screens and
the stack lands back on what was underneath — the event someone was about to
book. Same rule, and same reason, as the check-in app.

## Push notifications

The server writes the inbox whatever the phone allows
(`backend/services/attendeeNotifications.js`): tickets issued, ticket received,
"coming up" a day before, cancelled, rescheduled, and a welcome. When the phone
has granted permission it also receives them as pushes through Expo.

Push needs the EAS project id, which is in `app.json` (`extra.eas.projectId`).
A build without one still works, minus the lock-screen push; the inbox still
fills. A tap on a notification opens its screen whether the app was running or
closed (`openLaunchNotification` in `src/lib/push.ts`).

## Offline, sessions and holds

- **My Tickets survives a cold start with no signal.** The last list `/tickets`
  returned is kept in the app's documents folder, stamped with the account
  (`src/lib/ticketCache.ts`), seeded into the query at launch, and deleted on
  sign-out.
- **A session the server refuses signs the phone out.** A 401 on a request that
  carried the current session (revoked from the web, expired) clears the
  account and says so (`onAuthLost` in `src/api/client.ts`).
- **Leaving checkout gives the seats back** at once, unless a Stripe session
  was already started for the hold (it may still be paid).
- **Android payment return.** `openBrowserAsync` resolves when the Custom Tab
  opens on Android, so checkout waits for the app to come back to the
  foreground before asking how the payment ended (`src/lib/browserReturn.ts`).

## Before the first store build

1. `npx eas build --profile preview`.
2. Apply `supabase/migrations/20261213090000_attendee_app.sql` **before**
   deploying the backend that comes with this app — sign-in from the app writes
   `sessions.client = 'attendee_app'`, which the old constraint refuses.
3. Replace the icons in `assets/images` if the consumer app should look
   different from the check-in app (they are currently the same E-card icon).
4. App Store / Play listing, privacy answers (the `privacyManifests` in
   `app.json` lists what is collected), and the store ids in `eas.json`.

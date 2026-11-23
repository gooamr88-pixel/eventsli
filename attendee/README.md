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
| `welcome` | Your City. Your Experiences. Get Started / Sign In (first launch only) | — |
| `(tabs)/index` | Home: logo + inbox bell, city, search, Trending, categories, upcoming in the city | `/public/vip-events`, `/public/event-categories`, `/public/events` |
| `(tabs)/explore` | Explore: search, category chips and tiles, Near me | `/public/events`, `/public/events/near` |
| `(tabs)/saved` | Saved Events | `/me/saved-events` |
| `(tabs)/tickets` | My Tickets: Upcoming / Past | `/tickets` |
| `(tabs)/profile` | Profile | — |
| `event/[slug]` | The event: cover, when/where (opens Maps), About, ticket types, Select Tickets | `/public/events/:slug` |
| `event/[slug]/seats` | Seating Map (reserved events): by section and row, whole tables | `/public/events/:slug/seat-map`, `/hold` |
| `event/[slug]/tickets` | Select Tickets (general admission): a quantity per type | `/public/events/:slug`, `/hold` |
| `checkout/[reservationId]` | Checkout: hold countdown, the server's itemised quote, details, terms + typed signature, Pay Now | `/quote`, `/checkout`, `/claim`, `/checkout/:sessionId` |
| `checkout/confirmed` | Booking Confirmed | — |
| `ticket/[orderId]` | The tickets of one order, a QR each; Add to Calendar; Share | (from `/tickets`) |
| `notifications` | The inbox | `/me/notifications` |
| `settings` | Account, notifications, location, privacy, help, Log Out | `/me/push-devices` |
| `city` | City picker | `/public/cities` |
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

Push needs an EAS project id, which this app does not have yet:

```bash
npx eas init          # writes extra.eas.projectId into app.json
```

Until then everything works except the lock-screen push itself; the inbox
still fills.

## Before the first store build

1. `npx eas init` (above), then `npx eas build --profile preview`.
2. Apply `supabase/migrations/20261213090000_attendee_app.sql` **before**
   deploying the backend that comes with this app — sign-in from the app writes
   `sessions.client = 'attendee_app'`, which the old constraint refuses.
3. Replace the icons in `assets/images` if the consumer app should look
   different from the check-in app (they are currently the same E-card icon).
4. App Store / Play listing, privacy answers (the `privacyManifests` in
   `app.json` lists what is collected), and the store ids in `eas.json`.

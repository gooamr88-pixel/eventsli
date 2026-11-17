# Eventsli in every country (2026-11-17)

Organizers in any of 236 countries can sign up, create events priced in their
own currency, and sell. The six countries under comprehensive sanctions (Belarus,
Cuba, Iran, North Korea, Russia, Syria) are not offered.

## How it works

| | Card checkout (Stripe) | Offline payments |
|---|---|---|
| Where | Countries where Stripe offers accounts (44) **and** a super admin has switched card on | Every open country |
| Default | Card on in **Canada and the US only** (the only two verified) | On everywhere |
| Buyer pays | By card at checkout | The organizer directly, outside Eventsli — **buyers cannot buy online** (see GLOBAL-LAUNCH-REVIEW.md, finding A) |
| Tickets issued | Immediately | When the organizer records the sale under Door sales (seated events only, today) |
| Eventsli's commission | Taken from each card payment | Invoiced to the organizer |

- One table, `markets.json`, lists every country with its currency, whether
  Stripe can work there, its region and main time zone. The backend
  (`backend/utils/markets.json`) and frontend (`frontend/src/app/lib/markets.json`)
  copies must be identical. A test fails if they differ.
- The database has a matching `markets` table. An organizer's and an event's
  country (and the event's currency) are foreign keys into it.
- Amounts are stored in the currency's **minor unit**: cents, yen (no decimals),
  fils (three decimals for KWD, BHD, JOD, OMR, TND, IQD, LYD).

## Rolling out

1. Apply `supabase/migrations/20261121090000_global_markets.sql` to production.
   It creates the `markets` table, swaps the CA/US checks for foreign keys, fixes
   fixed-amount promo codes for yen and dinar, and **opens every country** in the
   `currencies` setting, with card left on only where it already was.
2. Deploy the backend and the frontend together.
3. Run `node backend/scripts/verify-schema.js`.
4. Set **Admin → Settings → Door-sale invoices → How organizers pay Eventsli**.
   Organizers abroad need international bank details (IBAN/SWIFT) to pay
   their commission invoices.

## Switching card payments on for another country

For each country (e.g. the UK):

1. In Stripe **test mode**, create a connected account for that country from the
   Canadian platform and complete onboarding. Stripe's cross-border rules depend
   on the platform's own country, and only CA/US have been verified so far.
2. Then go to **Admin → Settings → Countries open to organizers**, find the
   country, and tick **Card**.

Turning card off for a country stops card checkout on the next sale, even for
organizers who are already connected.

## Not covered yet

- **Legal**: the Terms and Privacy policy still describe Canada and the US. The
  sanctions exclusion list is a legal decision, so have counsel confirm it.
- **Stripe cost estimate** (`stripe_cost`) is one rate worldwide (2.9% + 30
  minor units). This only affects fee previews and the buyer-pays service fee
  estimate outside North America.
- **"Events near me"** matches visitors to a list of North American cities.
- The admin audit log shows changed prices with two decimals whatever the
  currency.

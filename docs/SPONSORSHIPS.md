# Sponsorships

Built 2026-11-20. This is the first of the two partner systems the owner asked for ("Vendors and Sponsors"). Sponsors came first; Vendors comes next and reuses the same `partner_companies` and `partner_members` tables.

## What it does

| Who | Where | What |
|---|---|---|
| Organizer | Event › **Sponsors** (`/organizer/events/[id]/sponsors`) | **Pipeline**: Leads → Proposal sent → Signed → Paid, with lost and cancelled deals in their own column. **Packages**: tier, price, how many, what's included, public or private. **Sponsor page**: switches the public page on or off, plus the intro, the default agreement, and offline payment instructions. |
| Organizer | One deal (`…/sponsors/[dealId]`) | Writes and sends the proposal: package, amount, benefits, agreement, a schedule of 1–12 payments that must add up exactly, and a reply-by date. Records offline payments, shows the signed agreement with its signature, sets the sponsor's display details, keeps private notes and a history. Can mark a deal lost, reopen it, or cancel it. |
| Brand (public) | `/e/[slug]/sponsor`, linked as "Become a sponsor" on the event page while the page is on | Packages with what's left, current sponsors, and an inquiry form. Each inquiry becomes a lead and emails the organizer. |
| Sponsor (signed in) | Account › **Sponsorships** (`/account/sponsorships`) | Reads the proposal, signs it (drawn or typed, using the same signature step as checkout), uploads a logo, pays each instalment by card or follows the offline instructions. |

A deal that is **signed and paid in full** is added to `event_sponsors` automatically, so the event page shows it at the right tier. Cancelling a deal removes it again.

## Rules (enforced by the database, migration `20261202090000_sponsorships.sql`)

- A package never sells past its quantity. This is checked under a row lock at **signing**.
- Nothing is paid before the agreement is signed.
- A card payment only counts for the Checkout session we opened, on the event organizer's own Stripe account, for the exact instalment amount. A repeated delivery of the same payment is recorded once.
- Only the contact's email address (verified at sign-in), or a member of the sponsor's company, can see, sign or pay a deal. Anyone else gets "not found".
- The organizer's notes never reach the sponsor.

## Money

- Card payments are **direct charges on the organizer's Stripe account**, the same as tickets. The organizer is the merchant and handles refunds and disputes in their own Stripe Dashboard.
- **Eventsli's fee on sponsorship card payments is 0% by default.** It reads `platform_settings` key `sponsorships`, value `{"feeBps": 250}` (basis points, so 250 = 2.5%), capped at 30%. There is no admin screen for it yet.
- Offline payments (bank transfer, cheque, cash) are recorded by the organizer and carry no Eventsli fee.
- Not built yet: recording a refund or dispute on a sponsorship card payment. The webhook acknowledges those events but does not record them on the deal.

## Deploying

1. Apply `supabase/migrations/20261202090000_sponsorships.sql` **before** the code: every Sponsors screen reads its tables. The event page itself fails safe and treats a missing table as "page off".
2. `node backend/scripts/migration-gap.js` lists it if it's missing.
3. No new environment variables. Emails go through Brevo like every other email here.

## Tests

- `backend/test/integration/sponsorships.test.js` (11 tests, real database): the whole flow, sold-out at signing, access control, card-webhook matching, cancelling.
- `backend/test/sponsorshipRules.test.js`: schedules, statuses, fee, logo ownership, error mapping.

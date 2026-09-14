# Frontend build plan

Sprint 11. The API is feature-complete — 95 routes — and nothing in `frontend/`
exists yet. `package.json` already declares the workspace and
`ecosystem.config.js` already expects Next on port 3000, so the shape is fixed
before the first file.

## The rule that governs every choice

Decided in the first session and not re-litigated here:

> عايز آخد من events platform الـ branding {design, colors} — لكن عايز آخد من
> fancy كل شي حسب طريقة الشغل. ناخد من فانسي اللوجيك والسيتنج ماب وكل شي مناسب،
> لأن events platform فيه أشياء بايظة كتير. عايز آخد منه الديزاين والفكرة فقط.
> أنا عايز زي fancy بالظبط في التقنيات والملفات وكل حاجة.

| Source | What it contributes | What is refused |
|---|---|---|
| `Desktop/events platform` — Eventsli v2, static HTML, the previous generation of **this** product | The visual identity: emerald palette, DM Sans / DM Serif Display, motion curves, z-index map, focus rings, the page inventory and the UX ideas | Its data layer (browser → Supabase direct), 447KB of CSS across 18 files, 366 `!important`, 12 breakpoints, `dashboard.html` at 146KB, `dist/`, `scratch/`, `theme.css` (self-marked `@deprecated` and still loaded) |
| `Desktop/fancy/fancy` — an adjacent product on Next 16 + React 19 + Tailwind 4 | The engineering: file tree, `apiClient`, breakpoints module, hooks, shared components, static checkers, vitest setup, the revalidate route, the comment culture | Its domain code (RSVP, envelopes, invitations, shop), the `assign_seat` model, ~5,100 inline styles, `styled-jsx` |
| `eventsli/backend` | The contract — 91 routes, one envelope, one error-code table | — |

**Nothing is copy-pasted.** Files marked *port* are read, understood, and
rewritten against this API. Files marked *lift* are close enough to move with a
rename and a re-read of the comments.

## Superseded by the BRD

Three things the August merge report and build spec specify are **wrong now**.
They are listed so nobody rebuilds them from those documents.

| The old spec said | The BRD decided | Consequence for the frontend |
|---|---|---|
| Separate Charges & Transfers, `ledger_entries`, a settlement worker, `DISPUTE_WINDOW_DAYS` | **No escrow.** Destination charges — the organizer is paid on Stripe's schedule and we never hold their money | There is no `/dashboard/finance/payouts` page and no settlement panel. The organizer's money screen is **commission invoices**, and those exist only on the manual (door) channel |
| `DEFAULT_CURRENCY=EGP`, Vodafone Cash | **Canada + US**, USD / CAD | Currency comes from the event row; no EGP formatting, no local wallet copy |
| Add `--font-ar`, an Arabic family | **English only. No Arabic identity** | One font stack. No RTL. No locale switch |
| 3 breakpoints — 640 · 1024 · 1280 | — | Reconciled to **fancy's four**: 640 · 768 · 1024 · 1280. "زي fancy بالظبط" wins, and 768 is the mobile↔desktop line the whole `fx-*` system is built around |

## Stack — locked

Versions are fancy's, verified in its `package.json`, not guessed.

```jsonc
{
  "dependencies": {
    "next": "16.2.7",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "framer-motion": "^12.40.0",
    "html5-qrcode": "^2.3.8",          // gate scanner only
    "react-international-phone": "^4.8.0"
  },
  "devDependencies": {
    "tailwindcss": "^4",
    "@tailwindcss/postcss": "^4",
    "eslint": "^9",
    "eslint-config-next": "16.2.7",
    "vitest": "^3.2.7",
    "@vitejs/plugin-react": "^6.0.4",
    "@testing-library/react": "^16.3.2",
    "@testing-library/jest-dom": "^7.0.0",
    "@testing-library/user-event": "^14.6.1",
    "jsdom": "^29.1.1"
  }
}
```

Three deliberate departures from fancy's list:

- **No `@supabase/supabase-js`.** Fancy keeps it for storage. Here the browser
  must never hold a Supabase client at all — an import is a lint failure, so the
  rule cannot decay into a convention. See *Gaps* for what this costs.
- **No `qrcode`.** The API renders the admission QR itself at
  `GET /public/qr/:token` with the signature checked first. Rendering it again
  in the browser would mean the token travels somewhere it does not need to.
- **No panzoom.** The old seat map imported it from `esm.sh` at runtime — a
  third-party CDN inside the purchase path. Pan and zoom are ~120 lines of
  transform math over an SVG viewBox, and fancy already proved the shape with
  `clampView`.

JavaScript, not TypeScript — fancy is JS with a `jsconfig.json`, and
`src/middleware.ts` is the single `.ts` file in the tree. Same here — except the
file is `src/proxy.ts`, because Next 16 renamed the convention and building on
the deprecated name is debt taken on for nothing on day one.

## Repository shape

```
frontend/
├── next.config.mjs            port  — CSP, image domains, headers
├── jsconfig.json              lift
├── postcss.config.mjs         lift
├── eslint.config.mjs          port  + the no-supabase-import rule
├── vitest.config.mjs          port
├── AGENTS.md                  port  — fancy's conventions, edited to ours
├── scripts/
│   ├── responsiveCheck.js     lift  — inert classes + fixed-column grids
│   ├── backtickInCssComment.js lift
│   └── fileSizeCheck.js       new   — 500-line cap, CI-warned
├── test/
│   ├── setup.js               lift
│   └── *.test.js(x)
└── src/
    ├── proxy.ts               port  — guards /account /organizer /admin /gate
    └── app/
        ├── layout.js  globals.css  error.js  not-found.js
        ├── page.js  sitemap.js  robots.js  icon.svg
        │            (no app/manifest.js — the convention emits ONE manifest
        │             linked into every page's head, and the installable thing
        │             here is /gate, not the storefront)
        │
        ├── how-it-works/  why-us/  trust/  contact/   ★ phase 8
        ├── lib/siteRoutes.js       ★ the ONE list robots, the sitemap
        │                             and the footer all read
        ├── components/SiteFooter.jsx
        ├── components/marketing/  PageHeader.jsx  Blocks.jsx
        │   → public/og-default.png  (1200×630, the default share card)
        │
        ├── api/internal/revalidate/route.js   lift — the backend's cache hook
        │
        ├── (auth)/  login  register  forgot-password  reset-password
        ├── events/page.js
        ├── e/[slug]/page.js                   ★ SSR
        ├── e/[slug]/seats/page.js             ★ client
        ├── checkout/[reservationId]/page.js
        ├── checkout/success/page.js
        ├── t/[token]/page.js
        ├── tickets/find/page.js
        │
        ├── account/  tickets  security
        ├── organizer/
        │   ├── layout.js  page.js  onboarding  payouts
        │   └── events/[id]/  edit tiers map tables tiers
        │                     orders attendees promos door
        │                     commission devices gate
        ├── admin/(panel)/  approvals events invoices users
        │                   organizers settings audit
        ├── gate/  page.jsx  login/page.jsx     ★ PWA
        │          GateScanner GateBar ScanResult ScanLog
        │          gateSession  useGateQueue  useScanner
        │          queuePolicy  scanQueue  qrToken  scanOutcome  feedback
        │          → public/gate-sw.js  public/gate.webmanifest
        │
        ├── components/
        │   ├── seating/  SeatMapCanvas.js  SeatMapEditor.js  SeatPicker.js
        │   │              seatingGeometry.js          ★ ONE definition
        │   ├── ui/ forms/ icons/ landing/
        │   ├── Toast.js ToastHost.js ToastCard.js     lift
        │   ├── ConfirmDialog.js useConfirm.js         lift
        │   ├── ErrorBoundary.js BoundaryError.js      lift
        │   ├── ImpersonationBanner.js LogoutModal.js  lift
        │   ├── OtpBoxes.js PhoneNumberInput.js        lift
        │   └── CountryFlag.js countries.js            lift
        ├── hooks/
        │   ├── useAuth.js         port — /auth/me, no localStorage trust
        │   ├── useMediaQuery.js   lift
        │   ├── useModalA11y.js    lift
        │   ├── useCountdown.js    lift — drives the 35-minute hold
        │   └── useReservation.js  new  — the hold as a first-class object
        ├── lib/breakpoints.js     lift
        └── utils/
            ├── apiClient.js       port — cookie name, 401 policy, envelope
            ├── errors.js          new  — the ~40 codes → sentence + recovery
            ├── money.js           new  — format only, never compute
            ├── timezone.js        lift
            ├── toast.js           lift
            ├── authErrors.js      port
            └── responseHelpers.js lift
```

## The contract with the API

Six facts, each verified in the backend, that decide how every page is written.

**1. One envelope.**
`{ success: true, data, meta?, pagination? }` /
`{ success: false, error, message, meta? }`.
`apiFetch` unwraps `data` and throws an `ApiError` carrying `code`, `message`,
`status` and `meta` on failure.

**2. Switch on the code, never the message.** `utils/errors.js` maps every code
in `backend/utils/responseEnvelope.js` to a sentence and a recovery action.
A code with no entry renders the server's `message` and logs a warning — an
unmapped code must be loud, not invisible.

**3. The cookie is `eventsli_session`.** httpOnly, `sameSite: lax`,
`secure` in production. `eventsli.com` → `api.eventsli.com` is same-site
(site = eTLD+1), so lax is sent; `localhost:3000` → `localhost:5000` likewise.
Cross-origin still, so every request carries `credentials: 'include'` and the
origin must be in the backend's `FRONTEND_URL` allowlist.

**4. Two base URLs, and they must not be confused.**

| | Used by | Value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | the browser | `https://eventsli.com/api/v1` |
| `INTERNAL_API_URL` | server components | `http://127.0.0.1:5000/api/v1` |

`INTERNAL_API_URL` is deliberately not `NEXT_PUBLIC_*`. Inlined into the client
bundle it would be useless at best; and without it every SSR render hairpins
out through nginx and back, landing on the API as traffic from the box's own
address — which collapses all rendering onto one rate-limit key. The reasoning
is already written into `ecosystem.config.js`.

**5. SSR does not carry the cookie for you.** A server component that renders
authenticated data must read `cookies()` and forward the header explicitly.
Forget it and the page renders logged-out for a logged-in user, and the bug
appears only in production where SSR is on.

**6. Money is integer cents and the server is the authority.**
`utils/money.js` formats — `formatMoney(cents, currency)` — and does not add,
multiply or apply a percentage. Every total on screen comes from
`GET /public/reservations/:id/quote`. `parseFloat("19.99") * 100` is 1998.9999…,
and a cent lost per order is a real number by settlement.

## Design system

One token file: `src/app/globals.css`. **No `:root` variable is declared
anywhere else.** That single rule is what the old platform's seven-layer CSS
stack cost — `tokens → bridge → motion → polish → styles → theme → landing →
light-theme → mobile-ios`, each redefining the last, which is why 366
`!important` exist to break the ties.

Ported from `events platform/css/tokens.css`, with three corrections:

| Correction | Why |
|---|---|
| `--border-focus`, `--shadow-accent`, `--accent-subtle` become emerald | They are still `rgba(79,70,229,…)` from an older indigo identity. Focus rings and button shadows are purple under a green skin |
| Drop the Cormorant Garamond `<link>` | The tokens moved to DM Serif Display. Every page downloads a font it never uses |
| No `--font-ar` | English only |

- **Colour** — emerald: `#059669` primary (light), `#34D399` in dark for contrast
  on a dark ground. Backgrounds `#F8FAFC → #E2E8F0` light, `#09090B → #18181B`
  dark. Semantics `#16A34A` / `#F59E0B` / `#EF4444` / `#3B82F6`.
- **Type** — DM Sans 300–900 for UI, DM Serif Display for headings, 1.25 modular
  scale with `clamp()`.
- **Kept verbatim** — the named `cubic-bezier` curves (`ease-spring`,
  `ease-bounce`), the `prefers-reduced-motion` block, the named z-index map, and
  the `:focus-visible` rings. That part of the old platform was written with
  real accessibility awareness.

Tailwind v4 binds to those variables through `@theme`, so a utility and a token
can never disagree.

### Breakpoints — four, and only four

640 · 768 · 1024 · 1280, with `.98` for max-width queries. At fractional CSS
pixel widths (browser zoom, Windows scaling, iOS pinch) a whole-pixel `767` next
to a `768` leaves a band where neither rule matches. JS reads them from
`lib/breakpoints.js`; `globals.css` uses `@media (width >= theme(--breakpoint-md))`.

### The rule that has already cost this codebase time

**A class can never beat an inline style.** `className="fx-section"` next to
`style={{ padding: "100px 48px" }}` does not error, does not warn, and does
nothing at any viewport. Migrating means *deleting* the inline `padding` /
`maxWidth` / `margin` / `gridTemplateColumns` / `gap` keys. `scripts/responsiveCheck.js`
fails the build on an inert class, and its own test asserts it still detects a
known-bad fixture — a checker that reports "clean" because it broke is the
failure mode that test replaces.

Corollary from fancy's arithmetic: at a 320px viewport an `.fx-section` leaves
280px. A fixed 3-column grid of cards with 24px padding needs each card's
content to have a min-content width of ≤29px to fit. **Fixed-column grids do not
fit phones — use `.fx-grid`.**

## Route map — every page, every endpoint

96 routes. `POST /payments/webhook` and `GET /health` have no UI; the other 94
are reachable from a page below.

### Public — the money path

| Page | Endpoints |
|---|---|
| `/` | `GET /public/events` (soonest few) · `GET /public/event-categories` |
| `/events` | `GET /public/events` `?q ?country ?category ?from ?to ?includePast` |
| `/e/[slug]` **SSR** | `GET /public/events/:slug` |
| `/e/[slug]/seats` | `GET /public/events/:slug/seat-map` · `POST …/tables/:tableId/unlock` · `POST …/hold` · `POST /public/reservations/:id/release` |
| `/checkout/[reservationId]` | `GET …/quote` · `POST …/promo` · `DELETE …/promo` · `POST …/checkout` · `POST …/release` |
| `/checkout/success` | `GET /public/checkout/:sessionId` |
| `/t/[token]` | `GET /public/t/:token` · `<img src=GET /public/qr/:token>` |
| `/tickets/find` | `POST /public/tickets/resend` |
| `/terms` · `/terms/organizer` | `GET /public/terms/:audience` |

### Auth and account

| Page | Endpoints |
|---|---|
| `/login` `/register` | `POST /auth/login` · `/auth/register` · `/auth/google` |
| `/verify-email` | `POST /auth/verify-email` · `/auth/resend-verification` — register and an `EMAIL_NOT_VERIFIED` sign-in both land here |
| `/forgot-password` `/reset-password` | `POST /auth/forgot-password` · `/auth/reset-password` |
| everywhere | `GET /auth/me` · `POST /auth/logout` |
| `/account/tickets` | `GET /tickets` · `POST /tickets/:id/transfer` |
| `/account/security` | `GET /auth/sessions` · `DELETE /auth/sessions/:jti` · `POST /auth/logout-all` · `POST /auth/change-password` |

### Organizer

| Page | Endpoints |
|---|---|
| `/organizer/onboarding` | `POST /organizer` · `GET /organizer/me` · `PATCH /organizer` |
| `/organizer/payouts` | `POST /organizer/stripe/onboard` · `GET /organizer/stripe/status` |
| `/organizer` | `GET /events` |
| `/organizer/events/new` · `/[id]/edit` | `POST /events` · `GET/PATCH /events/:id` · `POST …/accept-terms` · `POST …/submit` — no cancel: BRD §17, only an admin cancels |
| `/[id]/edit` — cover | `POST …/cover-upload` → browser `PUT` to the signed URL → `PUT …/cover` · `DELETE …/cover` |
| `/[id]/tiers` | `GET/POST/PATCH/DELETE /events/:id/tiers[/:tierId]` |
| `/[id]/tables` | `GET/POST/PATCH/DELETE /events/:id/table-categories[/:categoryId]` |
| `/[id]/map` | `GET/PUT /events/:id/venue-map` |
| `/[id]/orders` | `GET /events/:id/orders` `?channel ?status ?q` |
| `/[id]/attendees` | `GET /events/:id/attendees` `?checkedIn ?status ?q` |
| `/[id]/promos` | `GET/POST/PATCH /events/:id/promos[/:promoId]` |
| `/[id]/door` | `POST …/manual-sales/quote` · `POST/GET …/manual-sales` |
| `/[id]/commission` | `GET …/commission` · `POST …/invoices/:invoiceId/proof` |
| `/[id]/devices` | `GET/POST /events/:id/scan-devices` · `PATCH …/:deviceId` |
| `/[id]/gate` | `GET /events/:id/gate` |

### Admin

| Page | Endpoints |
|---|---|
| `/admin/approvals` | `GET /admin/approvals` · `POST /admin/events/:id/{approve,reject,suspend,unsuspend,cancel}` |
| `/admin/events/[id]` | `PATCH /admin/events/:id/fees` · `GET …/fees/preview` · `POST …/scanner-override` |
| `/admin/invoices` | `GET /admin/invoices` · `POST /admin/events/:id/invoices` · `POST /admin/invoices/:id/settle` |
| `/admin/users` | `GET /admin/users` · `GET /admin/users/:id` · `PATCH …/role` · `POST …/block` · `POST …/unblock` |
| `/admin/organizers` | `POST /admin/organizers/:id/{ban,unban}` |
| `/admin/settings` | `GET /admin/settings` · `PATCH /admin/settings/:key` |
| `/admin/audit` | `GET /admin/audit` |

### Gate — a PWA route, not a separate app

| Page | Endpoints |
|---|---|
| `/gate/login` | `POST /scan/login` (device id + PIN) |
| `/gate` | `POST /scan/verify` · `POST /scan/sync` · `POST /scan/undo` · `GET /scan/status` |

Three properties the UI has to respect, because the API already does:

- **A refusal is a 200.** The device renders "already used at 19:04", it does
  not show a network error and invite a retry. Only a locked gate is a 403.
- **Every scan carries a device-generated id.** Re-uploading an offline queue
  returns the *original* answers, so the queue lives in IndexedDB with its id
  and its own clock, and replays are safe by construction.
- **The event comes from the device token**, never from a form field.

## The 35-minute hold is a first-class object

`useReservation` + a provider mounted above `/e/[slug]/seats` and `/checkout`:

- `POST …/hold` returns `reservationId`, a **`reservationToken`**, `expiresAt`,
  `seatCount`, `subtotalCents`. The token — not the id — is what releases the
  hold or changes its promo code. Store it in memory and `sessionStorage`; a
  bare id travelling to the client is not proof of anything.
- `useCountdown` drives a persistent bar. Warn at 5:00, again at 1:00.
- On expiry: release locally, drop to the seat map, and say which seats went —
  `RESERVATION_EXPIRED` arriving as a wall of red on the payment button is the
  worst possible moment to learn it.
- Leaving the checkout deliberately calls `POST …/release`. Seats held by
  someone who closed the tab are inventory nobody can sell for 35 minutes.

## Phases

Each phase ships behind its own definition of done. No phase starts before the
previous one's DoD is met.

| # | Phase | Definition of done |
|---|---|---|
| 0 | ~~**Foundation**~~ **— done 2026-09-05** | See *What phase 0 shipped* below |
| 1 | ~~**Storefront + checkout**~~ **— done 2026-09-05** | See *What phase 1 shipped* below |
| 2 | ~~**Auth + account**~~ **— done 2026-09-05** | See *What phase 2 shipped* below |
| 3 | ~~**Organizer core**~~ **— done 2026-09-05** | See *What phase 3 shipped* below |
| 4 | ~~**Venue designer + seat map**~~ **— done 2026-09-05** | See *What phase 4 shipped* below |
| 5 | ~~**Organizer operations**~~ **— done 2026-09-05** | See *What phase 5 shipped* below |
| 6 | ~~**Admin console**~~ **— done 2026-09-05** | See *What phase 6 shipped* below |
| 7 | ~~**Gate PWA**~~ **— done 2026-09-05** | See *What phase 7 shipped* below |
| 8 | ~~**Marketing + legal**~~ **— done 2026-09-05** | See *What phase 8 shipped* below |
| 9 | ~~**Hardening**~~ **— done 2026-09-06** | See *What phase 9 shipped* below |

## What phase 0 shipped

Verified, not asserted: `next build` is clean with zero warnings, `eslint .` is
clean with zero errors and zero warnings, 25 frontend tests and 81 backend tests
pass, and the built server was booted against the live API to confirm the
homepage renders 25 real events server-side.

| Built | Note |
|---|---|
| `globals.css` | The emerald tokens, the `@theme` bridge, the four breakpoints, the `fx-*` primitives, and the three theme states. One `:root`, nowhere else |
| `utils/apiClient.js` | Envelope unwrap, `ApiError` vs `NetworkError`, the two base URLs, `serverFetch` with cookie forwarding and cache tags, the 401-on-auth-page rule |
| `utils/errors.js` | All 40 codes, each with a recovery. A test reads `backend/utils/responseEnvelope.js` off disk and fails if either side adds a code the other lacks |
| `utils/money.js` | Format only — a test asserts the module exports no arithmetic |
| `lib/breakpoints.js`, `hooks/useMediaQuery.js` | Lifted, `useSyncExternalStore` |
| `src/proxy.ts` | Route guards. **`proxy.ts`, not `middleware.ts`** — Next 16 renamed the convention and the old name builds with a deprecation warning. `NextProxy` is a straight alias of `NextMiddleware`, so nothing changed but the filename |
| `api/internal/revalidate/route.js` | Lifted. Verified failing closed with a 503 when `REVALIDATE_SECRET` is unset |
| `scripts/` × 3 | `responsiveCheck` (10 tests, including one asserting it still catches a known-bad fixture, and one for the `[slug]` blind spot), `backtickInCssComment`, `fileSizeCheck` |
| CI | A `frontend` job: static checks → lint → vitest → `next build`, each a separate step |

Four things the build itself surfaced, all fixed rather than silenced:

- **`eslint` in `next.config.mjs` is unsupported in Next 16.** Removed; lint is
  its own CI step, which is better anyway — a lint failure buried in a compile
  log is one people learn to scroll past.
- **Turbopack picked the wrong workspace root.** It infers from the nearest
  lockfile and found a stray `package-lock.json` in the user's home directory,
  so it chose `C:\Users\<user>`. That root decides module resolution and file
  tracing, so `turbopack.root` is now pinned. Not a warning silenced — a wrong
  answer that happened to still compile.
- **`FlatCompat` throws on eslint-config-next 16.** `Converting circular
  structure to JSON`, from inside ESLint's own config validator, with no file
  and no rule in the trace. The package already exports a native flat-config
  array; the widely-copied `FlatCompat` recipe is simply wrong on this version.
- **A production build without `NEXT_PUBLIC_SUPABASE_URL` shipped a broken
  site, silently.** The storage hostname is compiled into both the CSP and the
  `next/image` allowlist, so a missing value blocked every cover image with
  nothing in any log. The build now refuses, in the spirit of `backend/app.js`
  refusing to boot on a missing secret — and CI supplies it, which is what
  proves the refusal is wired up.

One bug was found by a test that was written to find it: `formatPriceRange`
passed `null` prices through, because `Number(null)` is `0` and
`Number.isFinite(0)` is true — so a $25 event with one unpriced tier rendered
as "$0 – $25".

## What phase 1 shipped

The whole money path: browse → event → seat map → hold → quote → promo →
Stripe → success → ticket.

| Built | Note |
|---|---|
| `/` and `/events` | Search, thirteen category pills, cover art. Filters live in the URL as `<Link>`s, so a filtered view is shareable, the back button walks it, and the page renders with no JavaScript |
| `/e/[slug]` | SSR, JSON-LD `Event` built from the same values it renders, OG card from the cover. Times formatted in the EVENT's timezone, not the reader's — a show at 8pm in Toronto is 8pm on the ticket and at the door |
| `/e/[slug]/seats` | The seat map. Header SSR'd from the cached event; the map itself fetched fresh and never cached at any layer |
| `components/seating/` | `seatingGeometry.js` — five shapes, positions as percentages of a fixed logical world, per `position_x NUMERIC(6,3)`. `usePanZoom.js` — pan, wheel zoom and pinch over the SVG viewBox, no library. `SeatMapCanvas.jsx` — the renderer |
| `/checkout/[reservationId]` | Quote lines, promo apply/remove, buyer details, BRD §02 terms acceptance, Stripe redirect, explicit release |
| `/checkout/success` | Polls with backoff, because Stripe's redirect races the webhook that writes the order |
| `/t/[token]`, `/tickets/find` | The emailed ticket, and a resend that answers identically whether or not an order exists |
| `/terms`, `/terms/organizer`, `/privacy` | Terms rendered from `GET /public/terms/:audience`, **never** a copy in this repo |

### The seat map, and why it is drawn the way it is

`save_venue_map` only ever creates **table-attached** seats — every insert sets
`table_id`, and `seats.position_x/position_y` are never written. So there are no
loose seats to place, and every seat's position is derivable from its table's
position, shape and index. The buyer's map needs no seat coordinates from the
API, and none are exposed.

Five shapes: `round`, `oval`, `rect`, `square`, `row`. `row` is the one worth
noting — a bank of seats with no table body, which gives theatre and general-
admission rows the whole table machinery (pricing, holds, private access) for
nothing.

A contract test fails if any file under `src/` declares its own shape list or
seat size, and another proves no two seats overlap at any count on any shape.

### Private tables — the flow, corrected

This was got **wrong first, then fixed**, and the shape is not obvious from the
endpoints:

A protected table is omitted from the seat-map payload **entirely** — not
returned with a `locked` flag. So there is nothing on the map to click, and an
"unlock this table" control attached to a table cannot exist. The first
implementation had exactly that control, and it was unreachable.

The id arrives from outside, in the organizer's invitation link as `?table=<id>`.
That is also why `POST …/unlock` answers every rejection identically — callers
can put an arbitrary id in that URL, so a distinguishable answer would turn it
into a directory. `GET /seat-map` then takes a **comma-separated** list of keys
in `x-table-access`, a header rather than a query parameter so the keys stay out
of history and logs, and the server decides visibility. Adding a key re-fetches
the map; the table arrives with it.

### A cached miss is stored exactly like a cached hit

The plan warned about this for the event page and it bit somewhere else first.

Next prerenders a static page at **build time** and caches whatever that render
produced — including a failure. The build talks to no API (CI points it at an
unreachable one deliberately, to prove pages degrade), so `/terms` at
`revalidate = 3600` baked its own error branch and served "We could not load the
terms just now" for an hour — a legal document, behind a **required** checkbox
on the checkout.

Both terms pages are `force-dynamic` now. Rarely visited, must never be wrong.

The homepage had the milder version: its empty state read "Nothing is on sale
just yet", which is a claim about the business rather than about us. It now
distinguishes a failed fetch from an empty one. Short windows self-heal — 60s
listings correct themselves on the first request after a deploy — but the
message has to be honest either way.

### Bugs the tooling and tests caught

- **A QR the browser could not load.** `t/[token]/page.jsx` is a server
  component, where `API_URL` resolves to `127.0.0.1:5000` — correct for a
  server-side fetch, useless in an `<img src>`, because the browser resolves
  loopback to the viewer's own machine. `PUBLIC_API_URL` now exists for
  anything that lands in rendered HTML. The page rendered fine; only the image
  was broken, on the one page opened at a door.
- **The matching CSP hole.** `img-src 'self'` covers the QR in production, where
  the API is same-origin, and blocks it in development, where the page is :3000
  and the API is :5000 — an environment-only failure.
- **A setState inside another setState's updater.** An updater must be pure;
  React calls it twice in development to prove it. Moved out.

### `.jsx` for anything that renders

A departure from fancy, argued in `frontend/AGENTS.md`. Vitest's transform is
oxc, which decides whether to accept JSX **from the file extension**, so a
component in a `.js` file fails to parse — and the error names the *test* file,
which is already `.jsx`. Two configuration routes were tried; the second made it
worse. Naming the file for what it holds costs nothing and cannot break on a
dependency update.

## What phase 2 shipped

| Built | Note |
|---|---|
| `(auth)/login` · `register` | Email/password and Google, with `?next=` carried through both |
| `(auth)/forgot-password` · `reset-password` | The reset pair. No session is issued on reset — deliberate on the API's side, so a stolen link is not a session |
| `/account/tickets` | Every ticket, grouped by order, with QR and one-time transfer |
| `/account/security` | The session list, ending one or all, and the password change |
| `hooks/useAuth.js` | One `/auth/me` per page load, shared by every component that asks |
| `components/forms/` | `Field`, `FormError`, `SubmitButton`, `GoogleSignIn` |

**The session list is the visible half of something the API does that most
cookie auth does not**: every token is backed by a `sessions` row keyed on
`jti`, checked on every request. Ending one revokes the row, so the token stops
working on the device that holds it — which is what makes "sign out everywhere"
and a lost-phone recovery real rather than decorative.

**Nothing about the session is persisted.** No `localStorage`, no cached role —
a deliberate divergence from fancy, which kept `org_id` and `user_role` and
trusted them, so a revoked session left the header showing "Sign out" until the
visitor clicked through and got bounced. The cookie is httpOnly and unreadable
to JavaScript, so asking is the only way to know, and the answer is not
cacheable across page loads because an admin can end a session between two of
them. A test asserts the file contains no storage calls.

**Google costs the CSP its only third-party entries** — `accounts.google.com` on
`script-src` and `frame-src`. No `connect-src`: the ID token goes to our API and
is verified there against Google's keys. `frame-ancestors 'none'` stays
absolute. The button renders nothing when the client id is unset, because a dead
Google button looks like the fastest way in and does nothing.

### Two bugs found by exercising the live API, not by a failing test

- **A redirect loop nobody could escape.** `proxy.ts` bounces signed-in visitors
  off `/login`, but it can only see that a cookie *exists*, not that it is
  valid. A revoked session leaves the cookie in place, so: protected page → 401
  → `apiFetch` sends them to `/login?reason=expired` → the proxy sees a cookie
  and sends them back. Closed loop, sign-in form on the other side. `reason=expired`
  is now an explicit escape hatch. Each guard was individually correct; the bug
  lived in the seam.
- **A phantom session on every sign-up.** `POST /auth/register` issues a session
  itself. The form then called `/auth/login`, creating a SECOND row: the cookie
  overwrote the first so nothing looked wrong, and the orphan then appeared on
  the account's own "Where you are signed in" list as a device the person had
  never used. Found by counting sessions against a live API — one login should
  mean one session, and it meant two.

Verified against the real API: two devices signed in, sign-out on one returns
401 for it and 200 for the other, `logout-all` reports `sessionsEnded = 2` and
kills the caller too. Register alone now yields exactly one session, flagged
`current`.

## What phase 3 shipped

| Built | Note |
|---|---|
| `/organizer` | The event list, with a payout banner and the ban notice |
| `/organizer/payouts` | Stripe Connect, re-read from Stripe on every visit — never from our own flags |
| `/organizer/profile` | The one editable field, and why `country` is not one |
| `/organizer/events/new` | Create an event. **Not a wizard** — see below |
| `/organizer/events/[id]` | Overview, the review pipeline, cover upload (cancellation moved to the admin console — BRD §17) |
| `/organizer/events/[id]/tiers` · `/tables` | Ticket types and table categories |

**Not a multi-step wizard, deliberately.** `POST /events` needs five things, and
everything else — tiers, the seat map, categories, artwork — is edited on an
event that already exists and can be saved. Splitting five fields across four
screens invents ceremony and, worse, holds an organizer's work in browser state
where a closed tab loses it.

**The money settings are read-only** and shown in full. That is BRD §05/§06 —
every rate lives in `eventRules.js`'s admin map, and `feeBearer` is the single
financial field an organizer controls. But BRD §21 requires them to *see* every
amount they will bear before publishing, and a number you cannot edit is still
one you have to be told.

**Stripe status is re-read from Stripe, not cached.** Onboarding finishes
asynchronously — an organizer can land back on the page before verification
completes — and an account can be restricted later without telling us. The
`requirements` list is the reason the page is worth building: "not ready yet"
with no reason leaves someone with nothing to do but wait.

### Two bugs found by driving the live API

- **A confirmation that could never appear.** Deleting a table category reports
  how many tables it uncategorised, and the component read `uncategorised` where
  the API returns `tablesUncategorised` — always `undefined`, so the message
  never rendered and nothing anywhere said why.
- **A lenient date parser.** `toIso` guarded malformed input with
  `isNaN(new Date(x).getTime())`, which does not work: V8 falls back to a legacy
  parser, so `new Date("not-a-date:00Z")` is **not** NaN — it is
  `2000-01-01T05:00Z`. Junk sailed past the guard and became a real timestamp in
  a request body. The shape is validated with a regex now.

`toIso` itself is the subtle part of this phase. `datetime-local` yields
`2026-09-05T20:00` with no zone, so `new Date()` reads it in the **browser's**
zone — an organizer in Vancouver scheduling a Toronto show at 8pm would create
it at 11pm, silently, and the event page would then render the wrong time in the
correct timezone. Six tests cover it, including a half-hour offset
(`America/St_Johns`) and both sides of daylight saving.

Verified against the live API: register → no profile (404) → create profile →
role becomes `organizer` → create event (CA gives CAD, US gives USD) → two tiers
→ submit **refused 403** without terms → accept terms → `pending_review` → the
event appears in the `pending_review` queue that `/admin/approvals` reads.
`commissionPct: 0` from an organizer is refused 403.

## What phase 4 shipped

`/organizer/events/[id]/map` — drag tables, edit them, undo, save.

| File | Note |
|---|---|
| `useMapDraft.js` | The draft and its undo stack. Mirrors the API's ceilings (400 tables, 60 seats) so a save is refused *here* rather than after the work |
| `EditorCanvas.jsx` | The draggable SVG, on the same geometry as the buyer's |
| `TablePanel.jsx` | Label, shape, seats, whole-table price, category, price band, private + password |
| `MapEditor.jsx` | Load, save, keyboard undo, and the refusals |

**Saving is a full replace**, reconciled in one transaction: anything still
listed is created or updated, anything dropped is deleted, every deletion
checked against live stock, and a refusal rolls all of it back. That is what
lets the error message say "nothing was saved" and mean it.

**The editor frames the whole WORLD, the buyer frames the content.** Two
reasons, and the second is a bug avoided: an organizer needs the empty floor
they are arranging into, and `usePanZoom` re-frames whenever `bounds` changes
identity — so a content-framed editor would snap the view back on **every frame
of a drag**.

**A drag is one history entry, not one per frame.** `transient` on the update
suppresses recording after the first move. Without it, undo steps back a pixel
at a time and recovering one mistaken drag takes four hundred presses.

### A button that was there and did nothing

`canUndo` was derived from `past.current.length` — a ref, read during render.
Refs do not re-render, so the Undo button's disabled state never updated after
the first paint. React's lint caught it, and it is the kind of bug that survives
a demo: the control is present, looks right, and quietly does nothing. History
is state now, and a test pins it.

### Verified against the live API

A probe saved a six-table map through the editor's exact payload — every shape,
a private table, a whole-table price, a category and a price band — then read it
back both ways:

- 46 seat rows generated from 46 declared seats
- every `x`, `y` and `rotation` **identical** after the round trip
- the buyer sees 5 tables, `hiddenTableCount: 1`, and the private one is
  **absent from the payload entirely** — not returned with a flag
- position, rotation, shape and seat count match on every visible table
- unlocking with the password reveals it *and its six seats*; a wrong password
  is refused with a message that says nothing useful

Two things the probe learned by being refused, both of which are the design
working: publishing is blocked by the `published_requires_terms` CHECK
constraint rather than by a controller, and `accept-terms` only *records* the
acceptance — `submit` is what writes `terms_accepted_id` onto the event, which
is what the constraint reads.

## What phase 5 shipped

Six pages under `/organizer/events/[id]`, taking the event tabs to ten —
ordered by when an organizer needs them: build it, sell it, run the night.

| Page | Note |
|---|---|
| `/orders` | Both channels. Totals are for the **whole filtered set**, from the database |
| `/attendees` | The door list — deliberately without QR codes |
| `/promos` | Codes are deactivated, never deleted |
| `/door` | Quote, then record. Uses the **buyer's** seat map component |
| `/commission` | The debt, its invoices, and proof of payment |
| `/devices` | Scanning devices and the live gate state |

**The two channels answer different questions**, and `/commission` exists
because of it. On the card path the money passed through us and Stripe already
took our fee, so the position closes at zero. On the manual path the money never
came near us — the commission is a **receivable**, and a receivable that reads
as zero is one nobody collects.

**Orders totals come from the API, not from the page.** A footer that sums the
twenty-five visible rows and calls it revenue is worse than no footer, because
it looks like an answer.

**The door list carries no QR codes.** It is paginated, screenshot-able and read
by anyone the organizer shares a screen with; the credential that admits someone
does not belong in it. Asserted by the probe.

**A door sale is quoted before it is recorded**, and the quote shows the
commission it creates. An organizer taking cash is creating a debt in that
moment and should see it then — not a week later on an invoice they did not
expect.

**The device PIN is shown exactly once.** The API returns it on creation and
never again; it is stored hashed. The panel says so, in red, rather than letting
someone close the page and find out at a door.

### Verified against the live API

A probe walked the whole definition of done:

```
gate open → door sale (quote 45¢ commission, recorded, matches)
→ owed 45¢ on the manual channel
→ organizer refused 403 raising their own invoice; an admin raises it
→ invoice made overdue  → gate LOCKED (commission_overdue)
→ submit proof          → gateReopened: false, awaitingReview: true
                        → gate STILL LOCKED  ← the proof is not decorative
→ admin settles         → gateReopened: true, gate OPEN, no separate unlock
```

Plus: no QR token anywhere in the door list, and the door sale appears in
`/orders` alongside card sales.

One thing the probe got wrong first, worth recording because it read as a
product bug: `raise_commission_invoice` returns its own result object, not the
invoice row — the key is **`invoice_id`**, not `id`. Reading `.id` gave
`undefined`, so the "make it overdue" update matched nothing and the gate stayed
open. The API was correct throughout.

## What phase 6 shipped

`/admin` — approvals, invoices, people, settings, audit.

**The refusals are the feature.** BRD §19's ladder is rendered as reasons, not
discovered as 403s: the row shows *why* it cannot be acted on ("you cannot act
on your own account", "an equal cannot be acted on from here") and staff roles
appear as unselectable options for a non-super-admin rather than as an error
after the fact. The UI predicts only what it can — the rules needing server
state still arrive as messages, and every one of those codes now has a sentence.

### The error table had eight holes

Enumerating every code emitted in the backend against `ERROR_STATUS` found
**eight that bypassed the table entirely** — passed straight to `sendFail` with
a literal status, so the frontend's "is every code mapped?" test, which reads
that table, could not see them:

```
BELOW_SOLD  DUPLICATE_CATEGORY  DUPLICATE_TIER  TIER_IN_USE
TIER_HAS_SALES  SELF_ACTION  LAST_SUPER_ADMIN  INTERNAL_ERROR
```

Four of those are reachable from the **tiers page built in phase 3** — deleting
a tier that prices seats would have said "something went wrong" rather than
explaining that the seats would fall to zero. All eight are in `ERROR_STATUS`
and `errors.js` now, which also makes the existing drift test meaningful again.

### Two bugs the probe found

- **Blocking and banning require a reason** (5–1000 chars, enforced by the
  route) and the page sent no body — so every block would have failed with a
  validation error. The reason goes into `admin_audit`, which is the whole point
  of the audit page: "an admin did it" is not an answer months later. It is now
  a confirm step that asks for it.
- **`SELF_ACTION` is emitted with 409, not 403.** The table said 403; the
  controller passes its own status, so nothing broke — but the table was wrong.

### `LAST_SUPER_ADMIN` is unreachable, and that is fine

`mayActOn` refuses any target at or above the actor's level, and it runs
**before** the last-super-admin count. So a super-admin target is always caught
by rule 1 (self) or rule 2 (an equal) first, and this code cannot be produced
through the API. Verified in both directions rather than assumed.

It is kept — defence in depth that would start firing the moment the ladder
changed — but no UI will ever render it, and the plan should not claim otherwise.

## What phase 7 shipped

`/gate` and `/gate/login` — a door scanner that works with no signal.

**A route, not a second application.** The old platform shipped `gatekeeper_app/`
— a whole Flutter build with its own Supabase credentials — so every rule at the
door existed twice and the copy on the tablet was the one nobody updated. Here
the door shares the API, the error table and the deploy. `SiteHeader` already
returned null under `/gate` and `proxy.ts` already exempted it; the subtree adds
its own manifest, its own service worker and nothing else.

**The queue is the product.** `queuePolicy.js` holds the rules on plain arrays —
oldest first, a record leaves the queue only when the *server* has answered it, a
mid-flight upload that comes back with nothing puts every entry back — and
`scanQueue.js` is a thin IndexedDB adapter under it. That split is why fifteen
tests cover the part where an admission gets lost, without a fake database.

**Three properties the UI had to respect, and does:**

- **A refusal is a 200.** The screen renders "Already used · at 19:04". Only a
  locked gate is a 403, and it stops the camera rather than inviting a retry.
- **Every scan carries a device-generated id**, made at the door, so re-uploading
  a queue returns the *original* answers instead of a wall of duplicates.
- **The event comes from the device token.** `toWire` sends three fields —
  `qr`, `clientScanId`, `occurredAt` — and a test asserts `eventId` is not one.

**Offline is honest.** A queued scan is grey and says *"Held for upload"*, not
green. The device cannot verify a signature — the key is on the server, which is
the point — so `peekTicket` decodes the payload without verifying it and is used
for exactly one thing: refusing, with no network, a code that is not a ticket or
is a ticket for another event. It can only refuse, never admit, and the test
that matters is the negative one: a well-formed ticket for this event gets *no*
offline verdict at all.

**Dark, pinned.** `.fx-gate` rides on the existing `[data-theme="dark"]`
selector rather than getting a fourth copy of the palette. A tablet at a venue
door at night is held by someone who did not choose the OS setting and cannot
change it between guests.

### Verified against the live API

`backend/scripts/probe-gate.js` — writes, then restores everything it touched.
**29 checks, 0 failures**, including the definition of done executed rather than
asserted:

```
two offline scans of one ticket, own ids, own device clocks
→ one upload  → #1 admitted, stamped 17:28 (the DOOR's clock, not the upload's)
              → #2 duplicate, carrying 17:28 — the FIRST scan's time
              → summary: 1 new admission, not 2
→ the same queue uploaded again
              → the ORIGINAL answers, replay: true on both
              → summary: 0 admitted, 2 replayed
```

### Two backend gaps the gate exposed

- **`POST /scan/undo` never checked the event.** It took a bare ticket id
  straight to the RPC, which does not look at the event either — so a device
  authenticated for one venue could reverse an admission at another. That id is
  not secret: it is inside every QR token. Now a 404, and the probe asserts it.
- **Revoking a device only blocked the next sign-in.** `requireDevice` verified
  the signature and stopped. A device token lasts seven days, so a tablet left in
  a taxi went on admitting people for a week after the organizer had switched it
  off and watched the dashboard say `inactive` — a false assurance, which is
  worse than no button. `requireDevice` now re-reads the row on every request,
  the same trade `requireAuth` already makes for user sessions, and takes the
  event from the row rather than the claim.

## What phase 8 shipped

`/how-it-works`, `/why-us`, `/trust`, `/contact`, a footer, and the SEO plumbing
the site had none of: `robots.txt`, `sitemap.xml`, a favicon and a default share
card.

**One list, read by three things.** `lib/siteRoutes.js` declares the public pages
and the private prefixes; the sitemap, robots.txt and the footer all read it, and
a test walks `src/app` and fails on a page that is in none of them. The three
disagreeing is the classic SEO failure and every version of it is silent — a page
nothing links to, a footer link that 404s, or a crawler fetching `/t/<token>`,
which is a signed admission credential in a URL.

**robots.txt emits two patterns per prefix**, and the pair is the point. A bare
`/t` is a prefix match that also silences `/terms`; `/login/` does not match
`/login`. So each prefix gets `/x/` for the subtree and `/x$` — end-of-URL, RFC
9309 — for the page itself. The test matches them the way a crawler does.

**The old platform's URLs are kept alive.** Twelve 308s in `next.config.mjs` —
`/events.html`, `/terms.html`, `/scanner.html` and the rest. A 404 tells a crawler
the page is gone rather than moved, which throws away the ranking as well as the
traffic. `/merchant-agreement` redirects to `/terms/organizer`: that document *is*
the merchant agreement, it is versioned, and acceptance is recorded against the
version (BRD §21) — publishing a second copy under the old name would be a legal
document with two texts, one of them unversioned.

**The trust page has a section called "What we do not claim."** No SOC 2, no ISO
27001, no penetration test, no bug bounty, and no PCI certification of our own —
card data never reaches us. An organizer doing due diligence gets more from that
list than from a badge, and every claim above it is a property of code in this
repository: signed tickets, the QR drawn on our own servers, one admission per
ticket under a row lock, PBKDF2-HMAC-SHA512 at 210,000 iterations, the lint rule
that keeps Supabase out of the browser.

**`/contact` has no form**, deliberately. There is no contact endpoint, and a form
posting nowhere thanks somebody and drops the message — invisibly to us, totally
to them, and most often to the person with a problem urgent enough to go looking
for a contact page. A `mailto:` cannot lie about whether it sent.

### Verified, not asserted

Real Lighthouse 12, headless Chrome, against `next start` with the API up:

```
/e/[slug]        SEO 100      ← the phase DoD (≥ 95)
/                SEO 100
/events          SEO 100
/how-it-works    SEO 100
/why-us          SEO 100
/trust           SEO 100
/contact         SEO 100
```

Every scored audit passes on all seven. And the rendered `<head>` on `/e/[slug]`
carries the full card both validators read — `og:title`, `og:description`,
`og:url`, `og:type`, `og:site_name`, `og:locale`, `og:image` with width, height
and alt, plus `twitter:card=summary_large_image` and its image.

Reproduce it with the app running on :3000:

```bash
npx lighthouse@12 http://localhost:3000/e/<slug> --only-categories=seo \
  --chrome-flags="--headless=new" --output=json --quiet
```

A run that reports `NO_FCP` and a score of 0 is a headless flake, not a
regression — fetch the URL once to warm it and run again. It happened here on a
cold server and the same URL scored 100 either side of it.

The audit found a bug on the way to the number.

### `og:image` was missing on the most-shared URL on the platform

A page's `openGraph` **replaces** the layout's rather than merging into it. The
event page set `images: event.coverUrl ? [...] : undefined` — which did not fall
back to the root layout's default card, it deleted it, along with `og:site_name`
and `og:locale`. Every share of every event without cover art was a blank
rectangle beside a line of text.

Nothing errors and nothing logs; the only place it is visible is the rendered
`<head>`, or somebody else's chat window. Fixed by falling back to
`/og-default.png` with its dimensions declared, and a test now fails any page that
declares `openGraph` without `images`.

The cover's own dimensions are still not declared, on purpose: that file is
whatever the organizer uploaded, and a wrong width is worse than none because a
crawler believes it.

### The sitemap was prerendering its own failure

`export const revalidate = 3600` looked right and was the /terms mistake again —
Next prerenders a static route at build time and caches whatever it produced,
including a failure. The build talks to no API, so the first version shipped an
events-free sitemap for an hour after every deploy, during the window a crawler is
most likely to look.

Now the **route** is dynamic and the **fetches** inside it are cached for an hour:
every request re-renders, and at most ten API calls happen per hour however often
the URL is hit. `lastmod` comes from a new `updatedAt` on the public event shape —
omitted rather than guessed when the API has not sent one, because `startsAt`
would look plausible and would be a lie about when the page changed.

## What phase 9 shipped

The hardening pass, and it found the worst bug in the project.

### The production CSP was breaking the whole application

`script-src 'self'` with no nonce does not weaken a Next.js app — **it kills
it**. The App Router streams React's payload to the browser inside inline
`<script>` tags, and a strict policy refuses every one of them.

Measured on `/events` before the fix: **14 blocked inline scripts** and one
`Error: Connection closed.` from React's flight reader. Nothing hydrates — the
header never learns who is signed in, the seat map does not draw, the countdown
does not count, the checkout button does nothing.

It had been true since phase 0 and was invisible for eight of them, because
`isDev` is true under `next dev`, where the policy carries `'unsafe-inline'` for
the dev overlay. It appears only under `next start`, which is to say only in
production. Nothing in the build, the tests or the SEO audit could see it: the
server HTML is perfect, and Lighthouse gave that same page **SEO 100 while its
JavaScript was entirely dead**.

Found by reading the browser console during the accessibility sweep.

**The fix**: `proxy.ts` mints a per-request nonce, sets it on the request (so
Next stamps it onto its own inline scripts) *and* on the response (so the browser
enforces it). The policy moved to `config/csp.mjs` as a function — in
`next.config.mjs` it was evaluated once at build time, so a test could only ever
observe the *development* policy, and the one that protects anybody was the one
nothing could check. Nineteen assertions now cover it.

**What it cost, stated plainly**: a nonce is per-request, so `dynamic =
'force-dynamic'` is declared once in the root layout and route-level static
rendering is gone. Measured, not assumed — before that line, `/events` (already
dynamic) served 24 correctly nonced tags while `/how-it-works` (prerendered)
served 14 inline scripts with zero. The **data** cache is untouched:
`serverFetch`'s tagged, revalidating fetches are a separate mechanism, so a
re-render re-runs JSX and does not re-ask the API.

`'strict-dynamic'` was deliberately not used: the usual recipe restores
older-browser compatibility by adding `https:` and `'unsafe-inline'` as CSP2
fallbacks, putting the exact string this project promised to keep out back into
the header, where the next reader has to work out that it is inert.

Also tightened, while in there: `https://apis.google.com` removed from
script-src — nothing loads from it, it served the *old* Google Sign-In library —
plus explicit `worker-src`, `manifest-src`, `media-src 'none'`,
`upgrade-insecure-requests`, and HSTS (two years, subdomains, **not** preloaded).

### The accent colour failed AA on every ground

`scripts/contrast.js` computes WCAG ratios for every text role against every
ground in both themes, reading the values **out of globals.css** rather than
carrying a copy. Eight failures on the first run:

- **emerald-600 as text** — every link and eyebrow label — 3.44–3.77:1.
- **white on emerald-600** — every primary button and the active filter pill —
  **3.77:1**. Body-sized, so it needs 4.5.
- **`--es-text-subtle`** under AA on five of six grounds.

Fixed at the token: light accent → emerald-700 (5.01–5.48 everywhere), and both
subtle roles moved off their ramps, which is argued in the file — neither ramp
has a step between the two neighbouring values that clears 4.5, and taking the
next one would collapse `subtle` into `muted` and delete a level of hierarchy.

The first version of that script carried its own copy of the palette, found the
eight failures, and then went on reporting all eight after they were fixed. A
checker that fails when the code is correct gets deleted, so it now parses.

### Every link on the site was ignoring its own colour

Chasing the last contrast failure — Lighthouse reported **1.74:1** on the active
filter pill, white-ish text on emerald — turned up something much larger. The
token was right, the class was on the element, the rule was in the stylesheet,
and the colour was still wrong. Chrome settled it:

```
--es-text-on-accent  =  #09090b     (correct)
computed color       =  #f4f4f5     (--es-text, inherited)
```

**Cascade layers.** Tailwind v4 puts every utility in `@layer utilities`, and an
*unlayered* rule beats every layered rule regardless of specificity. `globals.css`
declared its base resets outside any layer, so:

```css
a { color: inherit; }        /* specificity (0,0,1) — and it won */
```

defeated `text-accent`, `text-muted` and `text-on-accent` on **every `<a>` in the
application**. The heading rule did the same to headings, killing `font-mono` and
every `tracking-*` written on one.

The base resets are now in `@layer base` and the `fx-*` primitives in
`@layer components`, which also fixes two call sites where `fx-stack
fx-stack--sm gap-1.5` had a dead utility on it. `.fx-debug-overflow` stays
unlayered on purpose — it is the one rule whose job is to beat everything.

Verified in a real browser with `scripts/_computed.js`, which reads
`getComputedStyle` over the DevTools protocol, because this is a class of bug
that is invisible to every other kind of test: the pill now computes `#09090b`
on `#34d399`, which is 10.35:1.

### `heading-order` on /events

`EventCard` hard-coded `<h3>`. Under the homepage's "On soon" `<h2>` that is
right; on `/events`, directly under the `<h1>`, it skips a level — which a screen
reader user hears as "something was missed", and goes back looking for a section
that does not exist. The level is now the caller's decision.

### Two more static checks, and the third one caught a real build break

```bash
node scripts/importantCheck.js   # !important, outside two argued exceptions
node scripts/encodingCheck.js    # UTF-8 BOMs and NUL bytes
node scripts/contrast.js --strict
```

**`!important` is zero, with two exceptions that are argued rather than
grandfathered**: the `prefers-reduced-motion` block, whose entire job is to beat
every animation declared anywhere — deleting those four to satisfy a line count
would be an accessibility regression dressed as a cleanup — and
`.fx-debug-overflow`, a devtools handle the app never applies. Adding a third
means editing the file and writing the reason down.

**`encodingCheck` exists because a BOM broke the build.** `Set-Content -Encoding
utf8` in PowerShell 5.1 writes UTF-8 *with* a BOM, and three invisible bytes in
front of `@import "tailwindcss"` produced this:

```
./src/app/globals.css:2:1  Parsing CSS source code failed
1 | (the tailwindcss banner comment)
```

— a line that is not in the file, because the import resolved with junk glued to
the front and the parser reported against the *generated* text. Fourteen other
source files turned out to have been carrying BOMs since earlier phases without
symptoms, because Node strips them from JavaScript. All stripped; the check now
fails the build on any of them.

### Four smaller accessibility fixes

- **Links inside sentences are underlined.** Colour alone does not mark a link
  in body text (WCAG 1.4.1) — `/contact` and `/login` both failed
  `link-in-text-block`. Standalone links in their own row do not need it and
  did not get it.
- **`Points` takes its heading level from the caller**, like `EventCard`. A grid
  under a titled band is `h3`; the one on `/why-us` sits directly under the
  `<h1>` and is `h2`.
- **The gate no longer disables zoom.** It carried `maximumScale: 1,
  userScalable: false` on the reasoning that a pinch-zoomed camera viewport is a
  missed scan. That does not survive the trade: it is a WCAG 1.4.4 failure that
  lands on exactly the person who needs to magnify a small screen in the dark,
  iOS has ignored it since Safari 10, and the cost it prevents is one accidental
  pinch.
- **`SiteHeader` checks the path in a wrapper**, above the component that calls
  `useAuth`. Returning null *after* the hook still ran it, so the gate was
  asking `/auth/me` on every load — a 401 it never used, logged to the console
  of a tablet that may have no signal. Hooks cannot be skipped; components can.

### Verified

Lighthouse 12, headless Chrome, against `next start` with the API up:

```
                    a11y   best-practices   SEO   CSP-blocked scripts
/                    100         96         100          0
/events              100         96         100          0
/e/[slug]            100         96         100          0
/how-it-works        100         96         100          0
/why-us              100         96         100          0
/trust               100         96         100          0
/contact             100         96         100          0
/login               100         96          63          0
/tickets/find        100         96         100          0
/gate                100        100          —           0
/gate/login          100        100          63          0
```

**Zero blocked scripts**, where `/events` alone had fourteen.

Two numbers in that table are correct rather than problems:

- **SEO 63 on `/login` and `/gate/login`** is the `is-crawlable` audit, and it
  fails *because robots.txt disallows them* — which is the intended behaviour
  from phase 8. A sign-in form has nothing to index and a device screen is not a
  page.
- **best-practices 96** is one console entry: `GET /auth/me` returns **401** for
  a signed-out visitor. That is correct HTTP for "who am I?" asked by nobody,
  the hook handles it, and changing a working auth contract to silence a console
  line is churn. The two gate pages score 100 because they no longer make the
  call at all.

A run that reports `NO_FCP`, or writes no report, is a headless flake under
load — it happened to four pages across these sweeps and every one of them
scored on a quiet re-run.

## Tests and static checks

Vitest + Testing Library, mirroring fancy's 45-file suite. Three checkers run
without a dev server or `node_modules`:

```bash
node scripts/responsiveCheck.js       # inert fx-* classes, fixed-column grids
node scripts/backtickInCssComment.js  # a backtick in a CSS comment is a parse error
node scripts/fileSizeCheck.js         # 500-line cap
node scripts/importantCheck.js        # !important, outside two argued exceptions
node scripts/encodingCheck.js         # UTF-8 BOMs and NUL bytes
node scripts/contrast.js --strict     # WCAG AA, every role × every ground × both themes
```

All six run as `npm run check`, with no dev server and no `node_modules`.

**Do not replace these with greps.** Audited in fancy on 2026-08-16: the grep
versions reported 9 inert classes and 21 fixed grids and **all 30 were false
positives** — `grep -A3` reads a child's `padding`, comments were never stripped,
and worst, `src --include=*.js` silently skips every `[slug]` route because both
bash and PowerShell read `[slug]` as a character class. The guest page, the RSVP
wizard and the ticket routes had never once been scanned.

On Windows the same trap lives in `Get-ChildItem -Include`. Use `-LiteralPath`,
or `Get-ChildItem -Recurse -File | Where-Object { $_.Extension -eq '.js' }`,
which never builds a glob.

## Gaps that block, and who closes them

| Gap | Impact | Fix |
|---|---|---|
| ~~**`events` has no image column and there is no upload route**~~ | — | **Closed 2026-09-05.** `cover_url` + `cover_path`, the public `event-media` bucket, and a two-step signed upload — `POST /events/:id/cover-upload` then `PUT /events/:id/cover`. The browser PUTs straight to the signed URL with a plain `fetch`, so it still holds no Supabase client. Verified end to end against live storage |
| ~~**`events` has no category**~~ | — | **Closed 2026-09-05.** `event_category`, thirteen values, exported once from `eventRules.js`. `GET /public/events?category=` filters; `GET /public/event-categories` serves the list so the browse page never hard-codes a copy |
| **`REVALIDATE_SECRET` is in `.env.example` and used by nothing** | The event page's cached payload ages out on a timer; a just-approved event reads 404 for a minute, and a cached miss is indistinguishable from a real one | Frontend: lift fancy's `api/internal/revalidate/route.js`. Backend: call it on publish, approve, suspend, cancel and price change. **Phase 0** |
| **94 test events are PUBLISHED in the live database** | They are in `/events`, on the homepage and — as of phase 8 — in `sitemap.xml`, which is an invitation for Google to index 94 pages called "Fulfilment Test" and "Gate Test". Found while counting sitemap entries: 104 URLs, 94 of them event pages, none real | Delete or unpublish them before the site is pointed at a live domain. They are leftovers from this project's own probes, so the call is the owner's; nothing in the code should decide it |
| **Stripe live is blocked on the platform profile** | Every checkout is refused until it is done | Not a code change — see `memory/stripe-live-blockers.md`. The checkout UI must render `STRIPE_NOT_CONNECTED`, `STRIPE_NOT_ACTIVE` and `STRIPE_NOT_CONFIGURED` as instructions, not as stack traces |
| **`sk_live_`, the Supabase service-role JWT and the database password sit in plaintext** in `ملف التقرير المالي eventsli/New Text Document.txt` | Any process or sync client on this machine can read a key that moves real money | Rotate the Stripe secret key and the service-role key, then keep them only in `backend/.env` |

## Harvest list — file by file

### From `events platform` — design only

| File | Action |
|---|---|
| `css/tokens.css` (305) | **port** → the whole of `globals.css`'s `:root`, purple remnants corrected |
| `css/motion.css` (504) | **port** → curves, durations, `prefers-reduced-motion` |
| `css/seating-chart.css` (575) | **read** → seat states, tier colours, legend |
| `css/venue-designer.css` (1377) | **read** → editor chrome, toolbars, handles |
| `css/mobile-ios.css` (920) | **read** → safe-area insets → `.fx-safe-*` |
| `css/light-theme.css`, `styles.css`, `theme.css`, `bridge.css`, `polish.css`, `landing-*.css` | **drop** — the seven-layer stack that created 366 `!important` |
| `index.html`, `events.html`, `event-detail.html`, `my-tickets.html`, `checkout-success.html`, `dashboard.html`, `admin.html`, `scanner.html`, `venue-designer.html` | **read as UX reference** — page inventory, section order, empty states, copy. No markup moves |
| `src/lib/seating-chart.js` (1185) | **read** → the render + hit-testing model. Its data layer (direct Supabase, `esm.sh` panzoom) is exactly what we are removing |
| `src/lib/vd-engine.js`, `vd-renderers.js`, `vd-seat-editor.js`, `vd-templates.js`, `vd-persistence.js` | **read** → editor behaviour: templates, row generation, seat numbering |
| `src/lib/price-breakdown.js` (307) | **read** → how the four money lines are shown to a buyer |
| `src/lib/wizard-*.js` | **read** → the create-event step order |
| `terms.html`, `privacy.html`, `merchant-agreement.html` | **port** → legal copy, re-checked against the BRD |
| `images/logo*.png`, `logo.svg`, `manifest.json` | **lift** — theme colour `#059669` already matches |
| `dist/`, `scratch/`, `Updates.txt`, `Build`, `bust_img_cache.py`, `gatekeeper_app/` | **drop** |

### From `fancy/frontend` — engineering

| File | Action |
|---|---|
| `AGENTS.md` | **port** — the conventions doc itself, edited to this product |
| `src/middleware.ts` | **port** — route guards, landing here as `src/proxy.ts` |
| `src/app/lib/breakpoints.js` | **lift** |
| `src/app/hooks/useMediaQuery.js`, `useModalA11y.js`, `useCountdown.js` | **lift** |
| `src/app/hooks/useAuth.js` | **port** — same shape, but `/auth/me` and no `org_id` in localStorage |
| `src/app/utils/apiClient.js` | **port** — cookie name, envelope unwrap, the 401-on-auth-page rule |
| `src/app/utils/toast.js`, `responseHelpers.js`, `timezone.js`, `phone.js`, `authErrors.js` | **lift** |
| `src/app/components/Toast*.js`, `ConfirmDialog.js`, `useConfirm.js`, `ErrorBoundary.js`, `BoundaryError.js`, `ImpersonationBanner.js`, `LogoutModal.js`, `OtpBoxes.js`, `PhoneNumberInput.js`, `CountryCodePhoneInput.js`, `CountryFlag.js`, `countries.js` | **lift** |
| `src/app/api/internal/revalidate/route.js` | **lift** — closes the `REVALIDATE_SECRET` gap exactly |
| `src/app/globals.css` (91KB) | **port the `fx-*` primitives only** — `.fx-section`, `.fx-gutter`, `.fx-container`, `.fx-grid`, `.fx-stack`, `.fx-row`, `.fx-scroll-x`, `.fx-break`, `.fx-truncate`, `.fx-min0`, `.fx-safe-*`. Fancy's colours stay behind |
| `scripts/responsiveCheck.js`, `backtickInCssComment.js` | **lift** with their tests |
| `vitest.config.mjs`, `test/setup.js` | **port** |
| `next.config.mjs` | **port** — headers and CSP, tightened |
| `src/app/dashboard/seating-map/page.js` (166KB) | **read only** — take the *ideas*: a fixed logical world with positions stored as percentages, `clampView`, one shared shape catalogue, single-ink print export. Never the file |
| `src/app/checkin/page.js`, `checkin-app/page.js` | **read** → the gate PWA's offline queue and camera handling |
| `src/app/components/templates/`, `guest/`, `shop/`, RSVP routes | **drop** — a different product |
| ~5,100 inline styles, `styled-jsx` | **drop** — fancy's own `AGENTS.md` documents both as liabilities |

## One rule carried over from this machine

PowerShell `.Replace()` on source files and `rm -rf node_modules` both **fail
silently here**. `paymentRoutes.js` was never created, checkout routes vanished
from `publicRoutes.js`, and route mounts went missing from `app.js` — with no
error in any output. Use the Write/Edit tools or a Python heredoc for source
edits, and verify state directly after any bulk install or delete.

# Frontend conventions

Ported from fancy's AGENTS.md, edited to this product. The rules that survived
are the ones that had already cost that codebase real bugs; the ones that
changed are noted with why.

## `.jsx` means it renders

**A file containing JSX is named `.jsx`. A file of pure logic is named `.js`.**
That is a departure from fancy, which names everything `.js`, and it is worth
the divergence.

Next compiles JSX out of a `.js` file without being told. Vitest does not: its
transform is oxc, which decides whether to accept JSX **from the file
extension**, so a component in a `.js` file fails to parse — and the error names
the *test* file, which is already `.jsx`, rather than the component it imported:

```
Failed to parse source for import analysis because the content contains
invalid JS syntax. If you are using JSX, make sure to name the file with
the .jsx or .tsx extension.
```

Two configuration routes were tried before this one. `plugin-react`'s `include`
already defaults to `/\.[tj]sx?$/`, so it was never the filter. Forcing
`esbuild: { loader: 'jsx' }` produced a worse failure — `RollupError: Parse
failure` — plus test timeouts. Naming the file for what it holds costs nothing
and cannot break when a dependency updates.

The split falls out cleanly: pages and components are `.jsx`, while
`utils/`, `lib/`, `hooks/`, `seatingGeometry.js`, `usePanZoom.js` and the
revalidate route handler are `.js`. `src/proxy.ts` is the single `.ts` file.

## Responsive layout

Layout comes from a small set of global classes in `src/app/globals.css`,
prefixed `fx-`. They exist so a component never writes its own padding,
container width or grid track count.

| Class | Replaces |
|---|---|
| `.fx-section` (+ `--xs/--sm/--lg`, `--tight-bottom`, `--flush-top/-bottom`) | `padding: "Npx 48px"` on a section |
| `.fx-gutter` | horizontal page padding only |
| `.fx-container` (+ `--xs … --wide`, `--full`) | `maxWidth` + `margin: '0 auto'` |
| `.fx-grid` (+ `--2 … --6`, `--fill`, `--gap-sm/-lg`) | `gridTemplateColumns: 'repeat(N, 1fr)'` |
| `.fx-stack`, `.fx-row` (+ `--between/--center/--gap/--scroll`) | ad-hoc flex column / wrapping flex row |
| `.fx-scroll-x` | content that genuinely cannot reflow (wide tables, the seat map) |
| `.fx-break`, `.fx-truncate`, `.fx-min0` | long unbreakable tokens; flex/grid children that will not shrink |
| `.fx-safe-*` | `position: fixed` elements under the notch or the home indicator |

### The one rule that matters

**A class can never beat an inline style.** Adding `className="fx-section"`
while leaving `style={{ padding: "100px 48px" }}` in place does not error, does
not warn, and does not change anything at any viewport — the class is simply
inert. Migrating means **deleting** the inline `padding` / `maxWidth` /
`margin` / `gridTemplateColumns` / `gap` keys and keeping every other key
exactly as it was.

Do **not** add `!important` to the `.fx-*` classes to work around this. Winning
over inline styles would mean applying `.fx-section` to an element with
deliberate asymmetric padding silently destroys it — trading a loud, greppable
failure for a quiet visual one. `scripts/responsiveCheck.js` fails the build
instead.

### Breakpoints

Four, and only four — Tailwind v4's defaults:

| | width | max-width form |
|---|---|---|
| `sm` | 640px | `639.98px` |
| `md` | 768px | `767.98px` — the mobile↔desktop line |
| `lg` | 1024px | `1023.98px` |
| `xl` | 1280px | `1279.98px` |

`.98` rather than a whole pixel: at fractional CSS-pixel widths (browser zoom,
Windows display scaling, iOS pinch) a 1px gap between a `min-width: 768px` rule
and a `max-width: 767px` one leaves a band where neither matches.

- **JS:** `src/app/lib/breakpoints.js` (`BREAKPOINTS`, `up`, `down`, `between`)
  or the hooks in `src/app/hooks/useMediaQuery.js`.
- **`globals.css`:** `@media (width >= theme(--breakpoint-md))`.

A custom property **cannot** appear in a media condition — `@media (max-width:
var(--bp-md))` is invalid CSS and is dropped in silence.

Never introduce a fifth value. The platform this replaced ran twelve — 480, 560,
600, 640, 700, 768, 860, 900, 950, 992, 1024, 1100 — because every stylesheet
invented its own.

### Proving a layout fits

Verification is arithmetic, not a browser. Inside an `.fx-section` the available
inline space is `V − 2 × padX(V)`:

```
320px viewport → 280.0px available   ← the binding constraint
360px          → 317.7px
390px          → 345.9px
```

| Construct | min-content width |
|---|---|
| block box | `border-x + padding-x + max(MCW children)` |
| explicit `width`/`minWidth: W` | `W` — a hard floor overriding everything below |
| `repeat(N, 1fr)` | `N × max(MCW item) + (N−1) × gap` |
| `.fx-grid` | `max(MCW item)` — track sizing contributes **zero** |
| flex `nowrap` | `Σ MCW(children) + (N−1) × gap` |
| flex `wrap` / `.fx-row` | `max(MCW children)` |
| text | longest unbreakable run ≈ `0.55 × fontSize × chars` |
| text with `.fx-break` | ≈ 1 character |
| `<table>` | `Σ per-column MCW` — unbounded; always needs `.fx-scroll-x` |
| anything inside `.fx-scroll-x` | 0 |

A fixed 3-column grid of cards with 24px padding needs each card's content to
have an MCW of ≤29px to fit 320px; a 2-column one needs ≤56px. Neither is
achievable. **Fixed-column grids do not fit phones — use `.fx-grid`.**

`overflow-wrap: break-word` prevents *visual* overflow but does **not** reduce
an element's min-content contribution. Only `.fx-break` (`anywhere`) does.

### Horizontal overflow

`html { overflow-x: clip }` in `globals.css` is a **guard, not a fix** — it
hides overflow rather than removing it, and hidden overflow is *unreachable*,
not scrollable. Do not move it to `body`: declaring it there makes `<body>` a
scroll container on phones, which breaks `position: sticky` and every `100dvh`.
To find what it hides, add `class="fx-debug-overflow"` to `<html>` in devtools.

## React 19 rules the linter enforces

These are errors, not style. Each one was hit while building phase 1.

- **No `setState` in an effect body.** Write the fetch as an inline
  `async` IIFE so every `setState` lands after an `await`; a synchronous one is
  a render the component immediately throws away. Guard with a `cancelled` flag
  so a late response cannot overwrite newer data.
- **No impure calls during render.** `Date.now()` in a component body can
  produce two different results for the same render. Derive the value in a hook
  and pass it down — `HoldBar` takes `remaining` for exactly this reason.
- **No ref writes during render.** Assign in an effect; a render can be
  discarded or replayed.
- **Resetting state when a prop changes** is done *during* render, not in an
  effect — set state while rendering and React re-runs the component before it
  paints. The effect version paints the stale value first, which on a seat map
  is a visible jump.

## A cached miss is stored exactly like a cached hit

Next prerenders a static page at **build time** and caches whatever that render
produced — including a failure. Our builds talk to no API on purpose (CI points
the build at an unreachable one, to prove pages degrade rather than crash), so
every page that fetches and falls back will bake its fallback into the build
output and serve it for the whole revalidate window.

Two rules follow, and both were learned by shipping the bug:

- **A page whose fallback would be actively misleading must not be static.**
  `/terms` was `revalidate = 3600` and served "We could not load the terms just
  now" for an hour — a legal document, behind a *required* checkbox on the
  checkout. It is `dynamic = 'force-dynamic'` now. Rarely visited, must never be
  wrong: the trade is obvious once stated.
- **A fallback must say who failed.** The homepage's empty state read "Nothing
  is on sale just yet", which is a claim about the business. When the fetch
  throws it now says "We could not load events just now", which is a claim about
  us. The listing and the homepage both carry a `failed` flag for this.

Short windows self-heal and are fine — `/e/[slug]` and the listings sit at 60s
and correct themselves on the first request after deploy. An hour does not.

## Static checks

No dev server and no `node_modules` required.

```bash
npm run check     # all three
node scripts/responsiveCheck.js       # inert fx-* classes, fixed-column grids
node scripts/backtickInCssComment.js  # a backtick in a CSS comment is a parse error
node scripts/fileSizeCheck.js         # 500-line cap, warns
```

**Do not replace these with greps.** Audited on the codebase they came from:
the grep versions reported 9 inert classes and 21 fixed grids and **all 30 were
false positives**, while silently skipping about twenty files. `grep -A3` reads
a child's `padding`; comments were counted as code; and worst,
`src --include=*.js` skips every `[slug]` route, because both bash and
PowerShell read `[slug]` as a character class. Here that would mean the event
page, the seat map, the checkout and the ticket — every page that takes money.

On Windows `Get-ChildItem -Include` has the same blind spot. Use `-LiteralPath`,
or `Get-ChildItem -Recurse -File | Where-Object { $_.Extension -eq '.js' }`,
which never builds a glob.

`responsiveCheck` has its own test asserting it still catches a known-bad
fixture — a checker reporting "clean" because it broke is the failure mode it
was written to replace, and "clean" is what you were hoping to see.

## The seat map

`components/seating/seatingGeometry.js` is the **only** definition of the shape
catalogue and the coordinate system. It is imported by the buyer's map, the
editor and the print export, and `seatingGeometry.test.js` fails if any other
file under `src/` declares its own shape list or seat size.

That test is not paranoia. In the codebase this pattern came from, the same
catalogue existed in three places and the copies drifted: a guest saw a buffet
table drawn as a round one, and the print path read a coordinate as a centre
where the editor had written a corner, scattering the map. Neither bug is
visible in the view you happen to be looking at.

Positions are **percentages of a logical world**, which is what
`tables.position_x NUMERIC(6,3)` means in the base schema. The organizer lays
out on a 27-inch monitor, the buyer opens on a 375px phone, the door staff print
on A4 — a pixel coordinate is correct in exactly one of the three.

## Money

`utils/money.js` **formats only**. It has no add, no multiply and no percentage,
and a test asserts the module exports nothing else. Every total comes from
`GET /public/reservations/:id/quote`, computed server-side where the four fee
items are reconciled against what Stripe actually bills.

`parseFloat("19.99") * 100` is `1998.9999999999998`.

## Errors

Switch on `error.code`, **never** on `error.message`. `utils/errors.js` maps
every code in `backend/utils/responseEnvelope.js` to a title, a recovery and a
tone; a test reads that backend file off disk and fails if either side gains a
code the other lacks. An unmapped code falls back to the server's message *and
logs a warning* — silence is how a code stays unmapped for months.

## The CSP carries a nonce, and that is load-bearing

`config/csp.mjs` builds the policy; **`proxy.ts` issues it**, per request, with a
nonce. Do not add a `Content-Security-Policy` to `next.config.mjs` — two CSP
headers are enforced as their *intersection*, so a nonce-free copy would block
the very scripts the nonce exists to allow.

**Why a nonce at all**: the App Router streams React's payload inside inline
`<script>` tags. Under `script-src 'self'` with no nonce every one is refused —
the server HTML renders perfectly and *nothing hydrates*. It only happens under
`next start`, so it is invisible in development and in every test.

That is why `dynamic = 'force-dynamic'` is declared in the root layout. A
prerendered page has no render at request time, so its scripts carry no nonce.
Do not "optimise" it back to static.

## Everything in globals.css belongs to a layer

Tailwind v4 puts utilities in `@layer utilities`, and **an unlayered rule beats
every layered rule regardless of specificity**. Base resets go in `@layer base`,
the `fx-*` primitives in `@layer components`. Write a rule outside both and it
silently defeats every utility written beside it in a component.

That is not hypothetical: `a { color: inherit }` sat unlayered and made
`text-accent`, `text-muted` and `text-on-accent` inert on **every link in the
app**. Nothing failed — the colour was just the inherited one.

`.fx-debug-overflow` is the only intentional exception; beating everything is its
job.

## Colour comes from a role, and the roles are measured

`node scripts/contrast.js` computes WCAG ratios for every text role against every
ground in both themes, **reading globals.css** rather than a copy. It runs in
`npm run check` with `--strict`. If you change a colour token, that is the thing
that tells you whether you may.

Never reach past a role for a ramp value in a component. The roles are where the
contrast guarantee lives.

## Routes, robots and the sitemap

`lib/siteRoutes.js` is the one list. `sitemap.js`, `robots.js` and `SiteFooter`
all read it, and `test/seoRoutes.test.js` walks `src/app` and fails on a page
that is in neither `PUBLIC_PAGES` nor `PRIVATE_PREFIXES`. **Adding a page means
deciding whether it is public** — that is the point of the failure, not a chore.

`/t/[token]` is the one that matters: a ticket URL carries the signed admission
token, so a crawler fetching one puts a credential in a log. Every private prefix
is emitted twice in robots.txt — `/x/` for the subtree and `/x$` for the page —
because a bare `/t` also matches `/terms`, and `/login/` does not match `/login`.

**A page's `openGraph` REPLACES the layout's.** It does not merge. A page that
declares one and omits `images` ships with no share card at all, and nothing
errors — the only place it shows is somebody else's chat window. A test fails any
page that declares `openGraph` without `images`.

## The gate

`src/app/gate/` is the door scanner. Four rules, all of them load-bearing:

**A refusal is a 200.** `check_in_ticket` returns `duplicate` with the time of
the first scan *inside a success envelope*, because it is a decision, not a
failure. Never render one as a network error with a retry button. The only 403
is `SCANNER_LOCKED`, and it stops the camera.

**A scan result is not an error code.** It arrives in a field called `result`,
so it misses `utils/errors.js` entirely. `gate/scanOutcome.js` is its table, and
`test/gateOutcomes.test.js` reads the check-in SQL and `scanService.js` off disk
the same way the error test reads the envelope. Only `admitted` opens a door —
an unrecognised result is refused, loudly.

**Every scan carries an id the DEVICE made**, before anything is sent. That is
what makes re-uploading a queue return the *original* answers instead of a wall
of duplicate refusals, and it is why a failed upload can be retried blindly. A
record leaves the queue only when the server has answered it — not when the
request is sent.

**The rules live in `queuePolicy.js`, on plain arrays.** `scanQueue.js` is a
thin IndexedDB adapter under it. Put new queue behaviour in the pure file; it is
where the tests are, and where an admission gets lost.

Two smaller things worth knowing: `.fx-gate` pins the dark palette by riding on
the existing `[data-theme="dark"]` selector rather than copying it, and
`public/gate-sw.js` is registered with `scope: '/gate'` and in production only —
it never touches the storefront, and it never caches `/api/`.

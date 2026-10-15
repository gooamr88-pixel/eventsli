# Dependency advisories

`npm audit --audit-level=moderate` blocks CI. The tree is clean at that level
and this file is how it stays clean: when an advisory lands in a transitive
dependency and upstream has not shipped a fix, it gets an `overrides` entry in
the **root** `package.json` and an entry here saying why. Lowering the CI
threshold is not an option — a gate that moves whenever it fires is not a gate.

`overrides` only works from the workspace root. An `overrides` block in
`backend/package.json` is read by nobody and fixes nothing, which is easy to
miss because npm reports no error for it.

## Current overrides

| Package | Pinned to | Advisory | Why an override |
|---|---|---|---|
| `qs` | `^6.16.0` | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) — array-limit bypass via bracket-key comma parsing; [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) — DoS via attacker-controlled `isBuffer` | Reached through `express → body-parser → qs`. Express 4.22.2 is the last 4.x release and still depends on an affected range, so there is no version of Express to upgrade to. 6.16.0 is a patch-level move from 6.15.3 with no API change. |

Both advisories are in the query-string parser that sits in front of every
route, so this is not a theoretical one — `qs` parses attacker input on the
first line of every request.

## Resolved by removal, not by pinning

`exceljs` carried the only other advisory
([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
through `uuid`). npm's own remedy was `exceljs@3.4.0` — a *downgrade* across a
major version — and the alternative was pinning `uuid` forward across three
major versions to satisfy a package we do not call.

It turned out nothing in the codebase imports `exceljs`. It was a declared
dependency with no call site, so it was removed, and `uuid` left the tree with
it. Worth stating plainly because the reflex is to reach for an override: check
whether the dependency is load-bearing first. An unused dependency is not a
vulnerability to be managed, it is weight to be dropped.

`qrcode` was in the same state — declared, never imported — but that one was a
*missing* implementation rather than dead weight: the ticket email was pointing
its `<img>` at a public QR-generating service with the signed admission token in
the query string. It is now wired up and renders the codes locally. See
`controllers/ticketController.js → qrImage`.

## 2026-10-15 — production clean, eight dev-only advisories open

`npm audit --omit=dev` is **0** after this pass. Before it, what ships carried:

| Package | Was | Now | Advisory | Exposure here |
|---|---|---|---|---|
| `next` | 16.3.4 | **16.3.8** | RCE in `next/og` (critical); SSRF in image optimisation (high); ISR cache poisoning in self-hosted apps (moderate ×2); metadata-route and dev-MCP disclosure | `next/og` is not used. Image optimisation and self-hosted ISR are both used, so the SSRF and cache-poisoning fixes matter. Patch release inside 16.3. |
| `eslint-config-next` | 16.3.4 | **16.3.8** | — | Kept in step with `next`. |
| `compression` | 1.8.1 | **1.8.2** | DoS via memory leak on premature close (high) | Wraps every API response. |
| `proxy-addr` | 2.0.7 | **2.0.8** | IP spoofing via IPv4-mapped IPv6 trust subnet (critical) | Express's `trust proxy`; this API trusts a hop count, not a subnet, but the fix is a patch. |
| `sharp` | 0.35.4 | **0.35.5** | librsvg CVE (high) | next/image's optimiser. |
| `source-map-js`, `brace-expansion` | — | patched | DoS (high) | Build/tooling paths; updated within range. |

**Resolved by removal:** `nodemon` (and with it `chokidar` → `braces`). It was
only `npm run dev` for the backend; Node 22's built-in `node --watch` does the
same job, so the script uses that now.

**Note on upgrading next here.** npm placed 16.3.8 at the ROOT `node_modules`
rather than under `frontend/`, after refusing for several runs to move off the
nested 16.3.4 entry (it rewrote the manifest back to 16.3.4 — the "up to date"
trap above, in a new shape). `ecosystem.config.js` started the frontend from
the literal `frontend/node_modules/next/...` path, which would no longer exist
on the server after `npm install`; it now resolves next's CLI the way Node does.

### Still open — dev tooling only, never shipped

| Chain | Advisory | Why it is still here |
|---|---|---|
| `vitest` 3.2.7 → `tinypool`, `@vitest/mocker` | prototype-pollution gadget in worker options (critical); path traversal via a redirect mock (moderate) | Fixed only in vitest **≥ 4.1.11** — a MAJOR upgrade of the runner behind ~600 frontend tests. Exploitable only by test code or test config, which is ours. Owner decision: upgrade the runner, or accept. |
| `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` | stack-exhaustion DoS on deeply nested glob patterns (high) | **No fixed `braces` exists** (3.0.3 is the latest and is affected), so no override can help. The patterns are eslint's own config globs, not input. |

CI's `npm audit --audit-level=moderate` therefore still fails on these eight.
Two ways to make it green, both the owner's call: upgrade vitest to 4.1.11+
(and wait for `braces`), or gate CI on `npm audit --omit=dev` — what ships —
with the dev-only list kept here.

## Adding one

1. Confirm there is genuinely no upstream fix — check whether the direct
   dependency has a newer release first, and prefer upgrading it. Then check
   whether anything actually imports it.
2. Add the pin to `overrides` in the root `package.json`.
3. `rm -rf node_modules package-lock.json && npm install`. A plain `npm install`
   frequently reports "up to date" and applies nothing; verify with
   `node -e "console.log(require('<pkg>/package.json').version)"` rather than
   trusting the output. On Windows `rm -rf node_modules` can fail silently on a
   locked file and leave the old tree in place, which looks exactly like an
   override that does not work.
4. If the pin crosses a major version, add or extend a test that exercises the
   dependent's real code path.
5. Add a row above, with the advisory link and what makes the pin safe.

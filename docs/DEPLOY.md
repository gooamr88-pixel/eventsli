# Deploying Eventsli

Target: the Hostinger VPS at `187.77.1.72` (`srv1603748`), Ubuntu 24.04 LTS.
App root: `/var/www/eventsli`. Public host: `https://eventsli.com`.

## This box is shared, and that shapes everything below

Eventsli is the **third** application on it. Two were there first and nothing in
this guide may disturb them:

| What | Where | Ports |
|---|---|---|
| `fancy-rsvp` | `/var/www/fancy` | 3000 (frontend), 5000 (backend, 2 cluster workers) |
| `roya-platform` | `/var/www/roya-platform` | 5001 |
| **`eventsli`** | **`/var/www/eventsli`** | **3100 (frontend), 5100 (backend)** |

Both Eventsli processes run in **fork** mode, not cluster. That is not a
preference — pm2 records `interpreter` on a cluster app and then ignores it,
because cluster workers are spawned by the God process with `cluster.fork()`
and inherit the *daemon's* Node. The daemon is on the system's 20.20.2, so a
clustered API would silently run on Node 20 while `pm2 describe` claimed
otherwise. The tell is in the log: `@supabase/supabase-js` prints a "Node.js 20
and below are deprecated" warning on every boot.

Everything runs under one `pm2` daemon as **root**, and nginx fronts all of it.

Four things follow, and each is a command this guide deliberately does **not**
contain:

- **No `ufw` changes.** The firewall is already active and correct: 22, 80/443,
  and 5001. Eventsli's 3100 and 5100 are never opened — they are reachable only
  over loopback, through nginx, which is what you want.
- **No global Node upgrade.** The system node is 20.20.2 and the other two
  projects run on it. Eventsli gets its own Node 22 (step 1).
- **No touching `sites-enabled/` beyond the one `eventsli` file.** In particular
  `reject-all` is the `default_server` answering anything not matching a known
  hostname with `444`. Leave it — it is why hitting the bare IP closes the
  connection.
- **No new system user.** `pm2` already runs as root for the other apps. A
  separate user would need a second pm2 daemon and its own startup unit.
  Consistency with the box wins; the honest cost is that a remote-code bug in a
  dependency lands as root rather than in one directory.

---

## Before you touch the server

### 1. Point the DNS back at this box

`eventsli.com` currently resolves to `2.57.91.91` — **Hostinger's parking page**
(`Server: hcdn`), not this VPS. Nothing works until that changes.

In **hPanel → Domains → eventsli.com → DNS**. These are records in a web form,
not shell commands:

```
Type   Name    Value
A      @       187.77.1.72
A      www     187.77.1.72
```

If the domain has Hostinger **CDN** or **website parking** on, turn it off —
port 80 must reach this box directly or certificate renewal fails.

Confirm before step 6:

```bash
dig +short eventsli.com        # must print 187.77.1.72
```

### 2. The Stripe live webhook

Dashboard → Developers → **Webhooks** → endpoint at
`https://eventsli.com/api/v1/payments/webhook`, events:
`checkout.session.completed`, `checkout.session.expired`,
`payment_intent.payment_failed`, `charge.refunded`, `account.updated`.

Its **Signing secret** is `STRIPE_WEBHOOK_SECRET`. A `whsec_` from
`stripe listen` is a CLI-local secret that rejects every production event — the
symptom is buyers charged with no ticket.

### 3. Rotate the keys that have been sitting in plain text

The live Stripe key, the Supabase `service_role` JWT and the database password
have been in a Desktop folder for weeks. That folder is now excluded from git,
which stops it spreading further; it does not undo where it has been.

Doing this **before** step 3 means writing `.env` once. After means writing it
twice, with a reload in between:

```bash
nano /var/www/eventsli/backend/.env
pm2 reload eventsli-backend --update-env
```

---

## 1. Node 22, for this app only

`@supabase/supabase-js` declares `node >=22`, and it is the library the whole API
reaches the database through. Node 20 also left support in April 2026, so it
receives no security patches — not a runtime for something that moves money.

Install with `nvm` so the system node stays 20 for `fancy` and `roya`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 22
```

Then expose it at a **stable** path. `ecosystem.config.js` looks for exactly this
symlink and falls back to pm2's own interpreter when it is absent, so the
version-specific nvm path never has to be committed:

```bash
ln -sfn "$(nvm which 22)" /usr/local/bin/node22
/usr/local/bin/node22 -v          # expect v22.x
```

Confirm nothing moved for the other projects:

```bash
node -v                            # still v20.20.2
pm2 list                           # fancy and roya still online
```

---

## 2. The code

```bash
mkdir -p /var/www/eventsli
git clone https://github.com/gooamr88-pixel/eventsli.git /var/www/eventsli
cd /var/www/eventsli

# npm from the Node 22 install, so anything native builds against the right ABI
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
npm install
mkdir -p logs
```

---

## 3. The two `.env` files

They are not in the repository and must never be. Create them here.

### `/var/www/eventsli/backend/.env`

```ini
PORT=5100
NODE_ENV=production

FRONTEND_URL=https://eventsli.com,https://www.eventsli.com
BACKEND_URL=https://eventsli.com

# Generate FRESH on this server, three DIFFERENT values:
#   openssl rand -base64 48
JWT_SECRET=
QR_JWT_SECRET=
IP_HASH_SALT=

SUPABASE_URL=https://qvoyxwszojwyyelsjskm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

PAYMENTS_STRIPE_ENABLED=true
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_CLIENT_ID=
STRIPE_FEE_PCT=2.9
STRIPE_FEE_FIXED_CENTS=30

DEFAULT_COMMISSION_PCT=1.5
DEFAULT_COMMISSION_TAX_PCT=0
DEFAULT_PAYMENT_FEE_PCT=2.9
DEFAULT_PAYMENT_FEE_FIXED_CENTS=30

RESERVATION_TTL_MINUTES=35
DEFAULT_MAX_TICKETS_PER_ORDER=10
MANUAL_INVOICE_DUE_DAYS=7
MANUAL_INVOICE_MIN_HOURS_BEFORE_EVENT=24

BREVO_API_KEY=
BREVO_FROM_EMAIL=info@eventsli.com
BREVO_FROM_NAME=Eventsli

GOOGLE_CLIENT_ID=652713460612-t771u7c092ci6i1dcilfcif8t63c3oe5.apps.googleusercontent.com

# Venue search in the create-event wizard. OPTIONAL — blank means the venue
# field stays a plain text input and nothing breaks. Server-side only: the
# browser never talks to Google, it calls /api/v1/places on this API.
# Google Cloud → billing on → enable "Places API (New)" → create a key →
# restrict it to that one API and to this server's IP.
GOOGLE_PLACES_API_KEY=

# openssl rand -hex 32 — the SAME value goes in frontend/.env
REVALIDATE_SECRET=

LOG_LEVEL=info
SCHEDULER_ENABLED=true
```

`JWT_SECRET` and `QR_JWT_SECRET` must **differ**: a leaked ticket-signing key
must not also mint logins.

### `/var/www/eventsli/frontend/.env`

```ini
NEXT_PUBLIC_API_URL=https://eventsli.com/api/v1
INTERNAL_API_URL=http://127.0.0.1:5100/api/v1

REVALIDATE_SECRET=<character-for-character identical to the backend's>

NEXT_PUBLIC_SITE_URL=https://eventsli.com
NEXT_PUBLIC_SUPABASE_URL=https://qvoyxwszojwyyelsjskm.supabase.co
NEXT_PUBLIC_GOOGLE_CLIENT_ID=652713460612-t771u7c092ci6i1dcilfcif8t63c3oe5.apps.googleusercontent.com
```

```bash
chmod 600 /var/www/eventsli/backend/.env /var/www/eventsli/frontend/.env
```

> **`NEXT_PUBLIC_*` is compiled in, not read at runtime.** These are baked into
> the JavaScript by `next build`, so the file must be right *before* you build.
> Change one and you must rebuild — a restart is not enough.
> `NEXT_PUBLIC_SUPABASE_URL` is stricter: `next.config.mjs` **refuses to build**
> without it, because it is compiled into the image allowlist and the CSP, and a
> build without it ships a site where every event cover is silently blocked.

---

## 4. Database

Schema lives in `supabase/migrations/`, applied in filename order — from the
Supabase SQL editor, or here:

```bash
cd /var/www/eventsli/backend
node scripts/apply-migration.js ../supabase/migrations/<file>.sql
node scripts/verify-schema.js      # reports what the live DB actually has
```

---

## 5. Build and start

```bash
cd /var/www/eventsli
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22

npm run build --workspace=frontend
pm2 start ecosystem.config.js
pm2 save
```

`pm2 startup` is already configured on this box for the other apps, so `pm2 save`
is enough to bring Eventsli back after a reboot.

Check before touching nginx:

```bash
pm2 list                                  # the 4 existing + 3 new, all online
curl -s localhost:5100/api/v1/public/event-categories | head -c 200
curl -sI localhost:3100 | head -1
pm2 logs eventsli-backend --lines 30 --nostream
```

---

## 6. nginx

The existing `/etc/nginx/sites-available/eventsli` is **dead** — it serves a
static site from `/var/www/eventwaw`, a directory that does not exist. It is the
old platform this project replaces. Back it up, then replace it:

```bash
cp /etc/nginx/sites-available/eventsli /etc/nginx/sites-available/eventsli.old
nano /etc/nginx/sites-available/eventsli
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name eventsli.com www.eventsli.com;
    return 301 https://$host$request_uri;
}

server {
    # `listen … http2`, not the standalone `http2 on;` directive — that one
    # arrived in nginx 1.25.1 and this box runs 1.24.0, where it fails the
    # config test with `unknown directive "http2"`.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name eventsli.com www.eventsli.com;

    # Already issued and valid — certbot has run for this domain before.
    ssl_certificate     /etc/letsencrypt/live/eventsli.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eventsli.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ecdh_curve      secp384r1;
    ssl_prefer_server_ciphers on;

    # A cover image is the largest thing anyone uploads.
    client_max_body_size 6M;

    # ── DO NOT ADD SECURITY HEADERS HERE ───────────────────────────────────
    # The app sets its own CSP, HSTS and Permissions-Policy per response, and
    # the CSP carries a PER-REQUEST NONCE. Two CSP headers are enforced as
    # their INTERSECTION, so a nonce-free one added here blocks the inline
    # scripts React needs — the site renders perfectly and nothing works.

    location /api/ {
        proxy_pass http://127.0.0.1:5100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # Rate limits and audit rows key on the client address. Without this
        # every request looks like 127.0.0.1 — one rate-limit bucket for the
        # whole internet, and a useless audit log.
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Stripe signs the RAW body. Buffering or rewriting it breaks signature
    # verification, and the symptom is paid orders that are never fulfilled.
    location = /api/v1/payments/webhook {
        proxy_pass http://127.0.0.1:5100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3100;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # The gate's service worker. Never cached by a proxy, or a tablet at a door
    # keeps running last month's build with no way to update it.
    location = /gate-sw.js {
        proxy_pass http://127.0.0.1:3100;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

The symlink in `sites-enabled/` already exists, so:

```bash
nginx -t && systemctl reload nginx
```

`nginx -t` checks **every** site on the box. If it fails nothing reloads and the
other projects keep serving — which is why it runs before the reload, not after.

---

## 7. Verify

### Testing before DNS has moved

`--resolve` forces the connection to this box while still sending
`eventsli.com` as the hostname — so nginx picks the right server block and the
certificate matches. It tests the entire stack without waiting for a DNS change
to propagate, and it is how the first deployment was verified while the domain
still pointed at Hostinger's parking page:

```bash
R="--resolve eventsli.com:443:127.0.0.1"
curl -sI $R https://eventsli.com/ | head -3
curl -sI $R https://eventsli.com/ | grep -i content-security-policy
curl -s  $R https://eventsli.com/api/v1/public/event-categories | head -c 100
curl -s  $R https://eventsli.com/robots.txt | head -5
curl -s  $R https://eventsli.com/sitemap.xml | grep -c "<loc>"
curl -sI $R https://eventsli.com/og-default.png | head -1
```

Drop the `$R` once DNS points here — the same commands then test the real path.

### Each of these has caught a real failure in this project

```bash
# 1. Through nginx, not just loopback
curl -s https://eventsli.com/api/v1/public/event-categories | head -c 200

# 2. THE IMPORTANT ONE. If `nonce-` is missing, the site renders and NOTHING
#    on it works — no seat map, no checkout, no sign-in state.
curl -sI https://eventsli.com/ | grep -i content-security-policy

curl -sI https://eventsli.com/ | grep -i strict-transport
curl -s  https://eventsli.com/robots.txt | head -5
curl -s  https://eventsli.com/sitemap.xml | grep -c "<loc>"
curl -sI https://eventsli.com/og-default.png | head -1

# 3. The other two projects are untouched
curl -sI https://fancyrsvp.com | head -1
curl -sI https://nabda-capital-group.com | head -1
```

Then in a browser with devtools open:

- **`/`** — the console must have **no CSP violations**. One
  `GET /auth/me 401` for a signed-out visitor is expected and correct.
- **`/events`** → an event → choose seats → reach the checkout.
- **`/gate/login`** — sign a device in and scan one real ticket.
- **A real card purchase, refunded after.** Nothing else proves the webhook
  secret is right, and a wrong one means charged buyers with no tickets.

---

## Updating

```bash
cd /var/www/eventsli
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
git pull
npm install
npm run build --workspace=frontend
pm2 reload ecosystem.config.js --update-env
pm2 logs eventsli-backend --lines 30 --nostream
```

`reload`, not `restart` — workers are replaced one at a time, so requests in
flight are not dropped. Rebuild after changing any `NEXT_PUBLIC_*`. Apply
migrations **before** reloading.

### Rolling back

```bash
cd /var/www/eventsli
git log --oneline -5
git checkout <previous-sha>
npm install && npm run build --workspace=frontend
pm2 reload ecosystem.config.js --update-env
```

A migration does not roll back with the code. If the release had one, decide
deliberately whether to reverse it.

---

## Before real traffic

**Delete the 94 test events** published in the database — "Fulfilment Test",
"Gate Test", "Manual Test". They are on the homepage, in `/events`, and in
`sitemap.xml`, which invites Google to index 94 pages that are not real. They
are leftovers from this project's own probes.

Optional but cheap: this box has **no swap** and two cores. `next build` is the
memory-hungry step and currently succeeds with ~4.5 GB free — but a future build
competing with the other projects would be killed by the OOM reaper, which looks
like a build that stops with no error.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Page renders, nothing interactive | CSP has no nonce. `curl -sI` and look for `nonce-`; check nginx adds no CSP of its own |
| `next build` fails on `NEXT_PUBLIC_SUPABASE_URL` | Working as designed — `frontend/.env` missing or unreadable |
| Every request refused with CORS | `FRONTEND_URL` is missing a hostname; it needs both apex and `www` |
| Covers blocked, page otherwise fine | Built with the wrong `NEXT_PUBLIC_SUPABASE_URL`. Fix and **rebuild** |
| Paid orders never fulfilled | `STRIPE_WEBHOOK_SECRET` is the CLI's, not the live endpoint's |
| A new event 404s for a minute | `REVALIDATE_SECRET` differs between the two `.env` files |
| Rate limits trip immediately | `X-Forwarded-For` missing from the nginx block |
| `EADDRINUSE` on start | Something else took 3100/5100 — `ss -tlnp \| grep -E ':(3100\|5100)'` |
| pm2 starts on the wrong Node | `/usr/local/bin/node22` is missing, so `ecosystem.config.js` fell back to pm2's interpreter. Recreate the symlink, `pm2 delete eventsli-backend eventsli-frontend`, start again |
| Certificate renewal fails | DNS is not pointing here. `dig +short eventsli.com` must be `187.77.1.72` |

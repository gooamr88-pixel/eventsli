# Deploying Eventsli to the Hostinger VPS

Ubuntu 22.04/24.04, one box, two Node processes behind nginx.
`eventsli.com` → nginx → Next.js on :3000, and `/api/*` → the API on :5000.

> **Read this first.** Three things in this guide are not optional and are the
> ones that break a launch: the Stripe **live webhook secret** (the value in
> your notes is a `stripe listen` CLI secret and will reject every production
> event), `REVALIDATE_SECRET` being **identical** in both `.env` files, and
> `NEXT_PUBLIC_*` being present **at build time** rather than only at runtime.

---

## Before every push

```bash
npm run secrets      # nothing git would commit carries a live credential
npm run preflight    # the above, plus checks, lint, both test suites, the build
```

`npm run secrets` asks **git** which files it would commit — not the filesystem
— so `backend/.env` existing on your machine is fine and `backend/.env` being
tracked is a hard stop. A leaked `sk_live_` key is not fixed by deleting the
file afterwards: GitHub keeps the history and bots scrape new pushes within
seconds, so it has to be rotated.

---

## 0. Before you touch the server

### Rotate the keys that have been sitting in plain text

`ملف التقرير المالي eventsli/New Text Document.txt` holds the live Stripe secret
key, the Supabase `service_role` JWT and the database password. That file is on
a laptop, in a folder that syncs, and has been for weeks. It is now excluded
from git (`.gitignore`, verified with `git check-ignore`), which stops it
spreading further — it does not undo where it has already been.

Rotate all three, then put the new values only in `backend/.env` on the VPS:

| Key | Where | What breaks until you update `.env` |
|---|---|---|
| `sk_live_…` | Stripe → Developers → API keys → **Roll** | Every payment |
| `service_role` JWT | Supabase → Settings → API → **Reset** | The whole API |
| Database password | Supabase → Settings → Database | Migration scripts only |

The **publishable** key (`pk_live_…`), the Google client ID and the Supabase
project URL are public by design and do not need rotating.

### Create the live Stripe webhook

The `whsec_d273fc…` in your notes came from `stripe listen` on your laptop. It
signs events forwarded by the CLI and **nothing else**. In production, a webhook
signed with it fails verification, which means an order is paid and never
fulfilled — the buyer is charged and gets no ticket.

1. Stripe Dashboard → Developers → **Webhooks** → Add endpoint
2. URL: `https://eventsli.com/api/v1/payments/webhook`
3. Events: `checkout.session.completed`, `checkout.session.expired`,
   `payment_intent.payment_failed`, `charge.refunded`, `account.updated`
4. Copy the endpoint's **Signing secret** — that is your production
   `STRIPE_WEBHOOK_SECRET`.

### Point DNS at the box

At your registrar, two A records to the VPS IP:

```
eventsli.com        A   <VPS_IP>
www.eventsli.com    A   <VPS_IP>
```

Wait for it to resolve before running certbot — it fails otherwise:

```bash
dig +short eventsli.com
```

---

## 1. Prepare the server

SSH in as root, then create a non-root user to run the app. Node should not run
as root: a remote-code bug in a dependency then owns the box rather than one
directory.

```bash
ssh root@<VPS_IP>

adduser --disabled-password --gecos "" eventsli
usermod -aG sudo eventsli
mkdir -p /home/eventsli/.ssh
cp ~/.ssh/authorized_keys /home/eventsli/.ssh/
chown -R eventsli:eventsli /home/eventsli/.ssh
chmod 700 /home/eventsli/.ssh && chmod 600 /home/eventsli/.ssh/authorized_keys
```

Base packages:

```bash
apt update && apt upgrade -y
apt install -y curl git nginx ufw

# Node 22 LTS — the engines field requires >=22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2

node -v    # expect v22.x
```

Firewall. Note what is **not** opened: 3000 and 5000 stay closed, so the only
way to either process is through nginx.

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

Swap, if the plan has 2 GB or less. `next build` is memory-hungry and is killed
by the OOM reaper without it — which looks like a build that mysteriously stops.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 2. Get the code

```bash
su - eventsli
cd ~
git clone https://github.com/gooamr88-pixel/eventsli.git
cd eventsli
npm install                 # workspaces: installs backend and frontend together
```

For a **private** repo, use a deploy key so the server never holds your GitHub
password:

```bash
ssh-keygen -t ed25519 -C "eventsli-vps" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# GitHub → repo → Settings → Deploy keys → Add, read-only
git clone git@github.com:gooamr88-pixel/eventsli.git
```

---

## 3. The two `.env` files

**They are not in the repository and must never be.** Create them on the server.

### `backend/.env`

```bash
nano ~/eventsli/backend/.env
```

```ini
PORT=5000
NODE_ENV=production

FRONTEND_URL=https://eventsli.com,https://www.eventsli.com
BACKEND_URL=https://eventsli.com

# Generate FRESH ones on the server — never reuse the laptop's:
#   openssl rand -base64 48
JWT_SECRET=<paste>
QR_JWT_SECRET=<paste a DIFFERENT one>
IP_HASH_SALT=<paste a third>

SUPABASE_URL=https://qvoyxwszojwyyelsjskm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<the ROTATED service_role JWT>

PAYMENTS_STRIPE_ENABLED=true
STRIPE_SECRET_KEY=<the ROTATED sk_live_ key>
STRIPE_WEBHOOK_SECRET=<the LIVE endpoint's signing secret — not the CLI's>
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

BREVO_API_KEY=<the Brevo key>
BREVO_FROM_EMAIL=info@eventsli.com
BREVO_FROM_NAME=Eventsli

GOOGLE_CLIENT_ID=652713460612-t771u7c092ci6i1dcilfcif8t63c3oe5.apps.googleusercontent.com

# The SAME value goes in frontend/.env. openssl rand -hex 32
REVALIDATE_SECRET=<paste>

LOG_LEVEL=info
SCHEDULER_ENABLED=true
```

Three notes on that file:

- **`JWT_SECRET` and `QR_JWT_SECRET` must differ.** A leaked ticket-signing key
  must not also mint logins.
- **`SCHEDULER_ENABLED=true` on exactly one box.** With `pm2` in cluster mode
  the scheduler runs in every worker; that is fine for these jobs (they are
  idempotent) but if you ever add a second VPS, only one may have it on.
- **`FRONTEND_URL` takes both hostnames.** Miss `www` and CORS refuses every
  request from it.

### `frontend/.env`

```bash
nano ~/eventsli/frontend/.env
```

```ini
NEXT_PUBLIC_API_URL=https://eventsli.com/api/v1
INTERNAL_API_URL=http://127.0.0.1:5000/api/v1

# Character-for-character identical to backend/.env
REVALIDATE_SECRET=<the same value>

NEXT_PUBLIC_SITE_URL=https://eventsli.com
NEXT_PUBLIC_SUPABASE_URL=https://qvoyxwszojwyyelsjskm.supabase.co
NEXT_PUBLIC_GOOGLE_CLIENT_ID=652713460612-t771u7c092ci6i1dcilfcif8t63c3oe5.apps.googleusercontent.com
```

Lock both down:

```bash
chmod 600 ~/eventsli/backend/.env ~/eventsli/frontend/.env
```

> **`NEXT_PUBLIC_*` is compiled in, not read at runtime.** These values are
> baked into the JavaScript bundle by `next build`, so the file must be correct
> *before* you build. Change one and you must rebuild — restarting is not
> enough. `NEXT_PUBLIC_SUPABASE_URL` is stricter still: `next.config.mjs`
> **refuses to build** without it, because it is compiled into the image
> allowlist and the CSP, and a build without it ships a site where every event
> cover is silently blocked.

---

## 4. Database

The schema lives in `supabase/migrations/`, applied in filename order. Against
the hosted project, run them from the Supabase SQL editor, or from the server:

```bash
cd ~/eventsli/backend
# Needs SUPABASE_DB_PASSWORD in .env; see scripts/db.js for how the
# connection string is derived from SUPABASE_URL.
node scripts/apply-migration.js ../supabase/migrations/<file>.sql
node scripts/verify-schema.js
```

`verify-schema.js` is the check that matters — it reports what the live database
actually has, rather than what the migrations say it should.

---

## 5. Build and start

```bash
cd ~/eventsli
npm run build --workspace=frontend
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u eventsli --hp /home/eventsli
# then run the command it prints, as root
```

Check both are alive before touching nginx:

```bash
pm2 status
curl -s localhost:5000/api/v1/public/event-categories | head -c 200
curl -sI localhost:3000 | head -1
pm2 logs --lines 50
```

---

## 6. nginx

```bash
sudo nano /etc/nginx/sites-available/eventsli
```

```nginx
server {
    listen 80;
    server_name eventsli.com www.eventsli.com;
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name eventsli.com www.eventsli.com;

    # certbot fills these in
    ssl_certificate     /etc/letsencrypt/live/eventsli.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eventsli.com/privkey.pem;

    # A ticket QR and a cover image are the big ones; nothing here is larger.
    client_max_body_size 6M;

    # The app sets its own CSP, HSTS and Permissions-Policy per response.
    # Do NOT add security headers here as well: a second Content-Security-Policy
    # is enforced as the INTERSECTION of the two, and one without the per-request
    # nonce blocks the inline scripts React needs — a site that renders and does
    # not work.

    # ── The API ────────────────────────────────────────────────────────────
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # Rate limits and audit rows key on the client address. Without this
        # every request looks like it came from 127.0.0.1 — one rate-limit
        # bucket for the whole internet, and a useless audit log.
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Stripe signs the RAW body. Any rewriting here breaks signature
    # verification, and the symptom is paid orders that are never fulfilled.
    location = /api/v1/payments/webhook {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }

    # ── Next's immutable assets ────────────────────────────────────────────
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # The gate's service worker. Never cached by a proxy, or a tablet at a door
    # keeps running last month's build with no way to update it.
    location = /gate-sw.js {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # ── Everything else ────────────────────────────────────────────────────
    location / {
        proxy_pass http://127.0.0.1:3000;
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

```bash
sudo ln -s /etc/nginx/sites-available/eventsli /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### Certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d eventsli.com -d www.eventsli.com
sudo systemctl status certbot.timer     # renewal is automatic
```

---

## 7. Verify the live site

Run these in order. Each one has caught a real failure in this project.

```bash
# 1. The API answers through nginx, not just on loopback
curl -s https://eventsli.com/api/v1/public/event-categories | head -c 200

# 2. The CSP carries a nonce. If `nonce-` is missing, the site renders and
#    NOTHING on it works — no seat map, no checkout, no sign-in state.
curl -sI https://eventsli.com/ | grep -i content-security-policy

# 3. HSTS is present (production only)
curl -sI https://eventsli.com/ | grep -i strict-transport

# 4. robots.txt disallows the private routes and points at the sitemap
curl -s https://eventsli.com/robots.txt

# 5. The sitemap has real events in it, not just the ten static pages
curl -s https://eventsli.com/sitemap.xml | grep -c "<loc>"

# 6. The share card resolves
curl -sI https://eventsli.com/og-default.png | head -1
```

Then in a browser, with devtools open:

- **`/` — the console must be clean of CSP violations.** One
  `GET /auth/me 401` for a signed-out visitor is expected and correct.
- **`/events`** — click an event, choose seats, reach the checkout.
- **`/gate/login`** — sign a device in and scan one real ticket.
- **A test purchase with a real card**, refunded afterwards. Nothing else proves
  the webhook secret is right, and a wrong one means charged buyers with no
  tickets.

---

## 8. Deploying an update

```bash
cd ~/eventsli
git pull
npm install
npm run build --workspace=frontend
pm2 reload ecosystem.config.js --update-env
pm2 logs --lines 30
```

`reload`, not `restart`: it replaces workers one at a time, so requests in
flight are not dropped.

**Rebuild after changing any `NEXT_PUBLIC_*`.** They are compiled into the
bundle; `pm2 reload` alone leaves the old value in the JavaScript.

If a migration is part of the release, apply it **before** reloading — the new
code expects the new schema.

### Rolling back

```bash
cd ~/eventsli
git log --oneline -5
git checkout <previous-sha>
npm install && npm run build --workspace=frontend
pm2 reload ecosystem.config.js --update-env
```

A migration does not roll back with the code. If the release included one,
decide deliberately whether to reverse it.

---

## 9. Housekeeping

```bash
pm2 install pm2-logrotate                        # logs fill a small disk in weeks
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14

sudo apt install -y unattended-upgrades          # security patches
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Before you point real traffic at it, **delete the 94 test events** that are
published in the database — "Fulfilment Test", "Gate Test", "Manual Test". They
are on the homepage, in `/events`, and in `sitemap.xml`, which invites Google to
index 94 pages that are not real. They are leftovers from this project's own
probes.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Page renders, nothing is interactive | The CSP has no nonce. Check `curl -sI` for `nonce-` and that `proxy.ts` is running — the middleware must not be excluded by nginx |
| `next build` fails on `NEXT_PUBLIC_SUPABASE_URL` | Working as designed. `frontend/.env` is missing or unreadable |
| Every request refused with a CORS error | `FRONTEND_URL` is missing a hostname — it needs both `eventsli.com` and `www.` |
| Cover images blocked, page otherwise fine | Built with the wrong `NEXT_PUBLIC_SUPABASE_URL`. Fix it and **rebuild** |
| Paid orders never fulfilled | `STRIPE_WEBHOOK_SECRET` is the CLI's, not the live endpoint's |
| A new event 404s for a minute | `REVALIDATE_SECRET` differs between the two `.env` files |
| Rate limits trip almost immediately | `X-Forwarded-For` is not set in the nginx block |
| The build is killed with no error | Out of memory. Add the swap file from step 1 |

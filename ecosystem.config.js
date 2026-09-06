const fs = require('node:fs');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS BOX IS SHARED. Eventsli is the third application on it — `fancy-rsvp`
 * and `roya-platform` were there first, and nothing here may disturb them.
 *
 * Two consequences, both load-bearing:
 *
 * 1. PORTS. 3000 and 5000 are taken (fancy's frontend and backend), and 5001
 *    is roya's. Eventsli uses 3100 and 5100. Neither is opened in the
 *    firewall — they are reachable only over loopback, through nginx, which is
 *    how it should be. `INTERNAL_API_URL` below has to move with them.
 *
 * 2. NODE VERSION. The system node is 20.20.2 and the other two projects run
 *    on it, so upgrading it globally is not an option. But
 *    `@supabase/supabase-js` declares `node >=22`, and it is the library the
 *    entire API talks to the database through — not somewhere to be
 *    "probably fine" on an unsupported runtime, on an app that moves money.
 *
 *    So Eventsli runs on its own Node 22, installed with nvm and exposed at a
 *    stable path. `/usr/local/bin/node22` is a symlink created once at
 *    deploy time (see docs/DEPLOY.md); the version-specific nvm path is
 *    deliberately not written here, because it changes on every nvm update
 *    and this file is committed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const NODE_22 = '/usr/local/bin/node22';

/** `undefined` means pm2 uses its own interpreter — correct on a machine where
 *  the system node is already 22, and on a laptop. */
const interpreter = fs.existsSync(NODE_22) ? NODE_22 : undefined;

module.exports = {
  apps: [
    {
      name: 'eventsli-backend',
      script: 'server.js',
      cwd: './backend',
      interpreter,
      /**
       * TWO, not `max`. Cluster mode is safe here — this API serves no inbound
       * WebSockets (Supabase Realtime is an OUTBOUND client connection), so
       * there is no sticky-session requirement — but the box has two cores and
       * fancy-rsvp is already running two cluster workers on them. `max` would
       * read the core count and claim them again.
       */
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5100,
        // Sized to the box so concurrent PBKDF2 password hashes don't queue
        // behind libuv's default of 4.
        UV_THREADPOOL_SIZE: 16,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '../logs/backend-error.log',
      out_file: '../logs/backend-out.log',
      merge_logs: true,
    },
    {
      name: 'eventsli-frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      cwd: './frontend',
      interpreter,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        // Server components call the API over loopback. Without this they fall
        // back to the PUBLIC hostname, so every SSR render hairpins out through
        // nginx and back — landing on the API as traffic from the box's own
        // address, which collapses all rendering onto ONE rate-limit key and
        // adds a TLS round trip per render.
        //
        // Not NEXT_PUBLIC_*: it must never be inlined into the client bundle.
        INTERNAL_API_URL: 'http://127.0.0.1:5100/api/v1',
        // REVALIDATE_SECRET is deliberately NOT here — this file is committed.
        // Put it in frontend/.env and backend/.env with the SAME value.
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '../logs/frontend-error.log',
      out_file: '../logs/frontend-out.log',
      merge_logs: true,
    },
  ],
};

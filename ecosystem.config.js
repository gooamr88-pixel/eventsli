module.exports = {
  apps: [
    {
      name: 'eventsli-backend',
      script: 'server.js',
      cwd: './backend',
      // One worker per core. Cluster mode is safe here: this API serves no
      // inbound WebSockets (Supabase Realtime is an OUTBOUND client connection),
      // so there is no sticky-session requirement.
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
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
      args: 'start -p 3000',
      cwd: './frontend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Server components call the API over loopback. Without this they fall
        // back to the PUBLIC hostname, so every SSR render hairpins out through
        // nginx and back — landing on the API as traffic from the box's own
        // address, which collapses all rendering onto ONE rate-limit key and
        // adds a TLS round trip per render.
        //
        // Not NEXT_PUBLIC_*: it must never be inlined into the client bundle.
        INTERNAL_API_URL: 'http://127.0.0.1:5000/api/v1',
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

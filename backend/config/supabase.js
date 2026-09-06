const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
// dotenv is loaded once in server.js — no duplicate require here.

// Supabase Realtime needs a WebSocket global on older Node builds.
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

/**
 * The SERVICE-ROLE client. It bypasses Row Level Security entirely.
 *
 * That is deliberate and it is the only client this API uses: the browser never
 * talks to the database, so authorisation is enforced here, in middleware and
 * controllers, where it can be read in one place and tested. RLS stays switched
 * on underneath as defence in depth for anything that reaches Postgres by
 * another route — it is not the primary gate.
 *
 * The consequence: every query in this codebase is responsible for its own
 * ownership check. `verifyEventOwner` exists so that is not left to memory.
 */
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { webSocket: global.WebSocket, transport: global.WebSocket },
});

logger.info({ url: supabaseUrl.replace(/https:\/\/([^.]+)\..*/, 'https://$1.…') }, 'Supabase client ready');

module.exports = { supabase };

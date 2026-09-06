/**
 * A direct Postgres connection to the linked Supabase project, for scripts.
 *
 * The API itself never uses this — it goes through the Supabase client. This
 * exists for migrations and schema introspection, which PostgREST cannot do.
 *
 * The connection string is derived from SUPABASE_URL so there is one source of
 * truth for which project is being touched; a hand-pasted connection string is
 * how a migration ends up in the wrong database.
 */
const { Client } = require('pg');

// Supabase serves direct connections over IPv6 on newer projects, which many
// home and CI networks cannot reach. The session pooler is IPv4. Pin the region
// in .env once it is known so this stops probing on every run.
const REGIONS = [
  'us-west-1', 'us-east-1', 'us-east-2', 'ca-central-1',
  'eu-central-1', 'eu-west-1', 'ap-southeast-1',
];

function routes() {
  const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!ref || !password) {
    throw new Error('SUPABASE_URL and SUPABASE_DB_PASSWORD must be set in backend/.env');
  }
  const pw = encodeURIComponent(password);
  const pinned = process.env.SUPABASE_DB_REGION;
  const regions = pinned ? [pinned, ...REGIONS.filter((r) => r !== pinned)] : REGIONS;

  return [
    ...regions.map((region) => ({
      label: `pooler ${region}`,
      conn: `postgresql://postgres.${ref}:${pw}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
    })),
    { label: 'direct', conn: `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres` },
  ];
}

async function connect({ quiet = true } = {}) {
  const errors = [];
  for (const route of routes()) {
    const client = new Client({
      connectionString: route.conn,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      if (!quiet) console.log(`connected via ${route.label}`);
      return client;
    } catch (e) {
      await client.end().catch(() => {});
      errors.push(`${route.label}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error(`could not reach the database on any route:\n  ${errors.join('\n  ')}`);
}

module.exports = { connect };

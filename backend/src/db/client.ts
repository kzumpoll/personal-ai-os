import { Pool } from 'pg';

// Log DB host so we can confirm backend and dashboard point to the same DB.
// Never logs the password — only host + db name.
try {
  const u = new URL(process.env.DATABASE_URL ?? '');
  console.log(`[db/backend] connecting to ${u.host}${u.pathname} (env: DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'MISSING'})`);
} catch {
  console.warn('[db/backend] DATABASE_URL is missing or not a valid URL');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase always requires SSL. rejectUnauthorized: false accepts Supabase's self-signed cert.
  // Do NOT condition this on NODE_ENV — if NODE_ENV is not set on Railway, ssl: false causes
  // every connection to fail with "SSL is not enabled on the server".
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
});

export default pool;

import { Pool } from 'pg';

// Log DB host so we can confirm backend and dashboard point to the same DB.
// Never logs the password — only host + db name.
if (!process.env.DATABASE_URL) {
  console.error('[db/dashboard] FATAL: DATABASE_URL is not set — all dashboard queries will return empty data');
} else {
  try {
    const u = new URL(process.env.DATABASE_URL);
    console.log(`[db/dashboard] connecting to ${u.host}${u.pathname}`);
  } catch {
    console.error('[db/dashboard] DATABASE_URL is not a valid URL — all dashboard queries will return empty data');
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL. rejectUnauthorized: false accepts Supabase's self-signed cert.
  ssl: { rejectUnauthorized: false },
  // Keep pool small in serverless — each Vercel instance holds connections,
  // and multiple warm instances can exhaust Supabase's connection limit.
  max: 2,
  // Fail fast rather than hanging until Vercel's function timeout (10s hobby / 60s pro).
  connectionTimeoutMillis: 5000,
  // Release idle connections after 10s — critical for serverless where instances stay warm.
  idleTimeoutMillis: 10000,
});

// Surface unexpected pool-level errors (e.g., idle connection dropped by Supabase).
// Without this listener, pg emits an unhandled 'error' event that can crash the function.
pool.on('error', (err) => {
  console.error('[db/dashboard] pool error:', err.message, (err as NodeJS.ErrnoException).code ?? '');
});

export default pool;

/**
 * Logs a DB error with enough detail to diagnose it in Vercel function logs.
 * pg errors have a `.code` property (PostgreSQL/Node error code) that `.message` alone doesn't show.
 * Examples:
 *   28P01 = invalid password
 *   3D000 = database does not exist
 *   ECONNREFUSED = can't reach server
 *   57P03 = cannot connect now (DB starting up)
 */
export function logDbError(label: string, err: unknown): void {
  const code = (err as Record<string, unknown>)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  const cls = err instanceof Error ? err.constructor.name : typeof err;
  console.error(`[db/${label}] ${cls}${code ? ` (${code})` : ''}: ${msg}`);
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  due_date: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  quarter: string | null;
  created_at: string;
}

export interface Idea {
  id: string;
  content: string;
  actionability: string | null;
  next_step: string | null;
  linked_project_id: string | null;
  status: string;
  created_at: string;
}

export interface Thought {
  id: string;
  content: string;
  created_at: string;
}

export interface Win {
  id: string;
  content: string;
  entry_date: string;
  created_at: string;
}

export interface Journal {
  id: string;
  entry_date: string;
  mit: string | null;
  k1: string | null;
  k2: string | null;
  open_journal: string | null;
  wins_json: string[] | null;
  created_at: string;
}

export interface Resource {
  id: string;
  title: string;
  content_or_url: string | null;
  type: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

import pool from '../client';

export interface MutationLog {
  id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

export async function logMutation(data: {
  action: string;
  table_name: string;
  record_id?: string;
  before_data?: Record<string, unknown> | null;
  after_data?: Record<string, unknown> | null;
}): Promise<MutationLog> {
  const { rows } = await pool.query(
    `INSERT INTO mutation_log (action, table_name, record_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.action,
      data.table_name,
      data.record_id ?? null,
      data.before_data ? JSON.stringify(data.before_data) : null,
      data.after_data ? JSON.stringify(data.after_data) : null,
    ]
  );
  return rows[0];
}

export async function getLastMutation(): Promise<MutationLog | null> {
  const { rows } = await pool.query(
    `SELECT * FROM mutation_log ORDER BY created_at DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function getRecentMutations(limit = 10): Promise<MutationLog[]> {
  const { rows } = await pool.query(
    `SELECT * FROM mutation_log ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

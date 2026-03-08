import pool from '../client';

export interface Win {
  id: string;
  content: string;
  entry_date: string;
  created_at: string;
}

export async function createWin(data: {
  content: string;
  entry_date?: string;
}): Promise<Win> {
  const { rows } = await pool.query(
    `INSERT INTO wins (content, entry_date) VALUES ($1, $2) RETURNING *`,
    [data.content, data.entry_date ?? new Date().toISOString().split('T')[0]]
  );
  return rows[0];
}

export async function getWinsForDate(date: string): Promise<Win[]> {
  const { rows } = await pool.query(
    `SELECT * FROM wins WHERE entry_date = $1 ORDER BY created_at ASC`,
    [date]
  );
  return rows;
}

export async function getAllWins(): Promise<Win[]> {
  const { rows } = await pool.query(`SELECT * FROM wins ORDER BY entry_date DESC, created_at DESC`);
  return rows;
}

export async function deleteWin(id: string): Promise<Win | null> {
  const { rows } = await pool.query('DELETE FROM wins WHERE id = $1 RETURNING *', [id]);
  return rows[0] ?? null;
}

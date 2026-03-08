import pool from '../client';

export interface Thought {
  id: string;
  content: string;
  created_at: string;
}

export async function createThought(data: { content: string }): Promise<Thought> {
  const { rows } = await pool.query(
    `INSERT INTO thoughts (content) VALUES ($1) RETURNING *`,
    [data.content]
  );
  return rows[0];
}

export async function getAllThoughts(): Promise<Thought[]> {
  const { rows } = await pool.query(`SELECT * FROM thoughts ORDER BY created_at DESC`);
  return rows;
}

export async function deleteThought(id: string): Promise<Thought | null> {
  const { rows } = await pool.query('DELETE FROM thoughts WHERE id = $1 RETURNING *', [id]);
  return rows[0] ?? null;
}

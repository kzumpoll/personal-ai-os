import pool from '../client';

export interface Resource {
  id: string;
  title: string;
  content_or_url: string | null;
  type: string | null;
  created_at: string;
}

export async function createResource(data: {
  title: string;
  content_or_url?: string;
  type?: string;
}): Promise<Resource> {
  const { rows } = await pool.query(
    `INSERT INTO resources (title, content_or_url, type) VALUES ($1, $2, $3) RETURNING *`,
    [data.title, data.content_or_url ?? null, data.type ?? null]
  );
  return rows[0];
}

export async function getAllResources(): Promise<Resource[]> {
  const { rows } = await pool.query(`SELECT * FROM resources ORDER BY created_at DESC`);
  return rows;
}

export async function deleteResource(id: string): Promise<Resource | null> {
  const { rows } = await pool.query('DELETE FROM resources WHERE id = $1 RETURNING *', [id]);
  return rows[0] ?? null;
}

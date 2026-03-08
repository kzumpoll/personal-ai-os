import pool from '../client';

export interface Idea {
  id: string;
  content: string;
  actionability: string | null;
  next_step: string | null;
  linked_project_id: string | null;
  status: string;
  created_at: string;
}

export async function createIdea(data: {
  content: string;
  actionability?: string;
}): Promise<Idea> {
  const { rows } = await pool.query(
    `INSERT INTO ideas (content, actionability) VALUES ($1, $2) RETURNING *`,
    [data.content, data.actionability ?? null]
  );
  return rows[0];
}

export async function getAllIdeas(): Promise<Idea[]> {
  const { rows } = await pool.query(`SELECT * FROM ideas WHERE status = 'active' ORDER BY created_at DESC`);
  return rows;
}

export async function getIdeaById(id: string): Promise<Idea | null> {
  const { rows } = await pool.query(`SELECT * FROM ideas WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getIdeaByContent(content: string): Promise<Idea | null> {
  const { rows } = await pool.query(
    `SELECT * FROM ideas WHERE content ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
    [`%${content}%`]
  );
  return rows[0] ?? null;
}

export async function updateIdeaNextStep(id: string, next_step: string): Promise<Idea | null> {
  const { rows } = await pool.query(
    `UPDATE ideas SET next_step = $1 WHERE id = $2 RETURNING *`,
    [next_step, id]
  );
  return rows[0] ?? null;
}

export async function linkIdeaToProject(ideaId: string, projectId: string): Promise<Idea | null> {
  const { rows } = await pool.query(
    `UPDATE ideas SET linked_project_id = $1, status = 'promoted' WHERE id = $2 RETURNING *`,
    [projectId, ideaId]
  );
  return rows[0] ?? null;
}

export async function deleteIdea(id: string): Promise<Idea | null> {
  const { rows } = await pool.query('DELETE FROM ideas WHERE id = $1 RETURNING *', [id]);
  return rows[0] ?? null;
}

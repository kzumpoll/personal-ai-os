import pool from '../client';

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  quarter: string | null;
  created_at: string;
}

function inferQuarter(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()}-Q${q}`;
}

export async function createGoal(data: {
  title: string;
  description?: string;
  target_date?: string;
}): Promise<Goal> {
  const quarter = inferQuarter(data.target_date);
  const { rows } = await pool.query(
    `INSERT INTO goals (title, description, target_date, quarter)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.title, data.description ?? null, data.target_date ?? null, quarter]
  );
  return rows[0];
}

export async function getActiveGoals(limit = 10): Promise<Goal[]> {
  const { rows } = await pool.query(
    `SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getAllGoals(): Promise<Goal[]> {
  const { rows } = await pool.query(`SELECT * FROM goals ORDER BY created_at DESC`);
  return rows;
}

export async function getGoalById(id: string): Promise<Goal | null> {
  const { rows } = await pool.query('SELECT * FROM goals WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function updateGoalStatus(id: string, status: string): Promise<Goal | null> {
  const { rows } = await pool.query(
    `UPDATE goals SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] ?? null;
}

export async function deleteGoal(id: string): Promise<Goal | null> {
  const { rows } = await pool.query('DELETE FROM goals WHERE id = $1 RETURNING *', [id]);
  return rows[0] ?? null;
}

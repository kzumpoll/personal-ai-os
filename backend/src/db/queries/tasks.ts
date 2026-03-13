import pool from '../client';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  description: string | null;
  status: string;
  due_date: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function createTask(data: {
  title: string;
  notes?: string;
  due_date?: string;
  project_id?: string;
}): Promise<Task> {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, notes, due_date, project_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.title, data.notes ?? null, data.due_date ?? null, data.project_id ?? null]
  );
  return rows[0];
}

export async function getTaskById(id: string): Promise<Task | null> {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** Resolve a short ID prefix (e.g. "4691a0d7") to matching tasks (max 5). */
export async function getTasksByIdPrefix(prefix: string): Promise<Task[]> {
  const { rows } = await pool.query<Task>(
    `SELECT * FROM tasks WHERE id::text LIKE $1 AND status != 'done' ORDER BY created_at DESC LIMIT 5`,
    [`${prefix}%`]
  );
  return rows;
}

/** Resolve a short ID prefix to a full task, if exactly one match. */
export async function getTaskByIdPrefix(prefix: string): Promise<Task | null> {
  const matches = await getTasksByIdPrefix(prefix);
  return matches.length === 1 ? matches[0] : null;
}

export async function getTaskByTitle(title: string): Promise<Task | null> {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE LOWER(title) LIKE LOWER($1) AND status != 'done' LIMIT 1`,
    [`%${title}%`]
  );
  return rows[0] ?? null;
}

export async function getOverdueTasks(limit = 15): Promise<Task[]> {
  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE status = 'todo' AND due_date < CURRENT_DATE
     ORDER BY due_date ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getTasksForDate(date: string, limit = 15): Promise<Task[]> {
  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE status = 'todo' AND due_date = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [date, limit]
  );
  return rows;
}

export async function getTasksInRange(
  startDate: string,
  endDate: string,
  limit = 15
): Promise<Task[]> {
  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE status = 'todo' AND due_date >= $1 AND due_date <= $2
     ORDER BY due_date ASC
     LIMIT $3`,
    [startDate, endDate, limit]
  );
  return rows;
}

export async function getTasksDueOnOrBefore(date: string, limit = 50): Promise<Task[]> {
  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE status = 'todo' AND (due_date IS NULL OR due_date <= $1)
     ORDER BY due_date ASC NULLS LAST
     LIMIT $2`,
    [date, limit]
  );
  return rows;
}

export async function getCompletedToday(): Promise<Task[]> {
  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE status = 'done' AND completed_at::date = CURRENT_DATE
     ORDER BY completed_at DESC`
  );
  return rows;
}

export async function completeTask(id: string): Promise<Task | null> {
  const { rows } = await pool.query(
    `UPDATE tasks
     SET status = 'done', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateTaskDueDate(id: string, due_date: string): Promise<Task | null> {
  const { rows } = await pool.query(
    `UPDATE tasks
     SET due_date = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, due_date]
  );
  return rows[0] ?? null;
}

export async function updateTask(
  id: string,
  data: Partial<Pick<Task, 'title' | 'notes' | 'description' | 'status' | 'due_date' | 'project_id'>>
): Promise<Task | null> {
  const fields = Object.keys(data)
    .map((k, i) => `${k} = $${i + 2}`)
    .join(', ');
  const values = Object.values(data);
  const { rows } = await pool.query(
    `UPDATE tasks SET ${fields}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return rows[0] ?? null;
}

export async function deleteTask(id: string): Promise<Task | null> {
  const { rows } = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
  return rows[0] ?? null;
}

export async function getAllTasksBoard(): Promise<{
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  next7: Task[];
  future: Task[];
}> {
  const { rows } = await pool.query(
    `SELECT *,
       CASE
         WHEN due_date < CURRENT_DATE THEN 'overdue'
         WHEN due_date = CURRENT_DATE THEN 'today'
         WHEN due_date = CURRENT_DATE + 1 THEN 'tomorrow'
         WHEN due_date <= CURRENT_DATE + 7 THEN 'next7'
         ELSE 'future'
       END as bucket
     FROM tasks
     WHERE status = 'todo'
     ORDER BY due_date ASC NULLS LAST`
  );

  return {
    overdue: rows.filter((r) => r.bucket === 'overdue'),
    today: rows.filter((r) => r.bucket === 'today'),
    tomorrow: rows.filter((r) => r.bucket === 'tomorrow'),
    next7: rows.filter((r) => r.bucket === 'next7'),
    future: rows.filter((r) => r.bucket === 'future'),
  };
}

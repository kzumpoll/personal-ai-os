import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { title, due_date } = await req.json();
    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, due_date) VALUES ($1, $2) RETURNING *`,
      [title.trim(), due_date ?? null]
    );
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/tasks POST', err);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, due_date, status } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    let rows: Record<string, unknown>[];
    if (status === 'done') {
      ({ rows } = await pool.query(
        `UPDATE tasks SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      ));
    } else if (status === 'todo') {
      ({ rows } = await pool.query(
        `UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE tasks SET due_date = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, due_date ?? null]
      ));
    }

    if (rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/tasks PATCH', err);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

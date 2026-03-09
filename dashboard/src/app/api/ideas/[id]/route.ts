import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { rows } = await pool.query('DELETE FROM ideas WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: id });
  } catch (err) {
    logDbError('api/ideas DELETE', err);
    return NextResponse.json({ error: 'Failed to delete idea' }, { status: 500 });
  }
}

// Convert idea → task. Atomically creates a task and records the link on the idea.
// Requires: ALTER TABLE ideas ADD COLUMN IF NOT EXISTS linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { title, due_date } = await req.json();
  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: taskRows } = await client.query(
      `INSERT INTO tasks (title, due_date) VALUES ($1, $2) RETURNING *`,
      [title.trim(), due_date ?? null]
    );
    const task = taskRows[0];
    await client.query(
      `UPDATE ideas SET linked_task_id = $1 WHERE id = $2`,
      [task.id, id]
    );
    await client.query('COMMIT');
    return NextResponse.json(task);
  } catch (err) {
    await client.query('ROLLBACK');
    logDbError('api/ideas POST (to-task)', err);
    return NextResponse.json({ error: 'Failed to create task from idea' }, { status: 500 });
  } finally {
    client.release();
  }
}

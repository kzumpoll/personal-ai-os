import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
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
    const body = await req.json();
    const { id, due_date, status } = body;
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
      // ── Date-move path ─────────────────────────────────────────────────────
      console.log(`[tasks PATCH] date-move requested  id=${id}  due_date_sent=${JSON.stringify(due_date)}`);

      ({ rows } = await pool.query(
        `UPDATE tasks SET due_date = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, due_date ?? null]
      ));

      if (rows.length > 0) {
        // Immediately re-read to prove the write persisted (catches trigger resets / RLS WITH CHECK)
        const { rows: verify } = await pool.query(
          `SELECT id, due_date, updated_at FROM tasks WHERE id = $1`,
          [id]
        );
        const saved = verify[0];
        console.log(
          `[tasks PATCH] RETURNING due_date=${JSON.stringify(rows[0].due_date)}` +
          `  RE-READ due_date=${JSON.stringify(saved?.due_date)}` +
          `  match=${JSON.stringify(rows[0].due_date) === JSON.stringify(saved?.due_date)}`
        );
        // Surface any mismatch as an error so it doesn't silently succeed
        if (saved && JSON.stringify(rows[0].due_date) !== JSON.stringify(saved.due_date)) {
          console.error(
            `[tasks PATCH] !! WRITE DID NOT PERSIST !! ` +
            `RETURNING said ${JSON.stringify(rows[0].due_date)} but DB now has ${JSON.stringify(saved.due_date)}`
          );
          return NextResponse.json(
            { error: 'Write appeared to succeed but DB value was not changed — check triggers/RLS', stored: saved.due_date },
            { status: 409 }
          );
        }
      }
    }

    if (rows.length === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    revalidatePath('/tasks');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/tasks PATCH', err);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

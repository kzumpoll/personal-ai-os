import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { id, answers } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Get the schedule to know cadence
    const { rows: schedules } = await pool.query(
      `SELECT * FROM review_schedule WHERE id = $1`, [id]
    );
    if (schedules.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const schedule = schedules[0];

    // Save the review as a reviews row
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - schedule.cadence_days);

    await pool.query(
      `INSERT INTO reviews (review_type, period_start, period_end, content)
       VALUES ($1, $2, $3, $4)`,
      [
        schedule.review_type,
        periodStart.toISOString().slice(0, 10),
        now.toISOString().slice(0, 10),
        JSON.stringify({ answers, template: schedule.template }),
      ]
    );

    // Advance the schedule
    const nextDue = new Date(now);
    nextDue.setDate(nextDue.getDate() + schedule.cadence_days);

    await pool.query(
      `UPDATE review_schedule SET last_completed_at = NOW(), next_due_at = $1 WHERE id = $2`,
      [nextDue.toISOString(), id]
    );

    revalidatePath('/review');
    return NextResponse.json({ success: true });
  } catch (err) {
    logDbError('api/review-schedule/complete POST', err);
    return NextResponse.json({ error: 'Failed to complete review' }, { status: 500 });
  }
}

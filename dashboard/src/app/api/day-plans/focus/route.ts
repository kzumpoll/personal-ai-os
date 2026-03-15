import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

const VALID_FIELDS = ['mit_done', 'p1_done', 'p2_done'] as const;
type FocusField = typeof VALID_FIELDS[number];

/** Normalize text for fuzzy comparison: lowercase, strip punctuation, collapse whitespace */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Word-overlap (Jaccard) similarity between two strings [0..1] */
function similarity(a: string, b: string): number {
  const wordsA = normalizeText(a).split(' ').filter(Boolean);
  const wordsB = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (wordsA.length === 0 || wordsB.size === 0) return 0;
  const setA = new Set(wordsA);
  const overlap = wordsA.filter(w => wordsB.has(w)).length;
  return overlap / (setA.size + wordsB.size - overlap);
}

const SYNC_THRESHOLD = 0.5; // ≥50% word overlap → auto-complete matching task

export async function PATCH(req: NextRequest) {
  try {
    const { plan_date, field, done, focus_text } = await req.json() as {
      plan_date: string;
      field: FocusField;
      done: boolean;
      focus_text?: string;
    };

    if (!plan_date || !VALID_FIELDS.includes(field)) {
      return NextResponse.json({ error: 'plan_date and valid field required' }, { status: 400 });
    }

    // Update day_plans focus checkbox
    await pool.query(
      `UPDATE day_plans SET ${field} = $1, updated_at = NOW() WHERE plan_date = $2`,
      [done, plan_date]
    );

    // If marking done and we have focus text, try to sync matching task
    if (done && focus_text?.trim()) {
      const { rows: tasks } = await pool.query<{ id: string; title: string }>(
        `SELECT id, title FROM tasks WHERE due_date = $1 AND status = 'todo'`,
        [plan_date]
      );
      let bestId: string | null = null;
      let bestScore = 0;
      for (const t of tasks) {
        const score = similarity(focus_text, t.title);
        if (score > bestScore) { bestScore = score; bestId = t.id; }
      }
      if (bestId && bestScore >= SYNC_THRESHOLD) {
        await pool.query(
          `UPDATE tasks SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [bestId]
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logDbError('api/day-plans/focus PATCH', err);
    return NextResponse.json({ error: 'Failed to update focus completion' }, { status: 500 });
  }
}

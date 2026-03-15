import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

const VALID_FIELDS = ['mit_done', 'p1_done', 'p2_done'] as const;
type FocusField = typeof VALID_FIELDS[number];

export async function PATCH(req: NextRequest) {
  try {
    const { plan_date, field, done } = await req.json() as {
      plan_date: string;
      field: FocusField;
      done: boolean;
    };

    if (!plan_date || !VALID_FIELDS.includes(field)) {
      return NextResponse.json({ error: 'plan_date and valid field required' }, { status: 400 });
    }

    await pool.query(
      `UPDATE day_plans SET ${field} = $1, updated_at = NOW() WHERE plan_date = $2`,
      [done, plan_date]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    logDbError('api/day-plans/focus PATCH', err);
    return NextResponse.json({ error: 'Failed to update focus completion' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { account, date, balance, currency, notes } = await req.json();
    if (!account || !date || balance === undefined) {
      return NextResponse.json({ error: 'account, date, and balance are required' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO finance_balance_snapshots (account, date, balance, currency, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account, date) DO UPDATE SET balance = $3, currency = $4, notes = $5
       RETURNING *`,
      [account, date, balance, currency ?? 'AED', notes ?? null]
    );
    revalidatePath('/finances');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/finances/snapshots POST', err);
    return NextResponse.json({ error: 'Failed to save snapshot' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id,
              snapshot_date::text       AS snapshot_date,
              crypto_value::text,
              stocks_value::text,
              bank_accounts_value::text,
              cash_value::text,
              assets_value::text,
              notes,
              created_at::text          AS created_at
       FROM net_worth_snapshots
       ORDER BY snapshot_date DESC, created_at DESC
       LIMIT 36`
    );
    return NextResponse.json({ snapshots: rows });
  } catch (err) {
    logDbError('api/finances/net-worth GET', err);
    return NextResponse.json({ error: 'Failed to fetch snapshots' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { snapshot_date, crypto_value, stocks_value, bank_accounts_value, cash_value, assets_value, notes } = await req.json();
    if (!snapshot_date) return NextResponse.json({ error: 'snapshot_date required' }, { status: 400 });

    const { rows } = await pool.query(
      `INSERT INTO net_worth_snapshots
         (snapshot_date, crypto_value, stocks_value, bank_accounts_value, cash_value, assets_value, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id,
                 snapshot_date::text       AS snapshot_date,
                 crypto_value::text,
                 stocks_value::text,
                 bank_accounts_value::text,
                 cash_value::text,
                 assets_value::text,
                 notes,
                 created_at::text          AS created_at`,
      [snapshot_date, crypto_value ?? 0, stocks_value ?? 0, bank_accounts_value ?? 0, cash_value ?? 0, assets_value ?? 0, notes ?? null]
    );
    return NextResponse.json({ snapshot: rows[0] });
  } catch (err) {
    logDbError('api/finances/net-worth POST', err);
    return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await pool.query('DELETE FROM net_worth_snapshots WHERE id = $1', [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logDbError('api/finances/net-worth DELETE', err);
    return NextResponse.json({ error: 'Failed to delete snapshot' }, { status: 500 });
  }
}

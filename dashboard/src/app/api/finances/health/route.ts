import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// Diagnostic endpoint: tests each finance DB query independently.
// Hit /api/finances/health to see exactly which query is failing and why.
export async function GET() {
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endOfMonth   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

  async function check(label: string, fn: () => Promise<{ rowCount: number | null }>) {
    try {
      const r = await fn();
      return { label, ok: true, rows: r.rowCount ?? 0, error: null };
    } catch (err) {
      const code = (err as Record<string, unknown>)?.code;
      const msg  = err instanceof Error ? err.message : String(err);
      return { label, ok: false, rows: 0, error: `${code ? `(${code}) ` : ''}${msg}` };
    }
  }

  const results = await Promise.all([
    check('db_ping',       () => pool.query('SELECT 1')),
    check('categories',    () => pool.query('SELECT * FROM finance_categories LIMIT 1')),
    check('transactions',  () => pool.query('SELECT id FROM finance_transactions LIMIT 1')),
    check('statements',    () => pool.query('SELECT id FROM finance_statements LIMIT 1')),
    check('snapshots',     () => pool.query('SELECT id FROM finance_balance_snapshots LIMIT 1')),
    check('manual_holdings', () => pool.query('SELECT id FROM finance_manual_holdings LIMIT 1')),
    check('fx_rates',      () => pool.query('SELECT id FROM fx_rates LIMIT 1')),
    check('025_columns',   () => pool.query('SELECT source_name, direction, external_id FROM finance_transactions LIMIT 1')),
  ]);

  const allOk = results.every(r => r.ok);
  return NextResponse.json({ ok: allOk, checks: results }, { status: allOk ? 200 : 500 });
}

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM crypto_holdings ORDER BY usd_value DESC`
    );
    return NextResponse.json(rows);
  } catch (err) {
    logDbError('api/finances/crypto-holdings GET', err);
    return NextResponse.json({ error: 'Failed to fetch crypto holdings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { platform, usd_value, notes } = await req.json();
    if (!platform || usd_value === undefined) {
      return NextResponse.json({ error: 'platform and usd_value required' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO crypto_holdings (platform, usd_value, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (platform) DO UPDATE SET usd_value = $2, notes = $3, updated_at = NOW()
       RETURNING *`,
      [platform, usd_value, notes ?? null]
    );
    revalidatePath('/finances');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/finances/crypto-holdings POST', err);
    return NextResponse.json({ error: 'Failed to save crypto holding' }, { status: 500 });
  }
}

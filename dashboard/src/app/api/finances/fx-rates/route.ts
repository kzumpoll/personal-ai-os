import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM fx_rates ORDER BY date DESC, currency ASC LIMIT 200`
    );
    return NextResponse.json(rows);
  } catch (err) {
    logDbError('api/finances/fx-rates GET', err);
    return NextResponse.json({ error: 'Failed to fetch FX rates' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Support bulk import: { rates: [{ date, currency, rate_to_usd }] }
    if (Array.isArray(body.rates)) {
      let imported = 0;
      for (const r of body.rates) {
        if (!r.date || !r.currency || !r.rate_to_usd) continue;
        await pool.query(
          `INSERT INTO fx_rates (date, currency, rate_to_usd, is_estimated)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (date, currency) DO UPDATE SET rate_to_usd = $3, is_estimated = $4`,
          [r.date, r.currency.toUpperCase(), r.rate_to_usd, r.is_estimated ?? false]
        );
        imported++;
      }
      revalidatePath('/finances');
      return NextResponse.json({ imported });
    }

    // Single rate upsert
    const { date, currency, rate_to_usd, is_estimated } = body;
    if (!date || !currency || !rate_to_usd) {
      return NextResponse.json({ error: 'date, currency, and rate_to_usd required' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `INSERT INTO fx_rates (date, currency, rate_to_usd, is_estimated)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (date, currency) DO UPDATE SET rate_to_usd = $3, is_estimated = $4
       RETURNING *`,
      [date, currency.toUpperCase(), rate_to_usd, is_estimated ?? false]
    );
    revalidatePath('/finances');
    return NextResponse.json(rows[0]);
  } catch (err) {
    logDbError('api/finances/fx-rates POST', err);
    return NextResponse.json({ error: 'Failed to save FX rate' }, { status: 500 });
  }
}

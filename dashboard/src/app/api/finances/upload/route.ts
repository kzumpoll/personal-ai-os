import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import pool, { logDbError } from '@/lib/db';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseAmount(s: string): number {
  const cleaned = s.replace(/[",\s]/g, '').replace(/[()]/g, (m) => m === '(' ? '-' : '');
  return parseFloat(cleaned) || 0;
}

function parseDate(s: string): string | null {
  // Try common formats: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slashed = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (slashed) {
    const a = parseInt(slashed[1]), b = parseInt(slashed[2]), y = slashed[3];
    // If first part > 12, it's DD/MM/YYYY
    if (a > 12) return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    // Default to DD/MM/YYYY (common in UAE/Europe)
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const account = (formData.get('account') as string) || null;
    const currency = (formData.get('currency') as string) || 'AED';

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return NextResponse.json({ error: 'CSV must have header + data rows' }, { status: 400 });

    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const dateIdx = header.findIndex(h => h.includes('date'));
    const descIdx = header.findIndex(h => h.includes('desc') || h.includes('narration') || h.includes('particular') || h.includes('detail'));
    const amountIdx = header.findIndex(h => h === 'amount' || h.includes('amount'));
    const debitIdx = header.findIndex(h => h.includes('debit') || h.includes('withdrawal'));
    const creditIdx = header.findIndex(h => h.includes('credit') || h.includes('deposit'));

    if (dateIdx === -1 || descIdx === -1) {
      return NextResponse.json({ error: 'CSV must have date and description columns' }, { status: 400 });
    }

    // Create statement record
    const { rows: stmtRows } = await pool.query(
      `INSERT INTO finance_statements (filename, account, row_count) VALUES ($1, $2, $3) RETURNING id`,
      [file.name, account, lines.length - 1]
    );
    const statementId = stmtRows[0].id;

    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const dateStr = parseDate(cols[dateIdx] ?? '');
      const desc = cols[descIdx] ?? '';
      if (!dateStr || !desc.trim()) continue;

      let amount: number;
      if (amountIdx !== -1) {
        amount = parseAmount(cols[amountIdx] ?? '0');
      } else if (debitIdx !== -1 && creditIdx !== -1) {
        const debit = parseAmount(cols[debitIdx] ?? '0');
        const credit = parseAmount(cols[creditIdx] ?? '0');
        amount = credit > 0 ? credit : -debit;
      } else {
        continue;
      }

      if (amount === 0) continue;

      await pool.query(
        `INSERT INTO finance_transactions (date, description, amount, currency, account, statement_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [dateStr, desc.trim(), amount, currency, account, statementId]
      );
      imported++;
    }

    // Update statement row count
    await pool.query('UPDATE finance_statements SET row_count = $2 WHERE id = $1', [statementId, imported]);

    revalidatePath('/finances');
    return NextResponse.json({ imported, statementId });
  } catch (err) {
    logDbError('api/finances/upload POST', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

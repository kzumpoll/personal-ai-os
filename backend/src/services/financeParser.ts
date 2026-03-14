/**
 * Finance CSV parser service.
 *
 * Supported sources: Revolut
 * Future: Wio (not yet implemented — prompts user)
 *
 * Flow:
 *   1. detectSource()  — infers bank from caption + filename
 *   2. isFinanceCaption() — gates whether the document is finance-related
 *   3. parseRevolutCsv() — parses Revolut export CSV into NormalizedTransaction[]
 *   4. Caller inserts via insertImportedTransactions()
 */

export interface NormalizedTransaction {
  source_name: string;
  transaction_date: string; // YYYY-MM-DD
  booking_date?: string;    // YYYY-MM-DD
  amount: number;           // positive = credit, negative = debit
  currency: string;
  description_raw: string;
  merchant_raw?: string;
  fee: number;
  direction: 'credit' | 'debit';
  external_id: string;      // deterministic hash for dedup across re-imports
}

export type FinanceSource = 'revolut' | 'wio' | 'unknown';

const FINANCE_KEYWORDS = ['finance', 'statement', 'revolut', 'wio'];

export function isFinanceCaption(caption: string): boolean {
  const lower = caption.toLowerCase();
  return FINANCE_KEYWORDS.some((k) => lower.includes(k));
}

export function detectSource(caption: string, filename: string): FinanceSource {
  const text = `${caption} ${filename}`.toLowerCase();
  if (text.includes('revolut')) return 'revolut';
  if (text.includes('wio')) return 'wio';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseDateStr(s: string): string {
  // Handles "2024-01-15 10:30:00" and "2024-01-15T10:30:00"
  return (s ?? '').split(/[ T]/)[0];
}

/** Non-cryptographic hash of key fields — used for external_id dedup. */
function hashFields(fields: string[]): string {
  const str = fields.join('|');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Revolut CSV parser
// ---------------------------------------------------------------------------
// Expected headers (Revolut statement export):
//   Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
//
// Only rows with State == COMPLETED are imported.
// ---------------------------------------------------------------------------

export function parseRevolutCsv(csvText: string): NormalizedTransaction[] {
  const lines = csvText.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV appears empty — no data rows found');

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));

  const col = (exact: string) => headers.indexOf(exact);
  const colContains = (fragment: string) => headers.findIndex((h) => h.includes(fragment));

  const typeIdx      = col('type');
  const startedIdx   = colContains('started');
  const completedIdx = colContains('completed');
  const descIdx      = col('description');
  const amountIdx    = col('amount');
  const feeIdx       = col('fee');
  const currencyIdx  = col('currency');
  const stateIdx     = col('state');

  if (amountIdx === -1) throw new Error('CSV is missing an "Amount" column — is this a Revolut export?');
  if (descIdx === -1)   throw new Error('CSV is missing a "Description" column — is this a Revolut export?');
  if (startedIdx === -1) throw new Error('CSV is missing a "Started Date" column — is this a Revolut export?');

  const results: NormalizedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 3) continue;

    // Skip non-COMPLETED rows (PENDING, FAILED, REVERTED, etc.)
    const state = stateIdx >= 0 ? (row[stateIdx] ?? '').toUpperCase() : 'COMPLETED';
    if (state && state !== 'COMPLETED') continue;

    const amountStr  = row[amountIdx] ?? '0';
    const feeStr     = feeIdx >= 0 ? (row[feeIdx] ?? '0') : '0';
    const amount     = parseFloat(amountStr.replace(/[^-\d.]/g, ''));
    const fee        = parseFloat(feeStr.replace(/[^-\d.]/g, '')) || 0;

    if (isNaN(amount)) continue;

    const currency      = currencyIdx >= 0 ? (row[currencyIdx] ?? 'USD').trim() : 'USD';
    const description   = descIdx >= 0 ? (row[descIdx] ?? '').trim() : '';
    const txDate        = parseDateStr(startedIdx >= 0 ? (row[startedIdx] ?? '') : '');
    const bookingDate   = completedIdx >= 0 ? parseDateStr(row[completedIdx] ?? '') : undefined;
    const txType        = typeIdx >= 0 ? (row[typeIdx] ?? '').trim() : '';
    const direction: 'credit' | 'debit' = amount >= 0 ? 'credit' : 'debit';

    // Deterministic external_id: hash of content fields (stable across re-imports)
    const external_id = `revolut_${hashFields([txDate, description, amountStr, currency, feeStr])}`;

    results.push({
      source_name:      'revolut',
      transaction_date: txDate,
      booking_date:     bookingDate || undefined,
      amount,
      currency,
      description_raw:  description,
      merchant_raw:     txType || undefined,
      fee,
      direction,
      external_id,
    });
  }

  return results;
}

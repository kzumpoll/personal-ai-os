/**
 * Finance CSV parser service.
 *
 * Supported sources: Revolut, WIO (Personal + Business)
 *
 * Flow:
 *   1. detectSource()  — infers bank from caption + filename
 *   2. isFinanceCaption() — gates whether the document is finance-related
 *   3. parseRevolutCsv() / parseWioCsv() — parse CSV into NormalizedTransaction[]
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
  account?: string;         // account name (WIO and future sources)
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

// ---------------------------------------------------------------------------
// WIO CSV parser
// ---------------------------------------------------------------------------
// Handles both WIO Personal and WIO Business — same column schema:
//   Account name, Account type, Account IBAN, Account number, Card number,
//   Account currency, Transaction type, Date, Ref. number, Description,
//   Amount, Balance, Original ref. number, Notes
//
// Account subtype (personal vs business) is inferred from the "Account type"
// column value in the CSV and stored in merchant_raw as context.
// Date format: DD/MM/YYYY or DD/MM/YYYY HH:MM:SS (local wall clock, no TZ).
// No "State" column — all rows are considered final/completed.
// ---------------------------------------------------------------------------

function parseWioDate(s: string): string {
  if (!s) return '';
  const clean = s.trim();
  // DD/MM/YYYY or DD/MM/YYYY HH:MM:SS
  const m = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // ISO or "YYYY-MM-DD ..." fallback
  return clean.split(/[ T]/)[0];
}

export function parseWioCsv(csvText: string): NormalizedTransaction[] {
  const lines = csvText.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV appears empty — no data rows found');

  // Normalize headers: lowercase, collapse whitespace/dots/dashes to single underscore
  const headers = parseCSVLine(lines[0]).map((h) =>
    h.toLowerCase().trim().replace(/[\s.\-]+/g, '_').replace(/_+/g, '_')
  );

  if (!headers.includes('amount')) throw new Error('CSV is missing an "Amount" column — is this a WIO export?');
  if (!headers.includes('description')) throw new Error('CSV is missing a "Description" column — is this a WIO export?');
  if (!headers.includes('date')) throw new Error('CSV is missing a "Date" column — is this a WIO export?');

  const col = (name: string) => headers.indexOf(name);

  const accountNameIdx = col('account_name');
  const accountTypeIdx = col('account_type');
  const accountCurrIdx = col('account_currency');
  const txTypeIdx      = col('transaction_type');
  const dateIdx        = col('date');
  const refIdx         = col('ref_number');        // "Ref. number" → "ref_number"
  const descIdx        = col('description');
  const amountIdx      = col('amount');
  const notesIdx       = col('notes');

  const results: NormalizedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 3) continue;

    const amountStr = (row[amountIdx] ?? '').trim();
    if (!amountStr) continue;

    const amount = parseFloat(amountStr.replace(/[^-\d.]/g, ''));
    if (isNaN(amount)) continue;

    const rawDate  = dateIdx >= 0 ? (row[dateIdx] ?? '').trim() : '';
    const txDate   = parseWioDate(rawDate);
    if (!txDate) continue;

    const desc      = descIdx >= 0 ? (row[descIdx] ?? '').trim() : '';
    const txType    = txTypeIdx >= 0 ? (row[txTypeIdx] ?? '').trim() : '';
    const refNum    = refIdx >= 0 ? (row[refIdx] ?? '').trim() : '';
    const currency  = accountCurrIdx >= 0 ? (row[accountCurrIdx] ?? 'AED').trim() : 'AED';
    const accountNm = accountNameIdx >= 0 ? (row[accountNameIdx] ?? '').trim() : '';

    const direction: 'credit' | 'debit' = amount >= 0 ? 'credit' : 'debit';

    // Prefer ref number as dedup key — it's unique per transaction in WIO.
    // Fall back to hashing stable content fields when ref is absent.
    const hashInput = refNum
      ? [refNum, txDate, amountStr]
      : [txDate, desc, amountStr, currency];
    const external_id = `wio_${hashFields(hashInput)}`;

    results.push({
      source_name:      'wio',
      transaction_date: txDate,
      amount,
      currency,
      description_raw:  desc,
      merchant_raw:     txType || undefined,
      fee:              0,
      direction,
      external_id,
      account:          accountNm || undefined,
    });
  }

  return results;
}

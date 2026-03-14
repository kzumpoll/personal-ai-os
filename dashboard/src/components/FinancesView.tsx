'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import {
  Eye, EyeOff, TrendingUp, TrendingDown, Wallet, Bitcoin,
  RefreshCw, ChevronLeft, ChevronRight as ChevronRightIcon,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  color: string | null;
  is_income: boolean;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: string | number;
  currency: string;
  category_id: string | null;
  category_name: string | null;
  account: string | null;
  is_income: boolean;
  status: string;
  direction?: string | null;
  merchant_raw?: string | null;
}

interface BalanceSnapshot {
  id: string;
  account: string;
  date: string;
  balance: string | number;
  currency: string;
  balance_usd: string | number | null;
  notes: string | null;
}

interface ManualHolding {
  id: string;
  as_of_date: string;
  asset_type: 'crypto' | 'stock';
  asset_name: string;
  platform: string;
  quantity: string | number | null;
  usd_value: string | number;
  notes: string | null;
}

interface FxRate {
  id: string;
  date: string;
  currency: string;
  rate_to_usd: string | number;
  is_estimated: boolean;
}

interface SpendRow {
  name: string;
  color: string;
  total: number;
  total_usd: number;
}

interface NetFlow {
  income: number;
  expenses: number;
  net: number;
  income_usd: number;
  expenses_usd: number;
  net_usd: number;
}

interface Suggestion {
  category: string;
  confidence: number;
  reason: string;
  source: 'memory' | 'llm' | 'rules';
}

interface Props {
  categories: Category[];
  uncategorized: Transaction[];
  inboxTotal: number;
  categorizedTransactions: Transaction[];
  spendByCategory: SpendRow[];
  netFlow: NetFlow;
  snapshots: BalanceSnapshot[];
  manualHoldings: ManualHolding[];
  manualHoldingsDate: string | null;
  fxRates: FxRate[];
  dbErrors?: string[];
  startOfMonth: string;
  endOfMonth: string;
}

type Tab = 'inbox' | 'transactions' | 'reports' | 'balances' | 'holdings' | 'fx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `$\u202f${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt(amount: number | string, currency = 'USD'): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (currency === 'USD') return fmtUsd(n);
  return `${currency}\u202f${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string): string {
  try { return format(parseISO(dateStr), 'MMM d, yyyy'); } catch { return dateStr; }
}

function monthRange(offset = 0): { start: string; end: string } {
  const d = new Date();
  d.setMonth(d.getMonth() + offset, 1);
  const y = d.getFullYear(), m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${last}` };
}

function SectionLabel({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="mb-3" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color }}>
      {children}
    </p>
  );
}

// ── DateFilter ────────────────────────────────────────────────────────────────

function DateFilter({
  start, end,
  onApply,
}: {
  start: string; end: string;
  onApply: (start: string, end: string) => void;
}) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);

  function quick(label: string) {
    let ns = '', ne = '';
    if (label === 'This month')  { const r = monthRange(0);  ns = r.start; ne = r.end; }
    if (label === 'Last month')  { const r = monthRange(-1); ns = r.start; ne = r.end; }
    if (label === 'Last 3m')     {
      const now = new Date();
      ne = monthRange(0).end;
      const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      ns = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;
    }
    if (label === 'This year')   { const y = new Date().getFullYear(); ns = `${y}-01-01`; ne = `${y}-12-31`; }
    if (label === 'All time')    { ns = '2000-01-01'; ne = '2099-12-31'; }
    setS(ns); setE(ne); onApply(ns, ne);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">
      <input type="date" value={s} onChange={ev => setS(ev.target.value)}
        className="text-xs px-2 py-1 rounded"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>–</span>
      <input type="date" value={e} onChange={ev => setE(ev.target.value)}
        className="text-xs px-2 py-1 rounded"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
      <button onClick={() => onApply(s, e)}
        className="text-xs px-2.5 py-1 rounded"
        style={{ background: 'var(--cyan)', color: '#fff', cursor: 'pointer' }}>
        Apply
      </button>
      {['This month', 'Last month', 'Last 3m', 'This year', 'All time'].map(lbl => (
        <button key={lbl} onClick={() => quick(lbl)}
          className="text-xs px-2 py-1 rounded"
          style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          {lbl}
        </button>
      ))}
    </div>
  );
}

// ── InboxRow ──────────────────────────────────────────────────────────────────

function InboxRow({
  tx, categories, suggestion, suggestionsLoading, onCategorize,
}: {
  tx: Transaction;
  categories: Category[];
  suggestion: Suggestion | undefined;
  suggestionsLoading: boolean;
  onCategorize: (txId: string, categoryId: string) => void;
}) {
  const suggestedCat = suggestion ? categories.find(c => c.name === suggestion.category) : undefined;
  const [selectedCatId, setSelectedCatId] = useState(suggestedCat?.id ?? '');

  useEffect(() => {
    if (suggestedCat?.id && !selectedCatId) setSelectedCatId(suggestedCat.id);
  }, [suggestedCat?.id, selectedCatId]);

  const amt      = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
  const isCredit = tx.direction === 'credit' || (tx.direction == null && amt >= 0);
  const merchant = (tx.merchant_raw ?? tx.description).trim();
  const hasSubDesc = tx.merchant_raw && tx.description !== tx.merchant_raw;

  const expenseCats = categories.filter(c => !c.is_income);
  const incomeCats  = categories.filter(c =>  c.is_income);

  return (
    <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date */}
        <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', minWidth: 88 }}>
          {fmtDate(tx.date)}
        </span>

        {/* Merchant */}
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate font-medium" style={{ color: 'var(--text)' }}>{merchant}</p>
          {hasSubDesc && (
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-faint)' }}>{tx.description}</p>
          )}
        </div>

        {/* Direction badge */}
        <span className="text-xs px-1.5 py-0.5 rounded shrink-0"
          style={{ background: isCredit ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: isCredit ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
          {isCredit ? 'CR' : 'DR'}
        </span>

        {/* Amount */}
        <span className="text-sm font-medium shrink-0"
          style={{ color: isCredit ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
          {fmt(Math.abs(amt), tx.currency)}
        </span>

        {/* Category selector + confirm */}
        {suggestionsLoading ? (
          <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>…</span>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            {suggestion && suggestion.confidence < 0.65 && (
              <span className="text-xs" style={{ color: 'var(--yellow)', fontSize: '9px', fontFamily: 'var(--font-mono)' }}>low</span>
            )}
            <select
              value={selectedCatId}
              onChange={ev => setSelectedCatId(ev.target.value)}
              className="text-xs px-2 py-1 rounded"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)', maxWidth: 160, cursor: 'pointer' }}
            >
              <option value="">Pick category…</option>
              <optgroup label="Expenses">
                {expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
              <optgroup label="Income">
                {incomeCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            </select>
            <button
              disabled={!selectedCatId}
              onClick={() => selectedCatId && onCategorize(tx.id, selectedCatId)}
              className="text-xs px-2.5 py-1 rounded font-medium"
              style={{
                background: selectedCatId ? 'rgba(16,185,129,0.15)' : 'var(--surface-3)',
                color: selectedCatId ? 'var(--green)' : 'var(--text-faint)',
                cursor: selectedCatId ? 'pointer' : 'default',
                border: '1px solid transparent',
              }}
            >✓</button>
          </div>
        )}
      </div>

      {/* Suggestion provenance */}
      {suggestion && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: '9px' }}>
          {suggestion.source === 'memory' ? '🧠 memory' : suggestion.source === 'llm' ? '✨ ai' : '📋 rule'} · {suggestion.reason}
        </p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FinancesView({
  categories,
  uncategorized,
  inboxTotal,
  categorizedTransactions,
  spendByCategory,
  netFlow,
  snapshots,
  manualHoldings,
  manualHoldingsDate,
  fxRates,
  dbErrors,
  startOfMonth,
  endOfMonth,
}: Props) {
  const router = useRouter();

  // Privacy toggle (localStorage)
  const [privacyHidden, setPrivacyHidden] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('finances-privacy');
    if (saved === 'true') setPrivacyHidden(true);
  }, []);
  function togglePrivacy() {
    setPrivacyHidden(prev => {
      localStorage.setItem('finances-privacy', String(!prev));
      return !prev;
    });
  }

  // Tab
  const [tab, setTab] = useState<Tab>(inboxTotal > 0 ? 'inbox' : 'transactions');

  // ── Inbox state ──
  const [inboxItems, setInboxItems]     = useState<Transaction[]>(uncategorized);
  const [inboxCount, setInboxCount]     = useState(inboxTotal);
  const [inboxPage, setInboxPage]       = useState(1);
  const [inboxLoading, setInboxLoading] = useState(false);
  const PAGE_SIZE = 30;
  const inboxPages = Math.max(1, Math.ceil(inboxCount / PAGE_SIZE));

  // ── LLM suggestions ──
  const [suggestions, setSuggestions]               = useState<Record<string, Suggestion>>({});
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const fetchSuggestions = useCallback(async (items: Transaction[]) => {
    if (!items.length) return;
    setSuggestionsLoading(true);
    try {
      const res = await fetch('/api/finances/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: items.map(t => ({
            id: t.id, merchant_raw: t.merchant_raw ?? null,
            description: t.description, direction: t.direction ?? null,
            amount: t.amount, currency: t.currency,
          })),
        }),
      });
      if (res.ok) {
        const data = await res.json() as { suggestions: Record<string, Suggestion> };
        setSuggestions(prev => ({ ...prev, ...data.suggestions }));
      }
    } catch { /* silent */ }
    finally { setSuggestionsLoading(false); }
  }, []);

  // Fetch suggestions when inbox tab opens
  useEffect(() => {
    if (tab === 'inbox' && inboxItems.length > 0 && Object.keys(suggestions).length === 0) {
      fetchSuggestions(inboxItems);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchInboxPage(page: number) {
    setInboxLoading(true);
    try {
      const res = await fetch(`/api/finances/inbox?page=${page}&pageSize=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json() as { transactions: Transaction[]; total: number };
        setInboxItems(data.transactions);
        setInboxCount(data.total);
        setInboxPage(page);
        setSuggestions({});
        fetchSuggestions(data.transactions);
      }
    } catch { /* silent */ }
    finally { setInboxLoading(false); }
  }

  async function categorize(txId: string, categoryId: string) {
    try {
      await fetch('/api/finances/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: txId, category_id: categoryId }),
      });
      setInboxItems(prev => prev.filter(t => t.id !== txId));
      setInboxCount(prev => Math.max(0, prev - 1));
      setSuggestions(prev => { const next = { ...prev }; delete next[txId]; return next; });
    } catch { /* swallow */ }
  }

  // ── Transactions tab state ──
  const [txItems, setTxItems]         = useState<Transaction[]>(categorizedTransactions);
  const [txLoading, setTxLoading]     = useState(false);
  const [txStart, setTxStart]         = useState(startOfMonth);
  const [txEnd, setTxEnd]             = useState(endOfMonth);

  async function fetchTransactions(start: string, end: string) {
    setTxLoading(true); setTxStart(start); setTxEnd(end);
    try {
      const res = await fetch(`/api/finances/transactions?startDate=${start}&endDate=${end}&pageSize=200`);
      if (res.ok) { const d = await res.json(); setTxItems(d.transactions); }
    } catch { /* silent */ }
    finally { setTxLoading(false); }
  }

  // ── Reports tab state ──
  const [rptSpend, setRptSpend]       = useState<SpendRow[]>(spendByCategory);
  const [rptFlow, setRptFlow]         = useState<NetFlow>(netFlow);
  const [rptLoading, setRptLoading]   = useState(false);
  const [rptStart, setRptStart]       = useState(startOfMonth);
  const [rptEnd, setRptEnd]           = useState(endOfMonth);

  async function fetchReports(start: string, end: string) {
    setRptLoading(true); setRptStart(start); setRptEnd(end);
    try {
      const res = await fetch(`/api/finances/reports?startDate=${start}&endDate=${end}`);
      if (res.ok) {
        const d = await res.json() as { spendByCategory: SpendRow[]; netFlow: NetFlow };
        setRptSpend(d.spendByCategory);
        setRptFlow(d.netFlow);
      }
    } catch { /* silent */ }
    finally { setRptLoading(false); }
  }

  // ── Summary card values ──
  const cashTotal        = snapshots.reduce((s, r) => s + Number(r.balance_usd ?? 0), 0);
  const manualCryptoTotal = manualHoldings.filter(h => h.asset_type === 'crypto').reduce((s, h) => s + Number(h.usd_value), 0);
  const manualStockTotal  = manualHoldings.filter(h => h.asset_type === 'stock').reduce((s, h) => s + Number(h.usd_value), 0);

  // ── Tabs ──
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'inbox',        label: 'Inbox',       count: inboxCount },
    { key: 'transactions', label: 'Transactions' },
    { key: 'reports',      label: 'Reports' },
    { key: 'balances',     label: 'Balances' },
    { key: 'holdings',     label: 'Crypto/Stocks' },
    { key: 'fx',           label: 'FX Rates' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Income — always visible */}
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} style={{ color: 'var(--green)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Income</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--green)' }}>{fmtUsd(netFlow.income_usd)}</p>
        </div>

        {/* Expenses — always visible */}
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={14} style={{ color: 'var(--red)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Expenses</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--red)' }}>{fmtUsd(netFlow.expenses_usd)}</p>
        </div>

        {/* Net — privacy toggle */}
        <div className="rounded-lg p-4 relative" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} style={{ color: netFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Net</span>
            <button onClick={togglePrivacy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 0, marginLeft: 'auto' }}>
              {privacyHidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
          {privacyHidden
            ? <p className="text-lg font-medium" style={{ color: 'var(--text-muted)', letterSpacing: '0.15em' }}>••••</p>
            : <p className="text-lg font-medium" style={{ color: netFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {netFlow.net_usd >= 0 ? '+' : '-'}{fmtUsd(Math.abs(netFlow.net_usd))}
              </p>
          }
        </div>

        {/* Cash */}
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} style={{ color: 'var(--cyan)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Cash</span>
          </div>
          {privacyHidden
            ? <p className="text-lg font-medium" style={{ color: 'var(--text-muted)', letterSpacing: '0.15em' }}>••••</p>
            : <p className="text-lg font-medium" style={{ color: 'var(--cyan)' }}>{fmtUsd(cashTotal)}</p>
          }
        </div>

        {/* Stocks */}
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} style={{ color: 'var(--violet)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Stocks</span>
          </div>
          {privacyHidden
            ? <p className="text-lg font-medium" style={{ color: 'var(--text-muted)', letterSpacing: '0.15em' }}>••••</p>
            : <p className="text-lg font-medium" style={{ color: 'var(--violet)' }}>{fmtUsd(manualStockTotal)}</p>
          }
        </div>

        {/* Crypto */}
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Bitcoin size={14} style={{ color: 'var(--yellow)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Crypto</span>
          </div>
          {privacyHidden
            ? <p className="text-lg font-medium" style={{ color: 'var(--text-muted)', letterSpacing: '0.15em' }}>••••</p>
            : <p className="text-lg font-medium" style={{ color: 'var(--yellow)' }}>{fmtUsd(manualCryptoTotal)}</p>
          }
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 1 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="text-xs px-3 py-2 rounded-t"
            style={{
              background:   tab === t.key ? 'var(--surface)' : 'transparent',
              color:        tab === t.key ? 'var(--text)' : 'var(--text-muted)',
              fontWeight:   tab === t.key ? 600 : 400,
              border:       tab === t.key ? '1px solid var(--border)' : '1px solid transparent',
              borderBottom: tab === t.key ? '1px solid var(--surface)' : '1px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', fontSize: '10px' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Inbox ── */}
      {tab === 'inbox' && (
        <div>
          {inboxLoading ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          ) : inboxItems.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>
              {inboxCount === 0 ? 'All caught up — no uncategorized transactions.' : 'No items on this page.'}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {inboxItems.map(tx => (
                <InboxRow
                  key={tx.id}
                  tx={tx}
                  categories={categories}
                  suggestion={suggestions[tx.id]}
                  suggestionsLoading={suggestionsLoading}
                  onCategorize={categorize}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {inboxPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                disabled={inboxPage === 1 || inboxLoading}
                onClick={() => fetchInboxPage(inboxPage - 1)}
                style={{ background: 'none', border: 'none', cursor: inboxPage > 1 ? 'pointer' : 'default', color: inboxPage > 1 ? 'var(--text-muted)' : 'var(--text-faint)' }}
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: inboxPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => p !== inboxPage && fetchInboxPage(p)}
                  className="text-xs px-2.5 py-1 rounded"
                  style={{
                    background: p === inboxPage ? 'var(--cyan)' : 'var(--surface)',
                    color:      p === inboxPage ? '#fff' : 'var(--text-muted)',
                    cursor: p !== inboxPage ? 'pointer' : 'default',
                    fontWeight: p === inboxPage ? 600 : 400,
                  }}
                >{p}</button>
              ))}
              <button
                disabled={inboxPage === inboxPages || inboxLoading}
                onClick={() => fetchInboxPage(inboxPage + 1)}
                style={{ background: 'none', border: 'none', cursor: inboxPage < inboxPages ? 'pointer' : 'default', color: inboxPage < inboxPages ? 'var(--text-muted)' : 'var(--text-faint)' }}
              >
                <ChevronRightIcon size={14} />
              </button>
              <span className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                {inboxCount} total
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Transactions (categorized) ── */}
      {tab === 'transactions' && (
        <div>
          <DateFilter start={txStart} end={txEnd} onApply={fetchTransactions} />
          {txLoading ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          ) : txItems.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>No categorized transactions in this date range.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {txItems.map(tx => {
                const amt = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
                return (
                  <div key={tx.id} className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', minWidth: 88 }}>{fmtDate(tx.date)}</span>
                    <span className="text-sm flex-1 truncate" style={{ color: 'var(--text)' }}>{(tx.merchant_raw ?? tx.description).trim()}</span>
                    {tx.category_name && (
                      <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--violet)' }}>{tx.category_name}</span>
                    )}
                    <span className="text-sm font-medium shrink-0"
                      style={{ color: amt >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                      {amt >= 0 ? '+' : ''}{fmt(amt, tx.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Reports ── */}
      {tab === 'reports' && (
        <div>
          <DateFilter start={rptStart} end={rptEnd} onApply={fetchReports} />
          {rptLoading ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <SectionLabel>Spend by Category (USD)</SectionLabel>
                {rptSpend.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No categorized spending in this range.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {rptSpend.map(row => {
                      const maxTotal = rptSpend[0]?.total_usd ?? 1;
                      const pct      = Math.round((row.total_usd / maxTotal) * 100);
                      return (
                        <div key={row.name}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm" style={{ color: 'var(--text)' }}>{row.name}</span>
                            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtUsd(row.total_usd)}</span>
                          </div>
                          <div className="rounded-full h-1.5" style={{ background: 'var(--surface-3)' }}>
                            <div className="rounded-full h-1.5" style={{ width: `${pct}%`, background: row.color || 'var(--cyan)' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <SectionLabel>Net Flow (USD)</SectionLabel>
                <div className="flex flex-col gap-3">
                  {[
                    { label: 'Income',   val: rptFlow.income_usd,   color: 'var(--green)', prefix: '+' },
                    { label: 'Expenses', val: rptFlow.expenses_usd, color: 'var(--red)',   prefix: '-' },
                  ].map(({ label, val, color, prefix }) => (
                    <div key={label} className="flex items-center justify-between rounded-lg px-4 py-3"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
                      <span className="text-sm font-medium" style={{ color, fontFamily: 'var(--font-mono)' }}>{prefix}{fmtUsd(val)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg px-4 py-3"
                    style={{ background: 'var(--surface)', border: `1px solid ${rptFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
                    <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>Net</span>
                    <span className="text-sm font-bold"
                      style={{ color: rptFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                      {rptFlow.net_usd >= 0 ? '+' : ''}{fmtUsd(rptFlow.net_usd)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Balances ── */}
      {tab === 'balances' && (
        <div>
          <SectionLabel>Balance Snapshots</SectionLabel>
          {snapshots.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No balance snapshots recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {snapshots.map(s => {
                const bal = Number(s.balance);
                const busd = s.balance_usd != null ? Number(s.balance_usd) : null;
                return (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', minWidth: 80 }}>{s.date}</span>
                    <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{s.account}</span>
                    {s.notes && <span className="text-xs truncate" style={{ color: 'var(--text-faint)', maxWidth: 200 }}>{s.notes}</span>}
                    <span className="text-sm font-medium shrink-0"
                      style={{ color: bal >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                      {fmt(bal, s.currency)}
                    </span>
                    {busd != null && s.currency !== 'USD' && (
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>({fmtUsd(busd)})</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Holdings ── */}
      {tab === 'holdings' && <HoldingsTab holdings={manualHoldings} asOfDate={manualHoldingsDate} onRefresh={() => router.refresh()} />}

      {/* ── FX Rates ── */}
      {tab === 'fx' && <FxRatesTab rates={fxRates} />}
    </div>
  );
}

// ── HoldingsTab ───────────────────────────────────────────────────────────────

function HoldingsTab({ holdings, asOfDate, onRefresh }: { holdings: ManualHolding[]; asOfDate: string | null; onRefresh: () => void }) {
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<ManualHolding | null>(null);
  const [assetType, setAssetType] = useState<'crypto' | 'stock'>('crypto');
  const [assetName, setAssetName] = useState('');
  const [platform, setPlatform]   = useState('');
  const [quantity, setQuantity]   = useState('');
  const [usdValue, setUsdValue]   = useState('');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  const today         = new Date().toISOString().slice(0, 10);
  const cryptoHoldings = holdings.filter(h => h.asset_type === 'crypto');
  const stockHoldings  = holdings.filter(h => h.asset_type === 'stock');
  const cryptoTotal    = cryptoHoldings.reduce((s, h) => s + Number(h.usd_value), 0);
  const stockTotal     = stockHoldings.reduce((s, h) => s + Number(h.usd_value), 0);
  const total          = cryptoTotal + stockTotal;

  function startEdit(h: ManualHolding) {
    setEditing(h); setAssetType(h.asset_type); setAssetName(h.asset_name);
    setPlatform(h.platform); setQuantity(h.quantity != null ? String(h.quantity) : '');
    setUsdValue(String(h.usd_value)); setNotes(h.notes ?? ''); setShowForm(true);
  }

  function resetForm() {
    setEditing(null); setAssetType('crypto'); setAssetName(''); setPlatform('');
    setQuantity(''); setUsdValue(''); setNotes(''); setShowForm(false);
  }

  async function save() {
    if (!assetName || !usdValue) return;
    setSaving(true); setErrorMsg(null);
    try {
      const res = await fetch('/api/finances/manual-holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing?.id, as_of_date: asOfDate ?? today,
          asset_type: assetType, asset_name: assetName,
          platform: platform || 'Manual',
          quantity: quantity ? parseFloat(quantity) : null,
          usd_value: parseFloat(usdValue), notes: notes || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErrorMsg(d.error ?? `Save failed (${res.status})`); return; }
      resetForm(); onRefresh();
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function deleteHolding(id: string) {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/finances/manual-holdings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErrorMsg(d.error ?? 'Delete failed'); return; }
      onRefresh();
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Delete failed'); }
  }

  async function duplicateSnapshot() {
    setSaving(true); setErrorMsg(null);
    try {
      const res = await fetch('/api/finances/manual-holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'duplicate_snapshot' }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErrorMsg(d.error ?? 'Duplicate failed'); return; }
      onRefresh();
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Duplicate failed'); }
    finally { setSaving(false); }
  }

  function renderGroup(label: string, items: ManualHolding[], color: string) {
    if (!items.length) return null;
    const groupTotal = items.reduce((s, h) => s + Number(h.usd_value), 0);
    return (
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <SectionLabel color={color}>{label}</SectionLabel>
          <span className="text-xs font-medium" style={{ color, fontFamily: 'var(--font-mono)' }}>{fmtUsd(groupTotal)}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {items.map(h => (
            <div key={h.id} className="flex items-center gap-3 rounded-lg px-4 py-2.5 cursor-pointer group"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              onClick={() => startEdit(h)}>
              <span className="text-sm font-medium" style={{ color: 'var(--text)', minWidth: 60 }}>{h.asset_name}</span>
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{h.platform}</span>
              {h.quantity != null && (
                <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {Number(h.quantity).toLocaleString('en-US', { maximumFractionDigits: 8 })}
                </span>
              )}
              {h.notes && <span className="text-xs truncate" style={{ color: 'var(--text-faint)', maxWidth: 160 }}>{h.notes}</span>}
              <span className="flex-1" />
              <span className="text-sm font-medium shrink-0" style={{ color, fontFamily: 'var(--font-mono)' }}>{fmtUsd(h.usd_value)}</span>
              <button onClick={e => { e.stopPropagation(); deleteHolding(h.id); }}
                className="text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--red)', cursor: 'pointer' }}>×</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <SectionLabel>Manual Holdings</SectionLabel>
          {asOfDate && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Snapshot: {asOfDate}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium" style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>Total: {fmtUsd(total)}</span>
          {holdings.length > 0 && asOfDate !== today && (
            <button onClick={duplicateSnapshot} disabled={saving}
              className="text-xs px-3 py-1.5 rounded flex items-center gap-1"
              style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
              <RefreshCw size={10} /> Duplicate to today
            </button>
          )}
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="text-xs px-3 py-1.5 rounded"
            style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
            + Add holding
          </button>
        </div>
      </div>

      {errorMsg && !showForm && <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{errorMsg}</p>}
      {holdings.length === 0 && !showForm && (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>No holdings recorded. Add one to get started.</p>
      )}

      {renderGroup('Crypto', cryptoHoldings, 'var(--yellow)')}
      {renderGroup('Stocks', stockHoldings, 'var(--green)')}

      {showForm && (
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{editing ? `Edit ${editing.asset_name}` : 'Add holding'}</p>
            <button onClick={resetForm} className="text-xs" style={{ color: 'var(--text-faint)', cursor: 'pointer' }}>Cancel</button>
          </div>
          <div className="flex items-center gap-2 mb-2">
            {(['crypto', 'stock'] as const).map(t => (
              <button key={t} onClick={() => setAssetType(t)} className="text-xs px-2.5 py-1 rounded"
                style={{ background: assetType === t ? 'rgba(6,182,212,0.15)' : 'var(--surface-3)', color: assetType === t ? 'var(--cyan)' : 'var(--text-muted)', cursor: 'pointer', border: '1px solid var(--border)' }}>
                {t === 'crypto' ? 'Crypto' : 'Stock'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="text" value={assetName} onChange={e => setAssetName(e.target.value)} placeholder="Asset (BTC, AAPL)" className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 120 }} />
            <input type="text" value={platform} onChange={e => setPlatform(e.target.value)} placeholder="Platform" className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 100 }} />
            <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Qty (opt)" className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 90 }} />
            <input type="number" value={usdValue} onChange={e => setUsdValue(e.target.value)} placeholder="USD value" className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 110 }} />
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (opt)" className="text-xs px-2 py-1.5 rounded flex-1" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded"
              style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {errorMsg && <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>{errorMsg}</p>}
        </div>
      )}
    </div>
  );
}

// ── FxRatesTab ────────────────────────────────────────────────────────────────

function FxRatesTab({ rates }: { rates: FxRate[] }) {
  const router = useRouter();
  const [date, setDate]         = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('AED');
  const [rate, setRate]         = useState('');
  const [bulkText, setBulkText] = useState('');
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<string | null>(null);

  async function addSingle() {
    if (!date || !currency || !rate) return;
    setSaving(true);
    try {
      await fetch('/api/finances/fx-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, currency, rate_to_usd: parseFloat(rate) }) });
      setRate(''); setMsg('Saved'); router.refresh();
    } catch { setMsg('Failed'); }
    finally { setSaving(false); }
  }

  async function importBulk() {
    if (!bulkText.trim()) return;
    setSaving(true);
    try {
      const parsed = bulkText.trim().split('\n').map(line => {
        const parts = line.split(/[,\t]+/).map(s => s.trim());
        if (parts.length >= 3) return { date: parts[0], currency: parts[1], rate_to_usd: parseFloat(parts[2]) };
        if (parts.length === 2) return { date, currency: parts[0], rate_to_usd: parseFloat(parts[1]) };
        return null;
      }).filter((r): r is NonNullable<typeof r> => r !== null && !isNaN(r.rate_to_usd));
      const res = await fetch('/api/finances/fx-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rates: parsed }) });
      const data = await res.json();
      setMsg(`Imported ${data.imported} rates`); setBulkText(''); router.refresh();
    } catch { setMsg('Import failed'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <SectionLabel>FX Rates (currency units per 1 USD)</SectionLabel>
      <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Add rate</p>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            {['AED', 'EUR', 'GBP', 'IDR', 'USD'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" step="0.000001" value={rate} onChange={e => setRate(e.target.value)} placeholder="Rate to USD" className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 130 }} />
          <button onClick={addSingle} disabled={saving} className="text-xs px-3 py-1.5 rounded flex items-center gap-1" style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
            <RefreshCw size={10} /> Save
          </button>
          {msg && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg}</span>}
        </div>
      </div>
      <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Bulk import (one per line: date,currency,rate or currency,rate)</p>
        <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={4} className="w-full text-xs px-2 py-1.5 rounded mb-2"
          placeholder={"AED,3.6725\nEUR,0.92\n2026-03-01,IDR,15800"}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
        <button onClick={importBulk} disabled={saving} className="text-xs px-3 py-1.5 rounded" style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>Import</button>
      </div>
      {rates.length > 0 && (
        <div className="flex flex-col gap-1">
          {rates.map(r => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg px-4 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', minWidth: 80 }}>{r.date}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--text)', minWidth: 40 }}>{r.currency}</span>
              <span className="text-xs" style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>{r.rate_to_usd}</span>
              {r.is_estimated && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(234,179,8,0.1)', color: 'var(--yellow)', fontSize: '9px' }}>est.</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

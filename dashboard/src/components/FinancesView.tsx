'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Tag, TrendingUp, TrendingDown, Wallet, ChevronDown } from 'lucide-react';

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
  amount: number;
  currency: string;
  category_id: string | null;
  category_name: string | null;
  account: string | null;
  is_income: boolean;
  status: string;
  created_at: string;
}

interface BalanceSnapshot {
  id: string;
  account: string;
  date: string;
  balance: number;
  currency: string;
  notes: string | null;
}

interface SpendRow {
  name: string;
  color: string;
  total: number;
}

interface Props {
  categories: Category[];
  uncategorized: Transaction[];
  recentTransactions: Transaction[];
  spendByCategory: SpendRow[];
  netFlow: { income: number; expenses: number; net: number };
  snapshots: BalanceSnapshot[];
}

type Tab = 'inbox' | 'transactions' | 'reports' | 'balances';

function fmt(amount: number, currency: string = 'AED'): string {
  return `${currency} ${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SectionLabel({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="mb-3" style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color }}>
      {children}
    </p>
  );
}

export default function FinancesView({ categories, uncategorized, recentTransactions, spendByCategory, netFlow, snapshots }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(uncategorized.length > 0 ? 'inbox' : 'transactions');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!form.get('file')) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await fetch('/api/finances/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadMsg(`Imported ${data.imported} transactions`);
      router.refresh();
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function categorize(txId: string, categoryId: string) {
    try {
      await fetch('/api/finances/transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: txId, category_id: categoryId }),
      });
      router.refresh();
    } catch { /* swallow */ }
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox', count: uncategorized.length },
    { key: 'transactions', label: 'Transactions' },
    { key: 'reports', label: 'Reports' },
    { key: 'balances', label: 'Balances' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Net flow summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} style={{ color: 'var(--green)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Income</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--green)' }}>{fmt(netFlow.income)}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={14} style={{ color: 'var(--red)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Expenses</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--red)' }}>{fmt(netFlow.expenses)}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} style={{ color: netFlow.net >= 0 ? 'var(--green)' : 'var(--red)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Net</span>
          </div>
          <p className="text-lg font-medium" style={{ color: netFlow.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {netFlow.net >= 0 ? '+' : '-'}{fmt(Math.abs(netFlow.net))}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 1 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="text-xs px-3 py-2 rounded-t"
            style={{
              background: tab === t.key ? 'var(--surface)' : 'transparent',
              color: tab === t.key ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: tab === t.key ? 600 : 400,
              border: tab === t.key ? '1px solid var(--border)' : '1px solid transparent',
              borderBottom: tab === t.key ? '1px solid var(--surface)' : '1px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
            }}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', fontSize: '10px' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Upload bar */}
      {(tab === 'inbox' || tab === 'transactions') && (
        <form onSubmit={handleUpload} className="flex items-center gap-3">
          <input ref={fileRef} type="file" name="file" accept=".csv" className="text-xs" style={{ color: 'var(--text-muted)' }} />
          <input type="text" name="account" placeholder="Account (optional)" className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', width: 140 }} />
          <select name="currency" defaultValue="AED" className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="AED">AED</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
          <button type="submit" disabled={uploading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
            <Upload size={12} />
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </button>
          {uploadMsg && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{uploadMsg}</span>}
        </form>
      )}

      {/* Inbox: uncategorized transactions */}
      {tab === 'inbox' && (
        <div className="flex flex-col gap-1.5">
          {uncategorized.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>All caught up — no uncategorized transactions.</p>
          ) : (
            uncategorized.map((tx) => (
              <InboxRow key={tx.id} tx={tx} categories={categories} onCategorize={categorize} />
            ))
          )}
        </div>
      )}

      {/* Recent transactions */}
      {tab === 'transactions' && (
        <div className="flex flex-col gap-1">
          {recentTransactions.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>No transactions yet. Upload a CSV to get started.</p>
          ) : (
            recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", minWidth: 80 }}>{tx.date}</span>
                <span className="text-sm flex-1 truncate" style={{ color: 'var(--text)' }}>{tx.description}</span>
                {tx.category_name && (
                  <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--violet)' }}>
                    {tx.category_name}
                  </span>
                )}
                <span className="text-sm font-medium shrink-0" style={{ color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "var(--font-mono)" }}>
                  {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount, tx.currency)}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Reports */}
      {tab === 'reports' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <SectionLabel>Spend by Category (this month)</SectionLabel>
            {spendByCategory.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No categorized spending yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {spendByCategory.map((row) => {
                  const maxTotal = spendByCategory[0]?.total ?? 1;
                  const pct = Math.round((row.total / maxTotal) * 100);
                  return (
                    <div key={row.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm" style={{ color: 'var(--text)' }}>{row.name}</span>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)', fontFamily: "var(--font-mono)" }}>{fmt(row.total)}</span>
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
            <SectionLabel>Monthly Net Flow</SectionLabel>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Income</span>
                <span className="text-sm font-medium" style={{ color: 'var(--green)', fontFamily: "var(--font-mono)" }}>+{fmt(netFlow.income)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Expenses</span>
                <span className="text-sm font-medium" style={{ color: 'var(--red)', fontFamily: "var(--font-mono)" }}>-{fmt(netFlow.expenses)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: `1px solid ${netFlow.net >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
                <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>Net</span>
                <span className="text-sm font-bold" style={{ color: netFlow.net >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "var(--font-mono)" }}>
                  {netFlow.net >= 0 ? '+' : ''}{fmt(netFlow.net)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Balance snapshots */}
      {tab === 'balances' && (
        <div>
          <SectionLabel>Balance Snapshots</SectionLabel>
          {snapshots.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No balance snapshots recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {snapshots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", minWidth: 80 }}>{s.date}</span>
                  <span className="text-sm flex-1" style={{ color: 'var(--text)' }}>{s.account}</span>
                  {s.notes && <span className="text-xs truncate" style={{ color: 'var(--text-faint)', maxWidth: 200 }}>{s.notes}</span>}
                  <span className="text-sm font-medium shrink-0" style={{ color: s.balance >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "var(--font-mono)" }}>
                    {fmt(s.balance, s.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InboxRow({ tx, categories, onCategorize }: { tx: Transaction; categories: Category[]; onCategorize: (txId: string, catId: string) => void }) {
  const [open, setOpen] = useState(false);
  const expenseCategories = categories.filter(c => !c.is_income);
  const incomeCategories = categories.filter(c => c.is_income);

  return (
    <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", minWidth: 80 }}>{tx.date}</span>
        <span className="text-sm flex-1 truncate" style={{ color: 'var(--text)' }}>{tx.description}</span>
        <span className="text-sm font-medium shrink-0" style={{ color: tx.amount >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "var(--font-mono)" }}>
          {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount, tx.currency)}
        </span>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded"
          style={{ background: 'rgba(6,182,212,0.1)', color: 'var(--cyan)', cursor: 'pointer' }}
        >
          <Tag size={10} />
          Categorize
          <ChevronDown size={10} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          {(tx.amount < 0 ? expenseCategories : incomeCategories).map((c) => (
            <button
              key={c.id}
              onClick={() => { onCategorize(tx.id, c.id); setOpen(false); }}
              className="text-xs px-2.5 py-1 rounded-full"
              style={{ background: `${c.color ?? 'var(--cyan)'}20`, color: c.color ?? 'var(--cyan)', cursor: 'pointer', border: `1px solid ${c.color ?? 'var(--cyan)'}30` }}
            >
              {c.name}
            </button>
          ))}
          {/* Show other type too, collapsed */}
          {(tx.amount < 0 ? incomeCategories : expenseCategories).length > 0 && (
            <>
              <span className="text-xs self-center px-1" style={{ color: 'var(--text-faint)' }}>|</span>
              {(tx.amount < 0 ? incomeCategories : expenseCategories).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onCategorize(tx.id, c.id); setOpen(false); }}
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{ background: 'var(--surface-3)', color: 'var(--text-faint)', cursor: 'pointer', border: '1px solid var(--border)' }}
                >
                  {c.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

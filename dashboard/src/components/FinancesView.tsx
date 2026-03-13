'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Tag, TrendingUp, TrendingDown, Wallet, ChevronDown, Bitcoin, RefreshCw } from 'lucide-react';

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
  balance_usd: number | null;
  notes: string | null;
}

interface ManualHolding {
  id: string;
  as_of_date: string;
  asset_type: 'crypto' | 'stock';
  asset_name: string;
  platform: string;
  quantity: number | null;
  usd_value: number;
  notes: string | null;
}

interface FxRate {
  id: string;
  date: string;
  currency: string;
  rate_to_usd: number;
  is_estimated: boolean;
}

interface SpendRow {
  name: string;
  color: string;
  total: number;
  total_usd: number;
}

interface Props {
  categories: Category[];
  uncategorized: Transaction[];
  recentTransactions: Transaction[];
  spendByCategory: SpendRow[];
  netFlow: { income: number; expenses: number; net: number; income_usd: number; expenses_usd: number; net_usd: number };
  snapshots: BalanceSnapshot[];
  manualHoldings: ManualHolding[];
  manualHoldingsDate: string | null;
  fxRates: FxRate[];
}

type Tab = 'inbox' | 'transactions' | 'reports' | 'balances' | 'holdings' | 'fx';

function fmtUsd(amount: number): string {
  return `$ ${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt(amount: number, currency: string = 'USD'): string {
  if (currency === 'USD') return fmtUsd(amount);
  return `${currency} ${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SectionLabel({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="mb-3" style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color }}>
      {children}
    </p>
  );
}

export default function FinancesView({ categories, uncategorized, recentTransactions, spendByCategory, netFlow, snapshots, manualHoldings, manualHoldingsDate, fxRates }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(uncategorized.length > 0 ? 'inbox' : 'transactions');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const manualCryptoTotal = manualHoldings.filter(h => h.asset_type === 'crypto').reduce((sum, h) => sum + Number(h.usd_value), 0);
  const manualStockTotal = manualHoldings.filter(h => h.asset_type === 'stock').reduce((sum, h) => sum + Number(h.usd_value), 0);
  const cashTotal = snapshots.reduce((sum, s) => sum + Number(s.balance_usd ?? 0), 0);

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
    { key: 'holdings', label: 'Crypto/Stocks' },
    { key: 'fx', label: 'FX Rates' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Net flow summary cards — USD */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} style={{ color: 'var(--green)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Income</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--green)' }}>{fmtUsd(netFlow.income_usd)}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={14} style={{ color: 'var(--red)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Expenses</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--red)' }}>{fmtUsd(netFlow.expenses_usd)}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} style={{ color: netFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Net</span>
          </div>
          <p className="text-lg font-medium" style={{ color: netFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {netFlow.net_usd >= 0 ? '+' : '-'}{fmtUsd(Math.abs(netFlow.net_usd))}
          </p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Bitcoin size={14} style={{ color: 'var(--yellow)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Crypto</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--yellow)' }}>{fmtUsd(manualCryptoTotal)}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} style={{ color: 'var(--violet)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Stocks</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--violet)' }}>{fmtUsd(manualStockTotal)}</p>
        </div>
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} style={{ color: 'var(--cyan)' }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>Cash (Banks)</span>
          </div>
          <p className="text-lg font-medium" style={{ color: 'var(--cyan)' }}>{fmtUsd(cashTotal)}</p>
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
            <option value="IDR">IDR</option>
          </select>
          <button type="submit" disabled={uploading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded" style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
            <Upload size={12} />
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </button>
          {uploadMsg && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{uploadMsg}</span>}
        </form>
      )}

      {/* Inbox */}
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

      {/* Reports — USD */}
      {tab === 'reports' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <SectionLabel>Spend by Category — USD (this month)</SectionLabel>
            {spendByCategory.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No categorized spending yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {spendByCategory.map((row) => {
                  const maxTotal = spendByCategory[0]?.total_usd ?? 1;
                  const pct = Math.round((row.total_usd / maxTotal) * 100);
                  return (
                    <div key={row.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm" style={{ color: 'var(--text)' }}>{row.name}</span>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)', fontFamily: "var(--font-mono)" }}>{fmtUsd(row.total_usd)}</span>
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
            <SectionLabel>Monthly Net Flow — USD</SectionLabel>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Income</span>
                <span className="text-sm font-medium" style={{ color: 'var(--green)', fontFamily: "var(--font-mono)" }}>+{fmtUsd(netFlow.income_usd)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Expenses</span>
                <span className="text-sm font-medium" style={{ color: 'var(--red)', fontFamily: "var(--font-mono)" }}>-{fmtUsd(netFlow.expenses_usd)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: 'var(--surface)', border: `1px solid ${netFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
                <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>Net</span>
                <span className="text-sm font-bold" style={{ color: netFlow.net_usd >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "var(--font-mono)" }}>
                  {netFlow.net_usd >= 0 ? '+' : ''}{fmtUsd(netFlow.net_usd)}
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
                  {s.balance_usd != null && s.currency !== 'USD' && (
                    <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)" }}>
                      ({fmtUsd(s.balance_usd)})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Manual holdings (Crypto/Stocks) */}
      {tab === 'holdings' && <HoldingsTab holdings={manualHoldings} asOfDate={manualHoldingsDate} />}

      {/* FX rates */}
      {tab === 'fx' && <FxRatesTab rates={fxRates} />}
    </div>
  );
}

/* ── Manual Holdings Tab (Crypto/Stocks) ── */
function HoldingsTab({ holdings, asOfDate }: { holdings: ManualHolding[]; asOfDate: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ManualHolding | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [assetType, setAssetType] = useState<'crypto' | 'stock'>('crypto');
  const [assetName, setAssetName] = useState('');
  const [platform, setPlatform] = useState('');
  const [quantity, setQuantity] = useState('');
  const [usdValue, setUsdValue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const cryptoHoldings = holdings.filter(h => h.asset_type === 'crypto');
  const stockHoldings = holdings.filter(h => h.asset_type === 'stock');
  const cryptoTotal = cryptoHoldings.reduce((sum, h) => sum + Number(h.usd_value), 0);
  const stockTotal = stockHoldings.reduce((sum, h) => sum + Number(h.usd_value), 0);
  const total = cryptoTotal + stockTotal;

  function startEdit(h: ManualHolding) {
    setEditing(h);
    setAssetType(h.asset_type);
    setAssetName(h.asset_name);
    setPlatform(h.platform);
    setQuantity(h.quantity != null ? String(h.quantity) : '');
    setUsdValue(String(h.usd_value));
    setNotes(h.notes ?? '');
    setShowForm(true);
  }

  function resetForm() {
    setEditing(null);
    setAssetType('crypto');
    setAssetName('');
    setPlatform('');
    setQuantity('');
    setUsdValue('');
    setNotes('');
    setShowForm(false);
  }

  async function save() {
    if (!assetName || !usdValue) return;
    setSaving(true);
    try {
      await fetch('/api/finances/manual-holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing?.id,
          as_of_date: asOfDate ?? today,
          asset_type: assetType,
          asset_name: assetName,
          platform: platform || 'Manual',
          quantity: quantity ? parseFloat(quantity) : null,
          usd_value: parseFloat(usdValue),
          notes: notes || null,
        }),
      });
      resetForm();
      router.refresh();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  }

  async function deleteHolding(id: string) {
    try {
      await fetch('/api/finances/manual-holdings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    } catch { /* swallow */ }
  }

  async function duplicateSnapshot() {
    setSaving(true);
    try {
      await fetch('/api/finances/manual-holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate_snapshot' }),
      });
      router.refresh();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  }

  function renderGroup(label: string, items: ManualHolding[], color: string) {
    if (items.length === 0) return null;
    const groupTotal = items.reduce((sum, h) => sum + Number(h.usd_value), 0);
    return (
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <SectionLabel color={color}>{label}</SectionLabel>
          <span className="text-xs font-medium" style={{ color, fontFamily: "var(--font-mono)" }}>{fmtUsd(groupTotal)}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {items.map((h) => (
            <div
              key={h.id}
              className="flex items-center gap-3 rounded-lg px-4 py-2.5 cursor-pointer group"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              onClick={() => startEdit(h)}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--text)', minWidth: 60 }}>{h.asset_name}</span>
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{h.platform}</span>
              {h.quantity != null && (
                <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: "var(--font-mono)" }}>
                  {Number(h.quantity).toLocaleString('en-US', { maximumFractionDigits: 8 })}
                </span>
              )}
              {h.notes && <span className="text-xs truncate" style={{ color: 'var(--text-faint)', maxWidth: 160 }}>{h.notes}</span>}
              <span className="flex-1" />
              <span className="text-sm font-medium shrink-0" style={{ color, fontFamily: "var(--font-mono)" }}>{fmtUsd(h.usd_value)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteHolding(h.id); }}
                className="text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--red)', cursor: 'pointer' }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header with total and actions */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <SectionLabel>Manual Holdings</SectionLabel>
          {asOfDate && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Snapshot: {asOfDate}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium" style={{ color: 'var(--cyan)', fontFamily: "var(--font-mono)" }}>Total: {fmtUsd(total)}</span>
          {holdings.length > 0 && asOfDate !== today && (
            <button
              onClick={duplicateSnapshot}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded flex items-center gap-1"
              style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}
            >
              <RefreshCw size={10} />
              Duplicate to today
            </button>
          )}
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="text-xs px-3 py-1.5 rounded"
            style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}
          >
            + Add holding
          </button>
        </div>
      </div>

      {holdings.length === 0 && !showForm && (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>No holdings recorded. Add one to get started.</p>
      )}

      {renderGroup('Crypto', cryptoHoldings, 'var(--yellow)')}
      {renderGroup('Stocks', stockHoldings, 'var(--green)')}

      {/* Add/edit form */}
      {showForm && (
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{editing ? `Edit ${editing.asset_name}` : 'Add holding'}</p>
            <button onClick={resetForm} className="text-xs" style={{ color: 'var(--text-faint)', cursor: 'pointer' }}>Cancel</button>
          </div>
          <div className="flex items-center gap-2 mb-2">
            {(['crypto', 'stock'] as const).map(t => (
              <button
                key={t}
                onClick={() => setAssetType(t)}
                className="text-xs px-2.5 py-1 rounded"
                style={{
                  background: assetType === t ? 'rgba(6,182,212,0.15)' : 'var(--surface-3)',
                  color: assetType === t ? 'var(--cyan)' : 'var(--text-muted)',
                  cursor: 'pointer', border: '1px solid var(--border)',
                }}
              >
                {t === 'crypto' ? 'Crypto' : 'Stock'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="text" value={assetName} onChange={e => setAssetName(e.target.value)}
              placeholder="Asset (BTC, AAPL)" className="text-xs px-2 py-1.5 rounded"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 120 }} />
            <input type="text" value={platform} onChange={e => setPlatform(e.target.value)}
              placeholder="Platform" className="text-xs px-2 py-1.5 rounded"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 100 }} />
            <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)}
              placeholder="Qty (opt)" className="text-xs px-2 py-1.5 rounded"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 90 }} />
            <input type="number" value={usdValue} onChange={e => setUsdValue(e.target.value)}
              placeholder="USD value" className="text-xs px-2 py-1.5 rounded"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 110 }} />
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes (opt)" className="text-xs px-2 py-1.5 rounded flex-1"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded"
              style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── FX Rates Tab ── */
function FxRatesTab({ rates }: { rates: FxRate[] }) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('AED');
  const [rate, setRate] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addSingle() {
    if (!date || !currency || !rate) return;
    setSaving(true);
    try {
      await fetch('/api/finances/fx-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, currency, rate_to_usd: parseFloat(rate) }),
      });
      setRate(''); setMsg('Saved');
      router.refresh();
    } catch { setMsg('Failed'); }
    finally { setSaving(false); }
  }

  async function importBulk() {
    if (!bulkText.trim()) return;
    setSaving(true);
    try {
      // Parse lines: "date,currency,rate" or "currency,rate" (uses selected date)
      const parsed = bulkText.trim().split('\n').map(line => {
        const parts = line.split(/[,\t]+/).map(s => s.trim());
        if (parts.length >= 3) return { date: parts[0], currency: parts[1], rate_to_usd: parseFloat(parts[2]) };
        if (parts.length === 2) return { date, currency: parts[0], rate_to_usd: parseFloat(parts[1]) };
        return null;
      }).filter((r): r is NonNullable<typeof r> => r !== null && !isNaN(r.rate_to_usd));

      const res = await fetch('/api/finances/fx-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: parsed }),
      });
      const data = await res.json();
      setMsg(`Imported ${data.imported} rates`);
      setBulkText('');
      router.refresh();
    } catch { setMsg('Import failed'); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <SectionLabel>FX Rates (currency units per 1 USD)</SectionLabel>

      {/* Add single rate */}
      <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Add rate</p>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="text-xs px-2 py-1.5 rounded"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="text-xs px-2 py-1.5 rounded"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <option value="AED">AED</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="IDR">IDR</option>
          </select>
          <input type="number" step="0.000001" value={rate} onChange={e => setRate(e.target.value)}
            placeholder="Rate to USD" className="text-xs px-2 py-1.5 rounded"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', width: 130 }} />
          <button onClick={addSingle} disabled={saving} className="text-xs px-3 py-1.5 rounded flex items-center gap-1"
            style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
            <RefreshCw size={10} /> Save
          </button>
          {msg && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg}</span>}
        </div>
      </div>

      {/* Bulk import */}
      <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Bulk import (one per line: date,currency,rate or currency,rate)</p>
        <textarea
          value={bulkText} onChange={e => setBulkText(e.target.value)}
          rows={4} className="w-full text-xs px-2 py-1.5 rounded mb-2"
          placeholder={"AED,3.6725\nEUR,0.92\n2026-03-01,IDR,15800"}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-mono)', resize: 'vertical' }}
        />
        <button onClick={importBulk} disabled={saving} className="text-xs px-3 py-1.5 rounded"
          style={{ background: 'rgba(6,182,212,0.15)', color: 'var(--cyan)', cursor: 'pointer' }}>
          Import
        </button>
      </div>

      {/* Rate history */}
      {rates.length > 0 && (
        <div className="flex flex-col gap-1">
          {rates.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg px-4 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)', fontFamily: "var(--font-mono)", minWidth: 80 }}>{r.date}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--text)', minWidth: 40 }}>{r.currency}</span>
              <span className="text-xs" style={{ color: 'var(--cyan)', fontFamily: "var(--font-mono)" }}>{r.rate_to_usd}</span>
              {r.is_estimated && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(234,179,8,0.1)', color: 'var(--yellow)', fontSize: '9px' }}>est.</span>}
            </div>
          ))}
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

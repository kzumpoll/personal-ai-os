'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Check, Plus, Eye } from 'lucide-react';

interface Manifestation {
  id: string;
  category: string;
  vision: string;
  why: string | null;
  timeframe: string | null;
  status: string;
  evidence: string | null;
  manifested_at: string | null;
  created_at: string;
}

const CATEGORIES = ['career', 'health', 'relationships', 'wealth', 'lifestyle', 'spiritual', 'creative', 'learning', 'travel', 'other'];

const CATEGORY_COLORS: Record<string, string> = {
  career: 'var(--cyan)', health: 'var(--green)', relationships: 'var(--pink)',
  wealth: 'var(--yellow)', lifestyle: 'var(--violet)', spiritual: 'var(--purple)',
  creative: 'var(--orange)', learning: 'var(--blue)', travel: 'var(--teal)', other: 'var(--text-muted)',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3" style={{ fontFamily: "var(--font-mono)", fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

export default function ManifestationsView({ manifestations }: { manifestations: Manifestation[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('career');
  const [vision, setVision] = useState('');
  const [why, setWhy] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const active = manifestations.filter(m => m.status === 'active');
  const manifested = manifestations.filter(m => m.status === 'manifested');
  const released = manifestations.filter(m => m.status === 'released');

  async function create() {
    if (!vision.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/manifestations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, vision, why: why || null, timeframe: timeframe || null }),
      });
      setVision(''); setWhy(''); setTimeframe(''); setShowForm(false);
      router.refresh();
    } catch { /* swallow */ }
    finally { setSaving(false); }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await fetch('/api/manifestations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      router.refresh();
    } catch { /* swallow */ }
  }

  async function updateEvidence(id: string, evidence: string) {
    try {
      await fetch('/api/manifestations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, evidence }),
      });
      router.refresh();
    } catch { /* swallow */ }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Add button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded"
          style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--violet)', cursor: 'pointer' }}
        >
          <Plus size={12} /> Add Manifestation
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className="text-xs px-2.5 py-1 rounded-full capitalize"
                style={{
                  background: category === c ? `${CATEGORY_COLORS[c]}20` : 'var(--surface-3)',
                  color: category === c ? CATEGORY_COLORS[c] : 'var(--text-muted)',
                  border: `1px solid ${category === c ? CATEGORY_COLORS[c] + '40' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <input
              value={vision} onChange={e => setVision(e.target.value)}
              placeholder="I am / I have / I attract..." className="text-sm px-3 py-2 rounded w-full"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <input
              value={why} onChange={e => setWhy(e.target.value)}
              placeholder="Why this matters to me... (optional)" className="text-xs px-3 py-1.5 rounded w-full"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <div className="flex items-center gap-2">
              <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="text-xs px-2 py-1.5 rounded"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <option value="">No timeframe</option>
                <option value="3 months">3 months</option>
                <option value="6 months">6 months</option>
                <option value="1 year">1 year</option>
                <option value="3 years">3 years</option>
                <option value="5 years">5 years</option>
              </select>
              <button onClick={create} disabled={saving} className="text-xs px-3 py-1.5 rounded ml-auto"
                style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--violet)', cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Manifest'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active manifestations */}
      {active.length > 0 && (
        <div>
          <SectionLabel>Active Visions</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {active.map(m => (
              <ManifestationCard
                key={m.id} m={m}
                expanded={expandedId === m.id}
                onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                onMarkManifested={() => updateStatus(m.id, 'manifested')}
                onRelease={() => updateStatus(m.id, 'released')}
                onUpdateEvidence={(ev) => updateEvidence(m.id, ev)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Manifested */}
      {manifested.length > 0 && (
        <div>
          <SectionLabel>Manifested</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {manifested.map(m => (
              <ManifestationCard
                key={m.id} m={m}
                expanded={expandedId === m.id}
                onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                onMarkManifested={() => {}}
                onRelease={() => updateStatus(m.id, 'active')}
                onUpdateEvidence={(ev) => updateEvidence(m.id, ev)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Released */}
      {released.length > 0 && (
        <div>
          <SectionLabel>Released</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {released.map(m => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg px-4 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.6 }}>
                <span className="text-xs capitalize" style={{ color: CATEGORY_COLORS[m.category] ?? 'var(--text-muted)' }}>{m.category}</span>
                <span className="text-sm flex-1" style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{m.vision}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {manifestations.length === 0 && (
        <div className="py-12 text-center">
          <Sparkles size={32} style={{ color: 'var(--violet)', opacity: 0.4, margin: '0 auto 12px' }} />
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Your visionboard is empty. Add your first manifestation above.</p>
        </div>
      )}
    </div>
  );
}

function ManifestationCard({ m, expanded, onToggle, onMarkManifested, onRelease, onUpdateEvidence }: {
  m: Manifestation;
  expanded: boolean;
  onToggle: () => void;
  onMarkManifested: () => void;
  onRelease: () => void;
  onUpdateEvidence: (ev: string) => void;
}) {
  const [evidence, setEvidence] = useState(m.evidence ?? '');
  const color = CATEGORY_COLORS[m.category] ?? 'var(--text-muted)';
  const isManifested = m.status === 'manifested';

  return (
    <div
      className="rounded-lg p-4 cursor-pointer"
      style={{ background: 'var(--surface)', border: `1px solid ${isManifested ? 'var(--green)' : 'var(--border)'}` }}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2 mb-2">
        <Sparkles size={14} style={{ color, flexShrink: 0, marginTop: 2 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs capitalize px-1.5 py-0.5 rounded" style={{ background: `${color}15`, color, fontSize: '10px' }}>{m.category}</span>
            {m.timeframe && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{m.timeframe}</span>}
            {isManifested && <Check size={12} style={{ color: 'var(--green)' }} />}
          </div>
          <p className="text-sm" style={{ color: isManifested ? 'var(--green)' : 'var(--text)', fontWeight: 500 }}>{m.vision}</p>
          {m.why && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{m.why}</p>}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
          <textarea
            value={evidence} onChange={e => setEvidence(e.target.value)}
            onBlur={() => { if (evidence !== (m.evidence ?? '')) onUpdateEvidence(evidence); }}
            placeholder="Evidence / signs of progress..."
            rows={2} className="text-xs px-2 py-1.5 rounded w-full"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', resize: 'vertical' }}
          />
          <div className="flex items-center gap-2">
            {!isManifested && (
              <button onClick={onMarkManifested} className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)', cursor: 'pointer' }}>
                <Check size={10} /> Manifested
              </button>
            )}
            <button onClick={onRelease} className="text-xs px-2 py-1 rounded"
              style={{ background: 'var(--surface-3)', color: 'var(--text-faint)', cursor: 'pointer' }}>
              {isManifested ? 'Reactivate' : 'Release'}
            </button>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-faint)' }}>
              {new Date(m.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

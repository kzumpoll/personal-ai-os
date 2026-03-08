import pool, { Idea, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import DeleteButton from '@/components/DeleteButton';

function toDateStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function fmtDate(d: unknown): string {
  const s = toDateStr(d);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parts[1] - 1]} ${String(parts[2]).padStart(2, '0')}`;
}

const actionabilityColors: Record<string, { color: string; bg: string }> = {
  high:   { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  low:    { color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
};

async function getData() {
  try {
    const { rows } = await pool.query<Idea>(
      "SELECT * FROM ideas WHERE status = 'active' ORDER BY created_at DESC"
    );
    return rows;
  } catch (err) {
    logDbError('ideas', err);
    return [] as Idea[];
  }
}

export const revalidate = 30;

export default async function IdeasPage() {
  const ideas = await getData();
  const highCount = ideas.filter((i) => i.actionability === 'high').length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Ideas"
        subtitle={`${ideas.length} captured${highCount > 0 ? ` · ${highCount} high-actionability` : ''}`}
      />

      {ideas.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No ideas yet. Add one via Telegram.</p>
      ) : (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--border)' }}
        >
          {/* Table header */}
          <div
            className="grid gap-4 px-4 py-2"
            style={{
              gridTemplateColumns: '1fr 100px 60px 24px',
              background: 'var(--surface)',
              borderBottom: '1px solid var(--border)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
            }}
          >
            <span>Idea</span>
            <span>Actionability</span>
            <span style={{ textAlign: 'right' }}>Date</span>
            <span />
          </div>

          {/* Rows */}
          {ideas.map((idea, i) => {
            const actionKey = idea.actionability?.toLowerCase() ?? '';
            const actionCfg = actionabilityColors[actionKey] ?? null;

            return (
              <div
                key={idea.id}
                className="px-4 py-3 group"
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  background: i % 2 === 0 ? 'var(--bg)' : 'var(--surface)',
                }}
              >
                {/* Main row */}
                <div
                  className="grid gap-4 items-start"
                  style={{ gridTemplateColumns: '1fr 100px 60px 24px' }}
                >
                  <p className="text-sm leading-snug" style={{ color: 'var(--text)' }}>
                    {idea.content}
                  </p>

                  <div>
                    {idea.actionability ? (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full capitalize"
                        style={
                          actionCfg
                            ? { color: actionCfg.color, background: actionCfg.bg, fontWeight: 500 }
                            : { color: 'var(--text-muted)', background: 'var(--surface-2)' }
                        }
                      >
                        {idea.actionability}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>—</span>
                    )}
                  </div>

                  <p
                    className="text-xs text-right"
                    style={{ color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {fmtDate(idea.created_at)}
                  </p>

                  <DeleteButton id={idea.id} endpoint="/api/ideas" />
                </div>

                {/* Next step sub-row */}
                {idea.next_step && (
                  <div className="mt-2 flex items-start gap-1.5">
                    <span
                      className="text-xs shrink-0 mt-0.5"
                      style={{ color: 'var(--cyan)', fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      →
                    </span>
                    <p className="text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>
                      {idea.next_step}
                    </p>
                  </div>
                )}

                {/* Promoted to project badge */}
                {idea.linked_project_id && (
                  <div className="mt-1.5">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ color: 'var(--violet)', background: 'rgba(139,92,246,0.12)', fontWeight: 500 }}
                    >
                      promoted to project
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

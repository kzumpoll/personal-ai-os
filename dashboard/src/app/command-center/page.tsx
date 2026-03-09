import { format, formatDistanceToNow } from 'date-fns';
import pool, { Task, Journal, logDbError } from '@/lib/db';
import { getLocalToday } from '@/lib/date';
import PageHeader from '@/components/PageHeader';

interface MutationLog {
  id: string;
  action: string;
  table_name: string;
  record_id: string | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

interface Idea { id: string; content: string; created_at: string; }
interface Thought { id: string; content: string; created_at: string; }
interface ClaudeStatus {
  status: 'idle' | 'running' | 'waiting_for_permission';
  current_task: string | null;
  permission_request: string | null;
  updated_at: string | null;
}

interface BackendHealth {
  git_commit: string | null;
  git_branch: string | null;
  status: string;
  deployed_at: string | null;
}

async function getData() {
  const today = getLocalToday();
  const empty = {
    openCount: 0, overdueCount: 0, doneCount: 0,
    journal: null as Journal | null,
    mutations: [] as MutationLog[], ideas: [] as Idea[], thoughts: [] as Thought[],
    completedToday: [] as Task[], todayStr: today,
    claudeStatus: null as ClaudeStatus | null,
    backendHealth: null as BackendHealth | null,
  };

  try {
    const [
      openRes, overdueRes, doneRes,
      journalRes, mutRes,
      ideasRes, thoughtsRes, claudeRes,
    ] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*) FROM tasks WHERE status = 'todo'`),
      pool.query<{ count: string }>(`SELECT COUNT(*) FROM tasks WHERE status = 'todo' AND due_date < $1`, [today]),
      pool.query<{ count: string }>(`SELECT COUNT(*) FROM tasks WHERE status = 'done' AND completed_at::date = $1`, [today]),
      pool.query<Journal>('SELECT * FROM journals WHERE entry_date = $1', [today]),
      pool.query<MutationLog>(
        `SELECT * FROM mutation_log WHERE created_at::date = $1 ORDER BY created_at DESC LIMIT 12`,
        [today]
      ),
      pool.query<Idea>(`SELECT * FROM ideas ORDER BY created_at DESC LIMIT 5`),
      pool.query<Thought>(`SELECT * FROM thoughts ORDER BY created_at DESC LIMIT 5`),
      pool.query<ClaudeStatus>(
        `SELECT status, current_task, permission_request, updated_at FROM claude_code_status WHERE id = 'default'`
      ).catch(() => ({ rows: [] as ClaudeStatus[] })),
    ]);

    // Fetch backend health in parallel with the completed-today query
    const backendUrl = process.env.BACKEND_URL;
    const [completedTodayTasks, backendHealthRes] = await Promise.all([
      pool.query<Task>(
        `SELECT * FROM tasks WHERE status = 'done' AND completed_at::date = $1 ORDER BY completed_at DESC LIMIT 8`,
        [today]
      ),
      backendUrl
        ? fetch(`${backendUrl}/health`, { next: { revalidate: 60 } })
            .then((r) => r.json() as Promise<BackendHealth>)
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    const result = {
      openCount:    parseInt(openRes.rows[0]?.count ?? '0'),
      overdueCount: parseInt(overdueRes.rows[0]?.count ?? '0'),
      doneCount:    parseInt(doneRes.rows[0]?.count ?? '0'),
      journal:      journalRes.rows[0] ?? null,
      mutations:    mutRes.rows,
      ideas:        ideasRes.rows,
      thoughts:     thoughtsRes.rows,
      completedToday: completedTodayTasks.rows,
      todayStr:     today,
      claudeStatus: claudeRes.rows[0] ?? null,
      backendHealth: backendHealthRes,
    };
    console.log(
      `[command-center] query results — open:${result.openCount} overdue:${result.overdueCount}` +
      ` done:${result.doneCount} mutations:${result.mutations.length}` +
      ` ideas:${result.ideas.length} thoughts:${result.thoughts.length}` +
      ` completedToday:${result.completedToday.length} journal:${result.journal ? 'yes' : 'none'}`
    );
    return result;
  } catch (err) {
    logDbError('command-center', err);
    return empty;
  }
}

export const revalidate = 30;

function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: accent ? `2px solid ${accent}` : '1px solid var(--border)',
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p
      className="mb-3"
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '10px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color,
      }}
    >
      {children}
    </p>
  );
}

function MetricCell({
  value, label, color,
}: { value: number | string; label: string; color: string }) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-1"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <span
        className="text-2xl font-bold"
        style={{ color, fontFamily: "'JetBrains Mono', monospace" }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function fmtAction(action: string, table: string): { label: string; color: string } {
  if (action === 'create')      return { label: `+ ${table.replace(/s$/, '')} created`, color: 'var(--green)' };
  if (action === 'complete')    return { label: '✓ task completed', color: 'var(--cyan)' };
  if (action === 'move_date')   return { label: '→ task rescheduled', color: 'var(--blue)' };
  if (action === 'upsert')      return { label: '✎ journal updated', color: 'var(--violet)' };
  if (action.startsWith('undo')) return { label: '↩ undone', color: 'var(--amber)' };
  return { label: action, color: 'var(--text-muted)' };
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default async function CommandCenterPage() {
  const {
    openCount, overdueCount, doneCount,
    journal, mutations, ideas, thoughts, completedToday, todayStr, claudeStatus, backendHealth,
  } = await getData();

  const dateLabel = format(new Date(getLocalToday() + 'T12:00:00'), 'EEEE, MMMM d');

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Command Center" subtitle={dateLabel} badge="LIVE" badgeColor="cyan" />

      {/* Metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <MetricCell value={openCount}    label="Open tasks"    color="var(--text)" />
        <MetricCell value={overdueCount} label="Overdue"       color={overdueCount > 0 ? 'var(--red)' : 'var(--text)'} />
        <MetricCell value={doneCount}    label="Done today"    color="var(--cyan)" />
        <MetricCell value={ideas.length} label="Ideas"         color="var(--violet)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Focus / Active priorities */}
          {journal ? (
            <Card accent="var(--cyan)">
              <SectionTitle color="var(--cyan)">Active Priorities — {todayStr}</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {journal.mit && (
                  <div>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--cyan)', marginBottom: 4 }}>MIT</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{journal.mit}</p>
                  </div>
                )}
                {journal.k1 && (
                  <div>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--blue)', marginBottom: 4 }}>K1</p>
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{journal.k1}</p>
                  </div>
                )}
                {journal.k2 && (
                  <div>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', letterSpacing: '0.14em', color: 'var(--violet)', marginBottom: 4 }}>K2</p>
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{journal.k2}</p>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <SectionTitle>Active Priorities</SectionTitle>
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                No debrief for today. Run <span style={{ color: 'var(--text-muted)' }}>daily debrief</span> in Telegram to set focus.
              </p>
            </Card>
          )}

          {/* Changes today — mutation log */}
          <Card>
            <SectionTitle>Changes Today</SectionTitle>
            {mutations.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No changes recorded yet today.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {mutations.map((m) => {
                  const { label, color } = fmtAction(m.action, m.table_name);
                  const title = (m.after_data as Record<string, unknown> | null)?.title as string | undefined
                    ?? (m.after_data as Record<string, unknown> | null)?.content as string | undefined;
                  return (
                    <div key={m.id} className="flex items-center gap-3 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: 'var(--text-faint)', minWidth: 40 }}>
                        {fmtTime(m.created_at)}
                      </span>
                      <span style={{ fontSize: '12px', color }}>{label}</span>
                      {title && (
                        <span className="text-xs truncate" style={{ color: 'var(--text-muted)', maxWidth: 200 }}>
                          — {String(title).slice(0, 60)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Completed today */}
          {completedToday.length > 0 && (
            <Card accent="var(--green)">
              <SectionTitle color="var(--green)">Completed Today — {completedToday.length}</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {completedToday.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span style={{ fontSize: '11px', color: 'var(--green)' }}>✓</span>
                    <span className="text-sm" style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{t.title}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">

          {/* Recent ideas */}
          <Card accent="var(--violet)">
            <SectionTitle color="var(--violet)">Recent Ideas</SectionTitle>
            {ideas.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No ideas saved yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {ideas.map((idea) => (
                  <p key={idea.id} className="text-sm leading-snug" style={{ color: 'var(--text-dim)' }}>
                    {idea.content.slice(0, 80)}{idea.content.length > 80 ? '…' : ''}
                  </p>
                ))}
              </div>
            )}
          </Card>

          {/* Recent thoughts */}
          <Card accent="var(--blue)">
            <SectionTitle color="var(--blue)">Recent Thoughts</SectionTitle>
            {thoughts.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No thoughts saved yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {thoughts.map((t) => (
                  <p key={t.id} className="text-sm leading-snug" style={{ color: 'var(--text-dim)' }}>
                    {t.content.slice(0, 80)}{t.content.length > 80 ? '…' : ''}
                  </p>
                ))}
              </div>
            )}
          </Card>

          {/* Deploy info */}
          {(() => {
            const frontendSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
            const frontendMsg = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null;
            const backendSha = backendHealth?.git_commit ?? null;
            const mismatch = frontendSha && backendSha && frontendSha !== backendSha;
            if (!frontendSha && !backendSha) return null;
            return (
              <Card>
                <SectionTitle>Deploy State</SectionTitle>
                <div className="flex flex-col gap-2">
                  {frontendSha && (
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Frontend</span>
                      <div className="flex items-center gap-1.5">
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: 'var(--cyan)' }}>[{frontendSha}]</span>
                        {frontendMsg && <span className="text-xs truncate" style={{ color: 'var(--text-muted)', maxWidth: 120 }}>{frontendMsg.slice(0, 40)}</span>}
                      </div>
                    </div>
                  )}
                  {backendSha && (
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Backend</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: mismatch ? 'var(--amber)' : 'var(--cyan)' }}>[{backendSha}]</span>
                    </div>
                  )}
                  {!backendSha && (
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Backend</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: 'var(--text-faint)' }}>unreachable</span>
                    </div>
                  )}
                  {mismatch && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span style={{ fontSize: '10px', color: 'var(--amber)' }}>⚠ Versions differ — backend may be deploying</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-1">
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: 'var(--text-faint)' }}>
                      {process.env.VERCEL_GIT_COMMIT_REF ?? 'main'} branch
                    </span>
                    {backendHealth?.deployed_at && (
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: 'var(--text-faint)' }}>
                        deployed {formatDistanceToNow(new Date(backendHealth.deployed_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })()}

          {/* System status */}
          <Card>
            <SectionTitle>System Status</SectionTitle>
            <div className="flex flex-col gap-2">
              {[
                { label: 'Database', status: 'online', color: 'var(--green)' },
                { label: 'Telegram Bot', status: 'active', color: 'var(--green)' },
                { label: 'Mutation Log', status: `${mutations.length} events`, color: 'var(--cyan)' },
              ].map(({ label, status, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color }}>{status}</span>
                </div>
              ))}
              {/* Claude Code — live from DB */}
              {(() => {
                const cs = claudeStatus;
                const statusColor = cs?.status === 'running'
                  ? 'var(--blue)'
                  : cs?.status === 'waiting_for_permission'
                  ? 'var(--amber)'
                  : 'var(--green)';
                const statusLabel = cs?.status ?? 'idle';
                const ago = cs?.updated_at
                  ? formatDistanceToNow(new Date(cs.updated_at), { addSuffix: true })
                  : null;
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Claude Code</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: statusColor }}>
                        {statusLabel}
                      </span>
                    </div>
                    {cs?.current_task && (
                      <div className="pl-2">
                        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>↳ {cs.current_task.slice(0, 60)}</span>
                      </div>
                    )}
                    {cs?.permission_request && (
                      <div className="pl-2">
                        <span style={{ fontSize: '11px', color: 'var(--amber)' }}>⚠ {cs.permission_request.slice(0, 60)}</span>
                      </div>
                    )}
                    {ago && (
                      <div className="flex justify-end">
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: 'var(--text-faint)' }}>
                          updated {ago}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

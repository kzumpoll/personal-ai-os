import pool, { Project, Task, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import { formatDistanceToNow } from 'date-fns';

async function getData() {
  try {
    const [projectsRes, openRes, doneRes] = await Promise.all([
      pool.query<Project>('SELECT * FROM projects ORDER BY status ASC, created_at DESC'),
      pool.query<Task>("SELECT * FROM tasks WHERE status = 'todo' AND project_id IS NOT NULL"),
      pool.query<Task>("SELECT * FROM tasks WHERE status = 'done' AND project_id IS NOT NULL"),
    ]);

    const openByProject: Record<string, Task[]> = {};
    const doneByProject: Record<string, number> = {};

    for (const t of openRes.rows) {
      if (t.project_id) {
        openByProject[t.project_id] = openByProject[t.project_id] ?? [];
        openByProject[t.project_id].push(t);
      }
    }
    for (const t of doneRes.rows) {
      if (t.project_id) {
        doneByProject[t.project_id] = (doneByProject[t.project_id] ?? 0) + 1;
      }
    }

    return { projects: projectsRes.rows, openByProject, doneByProject };
  } catch (err) {
    logDbError('projects', err);
    return { projects: [] as Project[], openByProject: {} as Record<string, Task[]>, doneByProject: {} as Record<string, number> };
  }
}

function toDateStr(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: 'Active',   color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  planning:  { label: 'Planning', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  paused:    { label: 'Paused',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  completed: { label: 'Done',     color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
};

export const revalidate = 30;

function ProjectCard({ project: p, open, done }: { project: Project; open: Task[]; done: number }) {
  const total = open.length + done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const cfg = statusConfig[p.status] ?? statusConfig.planning;

  let relativeTime = '';
  try {
    relativeTime = formatDistanceToNow(new Date(toDateStr(p.created_at)), { addSuffix: true });
  } catch {
    relativeTime = '';
  }

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm leading-snug" style={{ color: 'var(--text)' }}>
            {p.title}
          </h2>
          {p.description && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
              {p.description}
            </p>
          )}
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full shrink-0"
          style={{ color: cfg.color, background: cfg.bg, fontWeight: 500 }}
        >
          {cfg.label}
        </span>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
            {pct}%
          </span>
          <span className="text-xs" style={{ color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
            {done}/{total}
          </span>
        </div>
        <div className="w-full rounded-full" style={{ height: 4, background: 'var(--surface-3)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct === 100 ? 'var(--green)' : cfg.color }}
          />
        </div>
      </div>

      {open.length > 0 && (
        <div className="flex flex-col gap-1 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          {open.slice(0, 3).map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--border-2)' }} />
              <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{t.title}</span>
            </div>
          ))}
          {open.length > 3 && (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>+{open.length - 3} more</span>
          )}
        </div>
      )}

      <p className="text-xs mt-auto" style={{ color: 'var(--text-faint)' }}>
        Created {relativeTime}
      </p>
    </div>
  );
}

export default async function ProjectsPage() {
  const { projects, openByProject, doneByProject } = await getData();

  const activeProjects = projects.filter((p) => p.status === 'active');
  const otherProjects = projects.filter((p) => p.status !== 'active');

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} total · ${activeProjects.length} active`}
      />

      {projects.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No projects yet. Create one via Telegram.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {activeProjects.length > 0 && (
            <section>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                Active
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeProjects.map((p) => (
                  <ProjectCard key={p.id} project={p} open={openByProject[p.id] ?? []} done={doneByProject[p.id] ?? 0} />
                ))}
              </div>
            </section>
          )}

          {otherProjects.length > 0 && (
            <section>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                Other
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {otherProjects.map((p) => (
                  <ProjectCard key={p.id} project={p} open={openByProject[p.id] ?? []} done={doneByProject[p.id] ?? 0} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

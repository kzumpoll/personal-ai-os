import pool, { Goal, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';

async function getData() {
  try {
    const { rows } = await pool.query<Goal>('SELECT * FROM goals ORDER BY status ASC, quarter DESC, created_at DESC');
    return rows;
  } catch (err) {
    logDbError('goals', err);
    return [] as Goal[];
  }
}

export const revalidate = 30;

const QUARTER_END: Record<string, string> = {
  Q1: 'Mar 31', Q2: 'Jun 30', Q3: 'Sep 30', Q4: 'Dec 31',
};

function quarterEndLabel(quarter: string): string {
  const [year, q] = quarter.split('-');
  const end = QUARTER_END[q];
  return end ? `ends ${end} ${year}` : '';
}

function inferQuarter(g: Goal): string {
  if (g.quarter) return g.quarter;
  if (g.target_date) {
    const d = new Date(String(g.target_date).slice(0, 10) + 'T12:00:00');
    return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
  }
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
}

export default async function GoalsPage() {
  const goals = await getData();
  const active = goals.filter((g) => g.status === 'active');
  const archived = goals.filter((g) => g.status !== 'active');

  const byQuarter = new Map<string, Goal[]>();
  for (const g of active) {
    const q = inferQuarter(g);
    if (!byQuarter.has(q)) byQuarter.set(q, []);
    byQuarter.get(q)!.push(g);
  }
  const quarters = Array.from(byQuarter.keys()).sort((a, b) => b.localeCompare(a));

  const now = new Date();
  const currentQuarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Goals" subtitle={`${active.length} active`} />

      {active.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No goals yet. Add one via Telegram.</p>
      )}

      {quarters.map((quarter) => {
        const qGoals = byQuarter.get(quarter)!;
        const isCurrent = quarter === currentQuarter;
        const [year, q] = quarter.split('-');

        return (
          <div key={quarter} className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '10px',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: isCurrent ? 'var(--cyan)' : 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                {q} {year}
              </span>
              {isCurrent && (
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(6,182,212,0.12)', color: 'var(--cyan)', fontFamily: "'JetBrains Mono', monospace", fontSize: '9px' }}
                >
                  current
                </span>
              )}
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: 'var(--text-faint)' }}>
                {quarterEndLabel(quarter)}
              </span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: 'var(--text-faint)' }}>
                {qGoals.length}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {qGoals.map((g) => <GoalRow key={g.id} goal={g} />)}
            </div>
          </div>
        );
      })}

      {archived.length > 0 && (
        <div className="mt-8 opacity-50">
          <div className="flex items-center gap-3 mb-3">
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '10px',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-faint)',
                fontWeight: 600,
              }}
            >
              Archived
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          <div className="flex flex-col gap-3">
            {archived.map((g) => <GoalRow key={g.id} goal={g} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function GoalRow({ goal }: { goal: Goal }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: '2px solid var(--violet)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{goal.title}</p>
        {goal.target_date && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '10px',
              color: 'var(--text-faint)',
              whiteSpace: 'nowrap',
            }}
          >
            {String(goal.target_date).slice(0, 10)}
          </span>
        )}
      </div>
      {goal.description && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{goal.description}</p>
      )}
    </div>
  );
}

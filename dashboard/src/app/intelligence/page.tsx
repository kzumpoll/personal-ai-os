import { format } from 'date-fns';
import pool, { logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';

interface Idea { id: string; content: string; actionability: string | null; created_at: string; }
interface Thought { id: string; content: string; created_at: string; }
interface Win { id: string; content: string; entry_date: string; created_at: string; }
interface Goal { id: string; title: string; description: string | null; status: string; target_date: string | null; }

async function getData() {
  const empty = { ideas: [] as Idea[], thoughts: [] as Thought[], wins: [] as Win[], goals: [] as Goal[] };
  try {
    const [ideasRes, thoughtsRes, winsRes, goalsRes] = await Promise.all([
      pool.query<Idea>('SELECT * FROM ideas ORDER BY created_at DESC LIMIT 20'),
      pool.query<Thought>('SELECT * FROM thoughts ORDER BY created_at DESC LIMIT 20'),
      pool.query<Win>('SELECT * FROM wins ORDER BY entry_date DESC LIMIT 20'),
      pool.query<Goal>(`SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 10`),
    ]);
    return {
      ideas:    ideasRes.rows,
      thoughts: thoughtsRes.rows,
      wins:     winsRes.rows,
      goals:    goalsRes.rows,
    };
  } catch (err) {
    logDbError('intelligence', err);
    return empty;
  }
}

export const revalidate = 60;

function SectionTitle({ children, color = 'var(--text-muted)' }: { children: React.ReactNode; color?: string }) {
  return (
    <p
      className="mb-4"
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '10px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color,
        borderBottom: '1px solid var(--border)',
        paddingBottom: 8,
      }}
    >
      {children}
    </p>
  );
}

function fmtDate(d: string): string {
  const s = String(d).slice(0, 10);
  const parts = s.split('-').map(Number);
  if (parts.length !== 3) return s;
  const [y, m, day] = parts;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${String(day).padStart(2, '0')}, ${y}`;
}

function CaptureCard({ content, meta, accent }: { content: string; meta?: string; accent: string }) {
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <p className="text-sm leading-snug" style={{ color: 'var(--text-dim)' }}>
        {content}
      </p>
      {meta && (
        <p
          className="mt-1.5"
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: 'var(--text-faint)' }}
        >
          {meta}
        </p>
      )}
    </div>
  );
}

function PlaceholderBlock({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="rounded-lg p-5 text-center"
      style={{ border: '1px dashed var(--border)', background: 'transparent' }}
    >
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{title}</p>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{description}</p>
    </div>
  );
}

export default async function IntelligencePage() {
  const { ideas, thoughts, wins, goals } = await getData();
  const dateLabel = format(new Date(), 'EEEE, MMMM d');

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Intelligence" subtitle={dateLabel} badge="BETA" badgeColor="violet" />

      {/* Placeholder insights — wired later to real AI summaries */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <PlaceholderBlock
          title="Daily Digest"
          description="AI-generated summary of your day — coming soon"
        />
        <PlaceholderBlock
          title="Pattern Recognition"
          description="Recurring themes across captures — coming soon"
        />
        <PlaceholderBlock
          title="Weekly Briefing"
          description="Progress vs goals summary — coming soon"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Ideas */}
        <section>
          <SectionTitle color="var(--violet)">Ideas &nbsp;{ideas.length}</SectionTitle>
          <div className="flex flex-col gap-2">
            {ideas.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No ideas yet. Tell Telegram an idea to capture it.</p>
            ) : (
              ideas.map((idea) => (
                <CaptureCard
                  key={idea.id}
                  content={idea.content}
                  meta={idea.actionability ?? fmtDate(idea.created_at)}
                  accent="var(--violet)"
                />
              ))
            )}
          </div>
        </section>

        {/* Thoughts */}
        <section>
          <SectionTitle color="var(--blue)">Thoughts &nbsp;{thoughts.length}</SectionTitle>
          <div className="flex flex-col gap-2">
            {thoughts.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No thoughts yet. Say "I've been thinking about X" in Telegram.</p>
            ) : (
              thoughts.map((t) => (
                <CaptureCard
                  key={t.id}
                  content={t.content}
                  meta={fmtDate(t.created_at)}
                  accent="var(--blue)"
                />
              ))
            )}
          </div>
        </section>

        {/* Wins */}
        <section>
          <SectionTitle color="var(--green)">Wins &nbsp;{wins.length}</SectionTitle>
          <div className="flex flex-col gap-2">
            {wins.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No wins logged yet. Log a win in Telegram.</p>
            ) : (
              wins.map((w) => (
                <CaptureCard
                  key={w.id}
                  content={w.content}
                  meta={fmtDate(w.entry_date)}
                  accent="var(--green)"
                />
              ))
            )}
          </div>
        </section>

        {/* Active goals */}
        <section>
          <SectionTitle color="var(--amber)">Active Goals &nbsp;{goals.length}</SectionTitle>
          <div className="flex flex-col gap-2">
            {goals.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No active goals. Say "add goal: X" in Telegram.</p>
            ) : (
              goals.map((g) => (
                <div
                  key={g.id}
                  className="rounded-md p-3"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderLeft: '2px solid var(--amber)',
                  }}
                >
                  <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{g.title}</p>
                  {g.description && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{g.description}</p>
                  )}
                  {g.target_date && (
                    <p
                      className="mt-1"
                      style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', color: 'var(--text-faint)' }}
                    >
                      Target: {fmtDate(g.target_date)}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

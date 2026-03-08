import { format } from 'date-fns';
import pool, { Thought, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import DeleteButton from '@/components/DeleteButton';

async function getData() {
  try {
    const { rows } = await pool.query<Thought>('SELECT * FROM thoughts ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    logDbError('thoughts', err);
    return [] as Thought[];
  }
}

export const revalidate = 30;

export default async function ThoughtsPage() {
  const thoughts = await getData();

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Thoughts" subtitle={`${thoughts.length} thoughts`} />

      {thoughts.length === 0 ? (
        <p className="text-sm text-[#555]">No thoughts yet. Add one via Telegram.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {thoughts.map((t) => (
            <div
              key={t.id}
              className="group rounded-lg p-4 flex items-start justify-between gap-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p className="text-sm leading-relaxed flex-1" style={{ color: 'var(--text)' }}>{t.content}</p>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs mt-0.5" style={{ color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {format(new Date(t.created_at), 'MMM d')}
                </span>
                <DeleteButton id={t.id} endpoint="/api/thoughts" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

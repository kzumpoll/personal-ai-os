import pool, { Thought, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import ThoughtsTable from '@/components/ThoughtsTable';

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
      <PageHeader title="Thoughts" subtitle={`${thoughts.length} captured`} />

      {thoughts.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No thoughts yet. Add one via Telegram.</p>
      ) : (
        <ThoughtsTable thoughts={thoughts} />
      )}
    </div>
  );
}

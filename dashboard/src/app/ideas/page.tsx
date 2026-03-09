import pool, { Idea, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import IdeasTable from '@/components/IdeasTable';

async function getData() {
  try {
    const { rows } = await pool.query<Idea>(
      'SELECT * FROM ideas ORDER BY created_at DESC'
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
  const activeCount = ideas.filter((i) => i.status === 'active').length;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Ideas"
        subtitle={`${ideas.length} captured${activeCount > 0 ? ` · ${activeCount} active` : ''}`}
      />

      <IdeasTable ideas={ideas} />
    </div>
  );
}

import pool, { Resource, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import ResourceList from '@/components/ResourceList';

async function getData() {
  try {
    const { rows } = await pool.query<Resource>('SELECT * FROM resources ORDER BY created_at DESC');
    return rows;
  } catch (err) {
    logDbError('resources', err);
    return [] as Resource[];
  }
}

export const revalidate = 30;

export default async function ResourcesPage() {
  const resources = await getData();

  return (
    <div className="max-w-2xl">
      <PageHeader title="Resources" subtitle={`${resources.length} saved`} />
      <ResourceList resources={resources} />
    </div>
  );
}

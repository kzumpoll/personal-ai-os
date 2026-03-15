import pool, { Goal, logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import LifeOSView from '@/components/LifeOSView';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

async function getData() {
  const [identityRes, goalsRes, manifestationsRes] = await Promise.allSettled([
    pool.query(`SELECT key, content FROM life_identity ORDER BY id`),
    pool.query<Goal>('SELECT * FROM goals ORDER BY status ASC, quarter DESC, created_at DESC'),
    pool.query<Manifestation>(
      `SELECT * FROM manifestations ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'manifested' THEN 1 ELSE 2 END,
        created_at DESC`
    ),
  ]);

  const identity: Record<string, string> = {};
  if (identityRes.status === 'fulfilled') {
    for (const r of identityRes.value.rows) identity[r.key as string] = r.content as string;
  } else {
    logDbError('lifeos/identity', identityRes.reason);
  }

  const goals: Goal[] = goalsRes.status === 'fulfilled'
    ? goalsRes.value.rows
    : (logDbError('lifeos/goals', goalsRes.reason), []);

  const manifestations: Manifestation[] = manifestationsRes.status === 'fulfilled'
    ? manifestationsRes.value.rows
    : (logDbError('lifeos/manifestations', manifestationsRes.reason), []);

  return JSON.parse(JSON.stringify({ identity, goals, manifestations })) as {
    identity: Record<string, string>;
    goals: Goal[];
    manifestations: Manifestation[];
  };
}

export default async function LifeOSPage() {
  const { identity, goals, manifestations } = await getData();
  const activeGoals = goals.filter(g => g.status === 'active');
  const activeManifestations = manifestations.filter(m => m.status === 'active');

  return (
    <div>
      <PageHeader
        title="Life OS"
        subtitle={`${activeGoals.length} active goals · ${activeManifestations.length} active manifestations`}
      />
      <LifeOSView identity={identity} goals={goals} manifestations={manifestations} />
    </div>
  );
}

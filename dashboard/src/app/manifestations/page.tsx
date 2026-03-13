import pool, { logDbError } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import ManifestationsView from '@/components/ManifestationsView';

export const dynamic = 'force-dynamic';

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
  try {
    const { rows } = await pool.query<Manifestation>(
      `SELECT * FROM manifestations ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'manifested' THEN 1 ELSE 2 END,
        created_at DESC`
    );
    return { manifestations: rows };
  } catch (err) {
    logDbError('manifestations', err);
    return { manifestations: [] as Manifestation[] };
  }
}

export default async function ManifestationsPage() {
  const { manifestations } = await getData();
  const active = manifestations.filter(m => m.status === 'active');
  const manifested = manifestations.filter(m => m.status === 'manifested');

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Visionboard"
        subtitle={`${active.length} active manifestations${manifested.length ? ` · ${manifested.length} manifested` : ''}`}
      />
      <ManifestationsView manifestations={manifestations} />
    </div>
  );
}

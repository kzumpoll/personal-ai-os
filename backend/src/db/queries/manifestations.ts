import pool from '../client';

export interface Manifestation {
  id: string;
  category: string;
  vision: string;
  why: string | null;
  timeframe: string | null;
  status: string;
  evidence: string | null;
  manifested_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createManifestation(data: {
  category: string;
  vision: string;
  why?: string;
  timeframe?: string;
}): Promise<Manifestation> {
  const { rows } = await pool.query<Manifestation>(
    `INSERT INTO manifestations (category, vision, why, timeframe)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.category, data.vision, data.why ?? null, data.timeframe ?? null]
  );
  return rows[0];
}

export async function getActiveManifestations(): Promise<Manifestation[]> {
  const { rows } = await pool.query<Manifestation>(
    `SELECT * FROM manifestations WHERE status = 'active' ORDER BY created_at DESC`
  );
  return rows;
}

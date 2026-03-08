import pool from '../client';

export interface Journal {
  id: string;
  entry_date: string;
  mit: string | null;
  k1: string | null;
  k2: string | null;
  open_journal: string | null;
  wins_json: string[] | null;
  created_at: string;
}

export async function getJournalByDate(date: string): Promise<Journal | null> {
  const { rows } = await pool.query(`SELECT * FROM journals WHERE entry_date = $1`, [date]);
  return rows[0] ?? null;
}

export async function upsertJournal(data: {
  entry_date: string;
  mit?: string;
  k1?: string;
  k2?: string;
  open_journal?: string;
  wins_json?: string[];
}): Promise<Journal> {
  const { rows } = await pool.query(
    `INSERT INTO journals (entry_date, mit, k1, k2, open_journal, wins_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (entry_date) DO UPDATE SET
       mit = COALESCE(EXCLUDED.mit, journals.mit),
       k1 = COALESCE(EXCLUDED.k1, journals.k1),
       k2 = COALESCE(EXCLUDED.k2, journals.k2),
       open_journal = COALESCE(EXCLUDED.open_journal, journals.open_journal),
       wins_json = COALESCE(EXCLUDED.wins_json, journals.wins_json)
     RETURNING *`,
    [
      data.entry_date,
      data.mit ?? null,
      data.k1 ?? null,
      data.k2 ?? null,
      data.open_journal ?? null,
      data.wins_json ? JSON.stringify(data.wins_json) : null,
    ]
  );
  return rows[0];
}

export async function getAllJournals(): Promise<Journal[]> {
  const { rows } = await pool.query(`SELECT * FROM journals ORDER BY entry_date DESC`);
  return rows;
}

export async function deleteJournal(id: string): Promise<Journal | null> {
  const { rows } = await pool.query('DELETE FROM journals WHERE id = $1 RETURNING *', [id]);
  return rows[0] ?? null;
}

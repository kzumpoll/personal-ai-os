import pool from '../client';

export type ReviewType = 'weekly' | 'monthly' | 'quarterly' | 'weekly_checkin';

export interface Review {
  id: string;
  review_type: ReviewType;
  period_start: string;
  period_end: string;
  content: Record<string, unknown>;
  created_at: string;
}

export async function createReview(data: {
  review_type: ReviewType;
  period_start: string;
  period_end: string;
  content: Record<string, unknown>;
}): Promise<Review> {
  const { rows } = await pool.query(
    `INSERT INTO reviews (review_type, period_start, period_end, content)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING *`,
    [data.review_type, data.period_start, data.period_end, JSON.stringify(data.content)]
  );
  return rows[0];
}

export async function getRecentReviews(type?: ReviewType, limit = 10): Promise<Review[]> {
  if (type) {
    const { rows } = await pool.query(
      'SELECT * FROM reviews WHERE review_type = $1 ORDER BY period_start DESC LIMIT $2',
      [type, limit]
    );
    return rows;
  }
  const { rows } = await pool.query(
    'SELECT * FROM reviews ORDER BY period_start DESC LIMIT $1',
    [limit]
  );
  return rows;
}

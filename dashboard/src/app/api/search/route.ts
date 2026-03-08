import { NextRequest, NextResponse } from 'next/server';
import pool, { logDbError } from '@/lib/db';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q || q.length < 2) {
    return NextResponse.json({ tasks: [], thoughts: [], ideas: [], resources: [], goals: [], projects: [] });
  }

  const pattern = `%${q}%`;

  try {
    const [tasksRes, thoughtsRes, ideasRes, resourcesRes, goalsRes, projectsRes] = await Promise.all([
      pool.query(
        `SELECT id, title, due_date, status FROM tasks WHERE title ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
        [pattern]
      ),
      pool.query(
        `SELECT id, content, created_at FROM thoughts WHERE content ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
        [pattern]
      ),
      pool.query(
        `SELECT id, content, actionability, created_at FROM ideas WHERE content ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
        [pattern]
      ),
      pool.query(
        `SELECT id, title, content_or_url, type, created_at FROM resources WHERE title ILIKE $1 OR content_or_url ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
        [pattern]
      ),
      pool.query(
        `SELECT id, title, status, target_date FROM goals WHERE title ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
        [pattern]
      ),
      pool.query(
        `SELECT id, title, status FROM projects WHERE title ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
        [pattern]
      ),
    ]);

    return NextResponse.json({
      tasks:     tasksRes.rows,
      thoughts:  thoughtsRes.rows,
      ideas:     ideasRes.rows,
      resources: resourcesRes.rows,
      goals:     goalsRes.rows,
      projects:  projectsRes.rows,
    });
  } catch (err) {
    logDbError('api/search', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

import pool from '../client';

export interface ClaudeCodeStatus {
  status: 'idle' | 'running' | 'waiting_for_permission';
  current_task: string | null;
  permission_request: string | null;
  updated_at: string;
}

export async function getClaudeCodeStatus(): Promise<ClaudeCodeStatus> {
  try {
    const { rows } = await pool.query(
      `SELECT status, current_task, permission_request, updated_at FROM claude_code_status WHERE id = 'default'`
    );
    if (rows.length === 0) {
      return { status: 'idle', current_task: null, permission_request: null, updated_at: new Date().toISOString() };
    }
    return rows[0] as ClaudeCodeStatus;
  } catch {
    return { status: 'idle', current_task: null, permission_request: null, updated_at: new Date().toISOString() };
  }
}

export async function setClaudeCodeStatus(data: {
  status: 'idle' | 'running' | 'waiting_for_permission';
  current_task?: string | null;
  permission_request?: string | null;
}): Promise<ClaudeCodeStatus> {
  const { rows } = await pool.query(
    `INSERT INTO claude_code_status (id, status, current_task, permission_request, updated_at)
     VALUES ('default', $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       current_task = EXCLUDED.current_task,
       permission_request = EXCLUDED.permission_request,
       updated_at = NOW()
     RETURNING status, current_task, permission_request, updated_at`,
    [data.status, data.current_task ?? null, data.permission_request ?? null]
  );
  return rows[0] as ClaudeCodeStatus;
}

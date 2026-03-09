import 'dotenv/config';
import express, { Request, Response } from 'express';
import pool from './db/client';
import { bot } from './telegram/bot';
import { isCalendarConfigured, verifyCalendarConnection, getCalendarDiagnostics } from './services/calendar';
import { getClaudeCodeStatus, setClaudeCodeStatus } from './db/queries/claude_status';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const startedAt = new Date().toISOString();

// ---------------------------------------------------------------------------
// Health endpoint — returns live service status
// ---------------------------------------------------------------------------

let calendarOk: boolean | null = null; // cached at startup, re-checked on request

app.get('/health', async (_req: Request, res: Response) => {
  let dbOk = false;
  try { await pool.query('SELECT 1'); dbOk = true; } catch { /* handled */ }

  const calOk = isCalendarConfigured();
  const claudeStatus = await getClaudeCodeStatus().catch(() => null);

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime()),
    started_at: startedAt,
    db: dbOk ? 'connected' : 'error',
    calendar: calOk ? 'configured' : 'not_configured',
    claude_code: claudeStatus?.status ?? 'unknown',
    // Railway injects these env vars automatically when connected to a git repo
    git_commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    git_branch: process.env.RAILWAY_GIT_BRANCH ?? null,
  });
});

// ---------------------------------------------------------------------------
// Claude Code status endpoints
// ---------------------------------------------------------------------------

app.get('/claude-status', async (_req: Request, res: Response) => {
  try {
    const status = await getClaudeCodeStatus();
    res.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[claude-status] GET error:', msg);
    res.status(500).json({ error: 'Failed to read status' });
  }
});

app.patch('/claude-status', async (req: Request, res: Response) => {
  // Require secret header to prevent unauthorized writes
  const secret = process.env.CLAUDE_STATUS_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const { status, current_task, permission_request } = req.body as {
    status?: 'idle' | 'running' | 'waiting_for_permission';
    current_task?: string;
    permission_request?: string;
  };

  if (!status || !['idle', 'running', 'waiting_for_permission'].includes(status)) {
    res.status(400).json({ error: 'status must be: idle | running | waiting_for_permission' });
    return;
  }

  try {
    const updated = await setClaudeCodeStatus({ status, current_task, permission_request });
    console.log('[claude-status] updated:', status, current_task ?? '');
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[claude-status] PATCH error:', msg);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ---------------------------------------------------------------------------
// Calendar diagnostics endpoint (internal, not secret)
// ---------------------------------------------------------------------------

app.get('/debug/calendar', async (_req: Request, res: Response) => {
  const diag = await getCalendarDiagnostics();
  res.json(diag);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function checkDb(): Promise<boolean> {
  try { await pool.query('SELECT 1'); return true; }
  catch { return false; }
}

async function main() {
  console.log('');
  console.log('=== Personal AI OS backend starting ===');
  console.log(`  env:  ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`  port: ${PORT}`);

  // Required env var check
  const missing: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!process.env.ANTHROPIC_API_KEY)  missing.push('ANTHROPIC_API_KEY');
  if (!process.env.DATABASE_URL)       missing.push('DATABASE_URL');
  if (missing.length) {
    console.error(`  FATAL: missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Database
  const dbOk = await checkDb();
  if (!dbOk) {
    console.error('  db:   FAILED to connect — check DATABASE_URL');
    process.exit(1);
  }
  console.log('  db:   connected ✓');

  // Google Calendar — detailed startup log
  const calDiag = await getCalendarDiagnostics();
  if (calDiag.configured) {
    console.log(`  cal:  configured ✓ (${calDiag.event_count ?? 0} events today)`);
  } else {
    console.log(`  cal:  not configured — ${calDiag.reason}`);
    if (calDiag.reason === 'json_parse_error') {
      console.error('  cal:  GOOGLE_CREDENTIALS_JSON or GOOGLE_TOKEN_JSON contains invalid JSON');
    }
  }

  // Claude Code status — confirm table exists and row is present
  const claudeStatus = await getClaudeCodeStatus().catch(() => null);
  console.log(`  claude-code: status=${claudeStatus?.status ?? 'db_error'}`);

  // HTTP server
  await new Promise<void>((resolve) => app.listen(PORT, resolve));
  console.log(`  http: listening on port ${PORT} ✓`);

  // Telegram bot — always use polling (Railway provides a persistent process)
  await bot.launch();
  console.log('  bot:  polling started ✓');
  console.log('=== startup complete ===\n');

  process.once('SIGINT',  () => { console.log('Shutting down (SIGINT)…');  bot.stop('SIGINT');  });
  process.once('SIGTERM', () => { console.log('Shutting down (SIGTERM)…'); bot.stop('SIGTERM'); });
}

main().catch((err) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

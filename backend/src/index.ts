import 'dotenv/config';
import express, { Request, Response } from 'express';
import pool from './db/client';
import { bot } from './telegram/bot';
import { isCalendarConfigured, verifyCalendarConnection, getCalendarDiagnostics } from './services/calendar';
import { getClaudeCodeStatus, setClaudeCodeStatus } from './db/queries/claude_status';
import { syncTasksToNotion } from './services/notion';
import { editImage, isImageEditConfigured } from './services/imageEdit';
import { startScheduler } from './services/scheduler';

const app = express();
// Accept up to 20 MB JSON payloads (for base64-encoded image edits)
app.use(express.json({ limit: '20mb' }));

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
    // Railway injects RAILWAY_GIT_COMMIT_SHA; GIT_SHA is a generic fallback for other hosts
    git_commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA)?.slice(0, 7) ?? null,
    git_branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    deployed_at: process.env.DEPLOY_TIME ?? startedAt,
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
// Notion sync endpoint
// ---------------------------------------------------------------------------

app.post('/notion-sync', async (req: Request, res: Response) => {
  const secret = process.env.CLAUDE_STATUS_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const date: string = (req.body as { date?: string }).date ?? today;
  const createMissing: boolean = (req.body as { create_missing?: boolean }).create_missing ?? false;

  console.log(`[notion-sync] starting sync for date=${date} create_missing=${createMissing}`);
  try {
    const result = await syncTasksToNotion(date, createMissing);
    console.log(`[notion-sync] ${result.summary}`);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notion-sync] error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Image edit endpoint — POST /image-edit
// Form fields: file (image), prompt (text instruction)
// Protected by CLAUDE_STATUS_SECRET if set
// ---------------------------------------------------------------------------

app.post('/image-edit', async (req: Request, res: Response) => {
  if (!isImageEditConfigured()) {
    res.status(503).json({ error: 'GOOGLE_AI_API_KEY not set — image editing not configured.' });
    return;
  }

  const secret = process.env.CLAUDE_STATUS_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  // Accepts JSON body: { image_base64: string, mime_type: string, prompt: string }
  // Returns JSON: { image_base64: string, mime_type: string, description: string | null }
  const body = req.body as { image_base64?: string; mime_type?: string; prompt?: string };
  if (!body.image_base64) { res.status(400).json({ error: 'Missing image_base64' }); return; }
  if (!body.prompt) { res.status(400).json({ error: 'Missing prompt' }); return; }

  const mimeType = body.mime_type ?? 'image/jpeg';

  try {
    const imageBuffer = Buffer.from(body.image_base64, 'base64');
    const result = await editImage(imageBuffer, mimeType, body.prompt);
    res.json({
      image_base64: result.imageBuffer.toString('base64'),
      mime_type: result.mimeType,
      description: result.description,
    });
  } catch (editErr) {
    const msg = editErr instanceof Error ? editErr.message : String(editErr);
    console.error('[image-edit] error:', msg);
    res.status(500).json({ error: msg });
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

  // Timezone — critical for day plan date boundaries and event times
  const userTz = process.env.USER_TZ;
  if (!userTz) {
    console.warn('  tz:   WARNING — USER_TZ not set. Dates will use UTC. Set USER_TZ=Asia/Makassar for Bali.');
  } else {
    const { getLocalToday } = await import('./services/localdate');
    console.log(`  tz:   USER_TZ=${userTz} | today=${getLocalToday()}`);
  }

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

  // Recurring scheduler — Friday 8am check-in
  startScheduler(bot);

  console.log('=== startup complete ===\n');

  process.once('SIGINT',  () => { console.log('Shutting down (SIGINT)…');  bot.stop('SIGINT');  });
  process.once('SIGTERM', () => { console.log('Shutting down (SIGTERM)…'); bot.stop('SIGTERM'); });
}

main().catch((err) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

# Personal AI OS — Runbook

Everything you need to run, deploy, and maintain the project.

---

## Architecture overview

| Component | Technology | Hosting |
|-----------|-----------|---------|
| Telegram bot + API | Node.js / TypeScript | Railway |
| Dashboard | Next.js | Vercel |
| Database | PostgreSQL | Supabase |
| Calendar | Google Calendar API | OAuth2 token |

Both backend and dashboard connect to the **same Supabase database** via `DATABASE_URL`.

---

## 1. Local development setup

### Prerequisites
- Node.js ≥ 20
- A Supabase project (free tier is fine)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An Anthropic API key

### Backend

```bash
cd backend
cp .env.example .env
# Fill in DATABASE_URL, TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY

npm install
npm run migrate        # runs all SQL migrations against Supabase
npm run dev            # starts bot in polling mode + HTTP server
```

Health check: http://localhost:3001/health

### Dashboard

```bash
cd dashboard
cp .env.local.example .env.local
# Fill in DATABASE_URL (same as backend)

npm install
npm run dev            # starts Next.js on http://localhost:3000
```

---

## 2. Database migrations

Migrations live in `backend/src/db/migrations/` and are numbered `001_...sql`, `002_...sql`, etc.

They use `CREATE TABLE IF NOT EXISTS` — safe to run repeatedly.

**To run locally:**
```bash
cd backend && npm run migrate
```

**On Railway** — migrations run automatically on every deploy via `railway.toml`:
```toml
startCommand = "npm run migrate && npm start"
```

**To add a new migration:**
1. Create `backend/src/db/migrations/003_your_change.sql`
2. Use `IF NOT EXISTS` for tables, `IF NOT EXISTS` for indexes
3. Deploy → migration runs on next Railway startup

---

## 3. Railway backend deployment

### First deploy

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. From the `backend/` directory:
   ```bash
   cd backend
   railway init          # creates a new project, or link to existing
   railway up            # deploys
   ```
4. Set environment variables in the Railway dashboard (see Section 6)
5. Railway uses `railway.toml` for build/start commands — nothing extra needed

### Subsequent deploys

```bash
cd backend && railway up
```

Or connect your GitHub repo in the Railway dashboard for auto-deploys on push.

### Verify the bot is running

1. Open Railway → your service → Logs
2. You should see:
   ```
   === Personal AI OS backend starting ===
     db:   connected ✓
     cal:  configured ✓   (or: not configured)
     http: listening on port XXXX ✓
     bot:  polling started ✓
   === startup complete ===
   ```
3. Send `/start` to your bot in Telegram — it should reply

### Health check

Railway automatically polls `GET /health` (configured in `railway.toml`).
You can also check it manually: `https://<your-railway-domain>.railway.app/health`

---

## 4. Vercel dashboard deployment

### First deploy

1. Install Vercel CLI: `npm install -g vercel`
2. From the `dashboard/` directory:
   ```bash
   cd dashboard
   vercel          # follow prompts, link to your Vercel account
   ```
3. Set environment variables in the Vercel dashboard (see Section 6)
4. Deploy: `vercel --prod`

Or: import the repo in the Vercel dashboard and set the **root directory** to `dashboard/`.

### Subsequent deploys

```bash
cd dashboard && vercel --prod
```

Or use Vercel's GitHub integration for auto-deploys.

---

## 5. Required environment variables

### Railway (backend)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Supabase connection string |
| `TELEGRAM_BOT_TOKEN` | ✅ | From @BotFather |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `OPENAI_API_KEY` | optional | Only for voice transcription (Whisper) |
| `NODE_ENV` | ✅ | Set to `production` |
| `GOOGLE_CREDENTIALS_JSON` | optional | Google OAuth credentials JSON (one-line string) |
| `GOOGLE_TOKEN_JSON` | optional | Google OAuth token JSON (one-line string) |

Railway sets `PORT` automatically — do not set it manually.

### Vercel (dashboard)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Same Supabase connection string as backend |
| `GOOGLE_CREDENTIALS_JSON` | optional | Same Google credentials JSON |
| `GOOGLE_TOKEN_JSON` | optional | Same Google token JSON |

---

## 6. Google Calendar setup in production

Google Calendar uses OAuth2 with a stored refresh token. The token is long-lived (years).

### One-time local setup (already done if Calendar works locally)

```bash
cd backend
npx tsx src/scripts/google-auth.ts
# Follow the URL, paste the code, token saved to credentials/google-token.json
```

### Converting file credentials to env vars (for Railway/Vercel)

Run this once on your machine to get the one-line JSON strings:

```bash
# Get GOOGLE_CREDENTIALS_JSON value:
cat backend/credentials/google-oauth.json | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)))"

# Get GOOGLE_TOKEN_JSON value:
cat backend/credentials/google-token.json | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)))"
```

Copy each output line as the value of the corresponding env var in Railway and Vercel.

### Auth priority

1. If `GOOGLE_CREDENTIALS_JSON` + `GOOGLE_TOKEN_JSON` are set → use them (production)
2. Else if `GOOGLE_CREDENTIALS_PATH` + `GOOGLE_TOKEN_PATH` are set → read files (local dev)
3. Otherwise → Calendar features are silently disabled (empty arrays returned, no crash)

### Token refresh

The refresh token does not expire (unless you revoke access in your Google account).
The `access_token` auto-refreshes. No action needed unless you rotate/revoke credentials.

---

## 7. Verifying backend and dashboard share the same database

Both use `DATABASE_URL`. On startup, each logs the DB host:

**Backend logs:**
```
[db/backend] connecting to aws-1-ap-southeast-1.pooler.supabase.com/postgres
```

**Dashboard logs (Vercel function logs):**
```
[db/dashboard] connecting to aws-1-ap-southeast-1.pooler.supabase.com/postgres
```

If both show the same host and database name, they are connected to the same DB.

---

## 8. End-to-end smoke test

After deploying both services, verify everything is live:

### Telegram bot
- Send `/start` → should reply with welcome message
- Send `what do I have today` → should list tasks (or say none)
- Send `add task test deployment` → should confirm task created
- Check Supabase → tasks table should have the new row

### Dashboard
- Open `https://<your-vercel-domain>.vercel.app`
- Today page should load (tasks, focus block)
- Tasks page should show the task you just created via bot

### Database
- Open Supabase → Table Editor → tasks
- The task created via bot should appear here
- Changes made in the dashboard API should also appear here

### Google Calendar (if configured)
- Send `/start` (or `what do I have today`) to the bot
- On the Today page, check if the Calendar section appears
- If Calendar section is missing when events exist, check that both
  `GOOGLE_CREDENTIALS_JSON` and `GOOGLE_TOKEN_JSON` are set in both
  Railway and Vercel

### Health endpoint
```bash
curl https://<your-railway-domain>.railway.app/health
# Expected: {"status":"ok","uptime":...,"started_at":"..."}
```

---

## 9. Deployment order

Deploy in this order on first setup:

1. **Supabase** — create project, note the `DATABASE_URL` connection string
2. **Run migrations locally** — `cd backend && npm run migrate` (creates all tables)
3. **Railway** — deploy backend with all env vars set; verify bot responds in Telegram
4. **Vercel** — deploy dashboard with `DATABASE_URL` set; verify Today page loads

---

## 10. Troubleshooting

| Symptom | Check |
|---------|-------|
| Bot not responding | Railway logs → look for "bot: polling started ✓" |
| DB connection error | Check `DATABASE_URL` — must include password and correct host |
| `relation "tasks" does not exist` | Migrations didn't run — check Railway logs for migration step |
| Calendar section empty | Check `GOOGLE_CREDENTIALS_JSON` + `GOOGLE_TOKEN_JSON` are set and valid JSON |
| Dashboard 500 error | Vercel function logs → usually a missing `DATABASE_URL` |
| `FATAL: missing required env vars` | Set the missing var in Railway and redeploy |

---

## 11. Day-to-day operations

- **Restart backend**: Railway dashboard → your service → Redeploy (or push to GitHub if connected)
- **Add tasks/ideas/wins**: Send a message to your Telegram bot
- **Daily debrief**: Send `/debrief` to the bot — include `Wake: 07:00` to generate a day plan
- **Weekly review**: Send `/review` to the bot, or open `/review` in the dashboard
- **View dashboard**: Bookmark your Vercel URL on your phone

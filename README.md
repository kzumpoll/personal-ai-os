# Personal AI OS

A personal AI operating system controlled via Telegram. All data lives in Postgres. A read-only Next.js dashboard shows your tasks, journal, goals, ideas, and more.

## Architecture

```
Telegram → Node.js Backend → Claude Sonnet → Postgres (Supabase)
                                              ↑
                             Next.js Dashboard (read-only)
```

- **Backend**: Node.js + Telegraf + Anthropic SDK — deployed on Railway
- **Dashboard**: Next.js 14 (App Router) — deployed on Vercel
- **Database**: Postgres via Supabase
- **Voice**: OpenAI Whisper transcription

---

## Project Structure

```
personal-ai-os/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Entry point
│   │   ├── telegram/
│   │   │   ├── bot.ts            # Telegraf bot, webhook/polling setup
│   │   │   ├── session.ts        # In-memory session state (debrief flow)
│   │   │   └── voice.ts          # Voice note download + Whisper transcription
│   │   ├── db/
│   │   │   ├── client.ts         # pg Pool
│   │   │   ├── migrate.ts        # Run migrations
│   │   │   ├── migrations/
│   │   │   │   └── 001_initial.sql
│   │   │   └── queries/          # All DB queries by entity
│   │   ├── ai/
│   │   │   ├── claude.ts         # Claude API calls
│   │   │   ├── context.ts        # Build compact context pack
│   │   │   └── intents.ts        # TypeScript intent types
│   │   └── mutations/
│   │       └── executor.ts       # Execute intents, log mutations
│   ├── package.json
│   ├── tsconfig.json
│   ├── railway.toml
│   └── .env.example
│
└── dashboard/
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx           # Today
    │   │   ├── tasks/page.tsx     # Task board
    │   │   ├── projects/page.tsx
    │   │   ├── goals/page.tsx
    │   │   ├── ideas/page.tsx
    │   │   ├── thoughts/page.tsx
    │   │   ├── journal/page.tsx
    │   │   └── resources/page.tsx
    │   ├── components/
    │   │   ├── Sidebar.tsx
    │   │   ├── TaskCard.tsx
    │   │   ├── TaskBoard.tsx
    │   │   └── PageHeader.tsx
    │   └── lib/
    │       └── db.ts
    ├── package.json
    ├── vercel.json
    └── .env.example
```

---

## Local Setup

### 1. Prerequisites

- Node.js 20+
- A Postgres database (Supabase free tier works)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An Anthropic API key
- An OpenAI API key (for Whisper transcription)

### 2. Backend

```bash
cd backend
cp .env.example .env
# Fill in .env values

npm install
npm run migrate      # Creates tables
npm run dev          # Starts bot in polling mode
```

### 3. Dashboard

```bash
cd dashboard
cp .env.example .env.local
# Set DATABASE_URL

npm install
npm run dev          # http://localhost:3000
```

---

## Telegram Commands

Send any of these to your bot — or just speak naturally:

| Command | Example |
|---------|---------|
| Create task | `create task Review PR due tomorrow` |
| List tasks | `list tasks` / `list overdue tasks` |
| Complete task | `complete Review PR` |
| Move task date | `move Review PR to Friday` |
| Add thought | `thought I should simplify the auth flow` |
| Add idea | `idea Build a habit tracker` |
| Add win | `win Shipped the new dashboard` |
| Add goal | `goal Launch v2 by end of quarter` |
| Save resource | `resource TypeScript handbook https://...` |
| Daily debrief | `daily debrief` or `/debrief` |
| Undo | `undo` or `/undo` |

Voice notes are automatically transcribed and interpreted.

---

## Daily Debrief Flow

1. Send `daily debrief` (or `/debrief`)
2. Bot determines dates:
   - Before 2pm: debrief yesterday, plan today
   - After 2pm: debrief today, plan tomorrow
3. Bot shows open tasks and prompts for MIT / K1 / K2 / journal / wins
4. Reply naturally, e.g.:
   ```
   MIT: Finish proposal
   K1: Review PR
   K2: Send invoice
   Journal: Good focus, got distracted after lunch
   Wins: Shipped auth, cleared inbox
   ```
5. Bot confirms interpretation → reply `yes` to save

---

## Deployment

### Backend → Railway

1. Push `backend/` to a GitHub repo (or the monorepo)
2. Create a new Railway service pointing to `/backend`
3. Set env vars in Railway dashboard
4. Set `WEBHOOK_URL` to your Railway app URL
5. `railway.toml` handles build + migration automatically

### Dashboard → Vercel

1. Push `dashboard/` to GitHub
2. Import to Vercel
3. Set `DATABASE_URL` in Vercel environment variables
4. Deploy

### Database → Supabase

1. Create a Supabase project
2. Copy the connection string (use the "Session mode" pooler URL for Railway)
3. Set `DATABASE_URL` in both backend and dashboard `.env` files
4. Migrations run automatically on Railway deploy

---

## Design Decisions

- **Compact context pack**: Never loads the full database into the LLM prompt. Max 15 tasks per bucket, 10 goals.
- **Structured JSON intents**: Claude returns typed JSON; backend validates and executes mutations. No direct DB access from LLM.
- **Mutation log**: Every write is logged to `mutation_log` enabling single-level undo.
- **In-memory sessions**: Debrief state is stored in a `Map<chatId, SessionState>`. For multi-instance deployments, swap for Redis.
- **Dashboard is read-only**: All mutations happen through Telegram. Dashboard uses Next.js ISR with 30s revalidation.
- **Polling vs Webhook**: Dev uses polling. Production uses Telegram webhooks via Express.

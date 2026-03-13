# Personal OS current state

## Current deployed commit
SHA: a50c15e
a50c15e (HEAD -> main, origin/main) feat: add web_search tool for internet access via DuckDuckGo
925bdc2 feat: add meetings + meeting_actions tables for Granola ingestion
be1e494 feat(calendar): show daily ROI message as 08:00 block
d22ea4c feat(review): redo Review tab with review_schedule + templates
80bddc8 feat: add Manifestation/Visionboard tab
589e6d1 refactor(claude): remove dead prompts + compact UNIFIED_SYSTEM_PROMPT
55e7c3e feat(debrief): support arbitrary date via /debrief YYYY-MM-DD
17c8f97 feat(plan): generate day plan without debrief via /plan HH:MM
8582038 feat(finances): USD base currency, FX rates, crypto holdings
85fcd92 feat: sidebar collapse toggle, remove Intelligence tab, project-scoped permissions

## What is working
- Google Calendar write from Telegram
- Image to calendar events
- Debrief parsing and correction loop
- Notion update flow
- Reminders creation with draft message
- Day plan gap fill and no Free time blocks
- Session persistence

## Known issues to fix next
- Reminders sometimes wrong time
- Task description update can hit UUID prefix bug
- Calendar UI and Projects UI upgrades
- Day plan without debrief
- Debrief for arbitrary date

## Key env vars
USER_TZ=Asia/Makassar
GOOGLE_TOKEN_JSON set on Railway
NOTION_TOKEN NOTION_TASKS_DB_ID NOTION_USER_ID
OPENAI_API_KEY

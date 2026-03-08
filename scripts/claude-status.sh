#!/usr/bin/env bash
# claude-status.sh — Update the Claude Code status row in the database.
#
# Usage:
#   ./scripts/claude-status.sh idle
#   ./scripts/claude-status.sh running "Refactoring auth module"
#   ./scripts/claude-status.sh waiting_for_permission "Write to /etc/hosts"
#
# Required env vars:
#   BACKEND_URL          — Railway backend, e.g. https://my-app.up.railway.app
#   CLAUDE_STATUS_SECRET — must match the value set on the backend (optional if unset there)
#
# Source from your shell profile or .env:
#   export BACKEND_URL=https://your-app.up.railway.app
#   export CLAUDE_STATUS_SECRET=your-secret-here

set -euo pipefail

STATUS="${1:-}"
TASK="${2:-}"
PERMISSION="${3:-}"

if [[ -z "$STATUS" ]]; then
  echo "Usage: $0 <idle|running|waiting_for_permission> [task_description] [permission_request]"
  exit 1
fi

if [[ "$STATUS" != "idle" && "$STATUS" != "running" && "$STATUS" != "waiting_for_permission" ]]; then
  echo "Error: status must be one of: idle, running, waiting_for_permission"
  exit 1
fi

BACKEND_URL="${BACKEND_URL:?BACKEND_URL env var is required}"
CLAUDE_STATUS_SECRET="${CLAUDE_STATUS_SECRET:-}"

# Build JSON body
if [[ -n "$TASK" && -n "$PERMISSION" ]]; then
  BODY=$(printf '{"status":"%s","current_task":"%s","permission_request":"%s"}' "$STATUS" "$TASK" "$PERMISSION")
elif [[ -n "$TASK" ]]; then
  BODY=$(printf '{"status":"%s","current_task":"%s","permission_request":null}' "$STATUS" "$TASK")
elif [[ -n "$PERMISSION" ]]; then
  BODY=$(printf '{"status":"%s","current_task":null,"permission_request":"%s"}' "$STATUS" "$PERMISSION")
else
  BODY=$(printf '{"status":"%s","current_task":null,"permission_request":null}' "$STATUS")
fi

AUTH_HEADER=""
if [[ -n "$CLAUDE_STATUS_SECRET" ]]; then
  AUTH_HEADER="Authorization: Bearer ${CLAUDE_STATUS_SECRET}"
fi

if [[ -n "$AUTH_HEADER" ]]; then
  curl -s -X PATCH "${BACKEND_URL}/claude-status" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d "$BODY" | cat
else
  curl -s -X PATCH "${BACKEND_URL}/claude-status" \
    -H "Content-Type: application/json" \
    -d "$BODY" | cat
fi

echo ""

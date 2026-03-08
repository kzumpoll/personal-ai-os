#!/usr/bin/env bash
# Claude Code hook: notification
# Called when Claude Code is waiting for user input (permission request, question, etc).
# Sets status to "waiting_for_permission".
#
# Required env vars (set in your shell profile):
#   BACKEND_URL
#   CLAUDE_STATUS_SECRET  (if set on the backend)

BACKEND_URL="${BACKEND_URL:-}"
CLAUDE_STATUS_SECRET="${CLAUDE_STATUS_SECRET:-}"

if [[ -z "$BACKEND_URL" ]]; then exit 0; fi

# Read stdin for notification details
INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','permission required'))" 2>/dev/null || echo "permission required")

# Truncate and escape for JSON
PERMISSION=$(echo "$MESSAGE" | head -c 100 | tr -d '"\\')

BODY=$(printf '{"status":"waiting_for_permission","current_task":null,"permission_request":"%s"}' "$PERMISSION")

if [[ -n "$CLAUDE_STATUS_SECRET" ]]; then
  curl -s -X PATCH "${BACKEND_URL}/claude-status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${CLAUDE_STATUS_SECRET}" \
    -d "$BODY" > /dev/null 2>&1 &
else
  curl -s -X PATCH "${BACKEND_URL}/claude-status" \
    -H "Content-Type: application/json" \
    -d "$BODY" > /dev/null 2>&1 &
fi

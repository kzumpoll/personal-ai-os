#!/usr/bin/env bash
# Claude Code hook: stop
# Called when Claude Code finishes a turn (reaches end of response).
# Sets status back to "idle".
#
# Required env vars (set in your shell profile):
#   BACKEND_URL
#   CLAUDE_STATUS_SECRET  (if set on the backend)

BACKEND_URL="${BACKEND_URL:-}"
CLAUDE_STATUS_SECRET="${CLAUDE_STATUS_SECRET:-}"

if [[ -z "$BACKEND_URL" ]]; then exit 0; fi

BODY='{"status":"idle","current_task":null,"permission_request":null}'

if [[ -n "$CLAUDE_STATUS_SECRET" ]]; then
  curl -s -X PATCH "${BACKEND_URL}/claude-status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${CLAUDE_STATUS_SECRET}" \
    -d "$BODY" > /dev/null 2>&1
else
  curl -s -X PATCH "${BACKEND_URL}/claude-status" \
    -H "Content-Type: application/json" \
    -d "$BODY" > /dev/null 2>&1
fi

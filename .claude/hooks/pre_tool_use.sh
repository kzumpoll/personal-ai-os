#!/usr/bin/env bash
# Claude Code hook: pre_tool_use
# Called before every tool execution. Sets status to "running".
#
# Claude Code passes tool info via stdin as JSON. We extract the tool name
# and use it as the current_task description.
#
# Required env vars (set in your shell profile):
#   BACKEND_URL
#   CLAUDE_STATUS_SECRET  (if set on the backend)

BACKEND_URL="${BACKEND_URL:-}"
CLAUDE_STATUS_SECRET="${CLAUDE_STATUS_SECRET:-}"

if [[ -z "$BACKEND_URL" ]]; then exit 0; fi

# Read stdin to get tool context
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")

TASK="Running: ${TOOL_NAME}"

BODY=$(printf '{"status":"running","current_task":"%s","permission_request":null}' "$TASK")

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

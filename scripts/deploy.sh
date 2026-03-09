#!/usr/bin/env bash
# deploy.sh — commit all changes and push to trigger Railway + Vercel auto-deploy.
#
# Usage:
#   ./scripts/deploy.sh "Your commit message"
#   ./scripts/deploy.sh              # uses default message "chore: update"
#
# What it does:
#   1. Runs backend tests
#   2. git add -A
#   3. git commit -m "<message>"
#   4. git push origin <current-branch>
#
# Railway watches the repo and auto-deploys the backend on push.
# Vercel watches the repo and auto-deploys the dashboard on push.
#
# Prerequisites:
#   - You are inside the personal-ai-os repo root
#   - You have a git remote called "origin"
#   - Railway + Vercel are connected to the repo on GitHub

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(pwd)")"
cd "$REPO_ROOT"

MSG="${1:-chore: update}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "=== Deploy: branch=${BRANCH} ==="

# 1. Run backend tests
echo ""
echo "→ Running backend tests..."
(cd backend && npm test)
echo "  ✓ Tests passed"

# 2. Check for changes
if git diff --quiet && git diff --staged --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo ""
  echo "Nothing to commit — working tree is clean."
  echo "If you want to re-push, run: git push origin ${BRANCH}"
  exit 0
fi

# 3. Stage all changes
echo ""
echo "→ Staging changes..."
git add -A
git status --short

# 4. Commit
echo ""
echo "→ Committing: \"${MSG}\""
git commit -m "${MSG}"

# 5. Push
echo ""
echo "→ Pushing to origin/${BRANCH}..."
git push origin "${BRANCH}"

COMMIT_HASH="$(git rev-parse --short HEAD)"
COMMIT_MSG="$(git log -1 --pretty=%s)"

echo ""
echo "✓ Deployed: [${COMMIT_HASH}] ${COMMIT_MSG}"
echo "  Branch:  ${BRANCH}"
echo "  Railway: auto-builds in ~60s  → https://railway.app/dashboard"
echo "  Vercel:  auto-builds in ~90s  → https://vercel.com/dashboard"
echo ""
echo "  To check deploy state, run:"
echo "    git log --oneline -5"

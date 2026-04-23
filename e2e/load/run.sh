#!/usr/bin/env bash
# Run all k6 load tests against the local API stack.
#
# Usage:
#   bash e2e/load/run.sh [API_URL]
#
# Prerequisites:
#   - k6 installed (https://k6.io/docs/getting-started/installation/)
#   - API running at API_URL (default: http://localhost:4000)
#   - Set ARENA_IDS to comma-separated arena UUIDs to test against
#
# Example:
#   ARENA_IDS=uuid1,uuid2 bash e2e/load/run.sh

set -euo pipefail

API_URL="${1:-http://localhost:4000}"
ARENA_IDS="${ARENA_IDS:-}"
AGENT_TOKENS="${AGENT_TOKENS:-}"
AGENT_IDS="${AGENT_IDS:-}"

if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 not found. Install from https://k6.io/docs/getting-started/installation/"
  exit 1
fi

echo "=== Agon Arena Load Tests ==="
echo "API_URL: $API_URL"
echo "ARENA_IDS: ${ARENA_IDS:-<not set — some tests will skip>}"
echo ""

echo "--- [1/2] Spectator load test (1,000 spectators) ---"
k6 run \
  -e API_URL="$API_URL" \
  -e ARENA_IDS="$ARENA_IDS" \
  "$(dirname "$0")/spectators.k6.js"

echo ""
echo "--- [2/2] Agent action load test (100 agents) ---"
k6 run \
  -e API_URL="$API_URL" \
  -e ARENA_IDS="$ARENA_IDS" \
  -e AGENT_TOKENS="$AGENT_TOKENS" \
  -e AGENT_IDS="$AGENT_IDS" \
  "$(dirname "$0")/agents.k6.js"

echo ""
echo "=== All load tests complete ==="

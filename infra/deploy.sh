#!/usr/bin/env bash
set -euo pipefail

# Resolve install directory from Lox config or fallback to default
LOX_CONFIG="$HOME/.lox/config.json"
if [ -f "$LOX_CONFIG" ] && command -v jq &> /dev/null; then
  PROJECT_DIR=$(jq -r '.install_dir' "$LOX_CONFIG")
elif [ -f "$LOX_CONFIG" ]; then
  PROJECT_DIR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$LOX_CONFIG','utf8')).install_dir)")
else
  PROJECT_DIR="$HOME/lox-brain"
fi

cd "$PROJECT_DIR"

echo "=== Lox deploy started at $(date -u) ==="

echo "--- git pull ---"
git pull origin main

echo "--- npm ci ---"
npm ci

echo "--- npm run build ---"
npm run build --workspaces

echo "--- apply schema.sql (idempotent DDL, as table owner) ---"
# Schema objects (area/source_type columns, indexes, the tasks table) are
# owner-applied — the non-owner runtime role cannot run DDL (issue #169), and
# the watcher now aborts on boot if they are missing. Apply as the table
# owner so new objects (e.g. tasks) are reachable by the runtime:
#   - psql runs as the postgres superuser, then SET ROLE <owner> so created
#     objects are owned by the runtime's role, not by postgres.
#   - the file is read by this user and piped via stdin (postgres cannot read
#     files under $HOME).
# schema.sql is fully idempotent (IF NOT EXISTS), so this is safe to re-run.
DB_NAME="${LOX_DB_NAME:-lox_brain}"
DB_OWNER="${LOX_DB_OWNER:-lox}"
{ echo "SET ROLE ${DB_OWNER};"; cat "$PROJECT_DIR/infra/postgres/schema.sql"; } \
  | sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1

echo "--- kill stale MCP processes ---"
pkill -f 'tsx src/mcp/index.ts' || true
pkill -f 'tsx packages/core/src/mcp/index.ts' || true

echo "--- restart watcher ---"
sudo systemctl restart lox-watcher

echo "--- verify watcher ---"
systemctl is-active lox-watcher

echo "=== Lox deploy completed at $(date -u) ==="
echo "DEPLOY_SUCCESS"

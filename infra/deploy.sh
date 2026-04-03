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

echo "--- kill stale MCP processes ---"
pkill -f 'tsx src/mcp/index.ts' || true
pkill -f 'tsx packages/core/src/mcp/index.ts' || true

echo "--- restart watcher ---"
sudo systemctl restart lox-watcher

echo "--- verify watcher ---"
systemctl is-active lox-watcher

echo "=== Lox deploy completed at $(date -u) ==="
echo "DEPLOY_SUCCESS"

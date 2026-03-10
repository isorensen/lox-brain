#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/sorensen/obsidian_open_brain"
cd "$PROJECT_DIR"

echo "=== Deploy started at $(date -u) ==="

echo "--- git pull ---"
git pull origin main

echo "--- npm ci ---"
npm ci

echo "--- npm run build ---"
npm run build

echo "--- restart watcher ---"
sudo systemctl restart obsidian-watcher

echo "--- kill stale MCP processes ---"
pkill -f 'tsx src/mcp/index.ts' || true

echo "--- verify watcher ---"
systemctl is-active obsidian-watcher

echo "=== Deploy completed at $(date -u) ==="
echo "DEPLOY_SUCCESS"

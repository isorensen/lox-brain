#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "  _        ___   __  __"
echo " | |      / _ \\  \\ \\/ /"
echo " | |     | | | |  \\  /"
echo " | |___  | |_| |  /  \\"
echo " |_____|  \\___/  /_/\\_\\"
echo ""
echo "  Where knowledge lives."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Installing..."
  if command -v brew &> /dev/null; then
    brew install node@22
  elif command -v apt &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
  else
    echo "Please install Node.js 22+ manually: https://nodejs.org"
    exit 1
  fi
fi

NODE_MAJOR=$(node -e "console.log(process.version.split('.')[0].slice(1))")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22+ required (found: $(node --version))"
  exit 1
fi

# Clone and run installer
TEMP_DIR=$(mktemp -d)
echo "Cloning Lox installer..."
git clone --depth 1 https://github.com/isorensen/lox-brain.git "$TEMP_DIR/lox-brain"
cd "$TEMP_DIR/lox-brain"
echo "Installing dependencies..."
npm ci --silent
echo "Building..."
npm run build --workspaces --silent
echo ""
node packages/installer/dist/index.js

# Cleanup
rm -rf "$TEMP_DIR"

#!/usr/bin/env bash
# team-onboard.sh — Lox Brain team member onboarding script
# Supports macOS and Linux. All steps are idempotent.
# Usage:
#   ./scripts/team-onboard.sh --wg-config /path/to/wg1.conf
#   ./scripts/team-onboard.sh --wg-config /path/to/wg1.conf --dry-run
#   ./scripts/team-onboard.sh --help

set -euo pipefail

# ---------------------------------------------------------------------------
# Config variables
# ---------------------------------------------------------------------------
VPN_SERVER_IP="10.20.0.1"
MCP_PORT="3100"
MCP_NAME="lox-brain-credifit"
MCP_URL="http://${VPN_SERVER_IP}:${MCP_PORT}/mcp"
WG_IFACE="wg1"
WG_TARGET_DIR="${HOME}/.config/lox/wireguard"
SKILLS_SOURCE="skills"   # relative to repo root
SKILLS_TARGET="${HOME}/.claude/skills"
LOX_CONFIG="${HOME}/.lox/config.json"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

info() { echo -e "${BLUE}[info]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail() { echo -e "${RED}  ✗${NC} $1"; }
step() { echo -e "\n${BOLD}[$1/7]${NC} $2"; }

# ---------------------------------------------------------------------------
# Globals set during arg parsing
# ---------------------------------------------------------------------------
WG_CONFIG=""
DRY_RUN=false
PEER_IP=""

# ---------------------------------------------------------------------------
# Cleanup trap
# ---------------------------------------------------------------------------
_cleanup() {
  local exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    echo ""
    fail "Onboarding failed (exit code ${exit_code}). Review the output above for details."
  fi
}
trap _cleanup EXIT

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage:
  $(basename "$0") --wg-config <path/to/wg1.conf> [--dry-run]
  $(basename "$0") --help

Options:
  --wg-config <path>   Path to the WireGuard config file (.conf)
  --dry-run            Print what would be done without making any changes
  --help               Show this help message and exit

Examples:
  ./scripts/team-onboard.sh --wg-config ~/Downloads/wg1.conf
  ./scripts/team-onboard.sh --wg-config ~/Downloads/wg1.conf --dry-run
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
parse_args() {
  if [[ $# -eq 0 ]]; then
    usage
    exit 1
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --wg-config)
        if [[ -z "${2:-}" ]]; then
          fail "--wg-config requires a path argument"
          exit 1
        fi
        WG_CONFIG="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done

  if [[ -z "$WG_CONFIG" ]]; then
    fail "--wg-config is required"
    usage
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Dry-run wrapper: run a command or print it
# ---------------------------------------------------------------------------
run() {
  if [[ "$DRY_RUN" == true ]]; then
    info "[dry-run] would run: $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# Cross-platform sed: extract first capturing group
# Usage: sed_extract <pattern> <file>
# Pattern must use basic regex with \(...\) for groups on both platforms.
# ---------------------------------------------------------------------------
sed_extract() {
  local pattern="$1"
  local file="$2"
  # -E extended regex, print only matching portion via capture
  # macOS sed does not support \K (PCRE), so we use a two-step approach
  sed -nE "s/${pattern}/\1/p" "$file" | head -1
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
print_banner() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║   Lox Brain — Team Onboarding       ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
  echo ""
  if [[ "$DRY_RUN" == true ]]; then
    warn "DRY-RUN mode enabled — no destructive changes will be made"
  fi
}

# ---------------------------------------------------------------------------
# STEP 1: Prerequisites
# ---------------------------------------------------------------------------
step1_prerequisites() {
  step 1 "Checking prerequisites"

  # Check wg
  if ! command -v wg &>/dev/null; then
    fail "'wg' not found. Install WireGuard:"
    echo "    macOS:  brew install wireguard-tools"
    echo "    Ubuntu: sudo apt install wireguard-tools"
    echo "    Fedora: sudo dnf install wireguard-tools"
    exit 1
  fi
  ok "wg found: $(command -v wg)"

  # Check claude
  if ! command -v claude &>/dev/null; then
    fail "'claude' CLI not found."
    echo "    Install from: https://claude.ai/download"
    exit 1
  fi
  ok "claude found: $(command -v claude)"

  # Check WG config file
  if [[ ! -f "$WG_CONFIG" ]]; then
    fail "WireGuard config not found: ${WG_CONFIG}"
    exit 1
  fi
  if [[ ! -r "$WG_CONFIG" ]]; then
    fail "WireGuard config is not readable: ${WG_CONFIG}"
    exit 1
  fi
  ok "WireGuard config: ${WG_CONFIG}"

  # Extract peer IP from Address field (compatible with macOS and GNU sed)
  PEER_IP="$(sed_extract 'Address[[:space:]]*=[[:space:]]*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+).*' "$WG_CONFIG")"
  if [[ -z "$PEER_IP" ]]; then
    fail "Could not extract 'Address' IP from config file: ${WG_CONFIG}"
    exit 1
  fi
  ok "Peer IP extracted: ${PEER_IP}"
}

# ---------------------------------------------------------------------------
# STEP 2: Install WireGuard config
# ---------------------------------------------------------------------------
step2_install_wg_config() {
  step 2 "Installing WireGuard config"

  local target="${WG_TARGET_DIR}/${WG_IFACE}.conf"

  if [[ "$DRY_RUN" == true ]]; then
    info "[dry-run] would create directory: ${WG_TARGET_DIR}"
    info "[dry-run] would copy ${WG_CONFIG} → ${target} (chmod 600)"
    return
  fi

  mkdir -p "$WG_TARGET_DIR"

  if [[ -f "$target" ]]; then
    if diff -q "$WG_CONFIG" "$target" &>/dev/null; then
      ok "Config already installed and matches: ${target}"
      return
    else
      warn "Config exists but differs: ${target}"
      printf "  Overwrite? [y/N] "
      read -r answer
      if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        info "Skipping config install — using existing file"
        return
      fi
    fi
  fi

  cp "$WG_CONFIG" "$target"
  chmod 600 "$target"
  ok "Config installed: ${target}"
}

# ---------------------------------------------------------------------------
# STEP 3: Activate WireGuard
# ---------------------------------------------------------------------------
step3_activate_wg() {
  step 3 "Activating WireGuard interface"

  # Check if interface is already up
  if sudo wg show "$WG_IFACE" &>/dev/null; then
    ok "Interface ${WG_IFACE} is already up"
  else
    local conf_path="${WG_TARGET_DIR}/${WG_IFACE}.conf"

    if [[ "$DRY_RUN" == true ]]; then
      info "[dry-run] would run: sudo wg-quick up ${conf_path}"
    else
      info "Bringing up ${WG_IFACE}..."
      sudo wg-quick up "$conf_path"
      ok "Interface ${WG_IFACE} is up"
    fi
  fi

  # Ping test (read-only, runs even in dry-run)
  info "Testing connectivity to VPN server (${VPN_SERVER_IP})..."
  if [[ "$DRY_RUN" == true ]]; then
    info "[dry-run] would run: ping -c 1 -W 5 ${VPN_SERVER_IP}"
    return
  fi

  if ping -c 1 -W 5 "$VPN_SERVER_IP" &>/dev/null; then
    ok "VPN server is reachable (${VPN_SERVER_IP})"
  else
    fail "Cannot reach VPN server at ${VPN_SERVER_IP}"
    echo ""
    echo "  Troubleshooting:"
    echo "    1. Check that the WireGuard interface is up: sudo wg show ${WG_IFACE}"
    echo "    2. Verify the server is running and your public key is authorized"
    echo "    3. Check firewall rules allow UDP 51820"
    echo "    4. Try: sudo wg-quick down ${WG_TARGET_DIR}/${WG_IFACE}.conf && sudo wg-quick up ${WG_TARGET_DIR}/${WG_IFACE}.conf"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# STEP 4: Register MCP in Claude Code
# ---------------------------------------------------------------------------
step4_register_mcp() {
  step 4 "Registering MCP server in Claude Code"

  # Check if already registered
  if claude mcp list 2>/dev/null | grep -q "$MCP_NAME"; then
    info "MCP '${MCP_NAME}' already registered — removing to re-register cleanly"
    if [[ "$DRY_RUN" == true ]]; then
      info "[dry-run] would run: claude mcp remove --scope user ${MCP_NAME}"
    else
      claude mcp remove --scope user "$MCP_NAME"
    fi
  fi

  if [[ "$DRY_RUN" == true ]]; then
    info "[dry-run] would run: claude mcp add --scope user --transport http ${MCP_NAME} ${MCP_URL}"
    return
  fi

  claude mcp add --scope user --transport http "$MCP_NAME" "$MCP_URL"

  # Verify
  if claude mcp list 2>/dev/null | grep -q "$MCP_NAME"; then
    ok "MCP '${MCP_NAME}' registered at ${MCP_URL}"
  else
    fail "Failed to verify MCP registration for '${MCP_NAME}'"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# STEP 5: Install skills
# ---------------------------------------------------------------------------
step5_install_skills() {
  step 5 "Installing skills"

  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  local repo_root
  repo_root="$(dirname "$script_dir")"
  local skills_src="${repo_root}/${SKILLS_SOURCE}"

  if [[ ! -d "$skills_src" ]]; then
    warn "Skills directory not found: ${skills_src} — skipping"
    return
  fi

  local installed=0
  local skipped=0

  # Iterate over each skill subdirectory
  for skill_dir in "${skills_src}"/*/; do
    # Guard against empty glob
    [[ -d "$skill_dir" ]] || continue

    local skill_name
    skill_name="$(basename "$skill_dir")"
    local skill_md="${skill_dir}SKILL.md"
    local target_md="${SKILLS_TARGET}/${skill_name}/SKILL.md"

    if [[ ! -f "$skill_md" ]]; then
      warn "No SKILL.md in ${skill_dir} — skipping"
      continue
    fi

    if [[ -f "$target_md" ]]; then
      ok "Skill '${skill_name}' already installed, skipping"
      (( skipped++ )) || true
      continue
    fi

    if [[ "$DRY_RUN" == true ]]; then
      info "[dry-run] would install skill '${skill_name}' → ${target_md}"
      (( installed++ )) || true
      continue
    fi

    mkdir -p "${SKILLS_TARGET}/${skill_name}"
    cp "$skill_md" "$target_md"
    ok "Skill '${skill_name}' installed"
    (( installed++ )) || true
  done

  info "Skills summary: ${installed} installed, ${skipped} already present"
}

# ---------------------------------------------------------------------------
# STEP 6: Create Lox config
# ---------------------------------------------------------------------------
step6_lox_config() {
  step 6 "Creating Lox configuration"

  if [[ -f "$LOX_CONFIG" ]]; then
    ok "Lox config already exists: ${LOX_CONFIG}"
    return
  fi

  local config_dir
  config_dir="$(dirname "$LOX_CONFIG")"

  if [[ "$DRY_RUN" == true ]]; then
    info "[dry-run] would create: ${LOX_CONFIG}"
    cat <<EOF
  Content:
  {
    "mode": "team",
    "vault": {
      "preset": "zettelkasten",
      "local_path": "~/Obsidian/Lox-Credifit"
    }
  }
EOF
    return
  fi

  mkdir -p "$config_dir"
  cat > "$LOX_CONFIG" <<'JSONEOF'
{
  "mode": "team",
  "vault": {
    "preset": "zettelkasten",
    "local_path": "~/Obsidian/Lox-Credifit"
  }
}
JSONEOF
  ok "Lox config created: ${LOX_CONFIG}"
}

# ---------------------------------------------------------------------------
# STEP 7: Verify
# ---------------------------------------------------------------------------
step7_verify() {
  step 7 "Verification"

  local mcp_status=""
  mcp_status="$(claude mcp list 2>/dev/null | grep "$MCP_NAME" || true)"

  if [[ "$mcp_status" == *"connected"* ]] || [[ "$mcp_status" == *"Connected"* ]]; then
    ok "${GREEN}MCP '${MCP_NAME}' is Connected${NC}"
  elif [[ -n "$mcp_status" ]]; then
    warn "MCP '${MCP_NAME}' is registered but not yet connected (may need a fresh Claude Code session)"
    info "Status: ${mcp_status}"
  else
    if [[ "$DRY_RUN" == true ]]; then
      info "[dry-run] skipping MCP verification"
    else
      warn "MCP '${MCP_NAME}' not found in 'claude mcp list' — registration may have failed"
    fi
  fi

  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║        Onboarding Complete!          ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
  echo ""

  if [[ "$DRY_RUN" == true ]]; then
    warn "Dry-run complete — no changes were made"
    return
  fi

  echo -e "  ${GREEN}Peer IP:${NC}      ${PEER_IP}"
  echo -e "  ${GREEN}VPN Server:${NC}   ${VPN_SERVER_IP}"
  echo -e "  ${GREEN}MCP URL:${NC}      ${MCP_URL}"
  echo -e "  ${GREEN}Lox Config:${NC}   ${LOX_CONFIG}"
  echo ""
  echo "  Next steps:"
  echo "    1. Open Claude Code and verify '${MCP_NAME}' appears in /mcp"
  echo "    2. Create your local vault at ~/Obsidian/Lox-Credifit"
  echo "    3. Run a test: use the 'search_notes' tool in Claude Code"
  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"
  print_banner

  step1_prerequisites
  step2_install_wg_config
  step3_activate_wg
  step4_register_mcp
  step5_install_skills
  step6_lox_config
  step7_verify
}

main "$@"

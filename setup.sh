#!/bin/bash
# Loom setup script — run this after cloning to configure a new machine.
# Usage: git clone <repo-url> && cd loom && ./setup.sh

set -e

LOOM_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
CLAUDE_SETTINGS="$CLAUDE_DIR/settings.json"
LOOM_HOME="$HOME/.loom"

echo "Setting up Loom from: $LOOM_DIR"
echo ""

# ---------------------------------------------------------------------------
# 1. Prerequisites check
# ---------------------------------------------------------------------------
echo "Checking prerequisites..."

missing=()
command -v node >/dev/null 2>&1 || missing+=("node")
command -v npm >/dev/null 2>&1 || missing+=("npm")
command -v git >/dev/null 2>&1 || missing+=("git")
command -v tmux >/dev/null 2>&1 || missing+=("tmux")
command -v jq >/dev/null 2>&1 || missing+=("jq")

if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: Missing required tools: ${missing[*]}"
  echo "Install them first (e.g., brew install ${missing[*]})"
  exit 1
fi

node_major=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$node_major" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found $(node -v))"
  exit 1
fi

echo "  All prerequisites found."

# ---------------------------------------------------------------------------
# 2. npm install
# ---------------------------------------------------------------------------
echo ""
echo "Installing dependencies..."
npm install
echo "  Done."

# ---------------------------------------------------------------------------
# 3. ~/.loom directory
# ---------------------------------------------------------------------------
echo ""
mkdir -p "$LOOM_HOME"
echo "Ensured ~/.loom exists."

# ---------------------------------------------------------------------------
# 4. LAN access
# ---------------------------------------------------------------------------
echo ""
CONFIG_FILE="$LOOM_HOME/config.json"
if [ -f "$CONFIG_FILE" ]; then
  current_host=$(jq -r '.host // empty' "$CONFIG_FILE")
else
  current_host=""
fi

if [ -z "$current_host" ]; then
  read -p "Allow LAN access? Other machines can discover and connect to Loom. (y/N): " LAN_CHOICE
  if [ "$LAN_CHOICE" = "y" ] || [ "$LAN_CHOICE" = "Y" ]; then
    if [ -f "$CONFIG_FILE" ]; then
      jq '.host = "0.0.0.0"' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
      echo '{"host":"0.0.0.0"}' | jq . > "$CONFIG_FILE"
    fi
    echo "  LAN access enabled (host: 0.0.0.0)"
  else
    echo "  LAN access disabled (localhost only). Change in Settings later."
  fi
else
  echo "LAN access already configured (host: $current_host)"
fi

# ---------------------------------------------------------------------------
# 5. Claude Code hooks — merge into ~/.claude/settings.json
# ---------------------------------------------------------------------------
echo ""
echo "Configuring Claude Code hooks..."

mkdir -p "$CLAUDE_DIR"

LOOM_HOOKS='{
  "PreToolUse": [{"hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]}],
  "PostToolUse": [{"hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]}],
  "UserPromptSubmit": [{"hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]}],
  "Notification": [
    {"matcher": "idle_prompt", "hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]},
    {"matcher": "permission_prompt", "hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]},
    {"matcher": "elicitation_dialog", "hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]}
  ],
  "Stop": [{"hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]}],
  "StopFailure": [{"hooks": [{"type": "http", "url": "http://localhost:3000/api/agent-status", "async": true}]}]
}'

if [ -f "$CLAUDE_SETTINGS" ]; then
  # Check if hooks already configured
  if jq -e '.hooks.PreToolUse' "$CLAUDE_SETTINGS" >/dev/null 2>&1; then
    existing_url=$(jq -r '.hooks.PreToolUse[0].hooks[0].url // empty' "$CLAUDE_SETTINGS")
    if [ "$existing_url" = "http://localhost:3000/api/agent-status" ]; then
      echo "  Loom hooks already configured, skipping."
    else
      echo "  WARNING: Existing hooks found with different URL."
      echo "  Current: $existing_url"
      echo "  Please merge Loom hooks manually into $CLAUDE_SETTINGS"
    fi
  else
    # Merge hooks into existing settings
    jq --argjson hooks "$LOOM_HOOKS" '.hooks = $hooks' "$CLAUDE_SETTINGS" > "$CLAUDE_SETTINGS.tmp"
    mv "$CLAUDE_SETTINGS.tmp" "$CLAUDE_SETTINGS"
    echo "  Merged Loom hooks into $CLAUDE_SETTINGS"
  fi
else
  # Create new settings with just hooks
  jq -n --argjson hooks "$LOOM_HOOKS" '{"hooks": $hooks}' > "$CLAUDE_SETTINGS"
  echo "  Created $CLAUDE_SETTINGS with Loom hooks."
fi

# ---------------------------------------------------------------------------
# 6. Statusline script
# ---------------------------------------------------------------------------
echo ""
STATUSLINE_SRC="$LOOM_DIR/statusline-command.sh"
STATUSLINE_DST="$CLAUDE_DIR/statusline-command.sh"

if [ -f "$STATUSLINE_SRC" ]; then
  cp "$STATUSLINE_SRC" "$STATUSLINE_DST"
  chmod +x "$STATUSLINE_DST"
  echo "Installed statusline script to $STATUSLINE_DST"

  # Add statusLine setting if not present
  if [ -f "$CLAUDE_SETTINGS" ]; then
    has_statusline=$(jq -e '.statusLine' "$CLAUDE_SETTINGS" 2>/dev/null && echo "yes" || echo "no")
    if [ "$has_statusline" = "no" ]; then
      jq '.statusLine = {"type": "command", "command": "bash ~/.claude/statusline-command.sh"}' \
        "$CLAUDE_SETTINGS" > "$CLAUDE_SETTINGS.tmp"
      mv "$CLAUDE_SETTINGS.tmp" "$CLAUDE_SETTINGS"
      echo "  Added statusLine config to settings."
    fi
  fi
else
  echo "No statusline-command.sh found in repo, skipping."
fi

# ---------------------------------------------------------------------------
# 7. Generate start-loom.sh for this machine's path
# ---------------------------------------------------------------------------
echo ""
echo "Generating start-loom.sh for this install path..."

# Match the server's tmux session naming: loom_<basename>_<md5-prefix>
BASENAME=$(basename "$LOOM_DIR" | tr -cd 'a-zA-Z0-9_-')
MD5_HASH=$(printf '%s' "$LOOM_DIR" | md5sum 2>/dev/null || printf '%s' "$LOOM_DIR" | md5)
MD5_HASH=$(echo "$MD5_HASH" | awk '{print $1}' | cut -c1-8)
SESSION_NAME="loom_${BASENAME}_${MD5_HASH}"

cat > "$LOOM_DIR/start-loom.sh" <<EOF
#!/bin/bash
# Launch Loom's tmux session.
# Run this BEFORE opening Loom — it creates the sticky session that Loom reattaches to.

SESSION="$SESSION_NAME"
DIR="$LOOM_DIR"

if tmux has-session -t "\$SESSION" 2>/dev/null; then
  echo "Session '\$SESSION' already exists. Attaching..."
  tmux attach-session -t "\$SESSION"
else
  echo "Creating session '\$SESSION'..."
  tmux new-session -s "\$SESSION" -c "\$DIR"
fi
EOF
chmod +x "$LOOM_DIR/start-loom.sh"
echo "  Session name: $SESSION_NAME"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo " Loom setup complete!"
echo "============================================"
echo ""
echo " Start Loom:    npm run dev"
echo " Start tmux:    ./start-loom.sh"
echo " Open browser:  http://localhost:3000"
echo ""

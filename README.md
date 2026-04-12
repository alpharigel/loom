# Loom

A workspace manager for agent-based development. Three-pane IDE with integrated terminals, file browsing, GitHub integration, and optional Docker isolation — designed for managing multiple projects with AI coding agents like Claude Code.

## Features

- **Terminal multiplexing** — persistent tmux sessions that survive page reloads and server restarts
- **File browser & editor** — browse files, edit with CodeMirror 6, markdown preview
- **GitHub integration** — view issues, PRs, commits; clone repos; create worktrees
- **Docker isolation** — optional per-project containers with auto-assigned ports
- **Profiles** — local multi-user profiles with per-profile scratch and agent directories
- **Multi-instance** — discover and connect to other Loom instances on your LAN via mDNS
- **Claude Code integration** — agent status hooks, statusline script, project-scoped commands
- **Home Assistant add-on** — run Loom as an HA add-on with ingress support

## Quick Start

```bash
git clone https://github.com/alpharigel/loom.git
cd loom
./setup.sh       # macOS / Linux / WSL
npm run dev
```

Open http://localhost:3000 in your browser.

### Prerequisites

- **Node.js 22+** (required — see [Why Node 22](#why-node-22))
- tmux
- git
- jq

### What `setup.sh` does

1. Checks prerequisites
2. Runs `npm install`
3. Creates `~/.loom/` config directory
4. Configures Claude Code hooks (agent status webhook)
5. Installs the statusline script
6. Generates `start-loom.sh` for your install path

## Platform Support

Loom runs natively on **macOS**, **Linux**, **WSL2**, and **Windows**. No C++ build tools are required on any platform — `node-pty` is vendored as `@homebridge/node-pty-prebuilt-multiarch`, which ships prebuilt binaries for darwin, linux, and win32.

### Windows (native)

```powershell
nvm install 22
nvm use 22
git clone https://github.com/alpharigel/loom.git
cd loom
npm install
npm start
```

Terminal sessions use Windows ConPTY. `setup.sh` is a bash script and won't run under plain PowerShell — skip it on Windows and use `npm install` directly (the setup script's Claude Code hooks can be configured manually if you want them).

### WSL2

Treat it as a normal Linux install. Keep the clone on the Linux filesystem (e.g. `~/Dev/loom`), not under `/mnt/c/...`, for fast file watching. If you also run Loom on the Windows host, use two separate clones — they can't share `node_modules` across the platform boundary, and you'll want different `PORT` values since WSL2 forwards localhost to the Windows host.

```bash
PORT=3001 npm start    # avoid colliding with a Windows instance on 3000
```

`~/.loom` is per-OS, so configs and profiles stay isolated between the two sides automatically.

**Cross-boundary peer discovery (Windows 11).** WSL2's default NAT network blocks UDP multicast, so the machine-switcher dropdown won't find a Loom instance running on the Windows host (and vice versa) — each side only sees itself. Enable **mirrored networking mode** to fix this: create `C:\Users\<you>\.wslconfig` with

```ini
[wsl2]
networkingMode=mirrored
```

then run `wsl --shutdown` from PowerShell and restart WSL. With mirrored mode, WSL shares the Windows host's network stack and mDNS (`_loom._tcp`) crosses freely in both directions.

### Why Node 22

Node 22 is the current Active LTS. The `engines` field enforces `>=22.0.0` so contributors and CI land on a consistent modern runtime.

## Configuration

All configuration lives in `~/.loom/`:

| File | Purpose |
|------|---------|
| `config.json` | Project directory path, Docker settings |
| `project-config.json` | Project order, per-project commands |
| `profiles.json` | Local user profiles |
| `tmux.conf` | Loom-managed tmux config |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `LOOM_PROJECT_DIR` | `~/Dev` | Where projects live |
| `LOOM_DATA_DIR` | `~/.loom` | Loom config/data directory |
| `LOOM_HA_MODE` | _(unset)_ | Set to disable mDNS (for HA add-on) |

## Architecture

Loom is a single Express.js server (`server.js`) with a vanilla JS frontend (`public/`).

**Backend:** Express + WebSocket (ws) + node-pty for terminals + chokidar for file watching

**Frontend:** Single-page app with module-per-pane architecture:
- `app.js` — state management, WebSocket, profiles, machine switching
- `projects.js` — project list, worktrees, ordering
- `terminal.js` — xterm.js terminal sessions
- `files.js` — file browser with breadcrumbs
- `editor.js` — CodeMirror 6 editor with markdown preview
- `details.js` — GitHub metadata (issues, PRs, commits)
- `dashboard.js` — project overview dashboard
- `settings.js` — configuration modal

### Multi-Instance

Loom instances on the same LAN discover each other via mDNS. The workspace dropdown (top-left) lets you switch between instances — all API calls and WebSocket connections route to the selected machine.

### Profiles

Profiles are local identities with no authentication. Each profile gets its own scratch and agent directories. When switching to a remote Loom instance, your profile is auto-created there if it doesn't exist.

## Docker Isolation

Enable Docker in Settings to run each project in its own container. The base image (`docker/Dockerfile`) includes Node.js 22, git, zsh, GitHub CLI, and Claude Code CLI. Containers mount the project workspace and pass through API keys.

## Home Assistant Add-on

Loom can run as a Home Assistant add-on. See `deploy/ha-addon/` for the add-on configuration. Add this repository as an add-on repository in HA to install.

## Development

```bash
npm run dev        # Start with auto-restart on changes
npm run build      # Bundle CodeMirror with esbuild
```

The server watches `public/` for changes and triggers live-reload in connected browsers during development.

## License

MIT

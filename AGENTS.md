# AGENTS.md

Guidance for AI coding agents (Claude Code, etc.) working in this repository.

## What is Loom?

Loom is a full-stack web application for managing multiple development projects with integrated terminals, file browsing, GitHub integration, and optional Docker container isolation. It provides a 3-pane IDE-like interface for agent-based development workflows.

## Build & Run Commands

```bash
npm start          # Production: node server.js (port 3000)
npm run dev        # Development: node --watch server.js (auto-restart on changes)
npm run build      # Bundle CodeMirror with esbuild
./setup.sh         # First-time setup (installs deps, configures Claude Code hooks)
```

There are no tests or linting configured.

## Tech Stack

- **Backend**: Express.js + WebSocket (ws) + node-pty for terminal multiplexing
- **Frontend**: Vanilla JS (no framework), xterm.js for terminals, CodeMirror 6 for editor
- **Runtime**: Node.js 22 (required; see `engines` in `package.json`)
- **Optional**: Docker for per-project container isolation

### node-pty on Windows

`node-pty` is declared via an npm alias in `package.json`:

```json
"node-pty": "npm:@homebridge/node-pty-prebuilt-multiarch@^0.13.1"
```

The upstream `node-pty` from Microsoft compiles from source via node-gyp and ships no prebuilt binaries, which forces every Windows contributor to install Visual Studio's "Desktop development with C++" workload (~6GB). The `@homebridge/node-pty-prebuilt-multiarch` fork is API-compatible and ships prebuilt binaries for win32/darwin/linux, so `require('node-pty')` in `server.js` works unchanged on all three platforms with no compiler required. Do **not** switch back to upstream `node-pty` unless you also have a plan for Windows prebuilds.

## Platform Notes

### Windows native
Works with Node 22 LTS via nvm-windows. No build tools required thanks to the prebuilt node-pty alias above. PTY sessions use Windows ConPTY.

### WSL2
Works as a normal Linux install. Keep the clone on the Linux filesystem (e.g. `~/Dev/loom`), not `/mnt/c/...`, for fast file watching and to avoid `node_modules` collisions with a Windows-side clone.

### Running Windows + WSL simultaneously
Two separate clones, different `PORT` values (WSL2 forwards localhost to the Windows host, so both can't bind 3000). `~/.loom` is per-OS so configs and profiles stay isolated automatically.

## Architecture

### Server (`server.js`)

Single monolithic Express server that handles:
- REST API for projects, files, config, GitHub data, and Docker management
- WebSocket server for terminal I/O and filesystem change notifications
- Terminal session management via node-pty with 30-minute idle TTL
- File watching via chokidar with 300ms debounce
- Profile management (local multi-user profiles, no authentication)
- Machine identity and mDNS peer discovery for multi-instance support

### Frontend (`public/`)

Single-page app with module-per-pane architecture:
- `app.js` — Central state (`App.state`), event bus (`App.on/emit`), profiles, machine switching
- `projects.js` — Left pane: git repo discovery, worktree listing, project ordering
- `details.js` — Middle pane top: GitHub metadata, issues, PRs, commits (cached 1 min)
- `terminal.js` — Middle pane bottom: xterm.js terminal sessions over WebSocket
- `files.js` — Right pane: directory browser with breadcrumbs
- `editor.js` — Right pane: CodeMirror 6 with markdown preview
- `settings.js` — Config modal
- `dashboard.js` — Dashboard view with project overview

### WebSocket Protocol

Client sends: `terminal:create`, `terminal:data`, `terminal:resize`, `terminal:close`
Server sends: `terminal:data`, `terminal:exit`, `terminal:error`, `fs:changed`

### Profiles

Local profile system (no authentication required):
- Profiles stored in `~/.loom/profiles.json` (array of `{ name, displayName, avatar }`)
- Each profile gets its own `~/.loom/profiles/<name>/scratch/` and `agents/` dirs
- Frontend sends active profile via `X-Loom-Profile` header on all API requests
- Profile selection is sticky via localStorage
- When switching to a remote Loom instance, profiles are auto-created if they don't exist

### Multi-Instance Support

Loom instances discover each other via mDNS (Bonjour) on the LAN:
- Each instance advertises as `_loom._tcp` on startup
- The workspace dropdown shows all discovered instances
- Switching instances routes all API calls and WebSocket to the remote host
- Profile names are matched across instances for continuity

### Configuration

- App config: `~/.loom/config.json` (projectDirectory, dockerEnabled, dockerPorts)
- Project config: `~/.loom/project-config.json` (projectOrder, commands, dockerPorts)
- Profiles: `~/.loom/profiles.json`
- Per-project Dockerfiles: `.loom/Dockerfile`
- Worktrees stored in `~/.loom/worktrees/`

### Environment Variables

- `PORT` — Server port (default: 3000)
- `LOOM_PROJECT_DIR` — Projects directory (default: ~/Dev)
- `LOOM_DATA_DIR` — Loom config directory (default: ~/.loom)
- `LOOM_HA_MODE` — Set to disable mDNS for Home Assistant add-on mode

### Docker

Base image (`docker/Dockerfile`) built on node:22 with git, zsh, GitHub CLI, and Claude Code CLI. Containers mount workspace, gh config, SSH keys, and gitconfig. Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN) are passed through.

### Design System

Dark industrial theme. Accent color: #e8a838 (golden). Fonts: JetBrains Mono (code), DM Sans (UI).

# Arcane Agents

Arcane Agents is a local-first visual control room for terminal-backed AI coding agents.
Each agent appears as a character on a 2D map, and selecting one opens its live terminal in the right panel.

## What It Does

- Manages agents as tmux windows.
- Streams live terminal output into the browser via `node-pty` + WebSockets.
- Tracks agent status (`idle`, `working`, `attention`, `error`) from pane output.
- Lets you spawn agents from shortcuts or direct project+runtime combinations.
- Stores state locally in SQLite.

## Platform Support

- Linux: fully supported and recommended.
- macOS: core app works, but opening an agent in an external terminal (`↗`) is currently Linux-oriented (`xdg-terminal-exec`).
- Windows: use WSL2 (Ubuntu or similar) and run Arcane Agents inside WSL.

## Requirements

- Node.js 20+ and npm
- tmux (hard dependency)
- At least one configured runtime command (for example `opencode`, `claude`, or `bash`)
- Optional but useful:
  - `git` (for worktree/discovery workflows)
  - `xdg-terminal-exec` (Linux external terminal button)

## Package Install (Planned)

Arcane Agents now includes a CLI entrypoint intended for global package installs:

- `arcane-agents` (same as `arcane-agents start`)
- `arcane-agents init` (writes `~/.config/arcane-agents/config.yaml` from template)
- `arcane-agents doctor` (checks dependencies and configured runtime commands)

The package is not published yet, but you can test the exact install flow locally:

```bash
npm run build
npm pack
npm install -g ./arcane-agents-0.1.0.tgz

arcane-agents init
arcane-agents doctor
arcane-agents
```

To remove the global test install:

```bash
npm uninstall -g arcane-agents
```

## Install From Source

1) Install system dependencies.

Linux (Debian/Ubuntu):

```bash
sudo apt update
sudo apt install -y tmux git
```

macOS (Homebrew):

```bash
brew install tmux git
```

Windows:

- Install WSL2 and Ubuntu.
- Run the Linux setup steps inside WSL.

2) Clone and install dependencies.

```bash
git clone https://github.com/thomasrice/arcane-agents.git
cd arcane-agents
npm install
```

3) Create your user config.

```bash
mkdir -p ~/.config/arcane-agents
cp config.example.yaml ~/.config/arcane-agents/config.yaml
```

4) Edit `~/.config/arcane-agents/config.yaml` with your own project paths and runtime commands.

5) Start dev mode (client + server).

```bash
npm run dev
```

Default URLs:

- App (Vite): `http://127.0.0.1:7600`
- API (Express): `http://127.0.0.1:7601`

## How To Use

- Use shortcut buttons in the bottom bar to quickly spawn agents.
- Use the `+` button for custom spawn (project + runtime selection).
- Press `/` to open the command palette.
- Click an agent to focus it and attach the terminal panel.
- Drag agents on the map to organize them visually.
- Use contextual controls to stop/restart selected agents.

## Configuration

### Paths and merge order

- Primary config: `~/.config/arcane-agents/config.yaml`
- Optional override config: `~/.config/arcane-agents/config.local.yaml`
- State directory: `~/.local/state/arcane-agents/`
- SQLite DB: `~/.local/state/arcane-agents/arcane-agents.db`

Config is loaded at server startup and merged in this order:

1. Built-in defaults
2. `config.yaml`
3. `config.local.yaml`

Changes require a server restart.

### Top-level sections

- `projects`: named project paths available for spawning.
- `runtimes`: command presets (CLI command arrays + labels).
- `shortcuts`: quick-spawn entries shown in UI and command palette.
- `discovery`: optional auto-discovery rules for additional projects.
- `backend.tmux`: tmux session and status poll settings.
- `server`: API bind host/port.

### `projects`

`projects` is a map keyed by project id.

Required fields per project:

- `path`: filesystem path (supports `~` expansion)
- `shortName`: short display slug

Optional fields per project:

- `label`: UI-friendly label

Example:

```yaml
projects:
  app:
    path: ~/code/my-app
    shortName: app
    label: My App
```

### `runtimes`

`runtimes` is a map keyed by runtime id.

Required fields per runtime:

- `command`: command to execute (string array)
- `label`: UI label

Example:

```yaml
runtimes:
  claude:
    command: ["claude"]
    label: Claude Code
  shell:
    command: ["bash"]
    label: Shell
```

### `shortcuts`

`shortcuts` is an array.

Required fields per shortcut:

- `label`: button text
- `project`: project id (or unique `shortName`)
- `runtime`: runtime id

Optional fields per shortcut:

- `command`: command override for this shortcut only
- `hotkeys`: array of key chords (for example `"Ctrl+1"`)
- `avatar`: pinned avatar type

Example:

```yaml
shortcuts:
  - label: APP
    project: app
    runtime: claude
    hotkeys: ["Ctrl+1"]
  - label: Tests
    project: app
    runtime: shell
    command: ["npm", "test", "--", "--watch"]
    avatar: elder-wizard
```

### `discovery`

`discovery` is an array of rules with:

- `name` (required)
- `type` (required): `worktrees`, `directories`, or `glob`
- `path` (required)
- `match` (optional)
- `exclude` (optional)
- `maxDepth` (optional)

Rule behavior:

- `worktrees`: runs `git worktree list` from `path`.
- `directories`: recursively scans directories from `path`.
  - `match` checks for a marker path (for example `.git`).
  - `exclude` skips matching directory names.
  - `maxDepth` controls recursion depth.
- `glob`: treats `path` as a glob pattern and includes matching directories.

Example:

```yaml
discovery:
  - name: code-projects
    type: directories
    path: ~/code
    match: ".git"
    exclude: ["node_modules", ".cache", "dist"]
    maxDepth: 2
  - name: app-worktrees
    type: worktrees
    path: ~/code/my-app
  - name: playground-glob
    type: glob
    path: ~/code/playground/*
```

### `backend.tmux`

- `sessionName`: tmux session used for managed windows.
- `pollIntervalMs`: status poll interval in milliseconds (minimum `250`).

Example:

```yaml
backend:
  tmux:
    sessionName: arcane-agents
    pollIntervalMs: 2500
```

### `server`

- `host`: bind address for the API server.
- `port`: bind port for the API server.

Example:

```yaml
server:
  host: 127.0.0.1
  port: 7600
```

## Development Commands

```bash
npm run dev        # client + server
npm run dev:server # backend only
npm run dev:client # frontend only
npm run lint
npm run typecheck
npm run test:ci
```

## Build + Run

```bash
npm run build
npm start
```

Default runtime URL: `http://127.0.0.1:7600`

Health checks:

```bash
# dev mode (npm run dev)
curl http://127.0.0.1:7601/api/health

# built app (npm start, default config)
curl http://127.0.0.1:7600/api/health
```

## Status Debugging

To log status transitions (for example `working -> idle`) in the server terminal, set
`ARCANE_AGENTS_STATUS_TRACE` when launching the backend:

```bash
ARCANE_AGENTS_STATUS_TRACE=transitions npm run dev:server
```

Useful modes:

- `ARCANE_AGENTS_STATUS_TRACE=off` (default)
- `ARCANE_AGENTS_STATUS_TRACE=transitions` (only status changes; no output when status stays the same)
- `ARCANE_AGENTS_STATUS_TRACE=verbose` (every status evaluation)

If you run full dev mode:

```bash
ARCANE_AGENTS_STATUS_TRACE=transitions npm run dev
```

Status debugging APIs:

- `GET /api/status-debug`
- `GET /api/workers/:workerId/status-debug`
- `GET /api/workers/:workerId/status-history`

## Screenshots

- Placeholder: add `docs/media/arcane-agents-main.png`.

## Screenshot + Video Capture Plan

Capture these before public launch:

1. Main layout overview (map + terminal + bottom bar, 3-5 agents visible).
2. Quick-spawn flow (click shortcut -> agent appears -> terminal auto-switch).
3. Attention flow (agent shows attention state -> user clicks and responds in terminal).
4. Agent control flow (select agent -> stop/restart from contextual controls).
5. Group interaction flow (multi-select + move/rally if available in your current build).

Suggested lightweight release media:

- 3-5 annotated screenshots for README.
- One short GIF/video (20-45s) covering spawn, switch, attention, and stop.
- Optional: one performance clip with many active agents (for example, 50-100).

## Stack

- TypeScript (client + server)
- Vite + React (client)
- Express + ws (server)
- xterm.js (embedded terminal)
- node-pty (PTY bridge)
- tmux (session/window process management)
- better-sqlite3 (local persistence)

## Project Layout

```text
src/
  client/   UI, map renderer, xterm terminal panel
  server/   API, orchestration, tmux adapter, status monitor
  shared/   Shared types/config models
assets/     Maps, character art
```

## License

- Code is licensed under MIT (`LICENSE`).

# Arcane Agents

Built and maintained by [Thomas Rice](https://www.thomasrice.com), Co-founder of
[Minotaur Capital](https://www.minotaurcapital.com).

Arcane Agents is a local-first visual control room for terminal-backed AI agents.
Each agent appears as a character on a 2D map, and selecting one opens its live terminal in the right panel.
Common setups use Claude Code or OpenCode runtimes, but any terminal-accessible runtime can work.

<p align="center">
  <video src="https://github.com/user-attachments/assets/b85ee107-17f4-4a78-b546-71951adeabd3" controls width="720"></video>
</p>

> [Watch the demo on YouTube →](https://youtu.be/vOUcloQTCoQ)

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

## Install (Non-Developers)

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

2) Install Arcane Agents globally.

```bash
npm install -g arcane-agents
```

3) Create your user config.

```bash
arcane-agents init
```

`arcane-agents start` also auto-creates a starter config if it is missing.

4) Edit your config.

```bash
arcane-agents config edit
```

This opens `~/.config/arcane-agents/config.yaml` in `$VISUAL` or `$EDITOR`.

5) Run setup checks.

```bash
arcane-agents doctor
```

6) Start Arcane Agents.

```bash
arcane-agents
```

7) Open `http://127.0.0.1:7600`.

Optional maintenance commands:

```bash
npm install -g arcane-agents@latest  # upgrade
npm uninstall -g arcane-agents       # uninstall
```

## Run Locally (Developers)

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
npm run cli -- init
```

4) Edit your config.

```bash
npm run cli -- config edit
```

Or edit `~/.config/arcane-agents/config.yaml` directly.

5) Start dev mode (client + server).

```bash
npm run dev
```

To expose dev mode to other computers on your LAN:

```bash
npm run dev -- --host
```

If you want to open the app through a named host such as a Tailscale MagicDNS
name, allow that host explicitly:

```bash
npm run dev -- --host --allow-host waystone
```

You can also bind to a specific interface:

```bash
npm run dev -- --host 192.168.1.42
```

Default URLs:

- App (Vite): `http://127.0.0.1:7600`
- API (Express): `http://127.0.0.1:7601`

## How To Use

- Use shortcut buttons in the bottom bar to quickly spawn agents.
- Use the `+` button for custom spawn (project + runtime selection).
- Click an agent to focus it and attach the terminal panel.
- Drag agents on the map to organize them visually.
- Use contextual controls to stop/restart selected agents.

## Keyboard Guide

### Selection vs terminal focus

- `Selection` focus: map/roster shortcuts are active.
- `Terminal` focus: keys go directly to the attached terminal.
- `Enter` on a selected agent focuses its terminal.
- With no selection, `Enter` activates the highlighted roster item; press `Enter` again to focus terminal input.
- `Ctrl+D` or `Ctrl+]` exits terminal focus back to selection focus.
- Press `Ctrl+D` or `Ctrl+]` again in selection focus to clear selection.

### Common shortcuts

- `/`: open command palette.
- `?`: show the full shortcut list in-app.
- `Tab` / `Shift+Tab`: cycle agents (or cycle selected-group focus).
- `.` / `,` / `Shift+.`: cycle idle agents.
- `1-0`: select control group.
- `Ctrl+1-0`: assign selected agents to a control group.
- `K`: open kill confirmation for selected agents.
- `Shift+K`: kill highlighted roster agent (then `Enter` to confirm).
- `R`: rename selected agent.
- `M`: toggle movement mode for selected agent(s).
- `W/A/S/D` or arrow keys: move selected agents.
- `Shift+W/A/S/D` or `Shift+Arrow keys`: pan the map viewport.
- `-` / `+`: zoom map out or in (outside terminal focus).
- `[` / `]`: resize split; `Shift+[` / `Shift+]`: jump split to edge; `=`: reset split.
- Left-drag the divider between map and terminal panes to resize.
- `Esc`: close overlays/dialogs, then deselect.

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

### Config CLI helpers

```bash
arcane-agents config path  # print config and local override paths
arcane-agents config show  # print config.yaml
arcane-agents config edit  # open config.yaml in $VISUAL/$EDITOR
```

### Top-level sections

- `projects`: named working directories (`cwd`) agents can launch into.
- `runtimes`: command presets to run in a project directory.
- `shortcuts`: saved `project + runtime` combinations; can also include hotkeys.
- `discovery`: optional auto-discovery rules for additional projects.
- `avatars`: avatar selection settings (for example disabling specific avatar types from random allocation).
- `status`: status detection settings (for example interactive command filtering).
- `audio`: client sound settings.
- `backend.tmux`: tmux session and status poll settings.
- `server`: API bind host/port.

### Quick example (Claude Code + OpenCode)

If you want to launch Claude Code in `~/minotaur/taurient` and OpenCode in
`~/code/personal-assistant`, a minimal config looks like this:

```yaml
projects:
  home:
    path: "~"
    shortName: home
  taurient:
    path: ~/minotaur/taurient
    shortName: taur
  personal-assistant:
    path: ~/code/personal-assistant
    shortName: pa

runtimes:
  claude:
    command: ["claude"]
    label: Claude Code
  opencode:
    command: ["opencode"]
    label: OpenCode
  shell:
    command: ["bash"]
    label: Shell

shortcuts:
  - label: Taurient Claude
    project: taurient
    runtime: claude
    hotkeys: ["Ctrl-U"]
  - label: PA OpenCode
    project: personal-assistant
    runtime: opencode
    hotkeys: ["Ctrl-A"]
  - label: Home Shell
    project: home
    runtime: shell
    hotkeys: ["Ctrl-S"]
```

### `projects`

`projects` is a map keyed by project id. Each entry defines the working
directory used when launching an agent.

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

`runtimes` is a map keyed by runtime id. Each runtime defines the command Arcane
Agents runs inside a selected project directory.

Required fields per runtime:

- `command`: command to execute (string array)
- `label`: UI label

Optional fields per runtime:

- `freshnessWindowMs`: override the idle-detection freshness window (in
  milliseconds) for this runtime. When output has been quiet for longer than this
  window, the worker is considered idle. Defaults to 20 seconds for generic
  runtimes; known agent runtimes (Claude, OpenCode, Codex) use their own
  built-in windows. Useful for long-running programs that may go quiet for
  extended periods between bursts of output.

Example:

```yaml
runtimes:
  claude:
    command: ["claude"]
    label: Claude Code
  shell:
    command: ["bash"]
    label: Shell
  my-pipeline:
    command: ["bin/run-pipeline"]
    label: Pipeline
    freshnessWindowMs: 60000  # allow up to 60s of quiet before marking idle
```

### `shortcuts`

`shortcuts` is an array of saved launch recipes. Each shortcut combines a
`project` with a `runtime`, and can optionally include one or more keyboard
hotkeys.

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

### `status`

Controls how Arcane Agents detects agent activity.

- `interactiveCommands`: programs where terminal output changes are user-driven
  (scrolling, status bar updates, etc.) and should not trigger `working`/`idle`
  transitions. Setting this replaces the defaults entirely.
- `extraInteractiveCommands`: additional commands to add to the default list
  without replacing it.

Default interactive commands: `nvim`, `vim`, `vi`, `nano`, `helix`, `hx`,
`emacs`, `emacsclient`, `less`, `more`, `man`, `htop`, `btop`, `top`, `watch`,
`lazygit`, `lazydocker`, `ranger`, `nnn`, `lf`, `yazi`, `tmux`.

Example — replace defaults entirely:

```yaml
status:
  interactiveCommands:
    - nvim
    - vim
    - my-custom-editor
```

Example — extend defaults with extra commands:

```yaml
status:
  extraInteractiveCommands:
    - my-custom-editor
    - my-other-tool
```

### `audio`

- `enableSound`: enable or disable in-app voice/sound playback (default `true`).

Example:

```yaml
audio:
  enableSound: true
```

### `avatars`

- `disabled`: avatar folder names to exclude from random avatar allocation.
- Disabled avatars can still be used when explicitly pinned via `shortcuts[].avatar`.

Example:

```yaml
avatars:
  disabled:
    - minotaur-strategist
    - gothic-witch
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

## Named Sessions

Named sessions let you run independent instances of Arcane Agents, each with its
own worker state (SQLite DB) and tmux session. Config (projects, runtimes,
shortcuts) stays shared.

### Usage

```bash
# Start the default session (same as before)
arcane-agents start

# Start a named session with separate state
arcane-agents start --session side-project
arcane-agents start -s experiments

# List all sessions that have been created
arcane-agents sessions list

# Delete a named session and all its data
arcane-agents sessions delete side-project
```

### How it works

- The default session uses `~/.local/state/arcane-agents/arcane-agents.db` (unchanged).
- Named sessions store their DB under `~/.local/state/arcane-agents/sessions/<name>/arcane-agents.db`.
- Each named session gets its own tmux session (`arcane-agents-<name>` by default).
- Config paths are shared across all sessions.

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

## Customizing Avatars

Avatar packs are directory-driven under `assets/characters/<avatar-type>/`.

- Required sprite files are documented in `assets/characters/README.md`.
- Optional voice clips are loaded from `assets/characters/<avatar-type>/voice-lines/`.
- Voice file names: fixed events use `arrive.mp3`, `attention.mp3`, `complete.mp3`, `death.mp3`; random events match any `move*.mp3` and `selected*.mp3` clips in the folder.
- In app runtime, clips are served from `/api/assets/characters/<avatar-type>/voice-lines/<file>.mp3`.
- Add a new avatar by dropping in a compliant folder; it becomes available automatically.

## License

- Licensed under MIT.

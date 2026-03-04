# Arcane Agents

Arcane Agents is a local-first visual control room for terminal-backed AI coding agents.
Each agent appears as a character on a 2D map, and selecting one opens its live terminal in the right panel.

## What It Does

- Manages agents as tmux windows.
- Streams live terminal output into the browser via `node-pty` + WebSockets.
- Tracks agent status (idle/working/attention/error) from pane output.
- Lets you spawn agents from shortcuts or direct project+runtime combinations.
- Stores state locally in SQLite.

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

## Project Layout

```
src/
  client/   UI, map renderer, xterm terminal panel
  server/   API, orchestration, tmux adapter, status monitor
  shared/   Shared types/config models
assets/     Maps, character art
```

## Install (Cross-Platform)

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

## Quick Start (Dev)

Clone + install:

```bash
npm install
```

Optional: create your user config from the repo example:

```bash
mkdir -p ~/.config/arcane-agents
cp config.example.yaml ~/.config/arcane-agents/config.yaml
```

Then edit runtime commands and project paths in `~/.config/arcane-agents/config.yaml`.

Start dev mode (client + server):

```bash
npm run dev
```

Default URLs:

- App (Vite): `http://127.0.0.1:7600`
- API (Express): `http://127.0.0.1:7601`

## Build + Run

```bash
npm run build
npm start
```

Default runtime URL: `http://127.0.0.1:7600`

## Config

User config file:

- `~/.config/arcane-agents/config.yaml`

State directory:

- `~/.local/state/arcane-agents/`

Note: config is loaded at server startup. Changes to `config.yaml` require a server restart.
These paths are used on Linux/macOS and inside WSL.

## Shortcuts

- `shortcuts`: quick spawn entries shown in the bottom bar, summon list, and command palette.
- A shortcut can optionally define:
  - `hotkeys` (for example `"Ctrl+A"`, `"Ctrl+Shift+A"`)
  - `command` (override runtime command for this shortcut)
  - `avatar` (pin a specific character sprite)
- Avatars pinned by shortcuts are excluded from the random avatar pool used by non-pinned spawns (unless all avatars are pinned, then full pool is used).

## Restarting The Server

If you are running `npm run dev` in a terminal, the simplest restart is:

1. Press `Ctrl+C`
2. Run `npm run dev` again

`npm run dev` now automatically clears existing listeners on ports `7600` and `7601`
before starting Vite and the backend.

If you need to restart backend only (port `7601`) from another shell:

```bash
pids=$(lsof -ti TCP:7601 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$pids" ]; then kill $pids; fi
npm run dev:server
```

Health check:

```bash
curl http://127.0.0.1:7601/api/health
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

## License

- Code is licensed under MIT (`LICENSE`).
- Character image assets are Copyright (c) 2026 Thomas Rice
  and are included under the MIT license in this repo.

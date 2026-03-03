# Overworld

Overworld is a local-first visual control room for terminal-backed AI coding agents.
Each agent appears as a character on a 2D map, and selecting one opens its live terminal in the right panel.

## What It Does

- Manages agents as tmux windows.
- Streams live terminal output into the browser via `node-pty` + WebSockets.
- Tracks worker status (idle/working/attention/error) from pane output.
- Lets you spawn agents from shortcuts or direct project+runtime combinations.
- Stores state locally in SQLite.

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
- macOS: core app works, but opening a worker in an external terminal (`↗`) is currently Linux-oriented (`xdg-terminal-exec`).
- Windows: use WSL2 (Ubuntu or similar) and run Overworld inside WSL.

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
mkdir -p ~/.config/overworld
cp config.example.yaml ~/.config/overworld/config.yaml
```

Then edit runtime commands and project paths in `~/.config/overworld/config.yaml`.

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

- `~/.config/overworld/config.yaml`

State directory:

- `~/.local/state/overworld/`

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
`OVERWORLD_STATUS_TRACE` when launching the backend:

```bash
OVERWORLD_STATUS_TRACE=transitions npm run dev:server
```

Useful modes:

- `OVERWORLD_STATUS_TRACE=off` (default)
- `OVERWORLD_STATUS_TRACE=transitions` (only status changes; no output when status stays the same)
- `OVERWORLD_STATUS_TRACE=verbose` (every status evaluation)

If you run full dev mode:

```bash
OVERWORLD_STATUS_TRACE=transitions npm run dev
```

Status debugging APIs:

- `GET /api/status-debug`
- `GET /api/workers/:workerId/status-debug`
- `GET /api/workers/:workerId/status-history`

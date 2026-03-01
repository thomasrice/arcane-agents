# Overworld

Overworld is a local-first visual control room for terminal-backed AI coding agents.
Each agent appears as a character on a 2D map, and selecting one opens its live terminal in the right panel.

## What It Does

- Manages agents as tmux windows.
- Streams live terminal output into the browser via `node-pty` + WebSockets.
- Tracks worker status (idle/working/attention/error) from pane output.
- Lets you spawn agents from shortcuts/profiles or direct project+runtime combinations.
- Stores state locally in SQLite.

## Stack

- TypeScript (client + server)
- Vite + React (client)
- Express + ws (server)
- xterm.js (embedded terminal)
- node-pty (PTY bridge)
- tmux (session/window process management)
- better-sqlite3 (local persistence)

## Project Layout

```
src/
  client/   UI, map renderer, xterm terminal panel
  server/   API, orchestration, tmux adapter, status monitor
  shared/   Shared types/config models
assets/     Maps, tilesets, character/object art
```

## Running Locally

Install dependencies:

```bash
npm install
```

Start dev mode (client + server):

```bash
npm run dev
```

Default URLs:

- App (Vite): `http://127.0.0.1:7600`
- API (Express): `http://127.0.0.1:7601`

## Config

User config file:

- `~/.config/overworld/config.yaml`

State directory:

- `~/.local/state/overworld/`

Note: config is loaded at server startup. Changes to `config.yaml` require a server restart.

## Shortcuts vs Profiles

- `shortcuts`: quick spawn entries shown in the bottom bar and summon list.
- `profiles`: named spawn presets mainly used via the command palette (`/`), with optional command/avatar overrides.

## Restarting The Server

If you are running `npm run dev` in a terminal, the simplest restart is:

1. Press `Ctrl+C`
2. Run `npm run dev` again

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

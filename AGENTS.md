# Arcane Agents

Arcane Agents is a local-first visual control room for managing terminal-backed AI coding agents. Each agent is a pixel-art fantasy character on a top-down map. Clicking a character opens its live terminal in an embedded browser terminal panel (xterm.js). Workers are backed by tmux windows.

`plan.md` is the in-progress structural refactor plan (approved 17/07/2026) — read it for the refactor's phased task lists, findings, and rationale.

## Tech Stack

- TypeScript end-to-end (client + server)
- Vite (frontend build)
- Canvas2D (top-down pixel-art map renderer)
- xterm.js (`@xterm/xterm`) + `@xterm/addon-fit` (embedded browser terminal)
- node-pty (server-side PTY for terminal streaming)
- Node.js + Express (backend API + static serving)
- ws (WebSocket for real-time updates + terminal streaming)
- better-sqlite3 (local persistence)
- tmux (process/session management — hard dependency, shelled out to directly)
- YAML config files (user configuration)

## Project Structure

```
src/
  server/         # Express server, API, tmux, status monitor
    cli.ts        #   CLI entry (start/init/setup/config/sessions/doctor)
    index.ts / bootstrapApp.ts   # Server bootstrap
    bootstrap/    #   Express app assembly, server context, WS upgrade, shutdown
    http/         #   REST API routes, request parsing, typed error responses
    orchestrator/ #   Worker lifecycle (spawn/stop/restart), spawn planning, tmux reconcile
    status/       #   Poll loop classifying each worker idle/working/attention; Claude transcript tracking
    tmux/         #   tmux shell-out adapter and argv builders
    ws/           #   Realtime broadcast hub + node-pty terminal bridge (WebSocket <-> PTY)
    persistence/  #   better-sqlite3 worker repository
    config/       #   YAML config load + schema, project discovery
    assets/       #   Avatar and voice-line catalogues
    setup/        #   Prerequisite checks
    utils/        #   App-root resolution and helpers
  client/         # Vite frontend: Canvas2D map, xterm.js, UI controls
    App.tsx / main.tsx   # App shell and React entry
    map/          #   Canvas2D map: rendering (render/), movement (runtime/), tiles, viewport, pathfinding
    components/   #   Dialogs, terminal panel, command palette, bottom bar
    hooks/        #   Data, selection, worker-action, and layout hooks
    hotkeys/      #   Keyboard shortcut handling
    sprites/      #   Sprite-sheet loading
    api.ts        #   Typed client for the server REST API
  shared/         # Types and constants shared between client and server
```

## Running

```bash
npm install
npm run dev        # Starts both Vite dev server and Express backend
```

The app serves at `http://localhost:7600`.

## Config

User config lives at `~/.config/arcane-agents/config.yaml`. See `config.example.yaml` in the repo root for the full schema. All personal paths and project config belong in user config files, never hardcoded.

State is stored at `~/.local/state/arcane-agents/` (SQLite DB + runtime metadata).

## Dev Server Hot Reload

`tsx watch` may not detect file changes made by external processes (e.g. Claude Code editing files). After making code changes, force a reload:

```bash
touch src/server/index.ts
```

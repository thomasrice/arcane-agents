# Arcane Agents

Arcane Agents is a local-first visual control room for managing terminal-backed coding workflows on a top-down pixel-art map.

`plan.md` is the in-progress structural refactor plan (approved 17/07/2026) — read it for the refactor's phased task lists, findings, and rationale.

## Domain Context

Read [[docs/contexts/characters/CONTEXT]] before introducing or changing language for Characters, their presentation assets, or their terminal lifecycle.

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
    cli.ts        #   CLI entry; parses argv and dispatches to cli/commands
    cli/          #   Per-command modules (start/init/setup/config/sessions/doctor) + arg/prompt/starter-config helpers
    index.ts / bootstrapApp.ts   # Server bootstrap
    bootstrap/    #   Express app assembly, server context, WS upgrade, shutdown
    http/         #   REST API routes, zod request schemas, asyncRoute wrapper, typed error responses
    orchestrator/ #   Worker lifecycle (spawn/stop/restart); spawn/ planning + reconcile/ pure tmux-reconciliation planner
    status/       #   Poll loop classifying each worker idle/working/attention/error; runtimes/ (per-runtime RuntimeAdapters: claude/codex/openCode/generic) + claudeTranscript/ tailing
    tmux/         #   tmux shell-out adapter and argv builders
    platform/     #   Cross-platform shell helpers (findExecutable, shellQuote) + clipboard/WSL detection
    ws/           #   Realtime broadcast hub + node-pty terminal bridge (WebSocket <-> PTY)
    persistence/  #   better-sqlite3 worker repository
    config/       #   YAML config load + schema, project discovery
    assets/       #   Avatar, character-sprite, and voice-line catalogues
    setup/        #   Prerequisite checks
    utils/        #   App-root resolution and helpers
  client/         # Vite frontend: Canvas2D map, xterm.js, UI controls
    App.tsx / main.tsx   # App shell (composition only) and React entry
    state/        #   zustand store, selectors, imperative-handle bridge — single source of shell state
    map/          #   Canvas2D map: render/layers + renderScene orchestration, runtime/ (movement sim + rAF loop), input/ (pointer state machine), commands/ (move orders), tiles, viewport, pathfinding
    components/   #   MapCanvas, dialogs, terminal panel, command palette, bottom bar, roster items
    hooks/        #   Server sync, worker actions, store reconciliation, fades, voice lines, terminal focus
    hotkeys/      #   Declarative shortcut registry + matcher
    sprites/      #   Sprite-sheet loading
    api.ts / assetUrls.ts   # Typed REST client and asset-URL builders
  shared/         # Types and constants shared between client and server (incl. mapSpec)
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

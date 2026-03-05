# Arcane Agents

Arcane Agents is a local-first visual control room for managing terminal-backed AI coding agents. Each agent is a pixel-art fantasy character in a top-down map. Clicking a character opens its live terminal in an embedded browser terminal panel (xterm.js). Workers are backed by tmux windows.

## Key Files

- `plan.md` — **Read this first.** Contains the full product plan, architecture, config schema, UI design, workflows, tech stack, and phased implementation tasks.

## Tech Stack

- TypeScript end-to-end (client + server)
- Vite (frontend build)
- Canvas2D (top-down pixel-art map renderer)
- xterm.js + xterm-addon-fit (embedded browser terminal)
- node-pty (server-side PTY for terminal streaming)
- Node.js + Express (backend API + static serving)
- ws (WebSocket for real-time updates + terminal streaming)
- better-sqlite3 (local persistence)
- tmux (process/session management — hard dependency)
- YAML config files (user configuration)

## Project Structure

```
src/
  server/         # Express server, API routes, tmux adapter, status monitor
  client/         # Vite-built frontend: Canvas2D map, xterm.js, UI controls
  shared/         # Types, config schema, constants shared between client/server
```

## Running

```bash
npm install
npm run dev        # Starts both Vite dev server and Express backend
```

The app serves at `http://localhost:7600`.

## Config

User config lives at `~/.config/arcane-agents/config.yaml`. See `config.example.yaml` in the repo root for the full schema.

State is stored at `~/.local/state/arcane-agents/` (SQLite DB + runtime metadata).

## Dev Server Hot Reload

`tsx watch` may not detect file changes made by external processes (e.g. Claude Code editing files). After making code changes, force a reload:

```bash
touch src/server/index.ts
```

## Development Notes

- The plan.md has detailed implementation phases with checkbox task lists. Work through them in order.
- Phase 0 is repo scaffold. Phase 1 is tmux + API. Phase 2 is UI. Phase 3 is polish. Phase 4 is art.
- For placeholder character sprites during early phases, use simple coloured tokens or basic geometric shapes on the Canvas2D. Real pixel-art sprites come in Phase 4.
- tmux is a hard dependency. The adapter should shell out to `tmux` commands (not use a library).
- The PTY bridge for xterm.js uses node-pty to spawn `tmux attach-session -t <session> \; select-window -t <window>` and pipe stdin/stdout over WebSocket.
- Status detection polls tmux every 2-3 seconds using `tmux list-panes` and `tmux capture-pane`.
- All personal paths and project config belong in user config files, never hardcoded.

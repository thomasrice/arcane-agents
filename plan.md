# Overworld Plan

Overworld is a local-first visual control room for managing terminal-backed AI coding agents. Each agent is a pixel-art fantasy character in a top-down overworld map. Clicking a character opens its live terminal in an embedded browser terminal panel. The map is a decorative outdoor fantasy scene; spawning and controls happen through an RTS-style bottom bar and command palette.

## Product Goal

Build an open-source orchestration layer that can:

- spawn terminal workers from config-driven shortcuts and profiles,
- map each worker to a real tmux window,
- visualise worker state in a top-down pixel-art overworld,
- provide an embedded terminal (xterm.js) for direct interaction,
- detect worker status by monitoring tmux output,
- allow fast context switching by clicking avatars.

Generic and open-source by default; user-specific setups live in config files.

## Product Principles

- Local-first (no cloud dependency).
- tmux as the execution substrate (hard dependency for v1).
- Config-driven (projects, runtimes, shortcuts, profiles are data, not code).
- Terminal-in-browser as primary interaction (xterm.js panel).
- RTS-style controls: bottom bar for spawning, contextual toolbar for selected worker.
- Map is decorative and organisational, not functional (spawning is not tied to map location).
- Fantasy RPG visual theme with pixel-art characters and outdoor overworld.
- One-click spawning for common scenarios; command palette for everything else.
- Always create a new worker on spawn (never reuse/focus existing).
- Auto-switch terminal panel to newly spawned worker.

## MVP Scope

### In scope

- Fixed top-down overworld map (outdoor fantasy scene, decorative).
- Pixel-art fantasy characters with variety (knight, mage, ranger, etc.).
- Side-by-side layout: map on left, embedded terminal (xterm.js) on right.
- Bottom bar with configurable quick-spawn shortcut buttons.
- "+" button for custom spawn (pick from configured/discovered projects + runtime).
- "/" command palette for keyboard-first spawning.
- Contextual toolbar when a worker is selected (stop, restart, info).
- tmux-backed session/window management (one character = one tmux window).
- Status detection via tmux polling (process state + terminal output parsing).
- Visual status indicators on characters (aura colour, overhead icon, speech bubble).
- Activity parsing from terminal output (tool names, file paths, broad state).
- Worker lifecycle controls (stop, restart, remove).
- Config-driven project discovery (worktree scanning, directory scanning).
- Drag-to-reposition characters on the map for manual clustering.
- Persist worker state in SQLite; recover and reconcile on restart.

### Out of scope (v1)

- Sound/audio (deferred to v2).
- Fog of war / procedural map expansion (deferred; fixed map for v1).
- Multi-host orchestration.
- Deep LLM provider integrations (hooks, tool-use events).
- Multi-user / auth.
- Kubernetes/Docker runtime backends.

## Name and Theme

"Overworld" evokes a top-down RPG world map. The visual theme is fantasy/outdoors:

- The map is an outdoor landscape (grass, trees, paths, clearings, water, ruins).
- Characters are fantasy archetypes (knight, mage, ranger, orc, elf, dwarf, druid, etc).
- Working characters set up at campfires, workbenches, tree stumps, or rocks.
- Idle characters wander the map.
- The map has no functional zones — it is purely decorative and for visual clustering.
- Users drag characters to arrange them however they like (group by project, priority, etc).

Character variety is important. Each spawned worker gets a distinct fantasy character from a pool. Shortcuts/profiles can pin a specific avatar type. Characters generated via PixelLab API or similar pixel-art tools.

## Core Workflows

### Workflow 1: Quick-spawn a common combo (1 click)

Bottom bar has shortcut buttons defined in config (e.g. "PA", "Lab", "Taur").

1. Click the "PA" shortcut button.
2. A new worker spawns: OpenCode launches in `~/code/personal-assistant/`.
3. A fantasy character appears on the map.
4. Terminal panel auto-switches to the new worker.

### Workflow 2: Custom spawn (3 clicks)

1. Click the "+" button on the bottom bar.
2. A spawn dialog opens: pick a project from a searchable list (configured + discovered).
3. Pick a runtime (Claude / OpenCode / Shell / custom command).
4. Click "Spawn".
5. Character appears, terminal auto-switches.

### Workflow 3: Command palette spawn (keyboard)

1. Press `/` to open the command palette.
2. Type `pa cl` — fuzzy matches "personal-assistant + Claude Code".
3. Press Enter.
4. Character spawns, terminal auto-switches.

### Workflow 4: Switch between workers (1 click)

1. Click a character on the map.
2. Terminal panel instantly switches to that worker's tmux pane.
3. Bottom bar changes to contextual toolbar (stop / restart / info).

### Workflow 5: Worker needs attention

1. A character's aura turns amber; speech bubble appears.
2. Click the character.
3. Terminal panel connects — permission prompt is visible.
4. Type response directly in xterm.js.

### Workflow 6: Stop a worker

1. Click a character to select it.
2. Bottom bar shows contextual toolbar with "Stop" button.
3. Click "Stop".
4. Character plays a despawn animation and is removed from the map.

### Workflow 7: Rearrange workers

1. Drag a character to a new position on the map.
2. Position is persisted — survives page reload.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (end-to-end) | Single language, type safety across client/server |
| Frontend build | Vite | Fast dev server, good TS support |
| Map renderer | Canvas2D | Matches pixel-art aesthetic, proven by pixel-agents, simpler than Three.js for top-down |
| Terminal embed | xterm.js + xterm-addon-fit | Industry standard browser terminal, used by VS Code |
| Server PTY | node-pty | Connects xterm.js to tmux panes via WebSocket |
| Backend | Node.js + Express | Best node-pty/xterm.js ecosystem, WS support |
| WebSocket | ws | Real-time status updates + terminal streaming |
| Database | SQLite (better-sqlite3) | Local-first, no daemon, single file |
| Process mgmt | tmux | Hard dependency; session/window/pane lifecycle |
| Config format | YAML | Human-readable, good for nested config |
| Package structure | Single package, Vite serves both | Keep simple for v1 |

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Browser (localhost)                       │
│                                                               │
│  ┌───────────────────────────┐  ┌──────────────────────────┐  │
│  │     Overworld Map         │  │    Terminal Panel         │  │
│  │     (Canvas2D)            │  │    (xterm.js)             │  │
│  │                           │  │                           │  │
│  │  characters, status       │  │  live terminal of         │  │
│  │  auras, activity icons    │  │  selected worker          │  │
│  │                           │  │                           │  │
│  ├───────────────────────────┤  │                           │  │
│  │  Bottom Bar               │  │  placeholder when         │  │
│  │  [PA] [Lab] [Taur] [+] / │  │  no worker selected       │  │
│  │  ─── or when selected ─── │  │                           │  │
│  │  [Stop] [Restart] [Info]  │  │                           │  │
│  └───────────┬───────────────┘  └────────────┬──────────────┘  │
│              │ REST + WS                      │ WS (PTY)       │
└──────────────┼────────────────────────────────┼────────────────┘
               │                                │
┌──────────────┴────────────────────────────────┴────────────────┐
│                      Node.js Server                             │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │ Orchestrator   │  │ PTY Bridge    │  │ Status        │       │
│  │ API            │  │ (node-pty)    │  │ Monitor       │       │
│  │                │  │               │  │ (tmux poll)   │       │
│  │ spawn/stop/    │  │ connects      │  │               │       │
│  │ list/restart   │  │ xterm.js to   │  │ capture-pane  │       │
│  │                │  │ tmux panes    │  │ process check │       │
│  └──────┬────────┘  └──────┬────────┘  └──────┬────────┘       │
│         │                   │                   │                │
│  ┌──────┴───────────────────┴───────────────────┴─────────┐     │
│  │                   tmux Adapter                          │     │
│  │  spawn / stop / list / reconcile / attachPty            │     │
│  └───────────────────────┬─────────────────────────────────┘     │
│                          │                                       │
│  ┌───────────────────────┴─────────────────────────────────┐     │
│  │                SQLite (state persistence)                │     │
│  └──────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                         tmux server                               │
│                                                                   │
│  session: overworld                                               │
│    window: pa-opencode-a3f2                                       │
│    window: labyrinth-claude-7b1c                                  │
│    window: taurient-claude-9d4e                                   │
│    ...                                                            │
└───────────────────────────────────────────────────────────────────┘
```

### Data flow

1. User clicks a shortcut button, "+" spawn dialog, or uses `/` command palette.
2. UI sends spawn request to orchestrator API.
3. Orchestrator resolves the project path + runtime command.
4. tmux adapter creates a new window, runs the command in the project directory.
5. Orchestrator persists worker to SQLite, assigns an avatar type.
6. Status monitor begins polling the new tmux pane.
7. UI receives worker-created event via WebSocket, renders character on map.
8. Terminal panel auto-connects to the new worker's tmux pane via PTY WebSocket.
9. Status monitor periodically sends state updates (idle/working/attention/error).
10. UI updates character indicators in real time.

## Configuration Model

### Config locations (XDG)

- User config: `~/.config/overworld/config.yaml`
- Optional local override: `~/.config/overworld/config.local.yaml`
- Runtime state: `~/.local/state/overworld/`
- SQLite DB: `~/.local/state/overworld/overworld.db`
- Cache/assets: `~/.cache/overworld/`

### Merge order

1. Built-in defaults (shipped with repo)
2. User config (`config.yaml`)
3. User local override (`config.local.yaml`)

### Proposed config schema

```yaml
# Projects: named directories available for spawning
projects:
  personal-assistant:
    path: ~/code/personal-assistant
    shortName: pa
  taurient:
    path: ~/minotaur/taurient
    shortName: taur
  labyrinth:
    path: ~/minotaur/labyrinth
    shortName: lab
  beacon:
    path: ~/minotaur/beacon
    shortName: beacon
  foundry:
    path: ~/minotaur/foundry
    shortName: foundry
  obsidian:
    path: ~/ObsidianVault
    shortName: obs
  titangrid:
    path: ~/code/titangrid
    shortName: titan
  thread:
    path: ~/minotaur/thread
    shortName: thread
  minotaur-assistant:
    path: ~/minotaur/assistant
    shortName: ma

# Runtimes: programs that can be launched in a project directory
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

# Shortcuts: quick-spawn buttons shown in the bottom bar
# Each shortcut always creates a new worker (never reuses existing).
shortcuts:
  - label: PA
    project: personal-assistant
    runtime: opencode
    icon: shield
  - label: Lab
    project: labyrinth
    runtime: claude
    icon: scroll
  - label: Taur
    project: taurient
    runtime: claude
    icon: sword
  - label: Obs
    project: obsidian
    runtime: claude
    icon: book

# Profiles: named presets for less common combos (available via palette and custom spawn)
profiles:
  kairos:
    project: taurient
    runtime: shell
    command: ["poetry", "run", "python", "chat.py", "-a", "kairos"]
    label: Chat with Kairos
    avatar: wizard

# Discovery: auto-scan rules to find additional projects
discovery:
  - name: taurient-worktrees
    type: worktrees
    path: ~/minotaur/taurient

  - name: code-projects
    type: directories
    path: ~/code
    match: ".git"
    exclude: ["node_modules", ".cache"]
    maxDepth: 1

# Backend settings
backend:
  tmux:
    sessionName: overworld
    pollIntervalMs: 2500

# Server settings
server:
  port: 7600
  host: 127.0.0.1
```

## Status Detection (tmux Polling)

Status is detected generically by polling tmux every 2-3 seconds. No deep integration with specific tools required for v1.

### Detection methods

```bash
# What is the foreground process?
tmux list-panes -t session:window -F '#{pane_current_command}'
# -> "claude" | "opencode" | "bash" | "python" | etc.

# Is the pane alive?
tmux list-panes -t session:window -F '#{pane_dead}'

# Capture visible terminal content (last 30 lines)
tmux capture-pane -t session:window -p -S -30
```

### State derivation

| Condition | Derived state |
|-----------|---------------|
| Foreground is `bash`/`zsh` (shell prompt) | `idle` |
| Foreground is `claude`/`opencode`/etc | `working` |
| Captured output matches permission pattern (`[Y/n]`, `Allow?`) | `attention` |
| Captured output matches error pattern (traceback, SIGTERM) | `error` |
| Pane is dead or process exited | `stopped` |

### Activity parsing (best-effort)

Parse the last few lines of captured terminal output to extract:

- Current tool being used (Read, Edit, Bash, Grep, Write, etc.)
- File paths being operated on
- Brief status text (e.g. "Reading src/config.ts", "Running tests")

This is heuristic and tool-specific but good enough for visual indicators. Falls back to broad state label ("Working", "Idle") when parsing fails.

## Domain Model

- `Project`: `id`, `name`, `path`, `shortName`, `source` (config | discovered)
- `Runtime`: `id`, `name`, `command`, `args`, `env`
- `Shortcut`: `label`, `projectId`, `runtimeId`, `icon`, `avatar`
- `Profile`: `id`, `projectId`, `runtimeId`, `label`, `command` (override), `avatar`
- `Worker`: `id`, `projectId`, `runtimeId`, `profileId?`, `status`, `activityText`, `avatarType`, `position` (map x,y), `tmuxRef`, `createdAt`, `lastActivityAt`
- `TmuxRef`: `session`, `window`, `pane`

## Orchestrator API

### REST endpoints

- `GET /api/health`
- `GET /api/config` — resolved config (projects, runtimes, shortcuts, profiles)
- `GET /api/config/projects` — includes discovered projects
- `GET /api/workers` — all active workers with status
- `POST /api/workers/spawn` — `{ shortcutIndex }` or `{ profileId }` or `{ projectId, runtimeId }`
- `POST /api/workers/:id/stop`
- `POST /api/workers/:id/restart`
- `PATCH /api/workers/:id/position` — `{ x, y }` for drag-to-reposition
- `DELETE /api/workers/:id` — stop and remove

### WebSocket endpoints

- `WS /api/ws` — real-time worker status updates (state changes, activity text)
- `WS /api/terminal/:workerId` — PTY stream for xterm.js (bidirectional)

## tmux Adapter

### Naming convention

- Session: `overworld` (single session, configurable)
- Window: `${projectShortName}-${runtimeShortName}-${shortId}`
- Example: `pa-opencode-a3f2`, `lab-claude-7b1c`

### Operations

- `spawn(projectPath, command, env?)` — create window, cd to path, run command
- `attachPty(tmuxRef)` — return PTY stream for xterm.js
- `stop(tmuxRef)` — send SIGTERM, wait 5s, then SIGKILL if needed
- `list()` — enumerate overworld-managed windows
- `reconcile(knownWorkers)` — match DB state against live tmux, mark stale workers
- `capturePane(tmuxRef, lines)` — get terminal content for status parsing

### Safety

- Only manage windows within the configured session name.
- Tag windows with overworld metadata (environment variable `OVERWORLD_WORKER_ID`).
- Graceful stop (SIGTERM + 5s grace) before force kill.
- Never kill the tmux session itself, only individual windows.

## UI Design

### Layout

```
┌──────────────────────────────────┬────────────────────────────┐
│                                  │                            │
│        Overworld Map             │     Terminal Panel          │
│        (Canvas2D)                │     (xterm.js)              │
│                                  │                            │
│   fantasy outdoor scene          │   live terminal of          │
│   characters with status         │   selected worker           │
│   auras, icons, labels           │                            │
│                                  │   "Select a worker to       │
│   WASD to pan, wheel to zoom    │    connect its terminal"    │
│   click character to select      │   (placeholder when none)   │
│   drag character to reposition   │                            │
│                                  │                            │
├──────────────────────────────────┤                            │
│  Bottom Bar                      │                            │
│                                  │                            │
│  Default (no selection):         │                            │
│  [PA] [Lab] [Taur] [Obs] [+] /  │                            │
│                                  │                            │
│  When worker selected:           │                            │
│  ◄ Back │ knight "pa-opencode"   │                            │
│  [Stop] [Restart] [Detach]       │                            │
└──────────────────────────────────┴────────────────────────────┘
```

### Bottom bar states

**Default state (no worker selected):**
- Quick-spawn shortcut buttons from config (e.g. [PA] [Lab] [Taur] [Obs]).
- [+] button: opens custom spawn dialog.
- [/] or pressing `/`: opens command palette overlay.

**Selected state (worker clicked):**
- Back arrow to deselect and return to default bar.
- Worker identity: avatar icon + name label (e.g. `knight "pa-opencode-a3f2"`).
- Project + runtime info.
- Action buttons: [Stop] [Restart] [Detach].
- Status indicator (working / idle / attention / error).

### Custom spawn dialog (the "+" button)

A modal/panel that opens over the map:
- Searchable list of projects (configured + discovered).
- Runtime picker: buttons for each configured runtime.
- Optional: command override field for custom commands.
- "Spawn" button.

### Command palette (the "/" key)

An overlay text input that fuzzy-matches across:
- Shortcut labels (e.g. "PA", "Lab").
- Profile names (e.g. "kairos").
- Project + runtime combos (e.g. "personal-assistant claude", "taurient opencode").
- Discovered project names.

Pressing Enter spawns immediately. Results update as you type.

### Map interactions

- WASD / arrow keys: pan the map.
- Mouse wheel: zoom.
- Click character: select it, terminal panel switches, bottom bar shows contextual controls.
- Click empty space: deselect current worker.
- Drag character: reposition on map (position persisted).
- Hover character: tooltip showing project, runtime, status, current activity.

### Character visual indicators

| Layer | What it shows | How |
|-------|--------------|-----|
| Sprite animation | idle / walking / working | Character pose (sitting at campfire vs standing vs walking) |
| Status aura | broad state | Colour glow: green=idle, blue=working, amber=attention, red=error |
| Overhead icon | current tool/action | Small pixel icon above head (terminal, book, pencil, magnifying glass) |
| Speech bubble | needs user input | Amber dots (permission needed) or exclamation mark |
| Name label | worker identity | Small text below character (project + runtime shorthand) |

### Character art

- Fantasy theme: knight, mage, ranger, orc, elf, dwarf, druid, paladin, rogue, barbarian, etc.
- Each spawned worker gets the next available character type from a pool (round-robin).
- Shortcuts and profiles can pin a specific avatar type in config.
- Characters are pixel-art sprite sheets generated via PixelLab API or similar tools.
- Sprite format: walk (4 directions), idle, working poses. Exact sheet layout TBD during Phase 4.
- For early phases, use placeholder sprites (pixel-agents character sheets or simple coloured tokens).

## Persistence and Recovery

- SQLite DB at `~/.local/state/overworld/overworld.db`.
- Tables: `workers`, `worker_events` (recent activity log).
- Worker rows store: id, project, runtime, command, tmux ref, status, position, avatar type, timestamps.
- On startup:
  1. Load workers from DB.
  2. Query tmux for live windows in the overworld session.
  3. Reconcile: match DB workers to live windows by tmux ref / OVERWORLD_WORKER_ID env var.
  4. Mark workers with no matching window as `stopped`.
  5. Optionally discover untracked overworld windows and adopt them.
  6. Push full state to UI via WebSocket.

## Discovery System

Config-driven rules for auto-discovering projects beyond those explicitly listed.

### Discovery rule types

- `worktrees`: Scan a git repo for worktrees. Each worktree becomes a project.
- `directories`: Scan a directory for subdirectories matching a pattern (e.g. containing `.git`).
- `glob`: Match paths against a glob pattern.

### Example

```yaml
discovery:
  - name: taurient-worktrees
    type: worktrees
    path: ~/minotaur/taurient

  - name: code-repos
    type: directories
    path: ~/code
    match: ".git"
    exclude: ["node_modules"]
    maxDepth: 1
```

Discovery runs on startup and can be refreshed via API (`POST /api/config/rediscover`).
Discovered projects are ephemeral (not written to config) but appear in the custom spawn dialog and command palette.

## Open Source Strategy

- Repo ships with `config.example.yaml` showing the schema with placeholder values.
- All personal paths, project names, and custom commands live in user config only.
- Discovery rules are the bridge: generic scanning logic, user-specific paths.
- Fantasy character assets will be included in the repo (open-licensed or generated).
- Clear separation between engine (generic) and config (personal).

## Implementation Phases

### Phase 0 — Repo scaffold

- [x] Create repo and git init.
- [x] Write plan.md.
- [x] Scaffold project structure (src/server, src/client, src/shared).
- [x] Set up Vite + TypeScript + Express.
- [x] Add config loader with YAML parsing and schema validation.
- [x] Add `config.example.yaml`.
- [x] Basic health endpoint and static file serving.

### Phase 1 — tmux adapter + orchestrator API

- [x] Implement tmux adapter (spawn, stop, list, reconcile, capturePane).
- [x] Add SQLite schema and persistence layer.
- [x] Add orchestrator API routes (spawn, stop, list, restart, position).
- [x] Add status monitor (tmux polling loop with state derivation).
- [x] Add WebSocket endpoint for real-time status pushes.
- [x] Add PTY bridge (node-pty + WebSocket) for terminal streaming.

### Phase 2 — UI: map + terminal + controls

- [x] Build Canvas2D map renderer (outdoor tile map, character sprites).
- [x] Add character rendering with status aura and name labels.
- [x] Wire xterm.js terminal panel (right side, auto-connect on select).
- [x] Build bottom bar: shortcut buttons (from config), contextual toolbar.
- [x] Build custom spawn dialog ("+") with project list and runtime picker.
- [x] Build command palette ("/") with fuzzy search.
- [x] Add click-to-select, drag-to-reposition.
- [x] Add hover tooltips.

### Phase 3 — Activity parsing + polish

- [x] Implement terminal output parser for activity text extraction.
- [x] Add overhead icons and speech bubbles based on parsed activity.
- [x] Implement discovery system (worktree scanner, directory scanner).
- [x] Add persistence and startup reconciliation.
- [x] Handle edge cases (tmux server restart, stale workers, etc).

### Phase 4 — Character art + visual polish

- [x] Define sprite asset format and loader conventions for PixelLab per-frame exports.
- [x] Implement sprite loader for `assets/characters/<type>/...` rotation + walk frame directories.
- [x] Replace placeholder character circles with sprite rendering plus fallback shapes when missing.
- [x] Document expected sprite asset directory structure for drop-in PixelLab exports.
- [ ] Generate fantasy character sprite sheets (PixelLab or similar).
- [ ] Create outdoor tileset for overworld map (grass, paths, trees, water, camps).
- [ ] Add working poses (character sitting at campfire/workbench).
- [ ] Polish animations (spawn effect, status transitions, walk cycles).
- [x] Add character name labels and status text rendering.

### Phase 5 — OSS release prep

- [ ] Write README with screenshots and usage guide.
- [ ] Write configuration documentation.
- [ ] Add `config.example.yaml` with thorough comments.
- [ ] Packaging and install instructions (npm, or standalone).
- [ ] First tagged release.

## Future (v2+)

- Sound/spatial audio (attention pings, ambient sounds, activity audio cues).
- Fog of war / procedural map expansion as workers spawn.
- Deep integrations via Claude Code hooks / OpenCode hooks for richer activity data.
- Custom map editor (draw your own overworld layout).
- Character levelling / progression (tracks lifetime activity per character type).
- Multiple map themes (dungeon, space station, village, etc).
- Plugin system for custom runtime adapters (Docker, SSH, etc).
- Terminal-in-map view (picture-in-picture terminal rendered on the canvas).

## MVP Acceptance Criteria

- [x] Can define shortcuts in config and see them as buttons in the bottom bar.
- [x] Clicking a shortcut spawns a new worker every time (never reuses).
- [x] Each worker appears as a distinct fantasy character on the map.
- [x] Clicking a character selects it and auto-connects xterm.js to its terminal.
- [x] Terminal panel auto-switches to newly spawned workers.
- [x] Bottom bar shows contextual controls (stop/restart) when a worker is selected.
- [x] Custom spawn dialog allows picking from configured + discovered projects.
- [x] Command palette fuzzy-matches shortcuts, profiles, and project+runtime combos.
- [x] Status indicators update in real time (idle, working, attention, error).
- [x] Activity text is parsed and shown for at least Claude Code and OpenCode.
- [x] Can stop and restart workers from the contextual toolbar.
- [x] Dragging characters repositions them; positions persist across reloads.
- [x] Restarting the server preserves workers and reconciles with tmux.
- [ ] Works with 10+ concurrent workers without performance issues.

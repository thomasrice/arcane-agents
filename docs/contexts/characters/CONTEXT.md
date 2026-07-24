---
context_type: canonical
system: arcane-agents
context: characters
last_reviewed: 2026-07-24
---

# Characters, Presentation, and Runtime

## Language

**Character**:
A persistent, named Arcane-managed unit that users select, move, configure, monitor, respawn, and open a terminal for. Its map figure is how the Character appears in the control room, not a separate entity.

**Avatar**:
The selectable presentation package assigned to a **Character**. An Avatar contains a **Sprite Set** and may contain **Voice Lines**.

**Sprite Set**:
The image assets within an **Avatar** that render a Character in supported directions and activity states. A Sprite Set contains static and animated **Frames**.

**Frame**:
One image within a **Sprite Set**, used alone for a static direction or as one step in an animation.

**Voice Lines**:
Optional audio assets within an **Avatar** that play for defined Character lifecycle and interaction events.

**Run**:
One execution lifetime of a Character’s configured command in its managed tmux window. Spawning starts the first Run; respawning ends the current Run and starts another without replacing the Character.

**Terminal**:
The persistent interactive command environment belonging to a Character’s current **Run**. The Terminal continues in tmux when no viewer is attached.

**Terminal View**:
An interactive client attached to a **Terminal**, such as Arcane’s embedded xterm.js panel or an external terminal application. Closing a Terminal View does not end the Terminal or Run.

## Invariants

- A **Character** may run an AI agent, shell, watcher, or custom command; Character does not imply that an AI agent is running.
- A Character owns its identity, name, configuration, status, map position, movement mode, notification preferences, **Avatar**, and access to its current **Run**.
- Each Character has at most one current Run; each Run has one Terminal; a Terminal may have zero or more Terminal Views.
- Respawning a Character preserves its identity, configuration, map position, and Avatar while replacing its current Run.
- Changing a Character’s Avatar changes its presentation, not its identity or runtime state.
- Closing every Terminal View does not end the Terminal, Run, or Character.

## Usage

- Use **Character** for the whole Arcane-managed product entity, not its map figure, Avatar, or an AI runtime it hosts.
- Use **Avatar** for the complete presentation package and **Sprite Set** only for its image assets.
- Use **Terminal** for the persistent command environment and **Terminal View** for an attached client.
- The shared model, persistence layer, API routes, and many internal symbols currently use `Worker` for **Character**. This is implementation drift, not a competing definition; no implementation rename has been approved.
- Existing `avatarType` and `characterType` names both identify an **Avatar**.

## Implementation Anchors

- `src/shared/types.ts`
- `src/server/orchestrator/orchestratorService.ts`
- `src/server/tmux/tmuxAdapter.ts`
- `src/server/ws/terminalBridge.ts`
- `src/client/map/render/layers/workerLayer.ts`
- `src/client/components/TerminalPanel.tsx`
- `assets/characters/README.md`

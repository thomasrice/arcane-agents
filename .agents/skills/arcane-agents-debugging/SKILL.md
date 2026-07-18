---
name: arcane-agents-debugging
description: Diagnose wrong worker status (working/idle/attention) in a live Arcane Agents instance — from a report like "worker X is working but shows idle" through to a pinned fixture and a one-file fix. Covers the status pipeline, live telemetry endpoints, read-only tmux inspection, and the fixture-first fix workflow.
---

# Debugging Arcane Agents status detection

Use this skill when a worker's map status (working / idle / attention / error) disagrees with what its terminal is actually doing, or when statuses flap.

## How status is decided (30-second model)

Every poll (~2.5s), per worker: `statusMonitor` → `collectSignals` → `decide`.

- `src/server/status/collectSignals.ts` reads the tmux pane (command, pid, output capture) and resolves ONE runtime adapter per worker: definite match first (worker.runtimeId → pane command → wrapped agent process under a shell pane), then output-sniffing as a last resort. The adapter (`src/server/status/runtimes/{claude,codex,openCode,generic}.ts`) owns capture size, freshness/spawn-grace windows, and a single-pass `detect(output) → {prompt, active, activityText}`.
- Claude panes additionally get a transcript snapshot from `claudeTranscript/` (JSONL tailing; health = ok|absent|error; one transcript file belongs to at most one worker).
- `src/server/status/decide.ts` weighs the evidence. Key invariant since v1.3.0: **for agent runtimes, scrollback text is never working evidence** — only native signals are (adapter `active`, Claude task/progress, transcript-working, live child process). Generic shell workers keep parsed-activity evidence (a running build has nothing else).

The safety net is `src/server/status/statusDecision.integration.test.ts`: pane text + timings in, `{status, reason codes}` out. Every fix ends as a fixture there.

## The debugging loop

Given "worker `<name>` shows the wrong status":

1. **Find the worker and its recent decisions** (read-only, live instance on port 7600 by default):
   ```bash
   curl -s localhost:7600/api/workers | jq '.workers[] | select(.displayName=="<name>")'
   curl -s localhost:7600/api/workers/<id>/status-history | jq '.[-3:]'
   ```
   Read `reasons[].code` and `facts`: `runtime` (which adapter decided), `transcript` (ok|absent|error), `outputQuietForMs`, the signal booleans.

2. **Export the decision inputs as a fixture** (v1.4.0+):
   ```bash
   curl -s "localhost:7600/api/workers/<id>/status-fixture?current=1" > /tmp/fixture.json   # latest evaluation
   curl -s "localhost:7600/api/workers/<id>/status-fixture" > /tmp/fixture.json             # latest transition
   ```
   The `fixture` object is field-compatible with the integration suite's `EvaluateOptions`. `/api/status-debug` lists all workers with `transitionsLastHour` — start there for "which workers are misbehaving".

3. **If telemetry is unavailable, read the pane directly** (read-only; never attach):
   ```bash
   # Socket: backend.tmux.socketName in ~/.config/arcane-agents/config.yaml; "default" = plain tmux
   tmux list-panes -a -F '#{pane_id} #{pane_current_command} #{pane_pid}'
   tmux capture-pane -p -t '<pane_id>' | tail -40
   ps -o pid,args -p <pane_pid>; ps --ppid <pane_pid> -o pid,args   # what is REALLY running
   ```

4. **Interpret.** Known signatures:
   - `facts.runtime: "generic"` but the pane is an agent CLI → classification gap (e.g. pane command reports `node`). The old false-working flap applies to generic workers, so misclassification reintroduces it.
   - `parsed-activity-signal` as a working reason on a claude/codex/opencode runtime → should be impossible since v1.3.0; if seen, the worker was classified generic at that moment.
   - `transcript: "ok"` + `outputQuietForMs` in the minutes → pre-v1.3.1 transcript misattribution signature (sessions sharing a `~/.claude/projects` dir).
   - `transcript: "error"` → transcript resolution/IO broke; status falls back to pane heuristics (weaker for Claude).
   - `transcript: "absent"` on a long-lived claude pane mid-turn (the process has been alive for days across `/clear`s or new conversations, and is actively streaming) → pre-v1.4.1 re-attach regression: the conservative session-start match only ever fit the original conversation's file, so a fresh session file could never re-attach. Fixed by activity-correlation attach (`claudeTranscript/io.ts` `resolveByActivityCorrelation`), which adopts the one transcript moving in lockstep with the pane after N qualifying (pane-changed) polls. If seen again, check the pane is genuinely producing fresh output (correlation only advances on changed polls) and that no other worker owns the file.
   - Correct-but-surprising: a generic shell streaming output (deploys, builds) legitimately flaps working↔idle with the output; that is by design.
   - Attention flickers on Claude (~12s after a tool starts, gone by ~45s) → orphaned transcript tool entry (known, documented in plan.md).

5. **Reproduce and fix.** Add the captured pane text + quiet windows as a case in `statusDecision.integration.test.ts` asserting the *desired* status; run `npx vitest run src/server/status` (never the full suite); fix in ONE place — detector regexes in `runtimes/<runtime>.ts`, resolution in `runtimes/adapter.ts` / `collectSignals.ts`, or evidence rules in `decide.ts`. Never weaken an existing pinned fixture silently; flip it deliberately with a comment. UI-marker drift after a Claude/Codex/OpenCode update is expected — the fixture corpus in `runtimes/*.test.ts` is where new UI variants get pinned.

6. **Verbose live tracing** (needs a restart, so prefer the endpoints): `ARCANE_AGENTS_STATUS_TRACE=1` logs per-evaluation decision lines.

## Safety rails (non-negotiable)

- The live instance and its tmux server belong to the user. **Read-only**: `capture-pane`, `list-panes`, `ps`, GET endpoints. Never restart the live server, never `kill-server`, never send keys to panes, never write to the live DB.
- For anything that needs a running server (smoke tests, endpoint checks): build, then boot an isolated copy — `ARCANE_AGENTS_API_PORT=<free port> node dist/server/cli.js start --session <throwaway>` — which gets its own state dir and tmux namespace. Afterwards kill it, `tmux -L <suffixed-socket> kill-server`, delete `~/.local/state/arcane-agents/sessions/<throwaway>`, and remove dead socket files from `/tmp/tmux-<uid>/`.
- Status records are metadata; the one genuinely destructive surface is killing workers. Don't.

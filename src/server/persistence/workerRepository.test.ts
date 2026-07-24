import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Worker } from "../../shared/types";
import { WorkerRepository } from "./workerRepository";

let tmpDir: string;
let dbPath: string;
const openRepositories: WorkerRepository[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcane-agents-repo-"));
  dbPath = path.join(tmpDir, "state", "workers.db");
});

afterEach(() => {
  for (const repo of openRepositories.splice(0)) {
    try {
      repo.close();
    } catch {
      // already closed
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function openRepo(): WorkerRepository {
  const repo = new WorkerRepository(dbPath);
  openRepositories.push(repo);
  return repo;
}

/**
 * A fully-specified worker built by hand so expectations are derived
 * independently of the repository's own serialisation.
 */
function makeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: "wkr-001",
    name: "pa-shell-ab12",
    displayName: "Research Desk",
    projectId: "pa",
    projectPath: "/home/user/projects/pa",
    runtimeId: "claude",
    runtimeLabel: "Claude Code",
    // Note the comma-and-space inside an element: a naive comma-join would
    // corrupt this on the way back, so a clean round-trip proves the command
    // is stored as a structured array, not a flattened string.
    command: ["claude", "--flag", "fix parser for a, b, c", "--json"],
    status: "working",
    activityText: "Editing parser.ts",
    activityTool: "edit",
    activityPath: "src/parser.ts",
    avatarType: "wizard",
    movementMode: "wander",
    silenced: false,
    position: { x: 128.5, y: -42.25 },
    tmuxRef: { session: "arcane-agents", window: "pa-shell-ab12", pane: "%3" },
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
    ...overrides
  };
}

describe("WorkerRepository save/load round-trip", () => {
  it("round-trips a worker, deserialising the command array to its original shape", () => {
    const repo = openRepo();
    const worker = makeWorker();

    repo.saveWorker(worker);
    const loaded = repo.getWorker(worker.id);

    // Independently constructed expectation (a fresh literal, not the saved reference).
    expect(loaded).toEqual({
      id: "wkr-001",
      name: "pa-shell-ab12",
      displayName: "Research Desk",
      projectId: "pa",
      projectPath: "/home/user/projects/pa",
      runtimeId: "claude",
      runtimeLabel: "Claude Code",
      command: ["claude", "--flag", "fix parser for a, b, c", "--json"],
      status: "working",
      activityText: "Editing parser.ts",
      activityTool: "edit",
      activityPath: "src/parser.ts",
      avatarType: "wizard",
      movementMode: "wander",
      silenced: false,
      position: { x: 128.5, y: -42.25 },
      tmuxRef: { session: "arcane-agents", window: "pa-shell-ab12", pane: "%3" },
      createdAt: "2026-03-04T00:00:00.000Z",
      updatedAt: "2026-03-04T00:00:00.000Z"
    });
    // The command survives as a real array, distinct from any string form.
    expect(Array.isArray(loaded?.command)).toBe(true);
  });

  it("persists the command as JSON on disk, independent of the read path", () => {
    const repo = openRepo();
    const worker = makeWorker({ command: ["bash", "-lc", "echo one,two && ls -a"] });
    repo.saveWorker(worker);

    // Read the raw stored value with a separate connection and parse it
    // ourselves — proves the on-disk format is JSON, not a delimiter-joined blob.
    const raw = new Database(dbPath, { readonly: true });
    try {
      const row = raw.prepare("SELECT command_json FROM workers WHERE id = ?").get(worker.id) as
        | { command_json: string }
        | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row!.command_json)).toEqual(["bash", "-lc", "echo one,two && ls -a"]);
    } finally {
      raw.close();
    }
  });

  it("round-trips an empty command array without collapsing to null or a string", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-empty", command: [] }));

    expect(repo.getWorker("wkr-empty")?.command).toEqual([]);
  });

  it("returns undefined for an unknown worker id", () => {
    const repo = openRepo();
    expect(repo.getWorker("does-not-exist")).toBeUndefined();
  });

  it("stores an absent displayName as absent, not the empty string", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-anon", displayName: undefined }));

    expect(repo.getWorker("wkr-anon")?.displayName).toBeUndefined();
  });
});

describe("WorkerRepository upsert semantics", () => {
  it("updates an existing id in place instead of inserting a duplicate", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-1", status: "idle", displayName: "First" }));
    repo.saveWorker(
      makeWorker({
        id: "wkr-1",
        status: "error",
        displayName: "Renamed",
        position: { x: 5, y: 6 }
      })
    );

    const all = repo.listWorkers();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: "wkr-1",
      status: "error",
      displayName: "Renamed",
      position: { x: 5, y: 6 }
    });
  });

  it("preserves the original created_at on upsert and ignores an incoming change to it", () => {
    // pins current behaviour — see plan.md
    // The upsert's DO UPDATE SET does not include created_at, so re-saving the
    // same id keeps the first-seen creation time. listWorkers ordering depends
    // on created_at, so this immutability is load-bearing.
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-1", createdAt: "2026-01-01T00:00:00.000Z" }));
    repo.saveWorker(makeWorker({ id: "wkr-1", createdAt: "2026-09-09T00:00:00.000Z" }));

    expect(repo.getWorker("wkr-1")?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not deduplicate distinct ids that share a displayName", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-a", displayName: "Twin", createdAt: "2026-01-01T00:00:00.000Z" }));
    repo.saveWorker(makeWorker({ id: "wkr-b", displayName: "Twin", createdAt: "2026-01-02T00:00:00.000Z" }));

    const ids = repo.listWorkers().map((w) => w.id);
    expect(ids).toEqual(["wkr-a", "wkr-b"]);
  });
});

describe("WorkerRepository.listWorkers ordering", () => {
  it("orders by created_at ascending regardless of insertion order", () => {
    const repo = openRepo();
    const earliest = makeWorker({ id: "wkr-early", createdAt: "2026-01-01T00:00:00.000Z" });
    const middle = makeWorker({ id: "wkr-mid", createdAt: "2026-06-15T12:00:00.000Z" });
    const latest = makeWorker({ id: "wkr-late", createdAt: "2026-12-31T23:59:59.000Z" });

    // Insert deliberately out of chronological order.
    repo.saveWorker(middle);
    repo.saveWorker(latest);
    repo.saveWorker(earliest);

    expect(repo.listWorkers().map((w) => w.id)).toEqual(["wkr-early", "wkr-mid", "wkr-late"]);
  });

  it("returns an empty list when no workers exist", () => {
    const repo = openRepo();
    expect(repo.listWorkers()).toEqual([]);
  });
});

describe("WorkerRepository.updateStatus activity-field semantics", () => {
  it("clears activity fields to undefined when the update omits them (the idle path)", () => {
    const repo = openRepo();
    repo.saveWorker(
      makeWorker({
        id: "wkr-busy",
        status: "working",
        activityText: "Running tests",
        activityTool: "bash",
        activityPath: "src/foo.ts"
      })
    );

    // statusMonitor calls updateStatus with an idle evaluation whose activity
    // fields are undefined; the repo must overwrite (clear) the stored values.
    const result = repo.updateStatus("wkr-busy", { status: "idle" });

    expect(result).toMatchObject({
      status: "idle",
      activityText: undefined,
      activityTool: undefined,
      activityPath: undefined
    });

    const reloaded = repo.getWorker("wkr-busy");
    expect(reloaded?.status).toBe("idle");
    expect(reloaded?.activityText).toBeUndefined();
    expect(reloaded?.activityTool).toBeUndefined();
    expect(reloaded?.activityPath).toBeUndefined();
  });

  it("writes the supplied activity fields when the update provides them", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-idle", status: "idle", activityText: undefined, activityTool: undefined, activityPath: undefined }));

    repo.updateStatus("wkr-idle", {
      status: "working",
      activityText: "Reading config",
      activityTool: "read",
      activityPath: "config.yaml"
    });

    expect(repo.getWorker("wkr-idle")).toMatchObject({
      status: "working",
      activityText: "Reading config",
      activityTool: "read",
      activityPath: "config.yaml"
    });
  });

  it("leaves all non-status fields intact when updating status", () => {
    const repo = openRepo();
    const worker = makeWorker({
      id: "wkr-keep",
      status: "working",
      movementMode: "wander",
      position: { x: 11, y: 22 },
      displayName: "Keeper"
    });
    repo.saveWorker(worker);

    const updated = repo.updateStatus("wkr-keep", { status: "attention", activityText: "Waiting" });

    expect(updated).toMatchObject({
      id: "wkr-keep",
      displayName: "Keeper",
      movementMode: "wander",
      position: { x: 11, y: 22 },
      command: worker.command,
      tmuxRef: worker.tmuxRef,
      createdAt: worker.createdAt
    });
    // updatedAt is refreshed to now, so it should differ from the seeded value.
    expect(updated?.updatedAt).not.toBe(worker.updatedAt);
  });

  it("returns undefined and persists nothing for an unknown worker", () => {
    const repo = openRepo();
    const result = repo.updateStatus("ghost", { status: "idle" });

    expect(result).toBeUndefined();
    expect(repo.listWorkers()).toEqual([]);
  });
});

describe("WorkerRepository.updateMovementMode", () => {
  it("persists a movement-mode change and round-trips it", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-move", movementMode: "hold" }));

    const updated = repo.updateMovementMode("wkr-move", "wander");
    expect(updated?.movementMode).toBe("wander");
    expect(repo.getWorker("wkr-move")?.movementMode).toBe("wander");
  });

  it("returns undefined for an unknown worker", () => {
    const repo = openRepo();
    expect(repo.updateMovementMode("ghost", "wander")).toBeUndefined();
  });
});

describe("WorkerRepository.updateSilenced", () => {
  it("persists silence changes without replacing the character", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-silent", silenced: false }));

    const updated = repo.updateSilenced("wkr-silent", true);

    expect(updated).toMatchObject({ id: "wkr-silent", silenced: true });
    expect(repo.getWorker("wkr-silent")?.silenced).toBe(true);
  });

  it("returns undefined for an unknown worker", () => {
    const repo = openRepo();
    expect(repo.updateSilenced("ghost", true)).toBeUndefined();
  });
});

describe("WorkerRepository.deleteWorker", () => {
  it("removes an existing worker and reports the change", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-del" }));

    expect(repo.deleteWorker("wkr-del")).toBe(true);
    expect(repo.getWorker("wkr-del")).toBeUndefined();
    expect(repo.listWorkers()).toEqual([]);
  });

  it("is a no-op that reports no change for an unknown id", () => {
    const repo = openRepo();
    repo.saveWorker(makeWorker({ id: "wkr-keep" }));

    expect(repo.deleteWorker("never-existed")).toBe(false);
    expect(repo.listWorkers().map((w) => w.id)).toEqual(["wkr-keep"]);
  });
});

describe("WorkerRepository legacy-schema migration", () => {
  /**
   * Build a DB whose `workers` table predates the columns the repository adds
   * via ensureColumn: display_name, activity_tool, activity_path, movement_mode.
   * Written by hand so the test does not lean on the production migration SQL.
   */
  function createLegacyDatabase(): void {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        runtime_label TEXT NOT NULL,
        command_json TEXT NOT NULL,
        status TEXT NOT NULL,
        activity_text TEXT,
        avatar_type TEXT NOT NULL,
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        tmux_session TEXT NOT NULL,
        tmux_window TEXT NOT NULL,
        tmux_pane TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy
      .prepare(
        `INSERT INTO workers (
           id, name, project_id, project_path, runtime_id, runtime_label,
           command_json, status, activity_text, avatar_type,
           position_x, position_y, tmux_session, tmux_window, tmux_pane,
           created_at, updated_at
         ) VALUES (
           @id, @name, @project_id, @project_path, @runtime_id, @runtime_label,
           @command_json, @status, @activity_text, @avatar_type,
           @position_x, @position_y, @tmux_session, @tmux_window, @tmux_pane,
           @created_at, @updated_at
         )`
      )
      .run({
        id: "wkr-legacy",
        name: "legacy-window",
        project_id: "pa",
        project_path: "/home/user/projects/pa",
        runtime_id: "shell",
        runtime_label: "Shell",
        command_json: JSON.stringify(["bash", "-l"]),
        status: "idle",
        activity_text: null,
        avatar_type: "wizard",
        position_x: 10,
        position_y: 20,
        tmux_session: "arcane-agents",
        tmux_window: "legacy-window",
        tmux_pane: "%0",
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z"
      });
    legacy.close();
  }

  it("adds missing columns and reads legacy rows back with sane defaults", () => {
    createLegacyDatabase();

    const repo = openRepo();
    const loaded = repo.getWorker("wkr-legacy");

    expect(loaded).toEqual({
      id: "wkr-legacy",
      name: "legacy-window",
      displayName: undefined,
      projectId: "pa",
      projectPath: "/home/user/projects/pa",
      runtimeId: "shell",
      runtimeLabel: "Shell",
      command: ["bash", "-l"],
      status: "idle",
      activityText: undefined,
      activityTool: undefined,
      activityPath: undefined,
      avatarType: "wizard",
      // movement_mode column is NULL for legacy rows; fallback is "hold".
      movementMode: "hold",
      silenced: false,
      position: { x: 10, y: 20 },
      tmuxRef: { session: "arcane-agents", window: "legacy-window", pane: "%0" },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z"
    });
  });

  it("can write the newly added columns after migrating a legacy DB", () => {
    createLegacyDatabase();
    const repo = openRepo();

    repo.saveWorker(
      makeWorker({
        id: "wkr-new",
        displayName: "Fresh",
        activityTool: "grep",
        activityPath: "src/x.ts",
        movementMode: "wander",
        silenced: true
      })
    );

    expect(repo.getWorker("wkr-new")).toMatchObject({
      displayName: "Fresh",
      activityTool: "grep",
      activityPath: "src/x.ts",
      movementMode: "wander",
      silenced: true
    });
  });

  it("is idempotent: reopening an already-migrated DB does not throw", () => {
    createLegacyDatabase();
    openRepo().close();

    // Second construction re-runs ensureColumn against columns that now exist;
    // the ADD COLUMN failures must be swallowed.
    expect(() => openRepo()).not.toThrow();
    expect(openRepo().getWorker("wkr-legacy")?.movementMode).toBe("hold");
  });

  it("coerces an unrecognised movement_mode value to the hold fallback", () => {
    // pins current behaviour — see plan.md
    // fromRow only recognises "wander"; every other stored value (including a
    // hypothetical future mode) collapses to "hold".
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const seed = openRepo();
    seed.saveWorker(makeWorker({ id: "wkr-odd", movementMode: "wander" }));
    seed.close();
    openRepositories.length = 0;

    const raw = new Database(dbPath);
    raw.prepare("UPDATE workers SET movement_mode = ? WHERE id = ?").run("patrol", "wkr-odd");
    raw.close();

    const repo = openRepo();
    expect(repo.getWorker("wkr-odd")?.movementMode).toBe("hold");
  });
});

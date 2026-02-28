import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Worker, WorkerPosition, WorkerStatus } from "../../shared/types";

interface WorkerStatusUpdate {
  status: WorkerStatus;
  activityText?: string;
  activityTool?: Worker["activityTool"];
  activityPath?: string;
}

interface WorkerRow {
  id: string;
  name: string;
  project_id: string;
  project_path: string;
  runtime_id: string;
  runtime_label: string;
  command_json: string;
  profile_id: string | null;
  status: WorkerStatus;
  activity_text: string | null;
  activity_tool: Worker["activityTool"] | null;
  activity_path: string | null;
  avatar_type: Worker["avatarType"];
  position_x: number;
  position_y: number;
  tmux_session: string;
  tmux_window: string;
  tmux_pane: string;
  created_at: string;
  updated_at: string;
}

export class WorkerRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  listWorkers(): Worker[] {
    const rows = this.db
      .prepare("SELECT * FROM workers ORDER BY datetime(created_at) ASC")
      .all() as WorkerRow[];

    return rows.map((row) => this.fromRow(row));
  }

  getWorker(workerId: string): Worker | undefined {
    const row = this.db.prepare("SELECT * FROM workers WHERE id = ?").get(workerId) as WorkerRow | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  saveWorker(worker: Worker): void {
    this.db
      .prepare(
        `
        INSERT INTO workers (
          id, name, project_id, project_path, runtime_id, runtime_label,
          command_json, profile_id, status, activity_text, activity_tool, activity_path, avatar_type,
          position_x, position_y, tmux_session, tmux_window, tmux_pane,
          created_at, updated_at
        ) VALUES (
          @id, @name, @project_id, @project_path, @runtime_id, @runtime_label,
          @command_json, @profile_id, @status, @activity_text, @activity_tool, @activity_path, @avatar_type,
          @position_x, @position_y, @tmux_session, @tmux_window, @tmux_pane,
          @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          project_id = excluded.project_id,
          project_path = excluded.project_path,
          runtime_id = excluded.runtime_id,
          runtime_label = excluded.runtime_label,
          command_json = excluded.command_json,
          profile_id = excluded.profile_id,
          status = excluded.status,
          activity_text = excluded.activity_text,
          activity_tool = excluded.activity_tool,
          activity_path = excluded.activity_path,
          avatar_type = excluded.avatar_type,
          position_x = excluded.position_x,
          position_y = excluded.position_y,
          tmux_session = excluded.tmux_session,
          tmux_window = excluded.tmux_window,
          tmux_pane = excluded.tmux_pane,
          updated_at = excluded.updated_at
      `
      )
      .run(this.toRow(worker));
  }

  updateStatus(workerId: string, update: WorkerStatusUpdate): Worker | undefined {
    const worker = this.getWorker(workerId);
    if (!worker) {
      return undefined;
    }

    const updated: Worker = {
      ...worker,
      status: update.status,
      activityText: update.activityText,
      activityTool: update.activityTool,
      activityPath: update.activityPath,
      updatedAt: new Date().toISOString()
    };

    this.saveWorker(updated);
    return updated;
  }

  updatePosition(workerId: string, position: WorkerPosition): Worker | undefined {
    const worker = this.getWorker(workerId);
    if (!worker) {
      return undefined;
    }

    const updated: Worker = {
      ...worker,
      position,
      updatedAt: new Date().toISOString()
    };

    this.saveWorker(updated);
    return updated;
  }

  deleteWorker(workerId: string): boolean {
    const result = this.db.prepare("DELETE FROM workers WHERE id = ?").run(workerId);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        runtime_label TEXT NOT NULL,
        command_json TEXT NOT NULL,
        profile_id TEXT,
        status TEXT NOT NULL,
        activity_text TEXT,
        activity_tool TEXT,
        activity_path TEXT,
        avatar_type TEXT NOT NULL,
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        tmux_session TEXT NOT NULL,
        tmux_window TEXT NOT NULL,
        tmux_pane TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
      CREATE INDEX IF NOT EXISTS idx_workers_tmux ON workers(tmux_session, tmux_window);
    `);

    this.ensureColumn("workers", "activity_tool", "TEXT");
    this.ensureColumn("workers", "activity_path", "TEXT");
  }

  private fromRow(row: WorkerRow): Worker {
    return {
      id: row.id,
      name: row.name,
      projectId: row.project_id,
      projectPath: row.project_path,
      runtimeId: row.runtime_id,
      runtimeLabel: row.runtime_label,
      command: JSON.parse(row.command_json) as string[],
      profileId: row.profile_id ?? undefined,
      status: row.status,
      activityText: row.activity_text ?? undefined,
      activityTool: row.activity_tool ?? undefined,
      activityPath: row.activity_path ?? undefined,
      avatarType: row.avatar_type,
      position: {
        x: row.position_x,
        y: row.position_y
      },
      tmuxRef: {
        session: row.tmux_session,
        window: row.tmux_window,
        pane: row.tmux_pane
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toRow(worker: Worker): WorkerRow {
    return {
      id: worker.id,
      name: worker.name,
      project_id: worker.projectId,
      project_path: worker.projectPath,
      runtime_id: worker.runtimeId,
      runtime_label: worker.runtimeLabel,
      command_json: JSON.stringify(worker.command),
      profile_id: worker.profileId ?? null,
      status: worker.status,
      activity_text: worker.activityText ?? null,
      activity_tool: worker.activityTool ?? null,
      activity_path: worker.activityPath ?? null,
      avatar_type: worker.avatarType,
      position_x: worker.position.x,
      position_y: worker.position.y,
      tmux_session: worker.tmuxRef.session,
      tmux_window: worker.tmuxRef.window,
      tmux_pane: worker.tmuxRef.pane,
      created_at: worker.createdAt,
      updated_at: worker.updatedAt
    };
  }

  private ensureColumn(tableName: string, columnName: string, type: string): void {
    try {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${type}`);
    } catch {
      // column already exists
    }
  }
}

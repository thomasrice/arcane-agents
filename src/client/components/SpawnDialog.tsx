import { useEffect, useMemo, useState } from "react";
import type { ProjectConfig, RuntimeConfig } from "../../shared/types";

interface SpawnDialogProps {
  open: boolean;
  projects: Record<string, ProjectConfig>;
  runtimes: Record<string, RuntimeConfig>;
  onClose: () => void;
  onSpawn: (projectId: string, runtimeId: string) => void;
}

export function SpawnDialog({ open, projects, runtimes, onClose, onSpawn }: SpawnDialogProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const projectIds = useMemo(() => Object.keys(projects), [projects]);
  const runtimeIds = useMemo(() => Object.keys(runtimes), [runtimes]);

  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectIds[0] ?? "");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>(runtimeIds[0] ?? "");

  const filteredProjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return projectIds;
    }

    return projectIds.filter((projectId) => {
      const project = projects[projectId];
      const corpus = `${projectId} ${project.shortName} ${project.path} ${project.label ?? ""}`.toLowerCase();
      return corpus.includes(term);
    });
  }, [projectIds, projects, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!projectIds.includes(selectedProjectId)) {
      setSelectedProjectId(projectIds[0] ?? "");
    }
    if (!runtimeIds.includes(selectedRuntimeId)) {
      setSelectedRuntimeId(runtimeIds[0] ?? "");
    }
  }, [open, projectIds, runtimeIds, selectedProjectId, selectedRuntimeId]);

  useEffect(() => {
    if (!filteredProjects.includes(selectedProjectId)) {
      setSelectedProjectId(filteredProjects[0] ?? "");
    }
  }, [filteredProjects, selectedProjectId]);

  if (!open) {
    return null;
  }

  const canSpawn = selectedProjectId.length > 0 && selectedRuntimeId.length > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">Spawn Worker</div>

        <input
          className="input"
          placeholder="Search projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />

        <div className="dialog-grid">
          <div>
            <div className="dialog-section-label">Project</div>
            <div className="option-list">
              {filteredProjects.map((projectId) => {
                const project = projects[projectId];
                const selected = projectId === selectedProjectId;
                return (
                  <button
                    key={projectId}
                    className={`option-btn ${selected ? "selected" : ""}`}
                    onClick={() => setSelectedProjectId(projectId)}
                  >
                    <span>{project.label ?? projectId}</span>
                    <small>{project.path}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="dialog-section-label">Runtime</div>
            <div className="option-list">
              {runtimeIds.map((runtimeId) => {
                const runtime = runtimes[runtimeId];
                const selected = runtimeId === selectedRuntimeId;
                return (
                  <button
                    key={runtimeId}
                    className={`option-btn ${selected ? "selected" : ""}`}
                    onClick={() => setSelectedRuntimeId(runtimeId)}
                  >
                    <span>{runtime.label}</span>
                    <small>{runtime.command.join(" ")}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="dialog-actions">
          <button className="bar-btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button
            className="bar-btn"
            disabled={!canSpawn}
            onClick={() => {
              if (!canSpawn) {
                return;
              }
              onSpawn(selectedProjectId, selectedRuntimeId);
            }}
          >
            Spawn
          </button>
        </div>
      </div>
    </div>
  );
}

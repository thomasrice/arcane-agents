import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedConfig } from "../../shared/types";
import type { BatchSpawnItem } from "../app/types";
import { buildSpawnOptions, type SpawnOption } from "../app/spawnOptions";
import { useFilterableList } from "../hooks/useFilterableList";

interface BatchSpawnDialogProps {
  open: boolean;
  config: ResolvedConfig;
  onClose: () => void;
  onBatchSpawn: (items: BatchSpawnItem[], onProgress: (done: number, total: number) => void) => Promise<void>;
}

const getOptionSearchText = (option: SpawnOption): string => option.searchText;

export function BatchSpawnDialog({ open, config, onClose, onBatchSpawn }: BatchSpawnDialogProps): JSX.Element | null {
  const [step, setStep] = useState<"config" | "names">("config");
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>(undefined);
  const [namesText, setNamesText] = useState("");
  const [spawning, setSpawning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined);
  const configInputRef = useRef<HTMLInputElement | null>(null);
  const namesTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const configOptions = useMemo<SpawnOption[]>(() => buildSpawnOptions(config), [config]);
  const {
    query: configQuery,
    setQuery: setConfigQuery,
    filtered: filteredOptions,
    reset: resetConfigFilter
  } = useFilterableList(configOptions, getOptionSearchText);

  const selectedConfig = useMemo(
    () => configOptions.find((option) => option.id === selectedConfigId),
    [configOptions, selectedConfigId]
  );

  const parsedNames = useMemo(
    () =>
      namesText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [namesText]
  );

  useEffect(() => {
    if (!open) return;
    setStep("config");
    setSelectedConfigId(undefined);
    resetConfigFilter();
    setNamesText("");
    setSpawning(false);
    setProgress(undefined);
    queueMicrotask(() => configInputRef.current?.focus());
  }, [open, resetConfigFilter]);

  useEffect(() => {
    if (step === "names") {
      queueMicrotask(() => namesTextareaRef.current?.focus());
    }
  }, [step]);

  if (!open) return null;

  const handleSelectConfig = (option: SpawnOption) => {
    setSelectedConfigId(option.id);
    setStep("names");
  };

  const handleSpawn = async () => {
    if (!selectedConfig || parsedNames.length === 0 || spawning) return;

    const items: BatchSpawnItem[] = parsedNames.map((name) => ({
      input: selectedConfig.input,
      displayName: name
    }));

    setSpawning(true);
    setProgress({ done: 0, total: items.length });

    await onBatchSpawn(items, (done, total) => {
      setProgress({ done, total });
    });

    setSpawning(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={spawning ? undefined : onClose}>
      <div className="dialog batch-spawn-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Batch Spawn</div>

        {step === "config" ? (
          <>
            <div className="dialog-section-label">Select config</div>
            <input
              ref={configInputRef}
              className="input"
              value={configQuery}
              onChange={(e) => setConfigQuery(e.target.value)}
              placeholder="Search shortcuts or project+runtime..."
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                } else if (e.key === "Enter" && filteredOptions.length > 0) {
                  e.preventDefault();
                  handleSelectConfig(filteredOptions[0]);
                }
              }}
            />
            <div className="option-list batch-spawn-config-list">
              {filteredOptions.map((opt) => (
                <button
                  key={opt.id}
                  className={`option-btn${opt.id === selectedConfigId ? " selected" : ""}`}
                  onClick={() => handleSelectConfig(opt)}
                >
                  <span>{opt.label}</span>
                  <small>{opt.subLabel}</small>
                </button>
              ))}
              {filteredOptions.length === 0 && <div className="palette-empty">No matching config</div>}
            </div>
          </>
        ) : (
          <>
            <div className="batch-spawn-config-summary">
              <button className="batch-spawn-back" onClick={() => setStep("config")}>
                &larr;
              </button>
              <span>
                <strong>{selectedConfig?.label}</strong>
                <small> {selectedConfig?.subLabel}</small>
              </span>
            </div>

            <div className="dialog-section-label">Names (one per line)</div>
            <textarea
              ref={namesTextareaRef}
              className="input batch-spawn-textarea"
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              placeholder={"Acme Corp\nGlobex Inc\nInitech LLC"}
              disabled={spawning}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (!spawning) onClose();
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  void handleSpawn();
                }
              }}
            />

            <div className="batch-spawn-footer">
              {progress && spawning ? (
                <div className="batch-spawn-progress">
                  <div className="batch-spawn-progress-bar">
                    <div
                      className="batch-spawn-progress-fill"
                      style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="batch-spawn-progress-text">
                    Spawning {progress.done}/{progress.total}...
                  </span>
                </div>
              ) : (
                <span className="batch-spawn-count">
                  {parsedNames.length} {parsedNames.length === 1 ? "name" : "names"}
                </span>
              )}

              <button
                className="bar-btn"
                disabled={parsedNames.length === 0 || spawning}
                onClick={() => void handleSpawn()}
              >
                Spawn {parsedNames.length}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

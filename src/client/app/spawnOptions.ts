import type { ResolvedConfig, WorkerSpawnInput } from "../../shared/types";

export interface SpawnOption {
  id: string;
  kind: "shortcut" | "combo";
  /** Base label (no verb). CommandPalette prefixes shortcuts with "Spawn "; batch uses it as-is. */
  label: string;
  subLabel: string;
  searchText: string;
  input: WorkerSpawnInput;
}

// The spawnable set for the palette / batch dialog: every configured shortcut, then
// every project × runtime combination. Previously duplicated in both dialogs.
export function buildSpawnOptions(config: ResolvedConfig): SpawnOption[] {
  const options: SpawnOption[] = [];

  config.shortcuts.forEach((shortcut, index) => {
    options.push({
      id: `shortcut-${index}`,
      kind: "shortcut",
      label: shortcut.label,
      subLabel: `${shortcut.project} · ${shortcut.runtime}`,
      searchText: `${shortcut.label} ${shortcut.project} ${shortcut.runtime}`.toLowerCase(),
      input: { shortcutIndex: index }
    });
  });

  for (const [projectId, project] of Object.entries(config.projects)) {
    for (const [runtimeId, runtime] of Object.entries(config.runtimes)) {
      options.push({
        id: `combo-${projectId}-${runtimeId}`,
        kind: "combo",
        label: `${projectId} + ${runtime.label}`,
        subLabel: `${project.shortName} · ${runtime.command.join(" ")}`,
        searchText: `${projectId} ${project.shortName} ${runtimeId} ${runtime.label}`.toLowerCase(),
        input: { projectId, runtimeId }
      });
    }
  }

  return options;
}

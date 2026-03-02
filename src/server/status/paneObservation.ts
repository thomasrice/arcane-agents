export interface PaneObservation {
  lastCommand: string;
  lastCommandChangeAtMs: number;
  lastOutputSignature: string;
  lastOutputChangeAtMs: number;
}

export function observePane(
  observations: Map<string, PaneObservation>,
  workerId: string,
  currentCommand: string,
  output: string
): PaneObservation {
  const now = Date.now();
  const signature = outputSignature(output);
  const existing = observations.get(workerId);

  if (!existing) {
    const initial: PaneObservation = {
      lastCommand: currentCommand,
      lastCommandChangeAtMs: now,
      lastOutputSignature: signature,
      lastOutputChangeAtMs: now
    };
    observations.set(workerId, initial);
    return initial;
  }

  if (existing.lastCommand !== currentCommand) {
    existing.lastCommand = currentCommand;
    existing.lastCommandChangeAtMs = now;
  }

  if (existing.lastOutputSignature !== signature) {
    existing.lastOutputSignature = signature;
    existing.lastOutputChangeAtMs = now;
  }

  return existing;
}

function outputSignature(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-40)
    .join("\n");
}

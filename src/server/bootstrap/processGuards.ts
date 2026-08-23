interface RegisterProcessGuardsInput {
  onProcess?: NodeJS.EventEmitter;
  log?: (message: string, error: unknown) => void;
}

/**
 * Keep the server alive when a single connection's async callback throws.
 *
 * Arcane multiplexes ~100 terminals through one process, and the risky work
 * lives in emitter callbacks (node-pty ioctls, ws frames, tmux polling) where
 * an escaping throw is an uncaught exception rather than a rejected promise.
 * Node's default is to exit, so one dead pty took every other terminal down
 * with it. Log loudly and keep serving instead: the affected socket is already
 * lost, but nothing else needs to be.
 */
export function registerProcessGuards({
  onProcess = process,
  log = defaultLog
}: RegisterProcessGuardsInput = {}): void {
  onProcess.on("uncaughtException", (error: unknown) => {
    log("uncaught exception; server continuing", error);
  });

  onProcess.on("unhandledRejection", (reason: unknown) => {
    log("unhandled promise rejection; server continuing", reason);
  });
}

function defaultLog(message: string, error: unknown): void {
  console.error(`[arcane-agents] ${message}:`, error);
}

// Bridge between store actions and the imperative component handles they need to
// drive (map centering, terminal focus). Replaces the counter-token state channels
// (mapCenterToken / terminalFocusToken) and their receiving-side dedupe refs: a
// store action calls a request fn, App has registered the live handles, and the
// call is deferred one macrotask so the target has committed the selection/worker
// change it is reacting to. Each call is self-deduping — issuing the command IS the
// signal, so there is no token to compare.

export interface MapCommandTarget {
  centerOnWorkers(workerIds: string[]): void;
}

export interface TerminalCommandTarget {
  focus(): void;
}

let mapTarget: MapCommandTarget | null = null;
let terminalTarget: TerminalCommandTarget | null = null;

export function setMapCommandTarget(target: MapCommandTarget | null): void {
  mapTarget = target;
}

export function setTerminalCommandTarget(target: TerminalCommandTarget | null): void {
  terminalTarget = target;
}

// Run after the current React commit so the map/terminal have re-rendered for the
// state change that triggered the command (a freshly spawned worker, the newly
// selected terminal worker). React flushes passive effects on a higher-priority
// MessageChannel task than setTimeout, so the target is mounted by the time we run.
function defer(run: () => void): void {
  if (typeof setTimeout === "function") {
    setTimeout(run, 0);
    return;
  }

  run();
}

export function requestCenterOnWorkers(workerIds: string[]): void {
  if (workerIds.length === 0) {
    return;
  }

  const ids = [...workerIds];
  defer(() => mapTarget?.centerOnWorkers(ids));
}

export function requestTerminalFocus(): void {
  defer(() => terminalTarget?.focus());
}

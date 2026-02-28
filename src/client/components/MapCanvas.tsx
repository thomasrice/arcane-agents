import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { Worker, WorkerPosition, WorkerStatus } from "../../shared/types";

interface MapCanvasProps {
  workers: Worker[];
  selectedWorkerId?: string;
  onSelect: (workerId: string | undefined) => void;
  onPositionCommit: (workerId: string, position: WorkerPosition) => void;
}

interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface HoverInfo {
  worker: Worker;
  screenX: number;
  screenY: number;
}

interface DragState {
  workerId: string;
  pointerId: number;
  startScreenX: number;
  startScreenY: number;
  moved: boolean;
}

interface Decoration {
  trees: Array<{ x: number; y: number; size: number }>;
  stones: Array<{ x: number; y: number; size: number }>;
}

const workerRadius = 13;

const statusAuraColor: Record<WorkerStatus, string> = {
  idle: "rgba(104, 189, 99, 0.45)",
  working: "rgba(85, 160, 232, 0.45)",
  attention: "rgba(246, 180, 77, 0.52)",
  error: "rgba(229, 87, 73, 0.5)",
  stopped: "rgba(131, 138, 152, 0.35)"
};

const avatarColor: Record<Worker["avatarType"], string> = {
  knight: "#8ca1c8",
  mage: "#4b83d6",
  ranger: "#4d9961",
  druid: "#6f8f44",
  rogue: "#7d6aa6",
  paladin: "#d6b568",
  orc: "#688449",
  dwarf: "#a37854"
};

export function MapCanvas({ workers, selectedWorkerId, onSelect, onPositionCommit }: MapCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 640 });
  const [viewport, setViewport] = useState<ViewportState>({
    scale: 1,
    offsetX: 70,
    offsetY: 25
  });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [localPositionOverrides, setLocalPositionOverrides] = useState<Record<string, WorkerPosition>>({});

  const decoration = useMemo<Decoration>(() => createDecoration(), []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;
      setCanvasSize({
        width: Math.max(300, Math.floor(width)),
        height: Math.max(220, Math.floor(height))
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLocalPositionOverrides((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const worker of workers) {
        const override = next[worker.id];
        if (!override) {
          continue;
        }

        const dx = Math.abs(override.x - worker.position.x);
        const dy = Math.abs(override.y - worker.position.y);
        if (dx < 0.5 && dy < 0.5) {
          delete next[worker.id];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [workers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * devicePixelRatio);
    canvas.height = Math.floor(canvasSize.height * devicePixelRatio);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    drawScene(context, canvasSize.width, canvasSize.height, workers, localPositionOverrides, selectedWorkerId, viewport, decoration);
  }, [canvasSize, workers, localPositionOverrides, selectedWorkerId, viewport, decoration]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const step = 30;
      if (["ArrowUp", "w", "W"].includes(event.key)) {
        event.preventDefault();
        setViewport((current) => ({ ...current, offsetY: current.offsetY + step }));
      } else if (["ArrowDown", "s", "S"].includes(event.key)) {
        event.preventDefault();
        setViewport((current) => ({ ...current, offsetY: current.offsetY - step }));
      } else if (["ArrowLeft", "a", "A"].includes(event.key)) {
        event.preventDefault();
        setViewport((current) => ({ ...current, offsetX: current.offsetX + step }));
      } else if (["ArrowRight", "d", "D"].includes(event.key)) {
        event.preventDefault();
        setViewport((current) => ({ ...current, offsetX: current.offsetX - step }));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const workerPositionLookup = useMemo(() => {
    return new Map<string, WorkerPosition>(
      workers.map((worker) => [worker.id, localPositionOverrides[worker.id] ?? worker.position])
    );
  }, [workers, localPositionOverrides]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = readPointerOnCanvas(event);
    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport);

    if (hit) {
      dragRef.current = {
        workerId: hit.id,
        pointerId: event.pointerId,
        startScreenX: point.x,
        startScreenY: point.y,
        moved: false
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      dragRef.current = null;
      onSelect(undefined);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = readPointerOnCanvas(event);
    const drag = dragRef.current;

    if (drag && drag.pointerId === event.pointerId) {
      const movedDistance = Math.hypot(point.x - drag.startScreenX, point.y - drag.startScreenY);
      if (movedDistance > 3) {
        drag.moved = true;
      }

      const worldPoint = screenToWorld(point.x, point.y, viewport);
      setLocalPositionOverrides((current) => ({
        ...current,
        [drag.workerId]: {
          x: Math.round(worldPoint.x * 10) / 10,
          y: Math.round(worldPoint.y * 10) / 10
        }
      }));
      setHover(null);
      return;
    }

    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport);
    if (!hit) {
      setHover(null);
      return;
    }

    setHover({
      worker: hit,
      screenX: point.x,
      screenY: point.y
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const point = readPointerOnCanvas(event);

    if (drag && drag.pointerId === event.pointerId) {
      if (drag.moved) {
        const position = localPositionOverrides[drag.workerId];
        if (position) {
          onPositionCommit(drag.workerId, position);
        }
      } else {
        onSelect(drag.workerId);
      }

      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }

    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport);
    onSelect(hit?.id);
  };

  const handlePointerLeave = () => {
    if (!dragRef.current) {
      setHover(null);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const point = readPointerOnCanvas(event);
    const worldBeforeZoom = screenToWorld(point.x, point.y, viewport);
    const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;

    setViewport((current) => {
      const nextScale = clamp(current.scale * zoomDelta, 0.55, 2.4);
      return {
        scale: nextScale,
        offsetX: point.x - worldBeforeZoom.x * nextScale,
        offsetY: point.y - worldBeforeZoom.y * nextScale
      };
    });
  };

  return (
    <div className="map-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      />

      {hover ? (
        <div className="map-tooltip" style={{ left: hover.screenX + 16, top: hover.screenY + 18 }}>
          <div className="map-tooltip-title">{hover.worker.name}</div>
          <div>
            {hover.worker.projectId} · {hover.worker.runtimeId}
          </div>
          <div>Status: {hover.worker.status}</div>
          {hover.worker.activityText ? <div>{hover.worker.activityText}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function drawScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  workers: Worker[],
  localPositions: Record<string, WorkerPosition>,
  selectedWorkerId: string | undefined,
  viewport: ViewportState,
  decoration: Decoration
): void {
  context.clearRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#7fc08b");
  gradient.addColorStop(1, "#4d9f60");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(72, 124, 76, 0.32)";
  for (let y = 0; y < height; y += 24) {
    for (let x = 0; x < width; x += 24) {
      if ((x + y) % 48 === 0) {
        context.fillRect(x, y, 2, 2);
      }
    }
  }

  context.strokeStyle = "rgba(198, 173, 107, 0.5)";
  context.lineWidth = 28;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(40, height * 0.7);
  context.bezierCurveTo(width * 0.28, height * 0.55, width * 0.5, height * 0.78, width - 30, height * 0.48);
  context.stroke();

  for (const tree of decoration.trees) {
    const screen = worldToScreen(tree.x, tree.y, viewport);
    context.fillStyle = "#2f6e45";
    context.beginPath();
    context.arc(screen.x, screen.y, tree.size * viewport.scale, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#204936";
    context.beginPath();
    context.arc(screen.x + 3 * viewport.scale, screen.y + 2 * viewport.scale, tree.size * 0.4 * viewport.scale, 0, Math.PI * 2);
    context.fill();
  }

  for (const stone of decoration.stones) {
    const screen = worldToScreen(stone.x, stone.y, viewport);
    context.fillStyle = "#9ba59b";
    context.fillRect(
      screen.x - stone.size * viewport.scale,
      screen.y - stone.size * viewport.scale,
      stone.size * 2 * viewport.scale,
      stone.size * 1.2 * viewport.scale
    );
  }

  context.textAlign = "center";
  context.font = "12px 'Trebuchet MS', sans-serif";

  for (const worker of workers) {
    const worldPosition = localPositions[worker.id] ?? worker.position;
    const screen = worldToScreen(worldPosition.x, worldPosition.y, viewport);
    const radius = workerRadius * viewport.scale;

    context.fillStyle = statusAuraColor[worker.status];
    context.beginPath();
    context.arc(screen.x, screen.y, radius + 11 * viewport.scale, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = avatarColor[worker.avatarType];
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(15, 24, 19, 0.45)";
    context.fillRect(screen.x - 4 * viewport.scale, screen.y - 3 * viewport.scale, 8 * viewport.scale, 6 * viewport.scale);

    if (worker.id === selectedWorkerId) {
      context.strokeStyle = "#f1f2d4";
      context.lineWidth = 2.4;
      context.beginPath();
      context.arc(screen.x, screen.y, radius + 5 * viewport.scale, 0, Math.PI * 2);
      context.stroke();
    }

    context.fillStyle = "rgba(0, 0, 0, 0.54)";
    context.fillRect(screen.x - 52, screen.y + 18 * viewport.scale, 104, 18);

    context.fillStyle = "#f8f7e5";
    context.fillText(worker.name, screen.x, screen.y + 31 * viewport.scale);
  }
}

function createDecoration(): Decoration {
  const random = seededRandom(9241);
  const trees = Array.from({ length: 48 }, () => ({
    x: 140 + random() * 900,
    y: 80 + random() * 580,
    size: 12 + random() * 12
  }));

  const stones = Array.from({ length: 26 }, () => ({
    x: 120 + random() * 920,
    y: 80 + random() * 600,
    size: 2 + random() * 4
  }));

  return { trees, stones };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function worldToScreen(worldX: number, worldY: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: worldX * viewport.scale + viewport.offsetX,
    y: worldY * viewport.scale + viewport.offsetY
  };
}

function screenToWorld(screenX: number, screenY: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: (screenX - viewport.offsetX) / viewport.scale,
    y: (screenY - viewport.offsetY) / viewport.scale
  };
}

function findWorkerAtScreenPoint(
  screenX: number,
  screenY: number,
  workers: Worker[],
  positions: Map<string, WorkerPosition>,
  viewport: ViewportState
): Worker | undefined {
  const radius = (workerRadius + 6) * viewport.scale;

  for (let index = workers.length - 1; index >= 0; index -= 1) {
    const worker = workers[index];
    const position = positions.get(worker.id) ?? worker.position;
    const screenPosition = worldToScreen(position.x, position.y, viewport);
    if (Math.hypot(screenPosition.x - screenX, screenPosition.y - screenY) <= radius) {
      return worker;
    }
  }

  return undefined;
}

function readPointerOnCanvas(event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>): {
  x: number;
  y: number;
} {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

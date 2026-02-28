import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { Worker, WorkerPosition } from "../../shared/types";
import { cornerKey, useOutpostMap, type LoadedOutpostMap } from "../map/tileMapLoader";
import {
  getSpriteFrame,
  type CharacterSpriteSet,
  type SpriteDirection,
  useCharacterSpriteLibrary
} from "../sprites/spriteLoader";

interface MapCanvasProps {
  workers: Worker[];
  selectedWorkerId?: string;
  onSelect: (workerId: string | undefined) => void;
  onPositionCommit: (workerId: string, position: WorkerPosition) => void;
  centerOnWorkerId?: string;
  centerRequestKey?: number;
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

interface WorkerMotion {
  moving: boolean;
  facing: SpriteDirection;
}

interface SpriteBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const workerRadius = 13;
const spriteBaseSize = 72;
const spriteAnchorYFactor = 0.82;
const moveSpeedPerTick = 9;

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

export function MapCanvas({
  workers,
  selectedWorkerId,
  onSelect,
  onPositionCommit,
  centerOnWorkerId,
  centerRequestKey
}: MapCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastCenterRequestRef = useRef<number | undefined>(undefined);
  const previousWorkerPositionsRef = useRef<Record<string, WorkerPosition>>({});
  const workerMovingUntilRef = useRef<Record<string, number>>({});
  const workerFacingRef = useRef<Record<string, SpriteDirection>>({});
  const moveOrdersRef = useRef<Record<string, WorkerPosition>>({});
  const animatedPositionsRef = useRef<Record<string, WorkerPosition>>({});

  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 640 });
  const [viewport, setViewport] = useState<ViewportState>({
    scale: 1,
    offsetX: 70,
    offsetY: 25
  });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, WorkerPosition>>({});
  const [animationTick, setAnimationTick] = useState(0);
  const [hasCenteredOnMap, setHasCenteredOnMap] = useState(false);

  const { mapData, errorText: mapErrorText } = useOutpostMap();

  const workerPositionLookup = useMemo(
    () => new Map<string, WorkerPosition>(workers.map((worker) => [worker.id, animatedPositions[worker.id] ?? worker.position])),
    [animatedPositions, workers]
  );

  const spriteTypes = useMemo(() => Array.from(new Set(workers.map((worker) => worker.avatarType))), [workers]);
  const spriteLibrary = useCharacterSpriteLibrary(spriteTypes);
  const fallbackSpriteSet = useMemo(
    () => Object.values(spriteLibrary).find((spriteSet) => Boolean(spriteSet?.hasSprites)),
    [spriteLibrary]
  );

  useEffect(() => {
    animatedPositionsRef.current = animatedPositions;
  }, [animatedPositions]);

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
    const activeWorkerIds = new Set(workers.map((worker) => worker.id));

    for (const workerId of Object.keys(moveOrdersRef.current)) {
      if (!activeWorkerIds.has(workerId)) {
        delete moveOrdersRef.current[workerId];
      }
    }

    setAnimatedPositions((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const workerId of Object.keys(next)) {
        if (!activeWorkerIds.has(workerId)) {
          delete next[workerId];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [workers]);

  useEffect(() => {
    const animationInterval = window.setInterval(() => {
      setAnimationTick((current) => (current + 1) % 1000000);

      const orders = moveOrdersRef.current;
      if (Object.keys(orders).length === 0) {
        return;
      }

      const workersById = new Map(workers.map((worker) => [worker.id, worker]));
      const nextPositions = { ...animatedPositionsRef.current };
      const commitQueue: Array<{ workerId: string; position: WorkerPosition }> = [];
      let changed = false;

      for (const [workerId, target] of Object.entries(orders)) {
        const worker = workersById.get(workerId);
        if (!worker) {
          delete orders[workerId];
          if (nextPositions[workerId]) {
            delete nextPositions[workerId];
            changed = true;
          }
          continue;
        }

        const currentPosition = nextPositions[workerId] ?? worker.position;
        const dx = target.x - currentPosition.x;
        const dy = target.y - currentPosition.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= moveSpeedPerTick) {
          const finalPosition = {
            x: target.x,
            y: target.y
          };
          nextPositions[workerId] = finalPosition;
          delete orders[workerId];
          commitQueue.push({
            workerId,
            position: finalPosition
          });
          changed = true;
          continue;
        }

        nextPositions[workerId] = {
          x: currentPosition.x + (dx / distance) * moveSpeedPerTick,
          y: currentPosition.y + (dy / distance) * moveSpeedPerTick
        };
        changed = true;
      }

      for (const worker of workers) {
        if (orders[worker.id]) {
          continue;
        }

        const staged = nextPositions[worker.id];
        if (!staged) {
          continue;
        }

        if (Math.hypot(staged.x - worker.position.x, staged.y - worker.position.y) < 0.5) {
          delete nextPositions[worker.id];
          changed = true;
        }
      }

      if (changed) {
        animatedPositionsRef.current = nextPositions;
        setAnimatedPositions(nextPositions);
      }

      for (const commit of commitQueue) {
        onPositionCommit(commit.workerId, {
          x: Math.round(commit.position.x * 10) / 10,
          y: Math.round(commit.position.y * 10) / 10
        });
      }
    }, 95);

    return () => {
      clearInterval(animationInterval);
    };
  }, [onPositionCommit, workers]);

  useEffect(() => {
    if (!mapData || hasCenteredOnMap) {
      return;
    }

    const centerX = (mapData.width * mapData.tileSize) / 2;
    const centerY = (mapData.height * mapData.tileSize) / 2;

    setViewport((current) => ({
      ...current,
      offsetX: canvasSize.width / 2 - centerX * current.scale,
      offsetY: canvasSize.height / 2 - centerY * current.scale
    }));
    setHasCenteredOnMap(true);
  }, [canvasSize.height, canvasSize.width, hasCenteredOnMap, mapData]);

  useEffect(() => {
    if (!centerOnWorkerId || centerRequestKey === undefined) {
      return;
    }

    if (lastCenterRequestRef.current === centerRequestKey) {
      return;
    }

    const worker = workers.find((item) => item.id === centerOnWorkerId);
    if (!worker) {
      return;
    }

    lastCenterRequestRef.current = centerRequestKey;
    const position = animatedPositions[worker.id] ?? worker.position;

    setViewport((current) => ({
      ...current,
      offsetX: canvasSize.width / 2 - position.x * current.scale,
      offsetY: canvasSize.height / 2 - position.y * current.scale
    }));
  }, [animatedPositions, canvasSize.height, canvasSize.width, centerOnWorkerId, centerRequestKey, workers]);

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

    const workerMotion = deriveWorkerMotion(
      workers,
      workerPositionLookup,
      previousWorkerPositionsRef.current,
      workerMovingUntilRef.current,
      workerFacingRef.current,
      performance.now()
    );

    drawScene({
      context,
      width: canvasSize.width,
      height: canvasSize.height,
      workers,
      displayedPositions: animatedPositions,
      workerMotion,
      selectedWorkerId,
      viewport,
      mapData,
      spriteLibrary,
      fallbackSpriteSet,
      animationTick
    });
  }, [
    animatedPositions,
    animationTick,
    canvasSize,
    mapData,
    selectedWorkerId,
    spriteLibrary,
    fallbackSpriteSet,
    viewport,
    workerPositionLookup,
    workers
  ]);

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

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = readPointerOnCanvas(event);
    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary, fallbackSpriteSet);

    if (hit) {
      onSelect(hit.id);
      return;
    }

    if (selectedWorkerId) {
      const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
      if (selectedWorker) {
        const target = clampWorldPosition(screenToWorld(point.x, point.y, viewport), mapData);
        moveOrdersRef.current[selectedWorker.id] = {
          x: Math.round(target.x * 10) / 10,
          y: Math.round(target.y * 10) / 10
        };

        setAnimatedPositions((current) => {
          if (current[selectedWorker.id]) {
            return current;
          }

          return {
            ...current,
            [selectedWorker.id]: selectedWorker.position
          };
        });
      }
      return;
    }

    onSelect(undefined);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = readPointerOnCanvas(event);
    const hit = findWorkerAtScreenPoint(point.x, point.y, workers, workerPositionLookup, viewport, spriteLibrary, fallbackSpriteSet);

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

  const handlePointerLeave = () => {
    setHover(null);
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
          {hover.worker.activityTool ? <div>Tool: {hover.worker.activityTool}</div> : null}
          {hover.worker.activityPath ? <div>Path: {hover.worker.activityPath}</div> : null}
          {hover.worker.activityText ? <div>{hover.worker.activityText}</div> : null}
        </div>
      ) : null}

      {mapErrorText ? (
        <div className="map-tooltip" style={{ left: 14, top: 14 }}>
          Map assets failed to load: {mapErrorText}
        </div>
      ) : null}
    </div>
  );
}

interface DrawSceneInput {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  workers: Worker[];
  displayedPositions: Record<string, WorkerPosition>;
  workerMotion: Record<string, WorkerMotion>;
  selectedWorkerId: string | undefined;
  viewport: ViewportState;
  mapData: LoadedOutpostMap | undefined;
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>;
  fallbackSpriteSet: CharacterSpriteSet | undefined;
  animationTick: number;
}

function drawScene({
  context,
  width,
  height,
  workers,
  displayedPositions,
  workerMotion,
  selectedWorkerId,
  viewport,
  mapData,
  spriteLibrary,
  fallbackSpriteSet,
  animationTick
}: DrawSceneInput): void {
  context.clearRect(0, 0, width, height);

  if (mapData) {
    drawOutpostTerrain(context, viewport, width, height, mapData);
    drawOutpostObjects(context, viewport, width, height, mapData);
  } else {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#7fc08b");
    gradient.addColorStop(1, "#4d9f60");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  context.textAlign = "center";
  context.imageSmoothingEnabled = false;

  for (const worker of workers) {
    const worldPosition = displayedPositions[worker.id] ?? worker.position;
    const screen = worldToScreen(worldPosition.x, worldPosition.y, viewport);
    const radius = workerRadius * viewport.scale;
    const motion = workerMotion[worker.id] ?? { moving: false, facing: "south" as const };

    const spriteSet = spriteLibrary[worker.avatarType] ?? fallbackSpriteSet;
    const spriteFrame = getSpriteFrame(spriteSet, {
      direction: motion.facing,
      moving: motion.moving,
      frameIndex: animationTick
    });

    let spriteBounds: SpriteBounds | undefined;
    if (spriteFrame) {
      spriteBounds = drawSpriteCharacter(context, spriteFrame, screen.x, screen.y, viewport.scale, spriteBaseSize);
    } else {
      drawFallbackWorker(context, worker, screen.x, screen.y, radius, viewport.scale);
    }

    const activityBadge = getActivityBadge(worker);
    if (activityBadge) {
      const badgeWidth = 42;
      const badgeHeight = 16;
      const badgeY = spriteBounds ? spriteBounds.y - 20 * viewport.scale : screen.y - radius - 28 * viewport.scale;

      context.fillStyle = "rgba(14, 21, 18, 0.85)";
      context.fillRect(screen.x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight);
      context.strokeStyle = "rgba(237, 244, 210, 0.5)";
      context.lineWidth = 1;
      context.strokeRect(screen.x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight);

      context.fillStyle = "#eff3d8";
      context.font = "10px 'Trebuchet MS', sans-serif";
      context.fillText(activityBadge, screen.x, badgeY + 11);
    }

    if (worker.status === "attention") {
      const bubbleX = spriteBounds ? spriteBounds.x + spriteBounds.width + 7 * viewport.scale : screen.x + radius + 9 * viewport.scale;
      const bubbleY = spriteBounds ? spriteBounds.y + 10 * viewport.scale : screen.y - radius - 8 * viewport.scale;

      context.fillStyle = "rgba(245, 185, 78, 0.95)";
      context.beginPath();
      context.arc(bubbleX, bubbleY, 8 * viewport.scale, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#35220d";
      context.font = "11px 'Trebuchet MS', sans-serif";
      context.fillText("!", bubbleX, bubbleY + 4 * viewport.scale);
    }

    if (worker.id === selectedWorkerId) {
      context.strokeStyle = "#f1f2d4";
      context.lineWidth = 2;

      if (spriteBounds) {
        context.strokeRect(
          spriteBounds.x - 2 * viewport.scale,
          spriteBounds.y - 2 * viewport.scale,
          spriteBounds.width + 4 * viewport.scale,
          spriteBounds.height + 4 * viewport.scale
        );
      } else {
        context.beginPath();
        context.arc(screen.x, screen.y, radius + 6 * viewport.scale, 0, Math.PI * 2);
        context.stroke();
      }
    }

    context.fillStyle = "rgba(0, 0, 0, 0.54)";
    context.fillRect(screen.x - 52, screen.y + 20 * viewport.scale, 104, 18);

    context.fillStyle = "#f8f7e5";
    context.font = "12px 'Trebuchet MS', sans-serif";
    context.fillText(worker.name, screen.x, screen.y + 33 * viewport.scale);
  }
}

function drawSpriteCharacter(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  centerX: number,
  groundY: number,
  scale: number,
  baseSize: number
): SpriteBounds {
  const bounds = spriteBoundsAtGround(centerX, groundY, scale, baseSize);
  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
  return bounds;
}

function drawFallbackWorker(
  context: CanvasRenderingContext2D,
  worker: Worker,
  centerX: number,
  centerY: number,
  radius: number,
  scale: number
): void {
  context.fillStyle = avatarColor[worker.avatarType];
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(15, 24, 19, 0.45)";
  context.fillRect(centerX - 4 * scale, centerY - 3 * scale, 8 * scale, 6 * scale);
}

function drawOutpostTerrain(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap
): void {
  const tileSize = mapData.tileSize;
  const worldMinX = (-viewport.offsetX / viewport.scale) - tileSize;
  const worldMinY = (-viewport.offsetY / viewport.scale) - tileSize;
  const worldMaxX = ((width - viewport.offsetX) / viewport.scale) + tileSize;
  const worldMaxY = ((height - viewport.offsetY) / viewport.scale) + tileSize;

  const minTileX = clamp(Math.floor(worldMinX / tileSize), 0, mapData.width - 1);
  const minTileY = clamp(Math.floor(worldMinY / tileSize), 0, mapData.height - 1);
  const maxTileX = clamp(Math.ceil(worldMaxX / tileSize), 0, mapData.width - 1);
  const maxTileY = clamp(Math.ceil(worldMaxY / tileSize), 0, mapData.height - 1);

  const baseTile = mapData.baseGrassTile;
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const screen = worldToScreen(tileX * tileSize, tileY * tileSize, viewport);
      const drawSize = tileSize * viewport.scale;

      if (baseTile) {
        context.drawImage(baseTile, screen.x, screen.y, drawSize, drawSize);
      } else {
        context.fillStyle = "#6eb574";
        context.fillRect(screen.x, screen.y, drawSize, drawSize);
      }

      const terrainValue = mapData.terrain[tileY]?.[tileX] ?? 0;
      if (terrainValue <= 0) {
        continue;
      }

      const tileset = mapData.tilesetsByTerrain[terrainValue];
      if (!tileset) {
        continue;
      }

      const key = cornerKey(
        cornerStateAtVertex(mapData, terrainValue, tileX, tileY),
        cornerStateAtVertex(mapData, terrainValue, tileX + 1, tileY),
        cornerStateAtVertex(mapData, terrainValue, tileX, tileY + 1),
        cornerStateAtVertex(mapData, terrainValue, tileX + 1, tileY + 1)
      );

      const overlayTile = tileset.tilesByCornerKey[key] ?? tileset.fallbackTile;
      if (overlayTile) {
        context.drawImage(overlayTile, screen.x, screen.y, drawSize, drawSize);
      }
    }
  }
}

function drawOutpostObjects(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap
): void {
  const drawObjects = [...mapData.objects].sort((a, b) => a.y - b.y || a.x - b.x);
  const worldMinX = (-viewport.offsetX / viewport.scale) - 128;
  const worldMinY = (-viewport.offsetY / viewport.scale) - 128;
  const worldMaxX = ((width - viewport.offsetX) / viewport.scale) + 128;
  const worldMaxY = ((height - viewport.offsetY) / viewport.scale) + 128;

  for (const placedObject of drawObjects) {
    const definition = mapData.objectDefinitions[placedObject.type];
    if (!definition) {
      continue;
    }

    const worldX = placedObject.x * mapData.tileSize + mapData.tileSize / 2 - definition.width / 2;
    const worldY = (placedObject.y + 1) * mapData.tileSize - definition.height;

    if (
      worldX > worldMaxX ||
      worldY > worldMaxY ||
      worldX + definition.width < worldMinX ||
      worldY + definition.height < worldMinY
    ) {
      continue;
    }

    const screen = worldToScreen(worldX, worldY, viewport);
    const drawWidth = definition.width * viewport.scale;
    const drawHeight = definition.height * viewport.scale;

    if (definition.image) {
      context.drawImage(definition.image, screen.x, screen.y, drawWidth, drawHeight);
      continue;
    }

    context.fillStyle = "rgba(32, 45, 35, 0.65)";
    context.fillRect(screen.x, screen.y, drawWidth, drawHeight);
  }
}

function cornerStateAtVertex(
  mapData: LoadedOutpostMap,
  terrainValue: number,
  vertexTileX: number,
  vertexTileY: number
): "lower" | "upper" {
  let matchCount = 0;

  if (terrainAt(mapData, vertexTileX - 1, vertexTileY - 1) === terrainValue) {
    matchCount += 1;
  }
  if (terrainAt(mapData, vertexTileX, vertexTileY - 1) === terrainValue) {
    matchCount += 1;
  }
  if (terrainAt(mapData, vertexTileX - 1, vertexTileY) === terrainValue) {
    matchCount += 1;
  }
  if (terrainAt(mapData, vertexTileX, vertexTileY) === terrainValue) {
    matchCount += 1;
  }

  return matchCount >= 2 ? "upper" : "lower";
}

function terrainAt(mapData: LoadedOutpostMap, tileX: number, tileY: number): number {
  if (tileX < 0 || tileY < 0 || tileX >= mapData.width || tileY >= mapData.height) {
    return 0;
  }

  return mapData.terrain[tileY]?.[tileX] ?? 0;
}

function clampWorldPosition(position: WorkerPosition, mapData: LoadedOutpostMap | undefined): WorkerPosition {
  if (!mapData) {
    return position;
  }

  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;

  return {
    x: clamp(position.x, 16, worldWidth - 16),
    y: clamp(position.y, 16, worldHeight - 16)
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
  viewport: ViewportState,
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>,
  fallbackSpriteSet: CharacterSpriteSet | undefined
): Worker | undefined {
  for (let index = workers.length - 1; index >= 0; index -= 1) {
    const worker = workers[index];
    const position = positions.get(worker.id) ?? worker.position;
    const screenPosition = worldToScreen(position.x, position.y, viewport);
    const spriteSet = spriteLibrary[worker.avatarType] ?? fallbackSpriteSet;

    if (spriteSet?.hasSprites) {
      const bounds = spriteBoundsAtGround(screenPosition.x, screenPosition.y, viewport.scale, spriteBaseSize);
      const padding = 5 * viewport.scale;
      if (
        screenX >= bounds.x - padding &&
        screenX <= bounds.x + bounds.width + padding &&
        screenY >= bounds.y - padding &&
        screenY <= bounds.y + bounds.height + padding
      ) {
        return worker;
      }
      continue;
    }

    const fallbackRadius = (workerRadius + 8) * viewport.scale;
    if (Math.hypot(screenPosition.x - screenX, screenPosition.y - screenY) <= fallbackRadius) {
      return worker;
    }
  }

  return undefined;
}

function deriveWorkerMotion(
  workers: Worker[],
  positions: Map<string, WorkerPosition>,
  previousPositions: Record<string, WorkerPosition>,
  movingUntil: Record<string, number>,
  facingByWorker: Record<string, SpriteDirection>,
  nowMs: number
): Record<string, WorkerMotion> {
  const motion: Record<string, WorkerMotion> = {};
  const activeIds = new Set(workers.map((worker) => worker.id));

  for (const workerId of Object.keys(previousPositions)) {
    if (!activeIds.has(workerId)) {
      delete previousPositions[workerId];
      delete movingUntil[workerId];
      delete facingByWorker[workerId];
    }
  }

  for (const worker of workers) {
    const position = positions.get(worker.id) ?? worker.position;
    const previous = previousPositions[worker.id];
    let facing = facingByWorker[worker.id] ?? "south";

    if (previous) {
      const dx = position.x - previous.x;
      const dy = position.y - previous.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.3) {
        movingUntil[worker.id] = nowMs + 450;
        facing = directionFromVector(dx, dy, facing);
      }
    }

    previousPositions[worker.id] = { ...position };
    facingByWorker[worker.id] = facing;
    motion[worker.id] = {
      moving: (movingUntil[worker.id] ?? 0) > nowMs,
      facing
    };
  }

  return motion;
}

function directionFromVector(dx: number, dy: number, fallback: SpriteDirection): SpriteDirection {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < 0.001 && absY < 0.001) {
    return fallback;
  }

  if (absX > absY) {
    return dx >= 0 ? "east" : "west";
  }

  return dy >= 0 ? "south" : "north";
}

function getActivityBadge(worker: Worker): string | undefined {
  switch (worker.activityTool) {
    case "read":
      return "READ";
    case "edit":
      return "EDIT";
    case "write":
      return "WRITE";
    case "bash":
      return "RUN";
    case "grep":
      return "SEARCH";
    case "glob":
      return "SCAN";
    case "task":
      return "TASK";
    case "todo":
      return "TODO";
    case "web":
      return "WEB";
    case "terminal":
      return "TTY";
    case "unknown":
      return "...";
    default:
      if (worker.status === "error") {
        return "ERR";
      }
      if (worker.status === "working") {
        return "RUN";
      }
      return undefined;
  }
}

function spriteBoundsAtGround(centerX: number, groundY: number, scale: number, baseSize: number): SpriteBounds {
  const drawSize = baseSize * scale;
  return {
    x: centerX - drawSize / 2,
    y: groundY - drawSize * spriteAnchorYFactor,
    width: drawSize,
    height: drawSize
  };
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

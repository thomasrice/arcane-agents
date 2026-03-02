import type { Worker, WorkerPosition } from "../../shared/types";
import type { CharacterSpriteSet } from "../sprites/spriteLoader";
import { worldToScreen, type ViewportState } from "./viewportMath";

export interface SpriteBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function spriteBoundsAtGround(centerX: number, groundY: number, scale: number, baseSize: number): SpriteBounds {
  const spriteAnchorYFactor = 0.84;
  const drawSize = baseSize * scale;
  return {
    x: centerX - drawSize / 2,
    y: groundY - drawSize * spriteAnchorYFactor,
    width: drawSize,
    height: drawSize
  };
}

export function findWorkerAtScreenPoint(
  screenX: number,
  screenY: number,
  workers: Worker[],
  positions: Map<string, WorkerPosition>,
  viewport: ViewportState,
  spriteLibrary: Partial<Record<string, CharacterSpriteSet>>,
  options: {
    workerRadius: number;
    spriteBaseSize: number;
  }
): Worker | undefined {
  for (let index = workers.length - 1; index >= 0; index -= 1) {
    const worker = workers[index];
    const position = positions.get(worker.id) ?? worker.position;
    const screenPosition = worldToScreen(position.x, position.y, viewport);
    const spriteSet = spriteLibrary[worker.avatarType];

    if (spriteSet?.hasSprites) {
      const bounds = spriteBoundsAtGround(screenPosition.x, screenPosition.y, viewport.scale, options.spriteBaseSize);
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

    const fallbackRadius = (options.workerRadius + 8) * viewport.scale;
    if (Math.hypot(screenPosition.x - screenX, screenPosition.y - screenY) <= fallbackRadius) {
      return worker;
    }
  }

  return undefined;
}

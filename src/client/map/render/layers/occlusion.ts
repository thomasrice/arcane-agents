import type { WorkerPosition } from "../../../../shared/types";
import type { LoadedOutpostMap } from "../../tileMapLoader";

interface CollisionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function isWorkerBehindAnyOcclusionRect(position: WorkerPosition, mapData: LoadedOutpostMap): boolean {
  const footX = position.x;
  const footY = position.y;
  const horizontalPadding = mapData.tileSize * 0.2;
  const baselineBias = mapData.tileSize * 0.08;
  const workerBounds: CollisionRect = {
    left: footX - mapData.tileSize * 0.48,
    top: footY - mapData.tileSize * 1.46,
    right: footX + mapData.tileSize * 0.48,
    bottom: footY + mapData.tileSize * 0.24
  };

  for (const rect of mapData.occlusionRects) {
    const occlusionRect: CollisionRect = {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height
    };

    if (rect.mode === "hard") {
      if (intersectsRect(workerBounds, occlusionRect)) {
        return true;
      }
      continue;
    }

    const rectLeft = rect.x - horizontalPadding;
    const rectRight = rect.x + rect.width + horizontalPadding;
    if (footX < rectLeft || footX > rectRight) {
      continue;
    }

    const baselineY = rect.y + rect.height;
    if (footY > baselineY - baselineBias) {
      continue;
    }

    if (!intersectsRect(workerBounds, occlusionRect)) {
      continue;
    }

    return true;
  }

  return false;
}

function intersectsRect(a: CollisionRect, b: CollisionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

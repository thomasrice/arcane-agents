import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SpriteDirection } from "../../sprites/spriteLoader";
import { isEditableTarget, isElementInTerminalPanel } from "../../app/utils";
import { isWasdKey, toPanDirection, type PanDirection, type ViewportState } from "../viewportMath";

interface UseMapKeyboardMotionInput {
  pressedPanKeysRef: MutableRefObject<Set<PanDirection>>;
  panRafRef: MutableRefObject<number | null>;
  lastPanFrameRef: MutableRefObject<number | null>;
  pressedMoveKeysRef: MutableRefObject<Set<PanDirection>>;
  moveRafRef: MutableRefObject<number | null>;
  lastMoveFrameRef: MutableRefObject<number | null>;
  workerFacingRef: MutableRefObject<Record<string, SpriteDirection>>;
  multiSelectedWorkerIdsRef: MutableRefObject<Set<string>>;
  setViewport: Dispatch<SetStateAction<ViewportState>>;
  nudgeSelectedWorkers: (deltaX: number, deltaY: number) => boolean;
  flushPendingKeyboardMoveCommits: () => void;
  keyboardPanSpeedPerSecond: number;
  keyboardMoveUnitsPerSecond: number;
}

export function useMapKeyboardMotion({
  pressedPanKeysRef,
  panRafRef,
  lastPanFrameRef,
  pressedMoveKeysRef,
  moveRafRef,
  lastMoveFrameRef,
  workerFacingRef,
  multiSelectedWorkerIdsRef,
  setViewport,
  nudgeSelectedWorkers,
  flushPendingKeyboardMoveCommits,
  keyboardPanSpeedPerSecond,
  keyboardMoveUnitsPerSecond
}: UseMapKeyboardMotionInput): void {
  useEffect(() => {
    const stopPanLoop = () => {
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      lastPanFrameRef.current = null;
    };

    const stopMoveLoop = () => {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = null;
      }
      lastMoveFrameRef.current = null;
    };

    const movementVector = (pressed: Set<PanDirection>): { x: number; y: number } | undefined => {
      let xAxis = 0;
      let yAxis = 0;

      if (pressed.has("left")) xAxis -= 1;
      if (pressed.has("right")) xAxis += 1;
      if (pressed.has("up")) yAxis -= 1;
      if (pressed.has("down")) yAxis += 1;

      if (xAxis === 0 && yAxis === 0) {
        return undefined;
      }

      const vectorLength = Math.hypot(xAxis, yAxis);
      return { x: xAxis / vectorLength, y: yAxis / vectorLength };
    };

    const panStep = (timestamp: number) => {
      const pressed = pressedPanKeysRef.current;
      if (pressed.size === 0) {
        stopPanLoop();
        return;
      }

      const lastFrame = lastPanFrameRef.current ?? timestamp;
      const deltaSeconds = Math.min(0.05, (timestamp - lastFrame) / 1000);
      lastPanFrameRef.current = timestamp;

      let xAxis = 0;
      let yAxis = 0;
      if (pressed.has("left")) xAxis += 1;
      if (pressed.has("right")) xAxis -= 1;
      if (pressed.has("up")) yAxis += 1;
      if (pressed.has("down")) yAxis -= 1;

      if (xAxis !== 0 || yAxis !== 0) {
        const vectorLength = Math.hypot(xAxis, yAxis);
        const speed = keyboardPanSpeedPerSecond * deltaSeconds;
        const deltaX = (xAxis / vectorLength) * speed;
        const deltaY = (yAxis / vectorLength) * speed;

        setViewport((current) => ({
          ...current,
          offsetX: current.offsetX + deltaX,
          offsetY: current.offsetY + deltaY
        }));
      }

      panRafRef.current = requestAnimationFrame(panStep);
    };

    const moveStep = (timestamp: number) => {
      const pressed = pressedMoveKeysRef.current;
      if (pressed.size === 0) {
        stopMoveLoop();
        return;
      }

      const lastFrame = lastMoveFrameRef.current ?? (timestamp - 1000 / 60);
      const deltaSeconds = Math.min(0.05, (timestamp - lastFrame) / 1000);
      lastMoveFrameRef.current = timestamp;

      const vector = movementVector(pressed);
      if (vector) {
        const speed = keyboardMoveUnitsPerSecond * deltaSeconds;
        nudgeSelectedWorkers(vector.x * speed, vector.y * speed);
      }

      moveRafRef.current = requestAnimationFrame(moveStep);
    };

    const startPanLoop = () => {
      if (panRafRef.current !== null) {
        return;
      }
      lastPanFrameRef.current = null;
      panRafRef.current = requestAnimationFrame(panStep);
    };

    const startMoveLoop = () => {
      if (moveRafRef.current !== null) {
        return;
      }
      lastMoveFrameRef.current = null;
      moveRafRef.current = requestAnimationFrame(moveStep);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const direction = toPanDirection(event.key);
      if (!direction) {
        return;
      }

      const movementDirectionKey = isMovementDirectionKey(event.key);
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && movementDirectionKey) {
        if (isElementInTerminalPanel(event.target)) {
          return;
        }

        event.preventDefault();

        if (multiSelectedWorkerIdsRef.current.size === 0) {
          pressedPanKeysRef.current.add(direction);
          startPanLoop();
          return;
        }

        const facingDirection = panDirectionToFacing(direction);
        for (const workerId of multiSelectedWorkerIdsRef.current) {
          workerFacingRef.current[workerId] = facingDirection;
        }

        const pressed = pressedMoveKeysRef.current;
        const alreadyPressed = pressed.has(direction);
        pressed.add(direction);

        if (!alreadyPressed) {
          const vector = movementVector(pressed);
          if (vector) {
            const immediateDistance = keyboardMoveUnitsPerSecond / 60;
            nudgeSelectedWorkers(vector.x * immediateDistance, vector.y * immediateDistance);
          }
        }

        startMoveLoop();
        return;
      }

      if (movementDirectionKey && (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)) {
        return;
      }

      event.preventDefault();
      pressedPanKeysRef.current.add(direction);
      startPanLoop();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const direction = toPanDirection(event.key);
      if (!direction) {
        return;
      }

      if (isMovementDirectionKey(event.key)) {
        pressedMoveKeysRef.current.delete(direction);
        if (pressedMoveKeysRef.current.size === 0) {
          stopMoveLoop();
          flushPendingKeyboardMoveCommits();
        }
      }

      pressedPanKeysRef.current.delete(direction);
      if (pressedPanKeysRef.current.size === 0) {
        stopPanLoop();
      }
    };

    const onBlur = () => {
      pressedPanKeysRef.current.clear();
      pressedMoveKeysRef.current.clear();
      stopPanLoop();
      stopMoveLoop();
      flushPendingKeyboardMoveCommits();
    };

    const pressedPanKeys = pressedPanKeysRef.current;
    const pressedMoveKeys = pressedMoveKeysRef.current;

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      stopPanLoop();
      stopMoveLoop();
      pressedPanKeys.clear();
      pressedMoveKeys.clear();
      flushPendingKeyboardMoveCommits();
    };
  }, [
    flushPendingKeyboardMoveCommits,
    keyboardMoveUnitsPerSecond,
    keyboardPanSpeedPerSecond,
    lastMoveFrameRef,
    lastPanFrameRef,
    moveRafRef,
    multiSelectedWorkerIdsRef,
    nudgeSelectedWorkers,
    panRafRef,
    pressedMoveKeysRef,
    pressedPanKeysRef,
    setViewport,
    workerFacingRef
  ]);
}

function panDirectionToFacing(direction: PanDirection): SpriteDirection {
  switch (direction) {
    case "up":
      return "north";
    case "down":
      return "south";
    case "left":
      return "west";
    case "right":
      return "east";
    default:
      return "south";
  }
}

function isMovementDirectionKey(key: string): boolean {
  return isWasdKey(key) || key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

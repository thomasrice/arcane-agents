import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SpriteDirection } from "../../sprites/spriteLoader";
import { isEditableTarget, isElementInTerminalPanel } from "../../app/utils";
import { isWasdKey, toPanDirection, type PanDirection, type ViewportState } from "../viewportMath";

interface UseMapKeyboardMotionInput {
  /** Shared facing record; a nudged worker turns to face its movement direction immediately. */
  workerFacingRef: MutableRefObject<Record<string, SpriteDirection>>;
  /** Current map selection (the one allowed selection mirror). */
  selectedWorkerIdsRef: MutableRefObject<Set<string>>;
  setViewport: Dispatch<SetStateAction<ViewportState>>;
  /** Zoom the viewport around the canvas centre by a scale factor. */
  zoomViewportByFactor: (factor: number) => void;
  nudgeSelectedWorkers: (deltaX: number, deltaY: number) => boolean;
  flushPendingKeyboardMoveCommits: () => void;
  keyboardPanSpeedPerSecond: number;
  keyboardMoveUnitsPerSecond: number;
}

/**
 * Owns all map keyboard input as a single window keydown/keyup listener: WASD/arrow
 * panning, selected-worker nudging, and +/- zoom, behind one editable-target guard.
 * The rAF pan/move loop bookkeeping refs are internal to this hook.
 */
export function useMapKeyboardMotion(input: UseMapKeyboardMotionInput): void {
  // Keep the listener and its pressed-key state alive for the component lifetime.
  // Parent rerenders can replace input callbacks while a key is down; rebuilding
  // this effect then cleared held keys and cancelled the active rAF loop before keyup.
  const inputRef = useRef(input);
  inputRef.current = input;
  const pressedPanKeysRef = useRef<Set<PanDirection>>(new Set());
  const panRafRef = useRef<number | null>(null);
  const lastPanFrameRef = useRef<number | null>(null);
  const pressedMoveKeysRef = useRef<Set<PanDirection>>(new Set());
  const moveRafRef = useRef<number | null>(null);
  const lastMoveFrameRef = useRef<number | null>(null);

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
        const speed = inputRef.current.keyboardPanSpeedPerSecond * deltaSeconds;
        const deltaX = (xAxis / vectorLength) * speed;
        const deltaY = (yAxis / vectorLength) * speed;

        inputRef.current.setViewport((current) => ({
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
        const speed = inputRef.current.keyboardMoveUnitsPerSecond * deltaSeconds;
        inputRef.current.nudgeSelectedWorkers(vector.x * speed, vector.y * speed);
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

    const tryHandleZoom = (event: KeyboardEvent): boolean => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return false;
      }

      const zoomIn = event.key === "+" || (event.code === "Equal" && event.shiftKey) || event.code === "NumpadAdd";
      const zoomOut = event.key === "-" || (event.code === "Minus" && !event.shiftKey) || event.code === "NumpadSubtract";
      if (!zoomIn && !zoomOut) {
        return false;
      }

      if (isElementInTerminalPanel(event.target)) {
        return true;
      }

      event.preventDefault();
      inputRef.current.zoomViewportByFactor(zoomIn ? 1.1 : 0.9);
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (tryHandleZoom(event)) {
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

        const { selectedWorkerIdsRef, workerFacingRef } = inputRef.current;
        if (selectedWorkerIdsRef.current.size === 0) {
          pressedPanKeysRef.current.add(direction);
          startPanLoop();
          return;
        }

        const facingDirection = panDirectionToFacing(direction);
        for (const workerId of selectedWorkerIdsRef.current) {
          workerFacingRef.current[workerId] = facingDirection;
        }

        const pressed = pressedMoveKeysRef.current;
        const alreadyPressed = pressed.has(direction);
        pressed.add(direction);

        if (!alreadyPressed) {
          const vector = movementVector(pressed);
          if (vector) {
            const immediateDistance = inputRef.current.keyboardMoveUnitsPerSecond / 60;
            inputRef.current.nudgeSelectedWorkers(vector.x * immediateDistance, vector.y * immediateDistance);
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
          inputRef.current.flushPendingKeyboardMoveCommits();
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
      inputRef.current.flushPendingKeyboardMoveCommits();
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
      inputRef.current.flushPendingKeyboardMoveCommits();
    };
  }, []);
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

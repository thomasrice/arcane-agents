import type { Response } from "express";
import { isAppError } from "./appError";

export function handleRequestError(res: Response, error: unknown): void {
  if (isAppError(error)) {
    res.status(error.status).json({
      error: error.message,
      code: error.code
    });
    return;
  }

  if (isBodyParseError(error)) {
    res.status(400).json({
      error: "Request body must be valid JSON.",
      code: "validation_error"
    });
    return;
  }

  res.status(500).json({
    error: "Internal server error.",
    code: "internal_error"
  });
}

function isBodyParseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  return record.type === "entity.parse.failed";
}

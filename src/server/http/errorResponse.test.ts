import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { conflictError, notFoundError, validationError } from "./appError";
import { handleRequestError } from "./errorResponse";

function createResponseMock(): Response {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  } as unknown as Response;

  (response.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(response);
  return response;
}

describe("handleRequestError", () => {
  it("maps typed app errors to explicit status and code", () => {
    const response = createResponseMock();

    handleRequestError(response, validationError("Invalid payload", "invalid_payload"));
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: "Invalid payload",
      code: "invalid_payload"
    });

    handleRequestError(response, notFoundError("Missing worker", "worker_not_found"));
    expect(response.status).toHaveBeenCalledWith(404);

    handleRequestError(response, conflictError("Worker already stopping", "worker_conflict"));
    expect(response.status).toHaveBeenCalledWith(409);
  });

  it("maps malformed JSON body parse errors to validation response", () => {
    const response = createResponseMock();
    handleRequestError(response, { type: "entity.parse.failed" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      error: "Request body must be valid JSON.",
      code: "validation_error"
    });
  });

  it("maps unknown errors to internal server responses", () => {
    const response = createResponseMock();
    handleRequestError(response, new Error("boom"));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: "Internal server error.",
      code: "internal_error"
    });
  });
});

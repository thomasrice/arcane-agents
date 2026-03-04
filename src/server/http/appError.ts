export type AppErrorCode =
  | "validation_error"
  | "not_found"
  | "conflict"
  | "internal_error"
  | (string & {});

export class AppError extends Error {
  readonly status: number;
  readonly code: AppErrorCode;

  constructor(status: number, code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function validationError(message: string, code: AppErrorCode = "validation_error"): AppError {
  return new AppError(400, code, message);
}

export function notFoundError(message: string, code: AppErrorCode = "not_found"): AppError {
  return new AppError(404, code, message);
}

export function conflictError(message: string, code: AppErrorCode = "conflict"): AppError {
  return new AppError(409, code, message);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

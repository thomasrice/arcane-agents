import type { RequestHandler } from "express";

// Express 4 does not forward rejected promises (or async throws) from route
// handlers to the error middleware. asyncRoute wraps a handler so both
// synchronous throws and async rejections funnel through next(error), making
// the error middleware (handleRequestError) the single error path for routes.
export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}

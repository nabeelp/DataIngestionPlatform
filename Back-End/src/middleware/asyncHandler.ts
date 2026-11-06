// =============================================================================
// Async handler - forwards rejections and thrown errors to the error middleware
// =============================================================================

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';

/**
 * Wraps a route handler so a thrown or rejected error reaches `next(error)` and the central error handler
 * instead of each handler repeating `try/catch`. The returned promise never rejects, so callers may await it.
 */
export function asyncHandler<P = ParamsDictionary>(
    handler: (req: Request<P>, res: Response, next: NextFunction) => unknown,
): RequestHandler<P> {
    return (req, res, next) => {
        try {
            return Promise.resolve(handler(req, res, next)).then(() => undefined, next);
        } catch (error) {
            next(error);
        }
    };
}

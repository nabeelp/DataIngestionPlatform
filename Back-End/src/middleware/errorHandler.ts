// =============================================================================
// Error Handler Middleware
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { RulesServiceError } from '../services/RulesService.service';
import { trace, SpanStatusCode } from '@opentelemetry/api';

export interface HttpFailure {
    statusCode: number;
    message: string;
}

/**
 * Maps a thrown value to the status and message the client receives. Known service errors keep their status;
 * a rules-service rejection of the request (400) is a client error, while other rules-service failures are
 * server errors. Anything else is a 500 that keeps its message, as the handler always has.
 */
export function toHttpFailure(err: unknown, fallbackStatus = 500): HttpFailure {
    if (err instanceof HttpError && err.statusCode >= 400 && err.statusCode <= 599) {
        return { statusCode: err.statusCode, message: err.message };
    }
    if (err instanceof RulesServiceError && err.statusCode === 400) {
        return { statusCode: 400, message: err.message };
    }
    const message = err instanceof Error && err.message ? err.message : 'Internal Server Error';
    return { statusCode: fallbackStatus, message };
}

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) {
    if (res.headersSent) {
        return next(err);
    }
    const { statusCode, message } = toHttpFailure(err, res.statusCode !== 200 ? res.statusCode : 500);
    // Log the error type only: messages and paths can contain customer data.
    logger.error(`[HTTP] Request failed with ${statusCode}: ${err instanceof Error ? err.name : 'UnknownError'}`);
    if (statusCode >= 500) {
        const span = trace.getActiveSpan();
        span?.recordException({ name: 'Error', message: 'API request failed' });
        span?.setStatus({ code: SpanStatusCode.ERROR });
    }

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && statusCode >= 500 && { stack: err.stack })
    });
}

// =============================================================================
// Error Handler Middleware
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { trace, SpanStatusCode } from '@opentelemetry/api';

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: NextFunction
) {
    logger.error('Error:', err);
    const span = trace.getActiveSpan();
    span?.recordException({ name: 'Error', message: 'API request failed' });
    span?.setStatus({ code: SpanStatusCode.ERROR });

    const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
    
    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
}

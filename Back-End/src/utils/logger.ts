// =============================================================================
// Logger Utility - Winston-based logging
// =============================================================================

import winston from 'winston';
import path from 'path';

// Log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
        return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    })
);

// Create logger instance
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // Console transport
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            ),
        }),
        
        // File transport for combined logs
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/combined.log'),
            format: logFormat,
        }),
        
        // File transport for error logs
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/error.log'),
            level: 'error',
            format: logFormat,
        }),
    ],
});

// Export logger methods for convenience
export const log = {
    info: (message: string, ...args: unknown[]) => logger.info(message, ...args),
    warn: (message: string, ...args: unknown[]) => logger.warn(message, ...args),
    error: (message: string, ...args: unknown[]) => logger.error(message, ...args),
    debug: (message: string, ...args: unknown[]) => logger.debug(message, ...args),
};


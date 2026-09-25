// =============================================================================
// Main Entry Point - Express API, Socket.IO, and upload workers
// =============================================================================

import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';
import http from 'http';
import crypto from 'crypto';
import client from 'prom-client';
import { appConfig } from './config/appConfig';
import { logger } from './utils/logger';
import indexRoutes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { initSocket, closeSocket } from './websocket/socketServer';

dotenv.config();

const app: Express = express();
const httpServer = http.createServer(app);
initSocket(httpServer);

// =============================================================================
// Middleware
// =============================================================================
app.use(helmet());
app.use(cors({
    origin: appConfig.cors.origin,
    credentials: appConfig.cors.credentials,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, _res, next) => {
    logger.debug(`[REQUEST] ${req.method} ${req.path}`);
    next();
});

const limiter = rateLimit({
    windowMs: appConfig.rateLimit.windowMs,
    max: appConfig.rateLimit.maxRequests,
    message: { success: false, message: 'Too many requests, please try again later' }
});
app.use('/api', limiter);

app.use('/api/v1', indexRoutes);

// =============================================================================
// Health and metrics
// =============================================================================
const register = new client.Registry();
client.collectDefaultMetrics({ register });

app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// /metrics requires METRICS_TOKEN (Bearer) when set; without it, metrics are only served in development.
const authorizeMetrics = (req: Request, res: Response, next: NextFunction) => {
    const expected = process.env.METRICS_TOKEN;
    if (!expected) {
        if (appConfig.nodeEnv === 'development') return next();
        return res.status(404).end();
    }
    const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const matches = provided.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!matches) return res.status(401).end();
    next();
};

app.get('/metrics', authorizeMetrics, async (_req: Request, res: Response) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch {
        res.status(500).end();
    }
});

app.use((req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

app.use(errorHandler);

// =============================================================================
// Start and stop
// =============================================================================
const PORT: number = parseInt(process.env.PORT || '3000', 10);
let shuttingDown = false;

const startServer = async () => {
    const missingConfig = [
        !appConfig.jwt.secret.trim() && 'JWT_SECRET',
        !appConfig.database.connectionString.trim() && 'DB_CONNECTION_STRING',
    ].filter(Boolean);
    if (missingConfig.length) {
        throw new Error(`Missing required configuration: ${missingConfig.join(', ')}`);
    }
    if (appConfig.nodeEnv !== 'development' && process.env.DEV_BYPASS_AUTH === 'true') {
        logger.warn('DEV_BYPASS_AUTH is ignored outside NODE_ENV=development');
    }

    const { cacheService } = await import('./services/Cache.service');
    await cacheService.initialize();
    const { initializeQueues } = await import('./services/Queue.service');
    await initializeQueues();
    const { initializeValidationWorker } = await import('./services/ValidationWorker.service');
    const validationWorker = initializeValidationWorker();
    const { initializeDeliveryWorker } = await import('./services/DeliveryWorker.service');
    const deliveryWorker = initializeDeliveryWorker();
    if (appConfig.redis.enabled) {
        let timeout: NodeJS.Timeout | undefined;
        try {
            await Promise.race([
                Promise.all([validationWorker.waitUntilReady(), deliveryWorker.waitUntilReady()]),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Redis workers did not become ready within 5 seconds')), 5000);
                })
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }
    logger.info('Cache, queues, and upload workers initialized successfully');

    httpServer.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server running on port ${PORT} (${appConfig.nodeEnv})`);
    });
};

const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received; shutting down gracefully`);

    const forceExit = setTimeout(() => {
        logger.error('Graceful shutdown timed out; forcing exit');
        process.exit(1);
    }, 15000);
    forceExit.unref();

    try {
        // Closing Socket.IO also closes the HTTP server, so new requests stop first.
        await closeSocket();
        const { closeAllQueues } = await import('./services/Queue.service');
        await closeAllQueues();
        const { cacheService } = await import('./services/Cache.service');
        await cacheService.close();
        const { closeConnection } = await import('./config/database');
        await closeConnection();
        logger.info('Shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
    }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startServer().catch(error => {
    logger.error('Startup failed; upload processing is unavailable:', error);
    process.exit(1);
});

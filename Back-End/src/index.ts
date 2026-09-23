// =============================================================================
// Main Entry Point - Express Server Setup (WITH WEBSOCKET SUPPORT)
// =============================================================================

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';
import { appConfig } from './config/appConfig';
import { logger } from './utils/logger';
import indexRoutes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import client from 'prom-client';
// ✅ NEW: WebSocket imports
import http from 'http';
import { Server } from 'socket.io';

// Load environment variables
dotenv.config();

// Create Express app
const app: Express = express();

// =============================================================================
// ✅ NEW: Create HTTP Server (REQUIRED for WebSockets)
// =============================================================================
const httpServer = http.createServer(app);

// =============================================================================
// ✅ NEW: Initialize Socket.IO
// =============================================================================
export const io = new Server(httpServer, {
    cors: {
        origin: appConfig.cors.origin || '*',
        credentials: true,
    },
});

// =============================================================================
// ✅ WebSocket Connection Handling
// =============================================================================
io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Client subscribes to a specific upload
    socket.on('subscribeToUpload', (uploadId: string) => {
        console.log(`[WebSocket] Socket ${socket.id} subscribed to upload ${uploadId}`);
        socket.join(uploadId);
    });

    socket.on('disconnect', () => {
        console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });
});

// =============================================================================
// Middleware
// =============================================================================
app.use(helmet());
app.use(cors({
    origin: appConfig.cors.origin,
    credentials: appConfig.cors.credentials,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logging middleware
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.path} from ${req.ip}`);
    next();
});

// Rate limiting
const limiter = rateLimit({
    windowMs: appConfig.rateLimit.windowMs,
    max: appConfig.rateLimit.maxRequests,
    message: { success: false, message: 'Too many requests, please try again later' }
});
app.use(limiter);

// Routes
app.use('/api/v1', indexRoutes);

// =============================================================================
// Prometheus metrics
// =============================================================================
const register = new client.Registry();
client.collectDefaultMetrics({ register });
(global as any).register = register;

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Metrics endpoint
app.get('/metrics', async (req: Request, res: Response) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (ex) {
        res.status(500).end(register.contentType);
    }
});

// 404 handler
app.use((req: Request, res: Response) => {
    console.log(`[404] Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// =============================================================================
// Start server
// =============================================================================
const PORT: number = parseInt(process.env.PORT || '3000', 10);

const startServer = async () => {
    // Initialize Redis cache before services that use cached upload progress.
    try {
        const { cacheService } = await import('./services/Cache.service');
        await cacheService.initialize();
        logger.info('Cache initialized successfully');
    } catch (error) {
        logger.warn('Failed to initialize cache (application will continue without cache):', error);
    }

    // Initialize queues
    try {
        const { initializeQueues } = await import('./services/Queue.service');
        await initializeQueues();
        logger.info('Queues initialized successfully');
    } catch (error) {
        logger.warn('Failed to initialize queues (validation/delivery may not work):', error);
    }

    // Initialize validation worker
    try {
        const { initializeValidationWorker } = await import('./services/ValidationWorker.service');
        initializeValidationWorker();
        logger.info('Validation worker initialized successfully');
    } catch (error) {
        logger.warn('Failed to initialize validation worker:', error);
    }

    // Initialize delivery worker
    try {
        const { initializeDeliveryWorker } = await import('./services/DeliveryWorker.service');
        initializeDeliveryWorker();
        logger.info('Delivery worker initialized successfully');
    } catch (error) {
        logger.warn('Failed to initialize delivery worker:', error);
    }

    // ✅ IMPORTANT: Use httpServer.listen (NOT app.listen)
    httpServer.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server running on port ${PORT}`);
        logger.info(`Environment: ${appConfig.nodeEnv}`);
        logger.info(`WebSocket server initialized`);
    });
};

startServer();
// =============================================================================
// Socket.IO server - authenticated real-time upload progress
// Clients authenticate with the same access token as the REST API (handshake auth.token).
// Each socket joins a per-user room; admins also join the admins room. Clients may subscribe to a
// specific upload only if they can access it.
// =============================================================================

import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { appConfig } from '../config/appConfig';
import { verifyAccessToken, type AuthenticatedUser } from '../middleware/authMiddleware';
import { Upload } from '../models/Upload.model';
import { logger } from '../utils/logger';

let io: Server | null = null;

const ADMIN_ROOM = 'admins';
const userRoom = (userId: string) => `user:${userId.toLowerCase()}`;
const uploadRoom = (uploadId: string) => `upload:${uploadId.toLowerCase()}`;

// Small bounded cache so progress events do not query the uploader on every emit.
const uploaderCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 5000;

async function getUploaderId(uploadId: string): Promise<string | null> {
    const key = uploadId.toLowerCase();
    const cached = uploaderCache.get(key);
    if (cached) return cached;

    const upload = await Upload.findById(uploadId);
    if (!upload?.UploadedBy) return null;

    if (uploaderCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = uploaderCache.keys().next().value;
        if (oldest) uploaderCache.delete(oldest);
    }
    uploaderCache.set(key, upload.UploadedBy);
    return upload.UploadedBy;
}

export function initSocket(httpServer: HttpServer): Server {
    io = new Server(httpServer, {
        cors: {
            origin: appConfig.cors.origin,
            credentials: true,
        },
    });

    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token as string | undefined;
            socket.data.user = verifyAccessToken(token);
            next();
        } catch {
            next(new Error('Unauthorized'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const user = socket.data.user as AuthenticatedUser;
        socket.join(userRoom(user.userId));
        if (user.role === 'admin') {
            socket.join(ADMIN_ROOM);
        }

        const subscribe = async (payload: unknown) => {
            const uploadId = typeof payload === 'string'
                ? payload
                : (payload as { uploadId?: unknown } | null)?.uploadId;
            if (typeof uploadId !== 'string' || uploadId.length > 64) return;

            try {
                const allowed = user.role === 'admin' || await Upload.hasAccessToUpload(uploadId, user.userId);
                if (allowed) {
                    socket.join(uploadRoom(uploadId));
                }
            } catch (error) {
                logger.warn('[SOCKET] Subscription check failed', error);
            }
        };

        socket.on('subscribeToUpload', subscribe);
        socket.on('joinUploadRoom', subscribe);
        socket.on('unsubscribeFromUpload', (uploadId: unknown) => {
            if (typeof uploadId === 'string') socket.leave(uploadRoom(uploadId));
        });
    });

    return io;
}

/**
 * Emit an upload progress event to subscribers of the upload, its uploader, and admins.
 * Also emits a lightweight `uploadUpdate` event for list views. Never throws.
 */
export async function emitUploadEvent(uploadId: string, payload: Record<string, unknown>): Promise<void> {
    if (!io) return;
    try {
        const uploaderId = await getUploaderId(uploadId);
        const rooms = [uploadRoom(uploadId), ADMIN_ROOM];
        if (uploaderId) rooms.push(userRoom(uploaderId));

        const event = { uploadId, ...payload };
        io.to(rooms).emit('uploadProgress', event);
        io.to(rooms).emit('uploadUpdate', { uploadId, type: payload.type, progress: payload.progress });
    } catch (error) {
        logger.warn(`[SOCKET] Could not emit event for upload ${uploadId}`, error);
    }
}

export async function closeSocket(): Promise<void> {
    if (!io) return;
    await new Promise<void>(resolve => io!.close(() => resolve()));
    io = null;
}

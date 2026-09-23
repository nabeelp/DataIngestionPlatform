// =============================================================================
// Cache Service - Redis Cache Management
// =============================================================================

import Redis from 'ioredis';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';

// Cache key prefixes
export const CACHE_KEYS = {
    FILE_DEFINITION: 'fileDefinition:',
    RULES: 'rules:',
    USER_ACCESS: 'userAccess:',
    UPLOAD_PROGRESS: 'uploadProgress:',
    QUEUE_STATS: 'queueStats:',
} as const;

// Default TTL values (in seconds)
const DEFAULT_TTL = 300; // 5 minutes
const redisEnabled = appConfig.redis.enabled;
const CACHE_TTL = {
    FILE_DEFINITION: 600,    // 10 minutes
    RULES: 300,              // 5 minutes
    USER_ACCESS: 600,        // 10 minutes
    UPLOAD_PROGRESS: 60,     // 1 minute
    QUEUE_STATS: 30,         // 30 seconds
} as const;

class CacheService {
    private redis: Redis | null = null;
    private isConnected: boolean = false;
    private memory = new Map<string, { value: string; expiresAt: number | null }>();
    private subscribers = new Map<string, Set<(message: any) => void>>();

    /**
     * Initialize Redis connection
     */
    async initialize(): Promise<void> {
        if (!redisEnabled) {
            logger.info('Using in-memory cache (REDIS_ENABLED=false)');
            return;
        }
        try {
            this.redis = new Redis({
                host: appConfig.redis.host || 'localhost',
                port: appConfig.redis.port || 6379,
                password: appConfig.redis.password,
                lazyConnect: true,
                connectTimeout: 3000,
                retryStrategy: () => null,
                maxRetriesPerRequest: 3,
            });

            this.redis.on('connect', () => {
                this.isConnected = true;
                logger.info('Redis cache connected');
            });

            this.redis.on('error', (err) => {
                logger.error('Redis cache error:', err);
                this.isConnected = false;
            });

            this.redis.on('close', () => {
                this.isConnected = false;
                logger.warn('Redis cache connection closed');
            });

            // Test connection
            await this.redis.connect();
            await this.redis.ping();
            logger.info('Redis cache initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize Redis cache:', error);
            this.redis?.disconnect();
            this.redis = null;
            throw new Error(`REDIS_ENABLED=true but Redis cache is unavailable: ${String(error)}`);
        }
    }

    /**
     * Check if Redis is connected
     */
    isReady(): boolean {
        return !redisEnabled || (this.isConnected && this.redis !== null);
    }

    private memoryEntry(key: string): { value: string; expiresAt: number | null } | undefined {
        const entry = this.memory.get(key);
        if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.memory.delete(key);
            return undefined;
        }
        return entry;
    }

    /**
     * Get a value from cache
     */
    async get<T>(key: string): Promise<T | null> {
        if (!redisEnabled) {
            const entry = this.memoryEntry(key);
            return entry ? JSON.parse(entry.value) as T : null;
        }
        if (!this.isReady()) {
            return null;
        }

        try {
            const value = await this.redis!.get(key);
            if (!value) {
                return null;
            }
            return JSON.parse(value) as T;
        } catch (error) {
            logger.error(`Cache get error for key ${key}:`, error);
            return null;
        }
    }

    /**
     * Set a value in cache
     */
    async set(key: string, value: any, ttl: number = DEFAULT_TTL): Promise<boolean> {
        if (!redisEnabled) {
            this.memory.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttl * 1000 });
            return true;
        }
        if (!this.isReady()) {
            return false;
        }

        try {
            const serialized = JSON.stringify(value);
            await this.redis!.setex(key, ttl, serialized);
            return true;
        } catch (error) {
            logger.error(`Cache set error for key ${key}:`, error);
            return false;
        }
    }

    /**
     * Delete a value from cache
     */
    async delete(key: string): Promise<boolean> {
        if (!redisEnabled) return this.memory.delete(key);
        if (!this.isReady()) {
            return false;
        }

        try {
            await this.redis!.del(key);
            return true;
        } catch (error) {
            logger.error(`Cache delete error for key ${key}:`, error);
            return false;
        }
    }

    /**
     * Delete keys by pattern
     */
    async deleteByPattern(pattern: string): Promise<number> {
        if (!redisEnabled) {
            const regex = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
            let deleted = 0;
            for (const key of this.memory.keys()) {
                if (this.memoryEntry(key) && regex.test(key) && this.memory.delete(key)) deleted++;
            }
            return deleted;
        }
        if (!this.isReady()) {
            return 0;
        }

        try {
            const keys = await this.redis!.keys(pattern);
            if (keys.length === 0) {
                return 0;
            }
            return await this.redis!.del(...keys);
        } catch (error) {
            logger.error(`Cache delete by pattern error for ${pattern}:`, error);
            return 0;
        }
    }

    /**
     * Check if a key exists in cache
     */
    async exists(key: string): Promise<boolean> {
        if (!redisEnabled) return !!this.memoryEntry(key);
        if (!this.isReady()) {
            return false;
        }

        try {
            const result = await this.redis!.exists(key);
            return result === 1;
        } catch (error) {
            logger.error(`Cache exists error for key ${key}:`, error);
            return false;
        }
    }

    /**
     * Set TTL for a key
     */
    async setTTL(key: string, ttl: number): Promise<boolean> {
        if (!redisEnabled) {
            const entry = this.memoryEntry(key);
            if (!entry) return false;
            entry.expiresAt = Date.now() + ttl * 1000;
            return true;
        }
        if (!this.isReady()) {
            return false;
        }

        try {
            await this.redis!.expire(key, ttl);
            return true;
        } catch (error) {
            logger.error(`Cache TTL error for key ${key}:`, error);
            return false;
        }
    }

    /**
     * Get TTL for a key
     */
    async getTTL(key: string): Promise<number> {
        if (!redisEnabled) {
            const entry = this.memoryEntry(key);
            if (!entry) return -2;
            return entry.expiresAt === null ? -1 : Math.ceil((entry.expiresAt - Date.now()) / 1000);
        }
        if (!this.isReady()) {
            return -2;
        }

        try {
            return await this.redis!.ttl(key);
        } catch (error) {
            logger.error(`Cache get TTL error for key ${key}:`, error);
            return -2;
        }
    }

    // ============================================================================
    // Convenience Methods
    // ============================================================================

    /**
     * Cache file definition
     */
    async cacheFileDefinition(id: string, data: any): Promise<boolean> {
        return this.set(`${CACHE_KEYS.FILE_DEFINITION}${id}`, data, CACHE_TTL.FILE_DEFINITION);
    }

    /**
     * Get cached file definition
     */
    async getFileDefinition<T>(id: string): Promise<T | null> {
        return this.get<T>(`${CACHE_KEYS.FILE_DEFINITION}${id}`);
    }

    /**
     * Invalidate file definition cache
     */
    async invalidateFileDefinition(id: string): Promise<boolean> {
        return this.delete(`${CACHE_KEYS.FILE_DEFINITION}${id}`);
    }

    /**
     * Cache rules for a file definition
     */
    async cacheRules(fileDefinitionId: string, data: any): Promise<boolean> {
        return this.set(`${CACHE_KEYS.RULES}${fileDefinitionId}`, data, CACHE_TTL.RULES);
    }

    /**
     * Get cached rules
     */
    async getRules<T>(fileDefinitionId: string): Promise<T | null> {
        return this.get<T>(`${CACHE_KEYS.RULES}${fileDefinitionId}`);
    }

    /**
     * Invalidate rules cache
     */
    async invalidateRules(fileDefinitionId: string): Promise<boolean> {
        return this.delete(`${CACHE_KEYS.RULES}${fileDefinitionId}`);
    }

    /**
     * Cache user access
     */
    async cacheUserAccess(userId: string, data: any): Promise<boolean> {
        return this.set(`${CACHE_KEYS.USER_ACCESS}${userId}`, data, CACHE_TTL.USER_ACCESS);
    }

    /**
     * Get cached user access
     */
    async getUserAccess<T>(userId: string): Promise<T | null> {
        return this.get<T>(`${CACHE_KEYS.USER_ACCESS}${userId}`);
    }

    /**
     * Invalidate user access cache
     */
    async invalidateUserAccess(userId: string): Promise<boolean> {
        return this.delete(`${CACHE_KEYS.USER_ACCESS}${userId}`);
    }

    /**
     * Cache upload progress
     */
    async cacheUploadProgress(uploadId: string, data: any): Promise<boolean> {
        return this.set(`${CACHE_KEYS.UPLOAD_PROGRESS}${uploadId}`, data, CACHE_TTL.UPLOAD_PROGRESS);
    }

    /**
     * Get cached upload progress
     */
    async getUploadProgress<T>(uploadId: string): Promise<T | null> {
        return this.get<T>(`${CACHE_KEYS.UPLOAD_PROGRESS}${uploadId}`);
    }

    /**
     * Invalidate upload progress cache
     */
    async invalidateUploadProgress(uploadId: string): Promise<boolean> {
        return this.delete(`${CACHE_KEYS.UPLOAD_PROGRESS}${uploadId}`);
    }

    /**
     * Cache queue stats
     */
    async cacheQueueStats(data: any): Promise<boolean> {
        return this.set(CACHE_KEYS.QUEUE_STATS, data, CACHE_TTL.QUEUE_STATS);
    }

    /**
     * Get cached queue stats
     */
    async getQueueStats<T>(): Promise<T | null> {
        return this.get<T>(CACHE_KEYS.QUEUE_STATS);
    }

    // ============================================================================
    // Pub/Sub for Real-time Updates
    // ============================================================================

    /**
     * Publish a message to a channel
     */
    async publish(channel: string, message: any): Promise<number> {
        if (!redisEnabled) {
            const listeners = this.subscribers.get(channel);
            for (const listener of listeners || []) queueMicrotask(() => listener(message));
            return listeners?.size || 0;
        }
        if (!this.isReady()) {
            return 0;
        }

        try {
            const serialized = JSON.stringify(message);
            return await this.redis!.publish(channel, serialized);
        } catch (error) {
            logger.error(`Cache publish error to ${channel}:`, error);
            return 0;
        }
    }

    /**
     * Subscribe to a channel (returns a Promise that resolves when subscribed)
     */
    async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
        if (!redisEnabled) {
            if (!this.subscribers.has(channel)) this.subscribers.set(channel, new Set());
            this.subscribers.get(channel)!.add(callback);
            return;
        }
        if (!this.isReady()) {
            return;
        }

        const subscriber = this.redis!.duplicate();
        
        subscriber.on('message', (ch, message) => {
            if (ch === channel) {
                try {
                    const parsed = JSON.parse(message);
                    callback(parsed);
                } catch (error) {
                    logger.error('Error parsing cache message:', error);
                }
            }
        });

        await subscriber.subscribe(channel);
        logger.info(`Subscribed to cache channel: ${channel}`);
    }

    // ============================================================================
    // Cleanup
    // ============================================================================

    /**
     * Close Redis connection
     */
    async close(): Promise<void> {
        this.memory.clear();
        this.subscribers.clear();
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
            this.isConnected = false;
            logger.info('Redis cache connection closed');
        }
    }

    /**
     * Flush all cache
     */
    async flushAll(): Promise<void> {
        if (!redisEnabled) {
            this.memory.clear();
            return;
        }
        if (!this.isReady()) {
            return;
        }

        try {
            await this.redis!.flushdb();
            logger.info('Cache flushed');
        } catch (error) {
            logger.error('Cache flush error:', error);
        }
    }
}

// Export singleton instance
export const cacheService = new CacheService();

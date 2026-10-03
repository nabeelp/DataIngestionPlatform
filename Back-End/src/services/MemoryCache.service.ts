import { appConfig } from '../config/appConfig';

interface CacheEntry {
    value: unknown;
    expiresAt: number;
}

class MemoryCacheService {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly maxEntries = 10_000;

    async get<T>(key: string): Promise<T | null> {
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return null;
        }
        return entry.value as T;
    }

    async set(key: string, value: unknown, ttlSeconds = appConfig.stats.cacheTtl): Promise<void> {
        const now = Date.now();
        for (const [entryKey, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(entryKey);
        }
        if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey !== undefined) this.entries.delete(oldestKey);
        }
        this.entries.set(key, { value, expiresAt: now + Math.max(0, ttlSeconds) * 1000 });
    }

    async delete(key: string): Promise<void> {
        this.entries.delete(key);
    }

    async cacheUploadProgress(uploadId: string, value: unknown): Promise<void> {
        await this.set(`upload:progress:${uploadId}`, value, 60);
    }

    async getUploadProgress<T = unknown>(uploadId: string): Promise<T | null> {
        return this.get<T>(`upload:progress:${uploadId}`);
    }

    async invalidateUploadProgress(uploadId: string): Promise<void> {
        await this.delete(`upload:progress:${uploadId}`);
    }
}

export const cacheService = new MemoryCacheService();

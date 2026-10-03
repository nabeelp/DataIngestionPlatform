import { appConfig } from '../config/appConfig';
import { User } from '../models/User.model';
import { Upload } from '../models/Upload.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { getConnection } from '../config/database';
import type { AdminStats, QueueStats } from '../interfaces/admin.interface';
import { logger } from '../utils/logger';
import { cacheService } from './MemoryCache.service';
import { serviceBusService } from './ServiceBus.service';

const CACHE_KEY = 'admin:stats';
const CACHE_TTL = appConfig.stats.cacheTtl;
const THROUGHPUT_WINDOW_MINUTES = 60;

export class StatsService {
    static async getAdminStats(): Promise<AdminStats> {
        const cached = await cacheService.get<AdminStats>(CACHE_KEY);
        if (cached) return cached;

        const [
            totalUsers,
            activeSessions,
            todayUploads,
            statusCounts,
            totalDefinitions,
            queueStats,
            recentUploadThroughput,
            recentFailures,
        ] = await Promise.all([
            User.getActiveCount(),
            User.getActiveSessionsCount(),
            Upload.getTodayCount(),
            Upload.getStatusCounts(),
            FileDefinition.getCount(),
            serviceBusService.getQueueMonitoringStats(),
            this.getRecentUploadThroughput(),
            this.getRecentFailures(),
        ]);

        const totalUploads = recentUploadThroughput.uploads;
        const systemHealth = totalUploads > 0
            ? `${Math.max(0, Math.round(100 - (recentFailures / totalUploads) * 100))}%`
            : '100%';
        const stats: AdminStats = {
            totalUsers,
            activeSessions,
            todayUploads,
            totalDefinitions,
            filesInQueue: statusCounts.filesInQueue || 0,
            filesValidating: statusCounts.filesValidating || 0,
            filesDelivering: statusCounts.filesDelivering || 0,
            systemHealth,
            queueStats,
            recentUploadThroughput,
        };

        await cacheService.set(CACHE_KEY, stats, CACHE_TTL);
        logger.info(`[STATS] Stats refreshed; health=${systemHealth}, uploadsLastHour=${totalUploads}`);
        return stats;
    }

    static async getQueueMonitoring(): Promise<{
        stats: QueueStats;
        recentUploadThroughput: AdminStats['recentUploadThroughput'];
    }> {
        const [stats, recentUploadThroughput] = await Promise.all([
            serviceBusService.getQueueMonitoringStats(),
            this.getRecentUploadThroughput(),
        ]);
        return { stats, recentUploadThroughput };
    }

    private static async getRecentUploadThroughput(): Promise<AdminStats['recentUploadThroughput']> {
        const pool = await getConnection();
        const result = await pool.request().query(`
            SELECT COUNT(*) AS Uploads
            FROM Uploads
            WHERE UploadedAt >= DATEADD(minute, -${THROUGHPUT_WINDOW_MINUTES}, SYSUTCDATETIME())
        `);
        const uploads = Number(result.recordset[0]?.Uploads) || 0;
        return {
            windowMinutes: THROUGHPUT_WINDOW_MINUTES,
            uploads,
            uploadsPerMinute: Number((uploads / THROUGHPUT_WINDOW_MINUTES).toFixed(2)),
        };
    }

    private static async getRecentFailures(): Promise<number> {
        const pool = await getConnection();
        const result = await pool.request().query(`
            SELECT COUNT(*) AS Failed
            FROM Uploads
            WHERE Status IN ('VALIDATION_FAILED', 'DELIVERY_FAILED')
              AND UploadedAt >= DATEADD(minute, -${THROUGHPUT_WINDOW_MINUTES}, SYSUTCDATETIME())
        `);
        return Number(result.recordset[0]?.Failed) || 0;
    }

    static async invalidateCache(): Promise<void> {
        await cacheService.delete(CACHE_KEY);
    }
}

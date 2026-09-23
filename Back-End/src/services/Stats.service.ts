/**
 * Admin Stats Service - Production-ready stats aggregation with caching
 */

import { appConfig } from '../config/appConfig';
import { User } from '../models/User.model';
import { Upload } from '../models/Upload.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { getAllQueueStats, getStuckJobs } from './Queue.service';
import { getConnection } from '../config/database';
import { AdminStats, QueueStats } from '../interfaces/admin.interface';
import { logger } from '../utils/logger';
import { cacheService } from './Cache.service';

const CACHE_KEY = 'admin:stats';
const CACHE_TTL = appConfig.stats.cacheTtl;

export class StatsService {
  /**
   * Get complete admin stats with caching
   */
  static async getAdminStats(): Promise<AdminStats> {
    // Try cache first
    const cached = await cacheService.get<AdminStats>(CACHE_KEY);
    if (cached) {
      logger.info('[STATS] Cache hit');
      return cached;
    }

    logger.info('[STATS] Cache miss - fetching fresh stats');

    try {
      // Parallel data fetching
      const [
        totalUsers,
        activeSessions,
        todayUploads,
        statusCounts,
        totalDefinitions,
        queueStatsRaw,
        stuckJobs,
        recentFailures
      ] = await Promise.allSettled([
        User.getActiveCount(),
        User.getActiveSessionsCount(),
        Upload.getTodayCount(),
        Upload.getStatusCounts(),
        FileDefinition.getCount(),
        getAllQueueStats(),
        getStuckJobs(),
        this.getRecentFailures()
      ]);

      const queueStats: QueueStats = (queueStatsRaw as PromiseFulfilledResult<any>).value || 
        { validation: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, delivery: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, retry: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 } };

      const failures = (recentFailures as PromiseFulfilledResult<number>).value || 0;
      const stuckCount = stuckJobs.status === 'fulfilled' 
        ? Object.values(stuckJobs.value as Record<string, any[]>).reduce((sum, jobs) => sum + jobs.length, 0)
        : 0;

      // Production health calculation
      const totalJobs = queueStats.validation.completed + queueStats.delivery.completed + failures;
      let systemHealth = 100;
      if (totalJobs > 0) {
        const failureRate = (failures / totalJobs) * 100;
        const stuckRate = (stuckCount / Math.max(1, totalJobs)) * 20; // Stuck jobs penalize 20%
        systemHealth = Math.max(0, Math.round(100 - failureRate - stuckRate));
      }

      const stats: AdminStats = {
        totalUsers: (totalUsers as PromiseFulfilledResult<number>).value || 0,
        activeSessions: (activeSessions as PromiseFulfilledResult<number>).value || 0,
        todayUploads: (todayUploads as PromiseFulfilledResult<number>).value || 0,
        totalDefinitions: (totalDefinitions as PromiseFulfilledResult<number>).value || 0,
        filesInQueue: (statusCounts as PromiseFulfilledResult<any>).value?.filesInQueue || 0,
        filesValidating: (statusCounts as PromiseFulfilledResult<any>).value?.filesValidating || 0,
        filesDelivering: (statusCounts as PromiseFulfilledResult<any>).value?.filesDelivering || 0,
        systemHealth: `${systemHealth}%`,
        queueStats,
      };

      // Cache for TTL
      await cacheService.set(CACHE_KEY, stats, CACHE_TTL);
      
      logger.info(`[STATS] Fresh stats cached: health=${systemHealth}% users=${stats.totalUsers} uploads=${stats.todayUploads}`);

      return stats;
    } catch (error) {
      logger.error('[STATS] Failed to fetch stats:', error);
      // Return safe defaults on error
      return {
        totalUsers: 0,
        activeSessions: 0,
        todayUploads: 0,
        totalDefinitions: 0,
        filesInQueue: 0,
        filesValidating: 0,
        filesDelivering: 0,
        systemHealth: '0%',
        queueStats: { validation: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, delivery: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }, retry: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 } },
      };
    }
  }

  /**
   * Recent failures in last 24h
   */
  private static async getRecentFailures(): Promise<number> {
    const pool = await getConnection();
    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);
    
    const result = await pool.request()
      .input('Last24h', last24h)
      .query(`
        SELECT COUNT(*) as failed 
        FROM Uploads 
        WHERE Status IN ('VALIDATION_FAILED', 'DELIVERY_FAILED') 
        AND UpdatedAt >= @Last24h
      `);
    
    return Number(result.recordset[0]?.failed) || 0;
  }

  /**
   * Invalidate cache
   */
  static async invalidateCache(): Promise<void> {
    await cacheService.delete(CACHE_KEY);
    logger.info('[STATS] Cache invalidated');
  }
}

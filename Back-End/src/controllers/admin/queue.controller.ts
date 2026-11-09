// =============================================================================
// Admin Controller - Queue monitoring
// =============================================================================

import { StatsService } from '../../services/Stats.service';
import { asyncHandler } from '../../middleware/asyncHandler';

/**
 * Get queue statistics
 */
export const getQueueStats = asyncHandler(async (_req, res) => {
    const { stats, recentUploadThroughput } = await StatsService.getQueueMonitoring();
    res.json({
        success: true,
        stats,
        recentUploadThroughput,
    });
});

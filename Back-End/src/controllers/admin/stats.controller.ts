// =============================================================================
// Admin Controller - Dashboard stats
// =============================================================================

import { StatsService } from '../../services/Stats.service';
import { AdminStats } from '../../interfaces/admin.interface';
import { asyncHandler } from '../../middleware/asyncHandler';

/**
 * Get dashboard statistics - Production ready with caching
 */
export const getStats = asyncHandler(async (_req, res) => {
    const stats: AdminStats = await StatsService.getAdminStats();

    res.json({
        success: true,
        stats
    });
});

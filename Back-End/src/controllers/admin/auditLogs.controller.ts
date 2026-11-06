// =============================================================================
// Admin Controller - Audit logs
// =============================================================================

import { AuditLog } from '../../models/AuditLog.model';
import { asyncHandler } from '../../middleware/asyncHandler';

/**
 * Get audit logs
 */
export const getAuditLogs = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const userId = req.query.userId as string;
    const action = req.query.action as string;
    const entityType = req.query.entityType as string;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const result = await AuditLog.findAll({
        page,
        pageSize: limit,
        userId,
        action,
        entityType,
        startDate,
        endDate
    });

    res.json({
        success: true,
        logs: result.logs,
        total: result.total,
        page,
        limit
    });
});

// =============================================================================
// Search Routes - global search across definitions and uploads the user can access
// =============================================================================

import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { authenticate } from '../middleware/authMiddleware';
import { DashboardService } from '../services/Dashboard.service';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/v1/search?q=term
 */
router.get(
    '/',
    authenticate,
    [query('q').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Search term must be 2-100 characters')],
    async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, message: errors.array()[0].msg });
        }
        try {
            const results = await DashboardService.search((req as any).user.userId, String(req.query.q));
            res.json({ success: true, ...results });
        } catch (error) {
            logger.error('[SEARCH] Search failed', error);
            res.status(500).json({ success: false, message: 'Search failed' });
        }
    }
);

export default router;

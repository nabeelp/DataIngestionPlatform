// =============================================================================
// Search Routes - global search across definitions and uploads the user can access
// =============================================================================

import { Router } from 'express';
import { query, validationResult } from 'express-validator';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { DashboardService } from '../services/Dashboard.service';
import { BadRequestError, HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/v1/search?q=term
 */
router.get(
    '/',
    authenticate,
    [query('q').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Search term must be 2-100 characters')],
    asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new BadRequestError(String(errors.array()[0].msg));
        }
        try {
            const results = await DashboardService.search(req.user!.userId, String(req.query.q));
            res.json({ success: true, ...results });
        } catch (error) {
            logger.error(`[SEARCH] Search failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            throw new HttpError('Search failed', 500);
        }
    })
);

export default router;

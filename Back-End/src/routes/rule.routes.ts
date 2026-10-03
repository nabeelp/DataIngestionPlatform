// =============================================================================
// Rule Routes - API endpoints for Validation Rules
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as RuleController from '../controllers/rule.controller';

const router = Router();

// Validation middleware
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

/**
 * GET /api/rules/definitions/:fileDefinitionId
 * Get all rules for a specific file definition
 * Requires access to the file definition
 */
router.get(
    '/definitions/:fileDefinitionId',
    authenticate,
    RuleController.getRules
);

/**
 * GET /api/rules/:id
 * Get a single rule by ID
 * Requires access to the rule's file definition
 */
router.get(
    '/:id',
    authenticate,
    RuleController.getRuleById
);

router.post(
    '/natural-language',
    authenticate,
    authorize('admin'),
    [
        body('FileDefinitionId').isUUID(),
        body('Request').isString().trim().isLength({ min: 1, max: 1000 }),
    ],
    validateRequest,
    RuleController.createRuleFromDescription
);

router.post(
    '/:id/regenerate',
    authenticate,
    authorize('admin'),
    [
        body('Request').isString().trim().isLength({ min: 1, max: 1000 }),
    ],
    validateRequest,
    RuleController.regenerateRuleFromDescription
);

router.post(
    '/validate',
    authenticate,
    authorize('admin'),
    [
        body('FileDefinitionId').isUUID(),
        body('Config').isObject(),
    ],
    validateRequest,
    RuleController.validateRuleConfiguration,
);

router.post(
    '/test',
    authenticate,
    authorize('admin'),
    [
        body('FileDefinitionId').isUUID(),
        body('Config').isObject(),
        body('examples').optional().isArray(),
    ],
    validateRequest,
    RuleController.testRuleConfiguration,
);

/**
 * POST /api/rules
 * Create a new rule
 * Admin only
 */
router.post(
    '/',
    authenticate,
    authorize('admin'),
    [
        body('FileDefinitionId').isUUID(),
        body('Config').isObject(),
    ],
    validateRequest,
    RuleController.createRule
);

/**
 * PUT /api/rules/:id
 * Update a rule
 * Admin only
 */
router.put(
    '/:id',
    authenticate,
    authorize('admin'),
    [
        body('Config').isObject(),
    ],
    validateRequest,
    RuleController.updateRule
);

/**
 * DELETE /api/rules/:id
 * Delete a rule
 * Admin only
 */
router.delete(
    '/:id',
    authenticate,
    authorize('admin'),
    RuleController.deleteRule
);

/**
 * PATCH /api/rules/:id/toggle
 * Toggle rule enabled/disabled status
 * Admin only
 */
router.patch(
    '/:id/toggle',
    authenticate,
    authorize('admin'),
    RuleController.toggleRule
);

export default router;

// =============================================================================
// Rule Routes - API endpoints for Validation Rules
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/authMiddleware';
import * as RuleController from '../controllers/rule.controller';
import { SUPPORTED_RULE_TYPES } from '../services/validation/ValidationEngine';

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

/**
 * POST /api/rules
 * Create a new rule
 * Requires access to the file definition
 */
router.post(
    '/',
    authenticate,
    [
        body('FileDefinitionId').isUUID(),
        body('Name').isLength({ min: 1, max: 200 }).trim(),
        body('Description').optional().isLength({ max: 1000 }),
        body('RuleType').isIn([...SUPPORTED_RULE_TYPES]),
        body('Severity').optional().isIn(['Error', 'Warning']),
        body('ExecutionOrder').optional().isInt({ min: 1 }),
        body('SqlQuery').isString().isLength({ min: 1, max: 4000 }),
        body('IsEnabled').optional().isBoolean(),
    ],
    validateRequest,
    RuleController.createRule
);

/**
 * PUT /api/rules/:id
 * Update a rule
 * Requires access to the rule's file definition
 */
router.put(
    '/:id',
    authenticate,
    [
        body('Name').optional().isLength({ min: 1, max: 200 }).trim(),
        body('Description').optional().isLength({ max: 1000 }),
        body('RuleType').optional().isIn([...SUPPORTED_RULE_TYPES]),
        body('Severity').optional().isIn(['Error', 'Warning']),
        body('ExecutionOrder').optional().isInt({ min: 1 }),
        body('SqlQuery').optional().isString().isLength({ min: 1, max: 4000 }),
        body('IsEnabled').optional().isBoolean(),
    ],
    validateRequest,
    RuleController.updateRule
);

/**
 * DELETE /api/rules/:id
 * Delete a rule
 * Requires access to the rule's file definition
 */
router.delete(
    '/:id',
    authenticate,
    RuleController.deleteRule
);

/**
 * PATCH /api/rules/:id/toggle
 * Toggle rule enabled/disabled status
 * Requires access to the rule's file definition
 */
router.patch(
    '/:id/toggle',
    authenticate,
    RuleController.toggleRule
);

export default router;


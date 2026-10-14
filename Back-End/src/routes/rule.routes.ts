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
    '/natural-language/propose',
    authenticate,
    authorize('admin'),
    [
        body('Request').isString().trim().isLength({ min: 1, max: 1000 }),
        body('Contract').isObject(),
        body('Rules').optional({ values: 'null' }).isArray({ max: 50 }),
        body('Config').optional({ values: 'null' }).isObject(),
    ],
    validateRequest,
    RuleController.proposeRuleFromDescription
);

const authoringContext = [
    body('FileDefinitionId').optional({ values: 'null' }).isUUID(),
    body('Contract').optional({ values: 'null' }).isObject(),
    body('Rules').optional({ values: 'null' }).isArray({ max: 50 }),
    body('Config').isObject(),
    body().custom(value => {
        if (!value?.Contract && !value?.FileDefinitionId) throw new Error('Contract or FileDefinitionId is required');
        return true;
    }),
];

router.post(
    '/validate',
    authenticate,
    authorize('admin'),
    authoringContext,
    validateRequest,
    RuleController.validateRuleConfiguration,
);

router.post(
    '/test',
    authenticate,
    authorize('admin'),
    [...authoringContext, body('examples').optional().isArray()],
    validateRequest,
    RuleController.testRuleConfiguration,
);

export default router;

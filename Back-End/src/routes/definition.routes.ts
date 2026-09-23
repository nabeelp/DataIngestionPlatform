// =============================================================================
// Definition Routes - API endpoints for File Definitions
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as DefinitionController from '../controllers/definition.controller';

const router = Router();

// Validation middleware
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log('[DEFINITION_ROUTES] Validation errors:', errors.array());
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

/**
 * GET /api/definitions/users/all
 * Get all available users (for admin to select when adding access)
 * Admin only
 * NOTE: This must be defined BEFORE /:id to avoid being matched as a parameter
 */
router.get(
    '/users/all',
    authenticate,
    authorize('admin'),
    DefinitionController.getAllUsers
);

/**
 * GET /api/definitions
 * Get all definitions accessible to the current user
 * All authenticated users can access this
 */
router.get(
    '/',
    authenticate,
    DefinitionController.getDefinitions
);

/**
 * GET /api/definitions/stats
 * Get definition stats for dashboard (total and active counts)
 * All authenticated users can access this
 */
router.get(
    '/stats',
    authenticate,
    DefinitionController.getDefinitionStats
);

/**
 * GET /api/definitions/:id
 * Get a single definition by ID
 * Requires access to the definition
 */
router.get(
    '/:id',
    authenticate,
    DefinitionController.getDefinitionById
);

/**
 * POST /api/definitions
 * Create a new definition
 * Admin only
 */
router.post(
    '/',
    authenticate,
    authorize('admin'),
    [
        body('Name').isLength({ min: 1, max: 200 }).trim(),
        body('Description').optional().isLength({ max: 1000 }),
        body('Columns').isArray({ min: 1 }),
        body('Columns.*.name').isString().isLength({ min: 1, max: 100 }),
        body('Columns.*.type').isIn(['string', 'integer', 'decimal', 'datetime', 'boolean']),
        body('Columns.*.required').isBoolean(),
        body('Status').optional().isIn(['Active', 'Inactive']),
    ],
    validateRequest,
    DefinitionController.createDefinition
);

/**
 * PUT /api/definitions/:id
 * Update a definition
 * Admin only
 */
router.put(
    '/:id',
    authenticate,
    authorize('admin'),
    [
        body('Name').optional().isLength({ min: 1, max: 200 }).trim(),
        body('Description').optional().isLength({ max: 1000 }),
        body('Columns').optional().isArray({ min: 1 }),
        body('Columns.*.name').optional().isString().isLength({ min: 1, max: 100 }),
        body('Columns.*.type').optional().isIn(['string', 'integer', 'decimal', 'datetime', 'boolean']),
        body('Columns.*.required').optional().isBoolean(),
        body('Status').optional().isIn(['Active', 'Inactive']),
    ],
    validateRequest,
    DefinitionController.updateDefinition
);

/**
 * DELETE /api/definitions/:id
 * Delete a definition
 * Admin only
 */
router.delete(
    '/:id',
    authenticate,
    authorize('admin'),
    DefinitionController.deleteDefinition
);

/**
 * POST /api/definitions/:id/users
 * Add users to a definition
 * Admin only
 */
router.post(
    '/:id/users',
    authenticate,
    authorize('admin'),
    [
        body('UserIds').isArray({ min: 1 }),
        body('UserIds.*').isString().isUUID(),
    ],
    validateRequest,
    DefinitionController.addUsersToDefinition
);

/**
 * GET /api/definitions/:id/template
 * Download template file (users with access)
 */
router.get(
    '/:id/template',
    authenticate,
    DefinitionController.downloadTemplate
);

/**
 * DELETE /api/definitions/:id/users/:userId
 * Remove a user from a definition
 * Admin only
 */
router.delete(
    '/:id/users/:userId',
    authenticate,
    authorize('admin'),
    DefinitionController.removeUserFromDefinition
);

export default router;



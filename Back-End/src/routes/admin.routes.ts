// =============================================================================
// Admin Routes - API endpoints for Admin Dashboard
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/authMiddleware';
import * as AdminController from '../controllers/admin.controller';
import { ComplianceService } from '../services/Compliance.service';
import { asyncHandler } from '../middleware/asyncHandler';
import { BadRequestError } from '../utils/httpError';

const router = Router();

// Validation middleware
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(authorize('admin'));

// One table per workbook sheet (optional); the controller checks sheet names and layout.
const sheetTableValidators = [
    body('tables').optional({ values: 'null' }).isArray({ max: 50 }),
    body('tables.*.sheet').isString().isLength({ min: 1, max: 31 }),
    body('tables.*.columns').isArray({ min: 1 }),
    body('tables.*.columns.*.name').isString().isLength({ min: 1, max: 100 }),
    body('tables.*.columns.*.type').isIn(['string', 'integer', 'decimal', 'date', 'datetime', 'boolean']),
    body('tables.*.columns.*.required').isBoolean(),
];

// ============================================================================
// Dashboard Stats
// ============================================================================

/**
 * GET /api/admin/stats
 * Get dashboard statistics - rate limited for production
 */
router.get(
    '/stats',
    [
      // Rate limit stats endpoint: 30/min per IP (high traffic dashboard)
      // Note: requires rate-limit-flexible middleware imported
      rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 30,
        message: { success: false, message: 'Too many stats requests, please wait' }
      })
    ],
    AdminController.getStats
);

/**
 * GET /api/admin/compliance?days=30
 * Operational compliance controls derived from platform data
 */
router.get('/compliance', asyncHandler(async (req, res) => {
    const days = parseInt(String(req.query.days || '30'), 10);
    const report = await ComplianceService.getReport(days);
    res.json({ success: true, report });
}));

// ============================================================================
// User Management
// ============================================================================

/**
 * GET /api/admin/users
 * Get all users (paginated)
 */
router.get(
    '/users',
    AdminController.getUsers
    
);

/**
 * POST /api/admin/users
 * Create new user
 */
router.post(
    '/users',
    [
        body('email').isEmail().normalizeEmail(),
        body('username').isLength({ min: 3, max: 50 }),
        body('password').isLength({ min: 8 }),
        body('firstName').optional().isLength({ max: 100 }),
        body('lastName').optional().isLength({ max: 100 }),
        body('role').optional().isIn(['admin', 'user']),
    ],
    validateRequest,
    AdminController.createUser
);

/**
 * PUT /api/admin/users/:id
 * Update user
 */
router.put(
    '/users/:id',
    [
        body('firstName').optional().isLength({ max: 100 }),
        body('lastName').optional().isLength({ max: 100 }),
        body('role').optional().isIn(['admin', 'user']),
        body('isActive').optional().isBoolean(),
    ],
    validateRequest,
    AdminController.updateUser
);

/**
 * POST /api/admin/users/:id/unlock
 * Unlock user account
 */
router.post(
    '/users/:id/unlock',
    AdminController.unlockUser
);

/**
 * DELETE /api/admin/users/:id
 * Delete (soft delete) user
 */
router.delete(
    '/users/:id',
    AdminController.deleteUser
);

// ============================================================================
// Audit Logs
// ============================================================================

/**
 * GET /api/admin/audit-logs
 * Get audit logs with filters
 */
router.get(
    '/audit-logs',
    AdminController.getAuditLogs
);

// ============================================================================
// Queue Monitoring
// ============================================================================

/**
 * GET /api/admin/queue-stats
 * Get queue statistics
 */
router.get(
    '/queue-stats',
    AdminController.getQueueStats
);

// ============================================================================
// File Definitions Management (Admin view)
// ============================================================================

/**
 * GET /api/admin/file-definitions
 * Get all file definitions (admin view)
 */
router.get(
    '/file-definitions',
    AdminController.getFileDefinitions
);

/**
 * POST /api/admin/file-definitions
 * Create new file definition
 */
router.post(
    '/file-definitions',
    [
        body('name').isLength({ min: 1, max: 200 }).trim(),
        body('description').optional().isLength({ max: 1000 }),
        body('columns').optional().isArray(),
        body('columns.*.name').isString().isLength({ min: 1, max: 100 }),
        body('columns.*.type').isIn(['string', 'integer', 'decimal', 'date', 'datetime', 'boolean']),
        body('columns.*.required').isBoolean(),
        ...sheetTableValidators,
        body('contract').optional().isObject(),
        body('status').optional().isIn(['Active', 'Inactive']),
        body('rules').optional({ values: 'null' }).isArray({ max: 50 }),
        body('rules.*.name').optional().isString().isLength({ min: 1, max: 255 }),
        body('rules.*.ruleType').optional().isString(),
        body('rules.*.expression').optional().isString().isLength({ max: 4000 }),
        body('rules.*.severity').optional().isIn(['Error', 'Warning']),
        body('rules.*.table').optional({ values: 'null' }).isString().isLength({ max: 255 }),
    ],
    validateRequest,
    AdminController.createFileDefinition
);

/**
 * PUT /api/admin/file-definitions/:id
 * Update file definition
 */
router.put(
    '/file-definitions/:id',
    [
        body('name').optional().isLength({ min: 1, max: 200 }).trim(),
        body('description').optional().isLength({ max: 1000 }),
        body('columns').optional().isArray(),
        body('columns.*.name').optional().isString().isLength({ min: 1, max: 100 }),
        body('columns.*.type').optional().isIn(['string', 'integer', 'decimal', 'date', 'datetime', 'boolean']),
        body('columns.*.required').optional().isBoolean(),
        ...sheetTableValidators,
        body('contract').optional().isObject(),
        body('rules').optional().isArray({ max: 50 }),
        body('revision').optional({ values: 'null' }).isString().isLength({ max: 64 }),
        body('status').optional().isIn(['Active', 'Inactive']),
    ],
    validateRequest,
    AdminController.updateFileDefinition
);

/**
 * POST /api/admin/file-definitions/preflight
 * Validate an unsaved definition draft (structure and rules) and preview what publishing would change
 */
router.post(
    '/file-definitions/preflight',
    [
        body('contract').isObject(),
        body('rules').optional({ values: 'null' }).isArray({ max: 50 }),
        body('definitionId').optional({ values: 'null' }).isUUID(),
    ],
    validateRequest,
    AdminController.preflightFileDefinition
);

/**
 * DELETE /api/admin/file-definitions/:id
 * Delete file definition
 */
router.delete(
    '/file-definitions/:id',
    AdminController.deleteFileDefinition
);

// ============================================================================
// File Definition User Assignments (Admin only)
// ============================================================================

import * as FileDefinitionAdminController from '../controllers/fileDefinitionAdmin.controller';

/**
 * GET /api/admin/file-definitions/:definitionId/users
 * Get users assigned to specific file definition
 */
router.get(
    '/file-definitions/:definitionId/users',
    FileDefinitionAdminController.getFileDefinitionUsers
);

/**
 * POST /api/admin/file-definitions/:definitionId/users
 * Assign users to file definition
 * Body: { userIds: string[] }
 */
router.post(
    '/file-definitions/:definitionId/users',
    [
        body('userIds').isArray({ min: 1 }),
        body('userIds.*').isString().isUUID(),
    ],
    validateRequest,
    FileDefinitionAdminController.addUsersToFileDefinition
);

/**
 * DELETE /api/admin/file-definitions/:definitionId/users/:userId
 * Remove specific user from file definition
 */
router.delete(
    '/file-definitions/:definitionId/users/:userId',
    FileDefinitionAdminController.removeUserFromFileDefinition
);

	/**
 * GET /api/admin/file-definitions/users/all
 * Get all available users for assignment
 */
router.get(
    '/file-definitions/users/all',
    FileDefinitionAdminController.getAllAvailableUsers
);

/**
 * Upload template file - requires multer middleware
 * POST /api/admin/file-definitions/:id/template-upload
 */
import { uploadTemplate } from '../middleware/upload.middleware';
router.post(
    '/file-definitions/:id/template-upload',
    (req: Request, res: Response, next: NextFunction) => {
        uploadTemplate.single('file')(req, res, (err: unknown) => {
            if (err) {
                const message = err instanceof Error ? err.message : 'Invalid template upload';
                return next(new BadRequestError(message));
            }
            next();
        });
    },
    FileDefinitionAdminController.uploadTemplate
);
router.delete(
    '/file-definitions/:id/template',
    FileDefinitionAdminController.removeTemplate
);

/**
 * POST /api/admin/file-definitions/analyze-example
 * Propose columns and candidate rules from an example CSV/XLSX file (multipart "file"). Nothing is stored.
 */
import { uploadExample, EXAMPLE_MAX_FILE_SIZE_BYTES } from '../middleware/upload.middleware';
import multer from 'multer';
router.post(
    '/file-definitions/analyze-example',
    (req: Request, res: Response, next: NextFunction) => {
        uploadExample.single('file')(req, res, (err: unknown) => {
            if (err) {
                const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
                    ? `Example files are limited to ${EXAMPLE_MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`
                    : err instanceof Error ? err.message : 'Invalid example file';
                return next(new BadRequestError(message));
            }
            next();
        });
    },
    FileDefinitionAdminController.analyzeExample
);



/**
 * GET /api/admin/file-definitions/users/counts
 * Get user counts for all file definitions (admin dashboard table)
 */
router.get(
    '/file-definitions/users/counts',
    FileDefinitionAdminController.getFileDefinitionUserCounts
);

/**
 * GET /api/admin/file-definitions/:id/export
 * Export file definition JSON for download
 */
router.get(
    '/file-definitions/:id/export',
    FileDefinitionAdminController.exportFileDefinition
);

/**
 * GET /api/admin/file-definitions/:id/versions
 * Version history plus the unpublished (draft) changes
 */
router.get(
    '/file-definitions/:id/versions',
    FileDefinitionAdminController.getFileDefinitionVersions
);

/**
 * POST /api/admin/file-definitions/:id/versions
 * Publish the current draft as the new active version
 * Body: { changeNote?: string }
 */
router.post(
    '/file-definitions/:id/versions',
    [body('changeNote').optional({ values: 'null' }).isString().isLength({ max: 500 })],
    validateRequest,
    FileDefinitionAdminController.publishFileDefinitionVersion
);

export default router;

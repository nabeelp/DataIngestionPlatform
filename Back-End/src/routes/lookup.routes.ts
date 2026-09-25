// =============================================================================
// Lookup Routes - reusable reference value lists
// Read: any authenticated user. Write: admins only.
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { Lookup, type ILookupInput } from '../models/Lookup.model';
import { logAction } from '../models/AuditLog.model';
import { AUDIT_ACTIONS, ENTITY_TYPES } from '../interfaces/auditLog.interface';
import type { IJwtPayload } from '../interfaces/user.interface';

const router = Router();

type AuthRequest = Request & { user?: IJwtPayload };

const validateRequest = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const first = errors.array()[0];
        return res.status(400).json({ success: false, message: first.msg, errors: errors.array() });
    }
    next();
};

const lookupBodyRules = [
    body('name')
        .isString().trim()
        .matches(/^[A-Za-z0-9_.-]{1,100}$/)
        .withMessage('Name must be 1-100 characters: letters, numbers, "_", "-" or "."'),
    body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
    body('values').isArray({ min: 1, max: 5000 }).withMessage('Provide between 1 and 5000 values'),
    body('values.*').isString().trim().isLength({ min: 1, max: 200 }).withMessage('Values must be 1-200 characters'),
];

const toInput = (req: Request): ILookupInput => ({
    name: String(req.body.name).trim(),
    description: req.body.description ? String(req.body.description).trim() : '',
    values: Array.from(new Set<string>((req.body.values as string[]).map(value => value.trim()))),
});

const isDuplicateKeyError = (error: any): boolean =>
    error?.number === 2627 || error?.number === 2601 || /UQ_Lookups_Name/.test(error?.message || '');

router.use(authenticate);

/**
 * GET /api/v1/lookups?search=
 */
router.get(
    '/',
    [query('search').optional().isString().isLength({ max: 100 })],
    validateRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const lookups = await Lookup.findAll(req.query.search as string | undefined);
            res.json({ success: true, lookups, total: lookups.length });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * POST /api/v1/lookups (admin)
 */
router.post(
    '/',
    authorize('admin'),
    lookupBodyRules,
    validateRequest,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const input = toInput(req);
            const lookup = await Lookup.create(input, req.user!.userId);
            await logAction(req.user!.userId, AUDIT_ACTIONS.LOOKUP_CREATED, ENTITY_TYPES.LOOKUP, lookup.id,
                { name: lookup.name, valueCount: lookup.values.length }, req.ip || undefined, req.headers['user-agent']);
            res.status(201).json({ success: true, lookup });
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                return res.status(409).json({ success: false, message: 'A lookup with this name already exists' });
            }
            next(error);
        }
    }
);

/**
 * PUT /api/v1/lookups/:id (admin)
 */
router.put(
    '/:id',
    authorize('admin'),
    [param('id').isUUID(), ...lookupBodyRules],
    validateRequest,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const input = toInput(req);
            const lookup = await Lookup.update(req.params.id as string, input);
            if (!lookup) {
                return res.status(404).json({ success: false, message: 'Lookup not found' });
            }
            await logAction(req.user!.userId, AUDIT_ACTIONS.LOOKUP_UPDATED, ENTITY_TYPES.LOOKUP, lookup.id,
                { name: lookup.name, valueCount: lookup.values.length }, req.ip || undefined, req.headers['user-agent']);
            res.json({ success: true, lookup });
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                return res.status(409).json({ success: false, message: 'A lookup with this name already exists' });
            }
            next(error);
        }
    }
);

/**
 * DELETE /api/v1/lookups/:id (admin)
 */
router.delete(
    '/:id',
    authorize('admin'),
    [param('id').isUUID()],
    validateRequest,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const deleted = await Lookup.delete(req.params.id as string);
            if (!deleted) {
                return res.status(404).json({ success: false, message: 'Lookup not found' });
            }
            await logAction(req.user!.userId, AUDIT_ACTIONS.LOOKUP_DELETED, ENTITY_TYPES.LOOKUP, req.params.id as string,
                undefined, req.ip || undefined, req.headers['user-agent']);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    }
);

export default router;

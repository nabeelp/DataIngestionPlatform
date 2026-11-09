// =============================================================================
// Auth Routes - Login endpoints for SSO and Password authentication
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { body, query, validationResult } from 'express-validator';
import { rateLimit } from 'express-rate-limit';
import { AuthService } from '../services/Auth.service';
import { buildAuthorizeUrl } from '../services/MicrosoftSso.service';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../utils/httpError';
import type { SsoProvider } from '../interfaces/user.interface';

const router = Router();

// Throttle credential endpoints per IP in addition to per-account lockout.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts, please try again later' },
});

const validateRequest = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

/**
 * POST /api/auth/login
 * Login with email and password
 * Body: { Email: string, Password: string }
 */
router.post(
    '/login',
    loginLimiter,
    [
        body('Email').isEmail().normalizeEmail(),
        body('Password').isLength({ min: 1 }),
    ],
    validateRequest,
    asyncHandler(async (req, res) => {
        try {
            const { Email, Password } = req.body;
            const result = await AuthService.handlePasswordLogin({ Email, Password });
            res.json(result);
        } catch (error) {
            // Every login failure is reported as 401 with the service's message.
            throw new HttpError(error instanceof Error ? error.message : 'Login failed', 401);
        }
    })
);

/**
 * POST /api/auth/sso/login
 * Complete SSO login by redeeming the authorization code
 * Body: { Provider: 'microsoft', Code: string, State: string, Session: string }
 */
router.post(
    '/sso/login',
    loginLimiter,
    [
        body('Provider').isIn(['microsoft']),
        body('Code').isString().isLength({ min: 1, max: 4096 }),
        body('State').isString().isLength({ min: 1, max: 256 }),
        body('Session').isString().isLength({ min: 1, max: 4096 }),
    ],
    validateRequest,
    asyncHandler(async (req, res) => {
        const { Provider, Code, State, Session } = req.body;
        try {
            const result = await AuthService.handleSsoLogin({
                Provider: Provider as SsoProvider,
                Code,
                State,
                Session,
            });
            res.json(result);
        } catch {
            // Details stay out of the response: provider errors can reveal token or tenant information.
            throw new HttpError('SSO login failed', 401);
        }
    })
);

/**
 * GET /api/auth/sso/url
 * Get SSO authorization URL for redirect. The client keeps `state` and `session` (not in a URL)
 * and sends them back with the authorization code.
 * Query: provider=microsoft
 */
router.get(
    '/sso/url',
    [query('provider').isIn(['microsoft'])],
    validateRequest,
    asyncHandler(async (_req, res) => {
        try {
            const { url, state, session } = buildAuthorizeUrl();
            res.json({ success: true, url, state, session });
        } catch (error) {
            // Misconfigured SSO is a 503 with the configuration message, not a server fault.
            throw new HttpError(error instanceof Error ? error.message : 'Failed to generate SSO URL', 503);
        }
    })
);

/**
 * POST /api/auth/logout
 * Logout user (client discards the token; JWTs are stateless)
 */
router.post(
    '/logout',
    authenticate,
    asyncHandler(async (_req, res) => {
        res.json({ success: true, message: 'Logged out successfully' });
    })
);

export default router;

// =============================================================================
// Auth Routes - Login endpoints for SSO and Password authentication
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { AuthService } from '../services/Auth.service';
import { User } from '../models/User.model';
import { authenticate, authorize } from '../middleware/authMiddleware';
import type { SsoProvider } from '../interfaces/user.interface';

const router = Router();

// Validation middleware
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log('[AUTH_ROUTES] Validation errors:', errors.array());
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

/**
 * POST /api/auth/login
 * Login with email and password
 * Body: { email: string, password: string }
 */
router.post(
    '/login',
    [
        body('Email').isEmail().normalizeEmail(),
        body('Password').isLength({ min: 1 }),
    ],
    validateRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        console.log('[AUTH_ROUTES] POST /login called');
        console.log('[AUTH_ROUTES] Request body:', { Email: req.body.Email, Password: '[REDACTED]' });
        
        try {
            const { Email, Password } = req.body;
            console.log('[AUTH_ROUTES] Calling AuthService.handlePasswordLogin');
            
            const result = await AuthService.handlePasswordLogin({ Email, Password });
            
            console.log('[AUTH_ROUTES] AuthService result:', { success: result.success, user: result.user });
            res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Login failed';
            console.error('[AUTH_ROUTES] Login error:', error);
            res.status(401).json({ success: false, message });
        }
    }
);

/**
 * POST /api/auth/sso/login
 * Login with SSO provider
 * Body: { provider: 'microsoft', accessToken: string, idToken?: string }
 */
router.post(
    '/sso/login',
    [
        body('Provider').isIn(['microsoft']),
        body('AccessToken').isLength({ min: 1 }),
    ],
    validateRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        console.log('[AUTH_ROUTES] POST /sso/login called');
        console.log('[AUTH_ROUTES] SSO Provider:', req.body.Provider);
        
        try {
            const { Provider, AccessToken, IdToken } = req.body;
            console.log('[AUTH_ROUTES] Calling AuthService.handleSsoLogin');
            
            const result = await AuthService.handleSsoLogin({
                Provider: Provider as SsoProvider,
                AccessToken,
                IdToken,
            });
            
            console.log('[AUTH_ROUTES] SSO AuthService result:', { success: result.success, user: result.user });
            res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'SSO login failed';
            console.error('[AUTH_ROUTES] SSO login error:', error);
            res.status(401).json({ success: false, message });
        }
    }
);

/**
 * POST /api/auth/refresh
 * Refresh JWT token
 * Headers: Authorization: Bearer <token>
 */
router.post(
    '/refresh',
    async (req: Request, res: Response, next: NextFunction) => {
        console.log('[AUTH_ROUTES] POST /refresh called');
        
        try {
            const authHeader = req.headers.authorization;
            console.log('[AUTH_ROUTES] Authorization header present:', !!authHeader);
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.log('[AUTH_ROUTES] No token provided');
                return res.status(401).json({ success: false, message: 'No token provided' });
            }

            const token = authHeader.substring(7);
            console.log('[AUTH_ROUTES] Calling AuthService.refreshToken');
            
            const result = await AuthService.refreshToken(token);
            
            console.log('[AUTH_ROUTES] Refresh result:', { success: result.success });
            res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Token refresh failed';
            console.error('[AUTH_ROUTES] Refresh error:', error);
            res.status(401).json({ success: false, message });
        }
    }
);

/**
 * GET /api/auth/sso/url
 * Get SSO authorization URL for redirect
 * Query: provider=microsoft
 */
router.get(
    '/sso/url',
    async (req: Request, res: Response, next: NextFunction) => {
        console.log('[AUTH_ROUTES] GET /sso/url called');
        console.log('[AUTH_ROUTES] Query params:', req.query);
        
        try {
            const { provider } = req.query;
            
            console.log('[AUTH_ROUTES] Requested provider:', provider);
            
            if (!provider || !['microsoft'].includes(provider as string)) {
                console.log('[AUTH_ROUTES] Invalid provider:', provider);
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid provider. Must be microsoft' 
                });
            }

            // Generate the appropriate OAuth URL based on provider
            let authUrl = '';
            
            switch (provider) {
                case 'microsoft':
                    const msConfig = {
                        clientId: process.env.MS_CLIENT_ID,
                        redirectUri: process.env.MS_REDIRECT_URI || 'http://localhost:5173/auth/callback',
                        scope: 'openid profile email User.Read',
                        responseType: 'code',
                        responseMode: 'query',
                    };
                    authUrl = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/authorize?` +
                        `client_id=${msConfig.clientId}&` +
                        `redirect_uri=${encodeURIComponent(msConfig.redirectUri)}&` +
                        `scope=${encodeURIComponent(msConfig.scope)}&` +
                        `response_type=${msConfig.responseType}&` +
                        `response_mode=${msConfig.responseMode}`;
                    break;
            }

            console.log('[AUTH_ROUTES] Generated auth URL (first 50 chars):', authUrl.substring(0, 50));
            res.json({ success: true, url: authUrl });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to generate SSO URL';
            console.error('[AUTH_ROUTES] SSO URL error:', error);
            res.status(500).json({ success: false, message });
        }
    }
);

/**
 * POST /api/auth/register
 * Register new user with password (admin only in production)
 * Body: { email, username, password, firstName?, lastName?, role? }
 */
router.post(
    '/register',
    [
        body('Email').isEmail().normalizeEmail(),
        body('Username').isLength({ min: 3, max: 50 }),
        body('Password').isLength({ min: 8 }),
        body('FirstName').optional().isLength({ max: 100 }),
        body('LastName').optional().isLength({ max: 100 }),
        body('Role').optional().isIn(['admin', 'user']),
    ],
    validateRequest,
    authenticate,
    authorize('admin'),
    async (req: Request, res: Response, next: NextFunction) => {
        console.log('[AUTH_ROUTES] POST /register called');
        
        try {
            const { Email, Username, Password, FirstName, LastName, Role } = req.body;
            console.log('[AUTH_ROUTES] Registration attempt for:', Email);

            // Check if user already exists
            const existingUser = await User.findByEmail(Email);
            if (existingUser) {
                console.log('[AUTH_ROUTES] User already exists:', Email);
                return res.status(400).json({ 
                    success: false, 
                    message: 'User with this email already exists' 
                });
            }

            // Hash password and create user
            const passwordHash = await AuthService.hashPassword(Password);
            
            const user = await User.create({
                Email,
                Username,
                Password: passwordHash,
                FirstName,
                LastName,
                Role: Role || 'user',
                IsPasswordAuthEnabled: true,
                IsSsoAuthEnabled: false,
            });

            console.log('[AUTH_ROUTES] User registered successfully:', user.Email);
            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                user: AuthService.formatUserResponse(user, 'password'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Registration failed';
            console.error('[AUTH_ROUTES] Registration error:', error);
            res.status(500).json({ success: false, message });
        }
    }
);

/**
 * POST /api/auth/logout
 * Logout user (client should discard token)
 * Requires authentication
 */
router.post(
    '/logout',
    authenticate,
    async (req: Request, res: Response, next: NextFunction) => {
        console.log('[AUTH_ROUTES] POST /logout called');
        
        // In a more complete implementation, you might want to:
        // 1. Add token to a blacklist
        // 2. Clear any server-side sessions
        // For now, we just acknowledge the logout request
        
        console.log('[AUTH_ROUTES] Logout successful');
        res.json({ success: true, message: 'Logged out successfully' });
    }
);

export default router;


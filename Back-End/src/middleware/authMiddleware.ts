// =============================================================================
// Authentication Middleware - Protects routes using JWT
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import type { UserRole } from '../interfaces/user.interface';

// Extend Express Request type to include user
export interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
        role: UserRole;
        loginMethod: string;
    };
}

// Development-only mock users (DEV_BYPASS_AUTH=true with NODE_ENV=development). IDs match seed_local_users.sql.
const MOCK_TOKEN_USERS: Record<string, { userId: string; email: string; role: UserRole; loginMethod: string }> = {
    '63BD96E4-1229-4399-8964-0795E50B3574': {
        userId: '63BD96E4-1229-4399-8964-0795E50B3574',
        email: 'admin@company.com',
        role: 'admin',
        loginMethod: 'password',
    },
    '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA': {
        userId: '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA',
        email: 'user@company.com',
        role: 'user',
        loginMethod: 'password',
    },
};

/**
 * Check if token is a mock token (for development only)
 */
const parseMockToken = (token: string): { userId: string; email: string; role: UserRole; loginMethod: string } | null => {
    // Format: mock_token_{userId}_{timestamp}
    if (token.startsWith('mock_token_')) {
        const parts = token.split('_');
        if (parts.length >= 3) {
            const userId = parts[2];
            const mockUser = MOCK_TOKEN_USERS[userId];
            if (mockUser) {
                return mockUser;
            }
        }
    }
    return null;
};

export type AuthenticatedUser = NonNullable<AuthRequest['user']>;

const isDevBypassEnabled = (): boolean =>
    appConfig.nodeEnv === 'development' && process.env.DEV_BYPASS_AUTH === 'true';

/**
 * Verify an access token (app JWT, or a mock token when the development bypass is enabled).
 * Throws when the token is missing, malformed, expired, or has an invalid signature.
 */
export function verifyAccessToken(token: string | undefined | null): AuthenticatedUser {
    if (!token) {
        throw new Error('No token provided');
    }

    if (token.startsWith('mock_token_')) {
        const mockUser = isDevBypassEnabled() ? parseMockToken(token) : null;
        if (!mockUser) {
            throw new Error('Mock tokens are only accepted when DEV_BYPASS_AUTH is enabled in development');
        }
        return mockUser;
    }

    const decoded = jwt.verify(token, appConfig.jwt.secret, { algorithms: ['HS256'] }) as AuthenticatedUser;
    if (!decoded?.userId || !decoded.role) {
        throw new Error('Token is missing required claims');
    }
    return { userId: decoded.userId, email: decoded.email, role: decoded.role, loginMethod: decoded.loginMethod };
}

/**
 * Middleware to verify JWT token and protect routes
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            success: false, 
            message: 'No token provided'
        });
    }

    try {
        (req as AuthRequest).user = verifyAccessToken(authHeader.substring(7));
        return next();
    } catch (error) {
        logger.warn(`[AUTH] Rejected token: ${error instanceof Error ? error.message : 'unknown error'}`);
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid or expired token' 
        });
    }
};

/**
 * Middleware to check if user has required role
 */
export const authorize = (...allowedRoles: UserRole[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const authReq = req as AuthRequest;
        
        if (!authReq.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        if (!allowedRoles.includes(authReq.user.role)) {
            logger.warn(`User ${authReq.user.email} attempted to access restricted route`);
            return res.status(403).json({ 
                success: false, 
                message: 'Insufficient permissions' 
            });
        }

        next();
    };
};

/**
 * Optional authentication - attaches user if token exists but doesn't require it
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            (req as AuthRequest).user = verifyAccessToken(authHeader.substring(7));
        } catch {
            // Invalid token - continue without user (optional auth)
        }
    }
    next();
};

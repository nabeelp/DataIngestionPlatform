// =============================================================================
// Authentication Middleware - Protects routes using JWT
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import type { LoginMethod, UserRole } from '../interfaces/user.interface';
import { isMockToken, verifyMockToken } from '../dev/mockAuth';

export interface AuthenticatedUser {
    userId: string;
    email: string;
    role: UserRole;
    loginMethod: LoginMethod;
}

/**
 * Verify an access token (app JWT, or a mock token when the development bypass is enabled).
 * Throws when the token is missing, malformed, expired, or has an invalid signature.
 */
export function verifyAccessToken(token: string | undefined | null): AuthenticatedUser {
    if (!token) {
        throw new Error('No token provided');
    }

    if (isMockToken(token)) {
        return verifyMockToken(token);
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
        req.user = verifyAccessToken(authHeader.substring(7));
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
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            logger.warn(`User ${req.user.email} attempted to access restricted route`);
            return res.status(403).json({ 
                success: false, 
                message: 'Insufficient permissions' 
            });
        }

        next();
    };
};

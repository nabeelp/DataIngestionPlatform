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

// Mock token users for development - these IDs must match frontend hardcoded users
const MOCK_TOKEN_USERS: Record<string, { userId: string; email: string; role: UserRole; loginMethod: string }> = {
    // Frontend hardcoded IDs (from AuthContext.tsx) - OLD IDs that align with database
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
    console.log('[AUTH] parseMockToken called with token:', token);
    
    // Format: mock_token_{userId}_{timestamp}
    if (token.startsWith('mock_token_')) {
        const parts = token.split('_');
        console.log('[AUTH] Token parts:', parts);
        if (parts.length >= 3) {
            const userId = parts[2];
            console.log('[AUTH] Extracted userId:', userId);
            console.log('[AUTH] MOCK_TOKEN_USERS keys:', Object.keys(MOCK_TOKEN_USERS));
            const mockUser = MOCK_TOKEN_USERS[userId];
            console.log('[AUTH] Found mockUser:', mockUser);
            if (mockUser) {
                return mockUser;
            }
        }
    }
    return null;
};

/**
 * Middleware to verify JWT token and protect routes
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger.warn('No token provided');
            return res.status(401).json({ 
                success: false, 
                message: 'No token provided' 
            });
        }

        const token = authHeader.substring(7);
        
        console.log('[AUTH] Received token:', token);
        
        // First check if it's a mock token (development mode)
        if (token.startsWith('mock_token_')) {
            const mockUser = parseMockToken(token);
            if (mockUser) {
                logger.info(`[AUTH] Mock token accepted for user: ${mockUser.email}`);
                (req as AuthRequest).user = mockUser;
                return next();
            }
        }
        
        // Check if token is a valid JWT format (has 2 dots)
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
            // Verify the JWT token
            const decoded = jwt.verify(token, appConfig.jwt.secret) as {
                userId: string;
                email: string;
                role: UserRole;
                loginMethod: string;
            };

            // Attach user to request
            (req as AuthRequest).user = decoded;
            return next();
        }
        
        // Token format not recognized
        logger.warn('Invalid token format:', token);
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid token format' 
        });
    } catch (error) {
        logger.error('Authentication error:', error);
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
    try {
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, appConfig.jwt.secret) as {
                userId: string;
                email: string;
                role: UserRole;
                loginMethod: string;
            };
            (req as AuthRequest).user = decoded;
        }
        
        next();
    } catch (error) {
        // Token invalid - continue without user (optional auth)
        next();
    }
};


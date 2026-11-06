// =============================================================================
// Development-only mock authentication (DEV_BYPASS_AUTH=true with NODE_ENV=development)
// The users match Back-End/database/local/seed_local_users.sql. Nothing here is reachable in other environments.
// =============================================================================

import { appConfig } from '../config/appConfig';
import type { AuthenticatedUser } from '../middleware/authMiddleware';

const MOCK_TOKEN_PREFIX = 'mock_token_';

const MOCK_USERS: Record<string, AuthenticatedUser> = {
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

export const isMockToken = (token: string): boolean => token.startsWith(MOCK_TOKEN_PREFIX);

export const isDevBypassEnabled = (): boolean =>
    appConfig.nodeEnv === 'development' && process.env.DEV_BYPASS_AUTH === 'true';

/**
 * Resolves a mock token (`mock_token_{userId}_{timestamp}`) to a seeded user.
 * Throws unless the bypass is enabled and the token names a known user.
 */
export function verifyMockToken(token: string): AuthenticatedUser {
    const userId = isDevBypassEnabled() ? token.split('_')[2] : undefined;
    const mockUser = userId ? MOCK_USERS[userId] : undefined;
    if (!mockUser) {
        throw new Error('Mock tokens are only accepted when DEV_BYPASS_AUTH is enabled in development');
    }
    return mockUser;
}

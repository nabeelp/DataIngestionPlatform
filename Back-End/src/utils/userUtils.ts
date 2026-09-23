// =============================================================================
// User Utilities - Helper functions for user authentication and authorization
// =============================================================================

import { getConnection } from '../config/database';

// Known mock user IDs from frontend (hardcoded in AuthContext.tsx) - OLD IDs that align with database
const KNOWN_MOCK_ADMIN_IDS = [
    '63BD96E4-1229-4399-8964-0795E50B3574', // admin@company.com (old)
];

const KNOWN_MOCK_USER_IDS = [
    '63BD96E4-1229-4399-8964-0795E50B3574', // admin@company.com
    '1C5E6A9B-BF1F-40E8-99DA-7893A8960CBA', // user@company.com (old)
];

/**
 * Check if a user ID is a known mock admin ID
 */
export function isKnownMockAdminUser(userId: string): boolean {
    return KNOWN_MOCK_ADMIN_IDS.includes(userId);
}

/**
 * Check if a user ID is a known mock user ID
 */
export function isKnownMockUser(userId: string): boolean {
    return KNOWN_MOCK_USER_IDS.includes(userId);
}

/**
 * Check if user is an admin by looking up in Users table or checking known mock IDs
 * Returns true if user is admin, false otherwise
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
    // First check if it's a known mock admin user
    if (isKnownMockAdminUser(userId)) {
        return true;
    }

    // If not a known mock user, check the database
    try {
        const pool = await getConnection();
        const userResult = await pool.request()
            .input('UserId', userId)
            .query(`SELECT Role FROM Users WHERE Id = @UserId`);
        
        return userResult.recordset[0]?.Role === 'admin';
    } catch (error) {
        // If database query fails (table doesn't exist or other error), 
        // check if it's a known mock user
        console.warn('[USER_UTILS] Database query failed for user role check:', error);
        return isKnownMockAdminUser(userId);
    }
}

/**
 * Get user role from database or return default for mock users
 * Returns 'admin' for admin users, 'user' for regular users
 */
export async function getUserRole(userId: string): Promise<string> {
    // Check if it's a known mock admin
    if (isKnownMockAdminUser(userId)) {
        return 'admin';
    }

    // Check if it's a known mock user (non-admin)
    if (isKnownMockUser(userId)) {
        return 'user';
    }

    // Query database for user role
    try {
        const pool = await getConnection();
        const userResult = await pool.request()
            .input('UserId', userId)
            .query(`SELECT Role FROM Users WHERE Id = @UserId`);
        
        return userResult.recordset[0]?.Role || 'user';
    } catch (error) {
        console.warn('[USER_UTILS] Database query failed for user role:', error);
        // Default to 'user' if database query fails
        return 'user';
    }
}


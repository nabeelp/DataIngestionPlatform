// =============================================================================
// User Utilities - role lookups for authorization decisions
// =============================================================================

import { getConnection } from '../config/database';
import { logger } from './logger';

/**
 * Look up a user's role in the Users table. Returns null when the user does not exist.
 */
async function findRole(userId: string): Promise<string | null> {
    const pool = await getConnection();
    const result = await pool.request()
        .input('UserId', userId)
        .query(`SELECT Role FROM Users WHERE Id = @UserId`);
    return result.recordset[0]?.Role ?? null;
}

/**
 * True when the user is an admin in the Users table. Fails closed if the lookup errors.
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
    try {
        return (await findRole(userId)) === 'admin';
    } catch (error) {
        logger.warn('[USER_UTILS] Role lookup failed; treating user as non-admin', error);
        return false;
    }
}

/**
 * The user's role ('admin' or 'user'). Defaults to 'user' if the user is unknown or the lookup fails.
 */
export async function getUserRole(userId: string): Promise<string> {
    try {
        return (await findRole(userId)) || 'user';
    } catch (error) {
        logger.warn('[USER_UTILS] Role lookup failed; defaulting to user role', error);
        return 'user';
    }
}

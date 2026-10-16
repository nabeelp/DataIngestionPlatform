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

// =============================================================================
// Database Configuration - MSSQL Connection Pool
// =============================================================================

import mssql from 'mssql';
import { appConfig } from './appConfig';

// Database connection pool
let pool: mssql.ConnectionPool | null = null;

/**
 * Get database connection pool
 * Creates a new pool if one doesn't exist
 */
export async function getConnection(): Promise<mssql.ConnectionPool> {
    if (pool && pool.connected) {
        return pool;
    }

    try {
        pool = await mssql.connect(appConfig.database.connectionString);

        console.log('Database connected successfully');
        return pool;
    } catch (error) {
        console.error('Database connection failed:', error);
        throw error;
    }
}

/**
 * Close database connection pool
 */
export async function closeConnection(): Promise<void> {
    if (pool) {
        await pool.close();
        pool = null;
        console.log('Database connection closed');
    }
}

// Export the pool type for type safety
export type DatabasePool = mssql.ConnectionPool;


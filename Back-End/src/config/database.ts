// =============================================================================
// Database Configuration - MSSQL Connection Pool
// =============================================================================

import mssql from 'mssql';
import { appConfig } from './appConfig';
import { logger } from '../utils/logger';

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

    if (!appConfig.database.connectionString) {
        throw new Error('DB_CONNECTION_STRING is required to use the database');
    }

    try {
        const connectionString = appConfig.database.connectionString;
        const localDb = /^Server=((?:\(localdb\))\\[^;]+);Database=([^;]+);Integrated Security=true;?$/i.exec(connectionString);
        if (connectionString.toLowerCase().includes('(localdb)') && !localDb) {
            throw new Error('LocalDB requires Server=(localdb)\\MSSQLLocalDB;Database=<database>;Integrated Security=true');
        }

        if (localDb) {
            const driver = await import('mssql/msnodesqlv8');
            pool = await driver.connect({
                server: localDb[1],
                database: localDb[2],
                driver: 'ODBC Driver 17 for SQL Server',
                options: { trustedConnection: true },
            });
        } else {
            pool = await mssql.connect(connectionString);
        }

        logger.debug('Database connected successfully');
        return pool;
    } catch (error) {
        logger.error('Database connection failed:', error);
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
        logger.debug('Database connection closed');
    }
}

// Export the pool type for type safety
export type DatabasePool = mssql.ConnectionPool;

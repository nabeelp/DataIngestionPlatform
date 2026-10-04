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

    const { connectionString, server, database } = appConfig.database;
    if (!connectionString && (!server || !database)) {
        throw new Error('Configure DB_CONNECTION_STRING or both DB_SERVER and DB_DATABASE.');
    }

    try {
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
        } else if (connectionString) {
            pool = await mssql.connect(connectionString);
        } else {
            pool = await mssql.connect({
                server,
                database,
                authentication: {
                    type: 'azure-active-directory-default',
                    options: {},
                },
                options: { encrypt: true, trustServerCertificate: false },
            });
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

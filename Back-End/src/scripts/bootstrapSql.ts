import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sql from 'mssql';
import { logger } from '../utils/logger';
import { inspectResetDatabase, parseResetOptions, resetBlobClient, resetBlobs, resetDatabase } from './resetApplicationData';

const schemaScripts = [
    '001_users.sql',
    '002_file_definitions.sql',
    '003_lookups.sql',
    '004_uploads.sql',
    '005_file_definition_versions.sql',
    '006_audit_logs.sql',
];

const requiredEnvironment = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

export function splitSqlBatches(script: string): string[] {
    return script
        .split(/^[ \t]*GO(?:[ \t]+\d+)?[ \t]*(?:--.*)?$/gim)
        .map(batch => batch.trim())
        .filter(Boolean);
}

export function expandSqlCmdVariables(
    script: string,
    variables: Record<string, string>,
): string {
    const safeVariables = Object.entries(variables).map(([name, value]) => {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
            throw new Error(`Invalid SQL script variable name: ${name}`);
        }
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
            throw new Error(`Invalid SQL principal name for ${name}`);
        }
        return [`$(${name})`, value] as const;
    });

    const expanded = safeVariables.reduce(
        (result, [token, value]) => result.split(token).join(value),
        script,
    );
    if (/\$\([A-Za-z][A-Za-z0-9_]*\)/.test(expanded)) {
        throw new Error('SQL grant script contains an unresolved variable.');
    }
    return expanded;
}

function errorWithCause(message: string, cause: unknown): Error {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(`${message} Cause: ${causeMessage}`);
    Object.defineProperty(error, 'cause', { value: cause, configurable: true });
    return error;
}

function requireGuid(name: string): string {
    const value = requiredEnvironment(name);
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
        throw new Error(`${name} must be a Microsoft Entra GUID.`);
    }
    return value;
}

async function executeScript(request: () => sql.Request, filePath: string): Promise<void> {
    const source = await readFile(filePath, 'utf8');
    for (const [index, batch] of splitSqlBatches(source).entries()) {
        try {
            await request().batch(batch);
        } catch (error) {
            throw errorWithCause(
                `Failed to execute SQL batch ${index + 1} in ${path.basename(filePath)}.`,
                error,
            );
        }
    }
}

export async function applySchemaScripts(request: () => sql.Request): Promise<void> {
    const directory = path.resolve(__dirname, '../../database');
    for (const name of schemaScripts) {
        await executeScript(request, path.join(directory, name));
    }
}

async function connectToDatabase(): Promise<sql.ConnectionPool> {
    const config: sql.config = {
        server: requiredEnvironment('DB_SERVER'),
        database: requiredEnvironment('DB_DATABASE'),
        authentication: {
            type: 'azure-active-directory-default',
            options: {},
        },
        options: {
            encrypt: true,
            trustServerCertificate: false,
        },
        connectionTimeout: 30_000,
        requestTimeout: 120_000,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= 9; attempt++) {
        const pool = new sql.ConnectionPool(config);
        try {
            return await pool.connect();
        } catch (error) {
            lastError = error;
            try {
                await pool.close();
            } catch (closeError) {
                logger.error('Failed to close an unsuccessful SQL connection pool:', closeError);
            }
            if (attempt < 9) {
                logger.warn(`Azure SQL connection attempt ${attempt} failed; retrying in 10 seconds.`);
                await new Promise(resolve => setTimeout(resolve, 10_000));
            }
        }
    }

    throw errorWithCause('Could not connect to Azure SQL after nine attempts.', lastError);
}

async function bootstrapDatabase(): Promise<void> {
    const databaseDirectory = path.resolve(__dirname, '../../database');
    const reset = parseResetOptions(process.argv.slice(2), requiredEnvironment('DB_DATABASE'));
    const pool = await connectToDatabase();
    try {
        if (reset) {
            const counts = await inspectResetDatabase(() => pool.request(), reset.expectedUsers);
            const blobs = resetBlobClient(reset.storageAccountUrl);
            const blobCounts = await resetBlobs(blobs, false);
            logger.info(`Reset inventory (no user data): ${JSON.stringify({ tables: counts, containers: blobCounts })}`);
            if (!reset.execute) return;
            await resetDatabase(pool, reset.expectedUsers, applySchemaScripts);
            await resetBlobs(blobs, true);
            logger.info('Application data reset verified; Users preserved.');
        } else {
            await applySchemaScripts(() => pool.request());
        }

        const grantScript = await readFile(
            path.join(databaseDirectory, 'grant-managed-identities.sql'),
            'utf8',
        );
        const expandedGrantScript = expandSqlCmdVariables(grantScript, {
            ApiIdentityName: requiredEnvironment('API_IDENTITY_NAME'),
            ApiIdentityClientId: requireGuid('API_IDENTITY_CLIENT_ID'),
            WorkerIdentityName: requiredEnvironment('WORKER_IDENTITY_NAME'),
            WorkerIdentityClientId: requireGuid('WORKER_IDENTITY_CLIENT_ID'),
        });
        for (const [index, batch] of splitSqlBatches(expandedGrantScript).entries()) {
            try {
                await pool.request().batch(batch);
            } catch (error) {
                throw errorWithCause(`Failed to execute managed-identity grant batch ${index + 1}.`, error);
            }
        }
    } finally {
        await pool.close();
    }
}

if (require.main === module) {
    void bootstrapDatabase().catch(error => {
        logger.error('Azure SQL bootstrap failed:', error);
        process.exitCode = 1;
    });
}

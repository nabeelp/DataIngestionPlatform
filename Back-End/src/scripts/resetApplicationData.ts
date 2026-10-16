import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { logger } from '../utils/logger';

export const resetTables = [
    'ValidationRuleDetails', 'ValidationResults', 'DeliveryRecords',
    'UploadSheets', 'UploadTasks', 'UploadAccess', 'Uploads',
    'FileDefinitionUserAccess', 'FileDefinitionVersions', 'Rules',
    'Lookups', 'AuditLogs', 'FileDefinitions',
] as const;

export const resetContainers = ['uploads', 'reports', 'templates', 'staging', 'deliveries'] as const;

interface ResetBlobStore {
    getContainerClient(name: string): {
        listBlobsFlat(options: { includeSnapshots: true }): AsyncIterable<{ name: string }>;
        getBlobClient(name: string): {
            deleteIfExists(options: { deleteSnapshots: 'include' }): Promise<unknown>;
        };
    };
}

export interface ResetOptions {
    execute: boolean;
    database: string;
    expectedUsers: number;
    storageAccountUrl: string;
}

export function parseResetOptions(args: string[], database: string): ResetOptions | undefined {
    if (args.length === 0) return undefined;
    const [mode, confirmedDatabase, expectedUsers, storageAccountUrl] = args;
    if (!['inspect-reset', 'reset-application-data'].includes(mode) ||
        args.length !== 4 || confirmedDatabase !== database ||
        !/^[1-9]\d*$/.test(expectedUsers) || !Number.isSafeInteger(Number(expectedUsers)) ||
        !/^https:\/\/[a-z0-9]{3,24}\.blob\.core\.windows\.net\/?$/.test(storageAccountUrl)) {
        throw new Error('Reset requires: inspect-reset|reset-application-data <matching database> <positive expected users> <Azure storage account URL>.');
    }
    return {
        execute: mode === 'reset-application-data',
        database,
        expectedUsers: Number(expectedUsers),
        storageAccountUrl,
    };
}

export function validateResetInventory(tables: { schemaName: string; name: string }[]): void {
    const expected = new Set<string>(['Users', ...resetTables]);
    if (tables.length !== expected.size ||
        tables.some(table => table.schemaName !== 'dbo' || !expected.delete(table.name)) ||
        expected.size !== 0) {
        throw new Error('Unexpected database table inventory; reset refused.');
    }
}

export async function inspectResetDatabase(
    request: () => sql.Request,
    expectedUsers: number,
): Promise<Record<string, number>> {
    const tables = await request().query<{ schemaName: string; name: string }>(`
        SELECT SCHEMA_NAME(schema_id) AS schemaName, name
        FROM sys.tables WHERE is_ms_shipped = 0;
    `);
    validateResetInventory(tables.recordset);
    const counts: Record<string, number> = {};
    for (const name of ['Users', ...resetTables]) {
        const result = await request().query<{ count: number }>(
            `SELECT COUNT_BIG(*) AS count FROM dbo.[${name}];`,
        );
        counts[name] = Number(result.recordset[0].count);
    }
    if (counts.Users !== expectedUsers) {
        throw new Error('User count changed; reset refused.');
    }
    const foreignKeys = await request().query<{ child: string; parent: string }>(`
        SELECT OBJECT_NAME(parent_object_id) AS child,
               OBJECT_NAME(referenced_object_id) AS parent FROM sys.foreign_keys;
    `);
    const order = new Map<string, number>(resetTables.map((name, index) => [name, index]));
    for (const key of foreignKeys.recordset) {
        if (key.parent !== 'Users' &&
            (key.child === 'Users' || (order.get(key.child) ?? -1) >= (order.get(key.parent) ?? -1))) {
            throw new Error('Unexpected foreign-key dependency; reset refused.');
        }
    }
    return counts;
}

export async function resetDatabase(
    pool: sql.ConnectionPool,
    expectedUsers: number,
    applySchema: (request: () => sql.Request) => Promise<void>,
): Promise<void> {
    const transaction = new sql.Transaction(pool);
    let rolledBack = false;
    transaction.on('rollback', () => { rolledBack = true; });
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
        const request = () => new sql.Request(transaction);
        await request().batch(`
            SET XACT_ABORT ON;
            SELECT * INTO #PreservedResetUsers FROM dbo.Users WITH (TABLOCKX, HOLDLOCK);
        `);
        await inspectResetDatabase(request, expectedUsers);
        for (const table of resetTables) {
            await request().batch(`DELETE FROM dbo.[${table}];`);
        }
        await applySchema(request);
        await request().batch(`
            IF CONVERT(VARBINARY(MAX), (
                SELECT * FROM #PreservedResetUsers ORDER BY Id FOR JSON PATH, INCLUDE_NULL_VALUES
            )) <> CONVERT(VARBINARY(MAX), (
                SELECT * FROM dbo.Users ORDER BY Id FOR JSON PATH, INCLUDE_NULL_VALUES
            ))
                THROW 51100, 'User rows changed during reset.', 1;
            DROP TABLE #PreservedResetUsers;
            IF COL_LENGTH(N'dbo.FileDefinitionVersions', N'DefinitionMetadata') IS NULL
                OR COL_LENGTH(N'dbo.Uploads', N'CompressedFileSize') IS NOT NULL
                OR COL_LENGTH(N'dbo.Uploads', N'CompressedBlobUrl') IS NOT NULL
                OR COL_LENGTH(N'dbo.Uploads', N'DeliveryJobId') IS NOT NULL
                OR COL_LENGTH(N'dbo.Uploads', N'ProcessingNode') IS NOT NULL
                THROW 51101, 'Reset schema verification failed.', 1;
        `);
        const counts = await inspectResetDatabase(request, expectedUsers);
        if (resetTables.some(table => counts[table] !== 0)) {
            throw new Error('Application rows remain after reset.');
        }
        await transaction.commit();
    } catch (error) {
        if (!rolledBack) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                logger.error('Reset rollback failed; verify SQL state before retrying:', rollbackError);
            }
        }
        throw error;
    }
}

export async function resetBlobs(
    client: ResetBlobStore,
    execute: boolean,
): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const name of resetContainers) {
        const container = client.getContainerClient(name);
        const blobs = new Set<string>();
        for await (const blob of container.listBlobsFlat({ includeSnapshots: true })) {
            blobs.add(blob.name);
        }
        counts[name] = blobs.size;
        if (execute) {
            for (const blob of blobs) {
                await container.getBlobClient(blob).deleteIfExists({ deleteSnapshots: 'include' });
            }
            let remaining = 0;
            for await (const blob of container.listBlobsFlat({ includeSnapshots: true })) {
                if (blob.name) remaining++;
            }
            if (remaining !== 0) throw new Error(`Application blobs remain in ${name}; cleanup incomplete.`);
        }
    }
    return counts;
}

export function resetBlobClient(url: string): BlobServiceClient {
    return new BlobServiceClient(url, new DefaultAzureCredential());
}

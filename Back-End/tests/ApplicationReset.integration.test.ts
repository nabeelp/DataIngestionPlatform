import sql from 'mssql';
import { applySchemaScripts } from '../src/scripts/bootstrapSql';
import { inspectResetDatabase, resetDatabase } from '../src/scripts/resetApplicationData';

const connection = process.env.RESET_TEST_SQL_CONNECTION_STRING;
const describeSql = connection ? describe : describe.skip;

describeSql('reset against an isolated SQL Server database', () => {
    jest.setTimeout(90_000);
    const database = `ResetVerification_${Date.now()}`;
    let admin: sql.ConnectionPool;
    let pool: sql.ConnectionPool;
    let users: unknown[];

    beforeAll(async () => {
        if (!connection) throw new Error('Missing local reset test connection.');
        admin = await new sql.ConnectionPool(connection).connect();
        const server = await admin.request().query<{ edition: number; databaseName: string }>(
            "SELECT SERVERPROPERTY('EngineEdition') AS edition, DB_NAME() AS databaseName",
        );
        if (server.recordset[0].edition === 5 || server.recordset[0].databaseName !== 'master') {
            throw new Error('Reset verification requires a local SQL Server master connection, not Azure SQL.');
        }
        await admin.request().batch(`CREATE DATABASE [${database}];`);
        pool = await new sql.ConnectionPool({ ...sql.ConnectionPool.parseConnectionString(connection), database }).connect();
        await applySchemaScripts(() => pool.request());
        await pool.request().batch(`
            INSERT dbo.Users(Id, Email, Username, PasswordHash, Role, IsPasswordAuthEnabled)
            VALUES (N'admin', N'admin@example.invalid', N'Admin', N'preserved-hash', N'admin', 1);
            INSERT dbo.Users(Id, Email, Username, SsoProvider, SsoSubjectId, IsSsoAuthEnabled)
            VALUES (N'user', N'user@example.invalid', N'User', N'microsoft', N'preserved-subject', 1);
        `);
        users = (await pool.request().query('SELECT * FROM dbo.Users ORDER BY Id')).recordset;
    });

    afterAll(async () => {
        if (pool) await pool.close();
        if (admin) {
            if (/^ResetVerification_\d+$/.test(database)) {
                await admin.request().batch(`IF DB_ID(N'${database}') IS NOT NULL DROP DATABASE [${database}];`);
            }
            await admin.close();
        }
    });

    const seed = () => pool.request().batch(`
        INSERT dbo.FileDefinitions(Id, Name) VALUES (N'definition', N'Disposable');
        INSERT dbo.FileDefinitionVersions(Id, FileDefinitionId, VersionNumber, Status, Contract)
        SELECT N'version', Id, 1, N'Active', Contract FROM dbo.FileDefinitions WHERE Id = N'definition';
        INSERT dbo.FileDefinitionUserAccess(Id, FileDefinitionId, UserId) VALUES (N'access', N'definition', N'user');
        INSERT dbo.AuditLogs(Id, UserId, Action) VALUES (N'audit', N'admin', N'Test');
    `);

    it('inspects without mutation and refuses a mismatched user count', async () => {
        await seed();
        expect(await inspectResetDatabase(() => pool.request(), 2)).toMatchObject({ Users: 2, FileDefinitions: 1 });
        await expect(resetDatabase(pool, 1, applySchemaScripts)).rejects.toThrow('User count');
        expect((await pool.request().query('SELECT COUNT(*) AS n FROM dbo.FileDefinitions')).recordset[0].n).toBe(1);
    });

    it('rolls back row deletion and schema changes when migration fails', async () => {
        await expect(resetDatabase(pool, 2, async request => {
            await request().batch('ALTER TABLE dbo.FileDefinitions ADD FailedMigration INT NULL;');
            throw new Error('migration failed');
        })).rejects.toThrow('migration failed');
        const result = await pool.request().query(`
            SELECT COUNT(*) AS n, COL_LENGTH(N'dbo.FileDefinitions', N'FailedMigration') AS failedColumn
            FROM dbo.FileDefinitions;
        `);
        expect(result.recordset[0]).toEqual({ n: 1, failedColumn: null });
    });

    it('rejects user mutation and rolls everything back', async () => {
        await expect(resetDatabase(pool, 2, async request => {
            await request().batch("UPDATE dbo.Users SET Role = N'admin' WHERE Id = N'user';");
        })).rejects.toThrow('User rows changed');
        expect((await pool.request().query('SELECT * FROM dbo.Users ORDER BY Id')).recordset).toEqual(users);
    });

    it('rejects case-only user mutations even with a case-insensitive database collation', async () => {
        await expect(resetDatabase(pool, 2, async request => {
            await request().batch("UPDATE dbo.Users SET Username = N'USER' WHERE Id = N'user';");
        })).rejects.toThrow('User rows changed');
        expect((await pool.request().query('SELECT * FROM dbo.Users ORDER BY Id')).recordset).toEqual(users);
    });

    it('migrates the previous schema, preserves every user field and permits safe reruns', async () => {
        await pool.request().batch(`
            ALTER TABLE dbo.FileDefinitionVersions DROP CONSTRAINT CK_FileDefinitionVersions_MetadataJson;
            ALTER TABLE dbo.FileDefinitionVersions DROP COLUMN DefinitionMetadata;
            ALTER TABLE dbo.Uploads ADD CompressedFileSize BIGINT NULL, CompressedBlobUrl NVARCHAR(1000) NULL,
                DeliveryJobId NVARCHAR(36) NULL, ProcessingNode NVARCHAR(100) NULL;
        `);
        await resetDatabase(pool, 2, applySchemaScripts);
        await resetDatabase(pool, 2, applySchemaScripts);
        const counts = await inspectResetDatabase(() => pool.request(), 2);
        expect(Object.entries(counts).filter(([name]) => name !== 'Users').every(([, count]) => count === 0)).toBe(true);
        expect((await pool.request().query('SELECT * FROM dbo.Users ORDER BY Id')).recordset).toEqual(users);
    });
});

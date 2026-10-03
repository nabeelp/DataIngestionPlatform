// Functional tests for definition versioning against a real SQL Server database.
// Run with TEST_DB_CONNECTION_STRING pointing at a disposable database that has every script in
// Back-End/database applied (see README). Skipped when the variable is not set.

import type { IColumn } from '../src/interfaces/fileDefinition.interface';

const TEST_DB = process.env.TEST_DB_CONNECTION_STRING;
const describeDb = TEST_DB ? describe : describe.skip;

if (TEST_DB) {
    process.env.DB_CONNECTION_STRING = TEST_DB;
    process.env.LOG_LEVEL = 'warn';
}

const load = () => ({
    db: require('../src/config/database') as typeof import('../src/config/database'),
    versions: require('../src/services/DefinitionVersion.service') as typeof import('../src/services/DefinitionVersion.service'),
    definitions: require('../src/services/FileDefinition.service') as typeof import('../src/services/FileDefinition.service'),
    rules: require('../src/services/Rule.service') as typeof import('../src/services/Rule.service'),
});

describeDb('definition versioning (SQL Server)', () => {
    jest.setTimeout(60_000);

    let m: ReturnType<typeof load>;
    let adminId: string;
    const createdDefinitions: string[] = [];

    const newDefinition = async (columns: IColumn[] = [{ name: 'Amount', type: 'decimal', required: true }]) => {
        const definition = await m.definitions.FileDefinitionService.createDefinition(
            { Name: `Versioning ${Date.now()}-${Math.random()}`, Description: '', Columns: columns, Status: 'Active' },
            adminId,
        );
        createdDefinitions.push(definition.Id);
        return definition;
    };

    const addRule = (definitionId: string, name: string, expression: string, order = 1) =>
        m.rules.createRule(
            { FileDefinitionId: definitionId, Name: name, RuleType: 'Range Check', SqlQuery: expression, ExecutionOrder: order },
            adminId,
        );

    beforeAll(async () => {
        m = load();
        const pool = await m.db.getConnection();
        const admin = await pool.request().query(`SELECT TOP 1 Id FROM Users WHERE Role = 'admin'`);
        adminId = admin.recordset[0]?.Id;
        if (!adminId) throw new Error('The test database needs an admin user (run seed_local_users.sql)');
    });

    afterAll(async () => {
        if (!m) return;
        const pool = await m.db.getConnection();
        for (const id of createdDefinitions) {
            await pool.request().input('Id', id).query(`
                DELETE FROM ValidationRuleDetails WHERE UploadId IN (SELECT Id FROM Uploads WHERE FileDefinitionId = @Id);
                DELETE FROM ValidationResults WHERE UploadId IN (SELECT Id FROM Uploads WHERE FileDefinitionId = @Id);
                DELETE FROM UploadSheets WHERE UploadId IN (SELECT Id FROM Uploads WHERE FileDefinitionId = @Id);
                DELETE FROM Uploads WHERE FileDefinitionId = @Id;
                DELETE FROM FileDefinitionVersions WHERE FileDefinitionId = @Id;
                DELETE FROM Rules WHERE FileDefinitionId = @Id;
                DELETE FROM FileDefinitionUserAccess WHERE FileDefinitionId = @Id;
                DELETE FROM FileDefinitions WHERE Id = @Id;
            `);
        }
        await m.db.closeConnection();
    });

    it('publishes version 1 when a definition is created', async () => {
        const definition = await newDefinition();

        const state = await m.versions.DefinitionVersionService.getDraftState(definition.Id);

        expect(state.activeVersion?.VersionNumber).toBe(1);
        expect(state.diff.hasChanges).toBe(false);
    });

    it('keeps edits as a draft until they are published as a new version', async () => {
        const definition = await newDefinition();
        await m.definitions.FileDefinitionService.updateDefinition(definition.Id, {
            Columns: [
                { name: 'Amount', type: 'integer', required: true },
                { name: 'Email', type: 'string', required: false },
            ],
        });
        await addRule(definition.Id, 'Amount range', 'Amount: 0..100');

        const draft = await m.versions.DefinitionVersionService.getDraftState(definition.Id);
        expect(draft.activeVersion?.VersionNumber).toBe(1);
        expect(draft.diff).toMatchObject({
            hasChanges: true,
            columns: { added: ['Email'], removed: [], changed: ['Amount'] },
            rules: { added: ['Amount range'], removed: [], changed: [] },
        });

        const published = await m.versions.DefinitionVersionService.publish(definition.Id, adminId, 'Integer amounts');
        expect(published).toMatchObject({ VersionNumber: 2, Status: 'Active', ChangeNote: 'Integer amounts' });

        const history = await m.versions.DefinitionVersionService.listVersions(definition.Id);
        expect(history.map(v => [v.VersionNumber, v.Status])).toEqual([[2, 'Active'], [1, 'Superseded']]);
        expect(history[1].Columns).toEqual([{ name: 'Amount', type: 'decimal', required: true }]);
        expect(history[1].Rules).toEqual([]);
        expect(history[0].Rules.map(r => r.Name)).toEqual(['Amount range']);
        expect((await m.versions.DefinitionVersionService.getDraftState(definition.Id)).diff.hasChanges).toBe(false);
    });

    it('refuses to publish when nothing changed', async () => {
        const definition = await newDefinition();

        await expect(m.versions.DefinitionVersionService.publish(definition.Id, adminId))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('version 1 is already active') });
    });

    it('refuses to publish an invalid draft and leaves the active version in place', async () => {
        const definition = await newDefinition();
        const pool = await m.db.getConnection();
        // Rules are validated on save, so an invalid enabled rule can only come from legacy data.
        const config = JSON.stringify({
            id: 'broken-range',
            name: 'Broken range',
            description: '',
            severity: 'Error',
            executionOrder: 1,
            enabled: true,
            table: null,
            type: 'range',
            params: { column: 'Amount', min: 9, max: 1 },
        });
        await pool.request().input('Id', definition.Id).input('Config', config).query(`
            INSERT INTO Rules (Id, FileDefinitionId, Config, ConfigSchemaVersion, IsEnabled)
            VALUES (NEWID(), @Id, @Config, 1, 1)
        `);

        await expect(m.versions.DefinitionVersionService.publish(definition.Id, adminId))
            .rejects.toMatchObject({ statusCode: 400, message: 'Rule "Broken range" is invalid: Minimum cannot exceed maximum' });
        expect((await m.versions.DefinitionVersionService.listVersions(definition.Id)).map(v => v.VersionNumber)).toEqual([1]);
    });

    it('returns 404 for an unknown definition', async () => {
        await expect(m.versions.DefinitionVersionService.publish('00000000-0000-0000-0000-000000000000', adminId))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('publishes concurrent requests for the same draft exactly once', async () => {
        const definition = await newDefinition();
        await addRule(definition.Id, 'Amount range', 'Amount: 0..100');

        const results = await Promise.allSettled([
            m.versions.DefinitionVersionService.publish(definition.Id, adminId),
            m.versions.DefinitionVersionService.publish(definition.Id, adminId),
        ]);

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.statusCode)).toEqual([409]);
        const versions = await m.versions.DefinitionVersionService.listVersions(definition.Id);
        expect(versions.map(v => [v.VersionNumber, v.Status])).toEqual([[2, 'Active'], [1, 'Superseded']]);
    });

    it('publishes an initial version for a definition that was never versioned', async () => {
        const pool = await m.db.getConnection();
        const id = `seeded-${Date.now()}`;
        createdDefinitions.push(id);
        const contract = JSON.stringify({
            schemaVersion: 1,
            layout: 'single',
            ignoredSheets: [],
            encoding: 'auto',
            tables: [{
                sheet: null,
                headerRow: null,
                allowExtraColumns: true,
                minRows: null,
                maxRows: null,
                columns: [{ name: 'Code', type: 'string', required: true }],
            }],
            rules: [],
            lookups: {},
        });
        await pool.request().input('Id', id).input('Contract', contract).query(`
            INSERT INTO FileDefinitions (Id, Name, Description, Contract, Status)
            VALUES (@Id, @Id, '', @Contract, 'Active')
        `);

        const [first, second] = [
            await m.versions.DefinitionVersionService.ensureActiveVersion(id, null),
            await m.versions.DefinitionVersionService.ensureActiveVersion(id, null),
        ];

        expect(first).toMatchObject({ VersionNumber: 1, Status: 'Active', ChangeNote: 'Initial version' });
        expect(second.Id).toBe(first.Id);
        expect(first.Columns).toEqual([{ name: 'Code', type: 'string', required: true }]);
    });

    it('lists version state for definitions, flagging unpublished drafts', async () => {
        const unchanged = await newDefinition();
        const edited = await newDefinition();
        await addRule(edited.Id, 'Amount range', 'Amount: 0..100');

        const states = await m.versions.DefinitionVersionService.getVersionStates([
            { Id: unchanged.Id, Columns: unchanged.Columns },
            { Id: edited.Id, Columns: edited.Columns },
        ]);

        expect(states.get(unchanged.Id)).toMatchObject({ activeVersion: { versionNumber: 1 }, hasUnpublishedChanges: false });
        expect(states.get(edited.Id)).toMatchObject({ activeVersion: { versionNumber: 1 }, hasUnpublishedChanges: true });
    });

});

// Functional tests for definition versioning against a real SQL Server database.
// Run with TEST_DB_CONNECTION_STRING pointing at a disposable database that has every script in
// Back-End/database applied (see README). Skipped when the variable is not set.

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IColumn } from '../src/interfaces/fileDefinition.interface';

const TEST_DB = process.env.TEST_DB_CONNECTION_STRING;
const describeDb = TEST_DB ? describe : describe.skip;

if (TEST_DB) {
    process.env.DB_CONNECTION_STRING = TEST_DB;
    process.env.REDIS_ENABLED = 'false';
    process.env.LOG_LEVEL = 'warn';
    process.env.UPLOAD_TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dip-versioning-'));
}

const load = () => ({
    db: require('../src/config/database') as typeof import('../src/config/database'),
    versions: require('../src/services/DefinitionVersion.service') as typeof import('../src/services/DefinitionVersion.service'),
    definitions: require('../src/services/FileDefinition.service') as typeof import('../src/services/FileDefinition.service'),
    rules: require('../src/services/Rule.service') as typeof import('../src/services/Rule.service'),
    uploads: require('../src/services/Upload.service') as typeof import('../src/services/Upload.service'),
    uploadModel: require('../src/models/Upload.model') as typeof import('../src/models/Upload.model'),
    queues: require('../src/services/Queue.service') as typeof import('../src/services/Queue.service'),
    worker: require('../src/services/ValidationWorker.service') as typeof import('../src/services/ValidationWorker.service'),
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
        await m.queues.initializeQueues();
    });

    afterAll(async () => {
        if (!m) return;
        await m.queues.closeAllQueues();
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
        await pool.request().input('Id', definition.Id).query(`
            INSERT INTO Rules (Id, FileDefinitionId, Name, RuleType, Severity, ExecutionOrder, SqlQuery, IsEnabled)
            VALUES (NEWID(), @Id, 'Broken range', 'Range Check', 'Error', 1, 'Amount: 9..1', 1)
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
        await pool.request().input('Id', id).query(`
            INSERT INTO FileDefinitions (Id, Name, Description, Columns, Status)
            VALUES (@Id, @Id, '', N'[{"name":"Code","type":"string","required":true}]', 'Active')
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

    describe('uploads', () => {
        const uploadCsv = async (definitionId: string, csv: string) => {
            const tempPath = path.join(process.env.UPLOAD_TEMP_DIR!, `${Date.now()}-${Math.random()}.csv`);
            fs.writeFileSync(tempPath, csv);
            return m.uploads.UploadService.createUpload({
                FileDefinitionId: definitionId,
                OriginalFilename: 'amounts.csv',
                StoredFilename: path.basename(tempPath),
                TempLocalPath: tempPath,
                FileSize: csv.length,
                FileType: 'csv',
            }, adminId);
        };

        const validate = async (uploadId: string) => {
            await m.uploads.UploadService.startValidation(uploadId);
            const upload = (await m.uploadModel.Upload.findById(uploadId))!;
            await m.worker.processValidationJob({
                data: { uploadId, fileDefinitionId: upload.FileDefinitionId, fileUrl: '', userId: adminId },
            } as any);
            return m.uploads.UploadService.getUploadDetails(uploadId);
        };

        it('validates each upload against the version that was active when it arrived, including on retry', async () => {
            const definition = await newDefinition([{ name: 'Amount', type: 'string', required: true }]);
            const early = await uploadCsv(definition.Id, 'Amount\nabc\n');

            await m.definitions.FileDefinitionService.updateDefinition(definition.Id, {
                Columns: [{ name: 'Amount', type: 'integer', required: true }],
            });
            await addRule(definition.Id, 'Amount range', 'Amount: 0..10');
            // Draft edits alone do not affect new uploads.
            const beforePublish = await uploadCsv(definition.Id, 'Amount\nabc\n');
            await m.versions.DefinitionVersionService.publish(definition.Id, adminId, 'Integer amounts');
            const late = await uploadCsv(definition.Id, 'Amount\nabc\n');

            const earlyResult = await validate(early.Id);
            const beforePublishResult = await validate(beforePublish.Id);
            const lateResult = await validate(late.Id);

            expect(earlyResult.definitionVersion).toMatchObject({ versionNumber: 1 });
            expect(earlyResult.upload.Status).toBe('VALIDATED');
            expect(earlyResult.ruleDetails.map(r => r.RuleName)).toEqual(['File definition columns']);
            expect(beforePublishResult.definitionVersion).toMatchObject({ versionNumber: 1 });
            expect(beforePublishResult.upload.Status).toBe('VALIDATED');

            expect(lateResult.definitionVersion).toMatchObject({ versionNumber: 2 });
            expect(lateResult.upload.Status).toBe('VALIDATION_FAILED');
            expect(lateResult.ruleDetails.map(r => [r.RuleName, r.Status])).toEqual([
                ['File definition columns', 'FAILED'],
                ['Amount range', 'FAILED'],
            ]);

            // A retry after yet another published change still uses the pinned version.
            await m.definitions.FileDefinitionService.updateDefinition(definition.Id, {
                Columns: [{ name: 'Amount', type: 'decimal', required: true }],
            });
            await m.versions.DefinitionVersionService.publish(definition.Id, adminId);
            const retried = await validate(late.Id);
            expect(retried.definitionVersion).toMatchObject({ versionNumber: 2 });
            expect(retried.ruleDetails.map(r => [r.RuleName, r.Status])).toEqual([
                ['File definition columns', 'FAILED'],
                ['Amount range', 'FAILED'],
            ]);
        });

        it('pins uploads created before versioning to the active version, never the draft', async () => {
            const definition = await newDefinition([{ name: 'Amount', type: 'string', required: true }]);
            const upload = await uploadCsv(definition.Id, 'Amount\nabc\n');
            const pool = await m.db.getConnection();
            await pool.request().input('Id', upload.Id).query(`UPDATE Uploads SET FileDefinitionVersionId = NULL WHERE Id = @Id`);
            // An unpublished draft that would fail this file.
            await m.definitions.FileDefinitionService.updateDefinition(definition.Id, {
                Columns: [{ name: 'Amount', type: 'integer', required: true }],
            });

            const result = await validate(upload.Id);

            expect(result.definitionVersion).toMatchObject({ versionNumber: 1 });
            expect(result.upload.FileDefinitionVersionId).toBe(result.definitionVersion!.id);
            expect(result.upload.Status).toBe('VALIDATED');
        });
    });
});

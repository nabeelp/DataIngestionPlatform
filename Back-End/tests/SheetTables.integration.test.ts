// Functional tests for definitions with one table per workbook sheet, against a real SQL Server database.
// Run with TEST_DB_CONNECTION_STRING (see DefinitionVersioning.integration.test.ts); skipped otherwise.

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';

const TEST_DB = process.env.TEST_DB_CONNECTION_STRING;
const describeDb = TEST_DB ? describe : describe.skip;
const JWT_SECRET = 'sheet-tables-test-secret';

if (TEST_DB) {
    process.env.DB_CONNECTION_STRING = TEST_DB;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.REDIS_ENABLED = 'false';
    process.env.LOG_LEVEL = 'error';
    process.env.UPLOAD_TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dip-sheet-tables-'));
}

const load = () => ({
    db: require('../src/config/database') as typeof import('../src/config/database'),
    versions: require('../src/services/DefinitionVersion.service') as typeof import('../src/services/DefinitionVersion.service'),
    uploads: require('../src/services/Upload.service') as typeof import('../src/services/Upload.service'),
    uploadModel: require('../src/models/Upload.model') as typeof import('../src/models/Upload.model'),
    queues: require('../src/services/Queue.service') as typeof import('../src/services/Queue.service'),
    worker: require('../src/services/ValidationWorker.service') as typeof import('../src/services/ValidationWorker.service'),
});

const workbook = (sheets: Record<string, unknown[][]>): Buffer => {
    const book = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

describeDb('sheet table definitions (SQL Server)', () => {
    jest.setTimeout(60_000);

    let m: ReturnType<typeof load>;
    let server: Server;
    let baseUrl: string;
    let adminId: string;
    const createdDefinitions: string[] = [];

    const token = () => jwt.sign({ userId: adminId, email: 'admin@test', role: 'admin', loginMethod: 'password' }, JWT_SECRET, { algorithm: 'HS256' });

    const call = async (method: string, apiPath: string, body?: unknown) => {
        const res = await fetch(`${baseUrl}${apiPath}`, {
            method,
            headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() as any };
    };

    const createDefinition = async (body: Record<string, unknown>) => {
        const res = await call('POST', '/admin/file-definitions', { name: `Sheets ${Date.now()}-${Math.random()}`, ...body });
        if (res.status === 201) createdDefinitions.push(res.body.definition.id);
        return res;
    };

    const ordersTables = [
        { sheet: 'Orders', columns: [{ name: 'OrderId', type: 'integer', required: true }, { name: 'Status', type: 'string', required: true }] },
        { sheet: 'Refunds', columns: [{ name: 'OrderId', type: 'integer', required: true }, { name: 'Reason', type: 'string', required: true }] },
    ];
    const statusRule = { name: 'Status allowed values', ruleType: 'Enum Check', expression: 'Status: Closed, Open', severity: 'Error', table: 'Orders' };

    const validateFile = async (definitionId: string, content: Buffer | string, fileType: 'xlsx' | 'csv') => {
        const tempPath = path.join(process.env.UPLOAD_TEMP_DIR!, `${Date.now()}-${Math.random()}.${fileType}`);
        fs.writeFileSync(tempPath, content);
        const upload = await m.uploads.UploadService.createUpload({
            FileDefinitionId: definitionId,
            OriginalFilename: `orders.${fileType}`,
            StoredFilename: path.basename(tempPath),
            TempLocalPath: tempPath,
            FileSize: content.length,
            FileType: fileType,
        }, adminId);
        await m.uploads.UploadService.startValidation(upload.Id);
        await m.worker.processValidationJob({ data: { uploadId: upload.Id, fileDefinitionId: definitionId, fileUrl: '', userId: adminId } } as any);
        return m.uploads.UploadService.getUploadDetails(upload.Id);
    };

    beforeAll(async () => {
        m = load();
        const app = express();
        app.use(express.json());
        app.use('/api/admin', require('../src/routes/admin.routes').default);
        app.use('/api/uploads', require('../src/routes/upload.routes').default);
        app.use('/api/rules', require('../src/routes/rule.routes').default);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

        const pool = await m.db.getConnection();
        const admin = await pool.request().query(`SELECT TOP 1 Id FROM Users WHERE Role = 'admin' AND IsActive = 1`);
        adminId = admin.recordset[0]?.Id;
        if (!adminId) throw new Error('The test database needs an admin user (run seed_local_users.sql)');
        await m.queues.initializeQueues();
    });

    afterAll(async () => {
        if (server) await new Promise<void>(resolve => server.close(() => resolve()));
        if (!m) return;
        await m.queues.closeAllQueues();
        const pool = await m.db.getConnection();
        for (const id of createdDefinitions) {
            await pool.request().input('Id', id).query(`
                DELETE FROM ValidationRuleDetails WHERE UploadId IN (SELECT Id FROM Uploads WHERE FileDefinitionId = @Id);
                DELETE FROM ValidationResults WHERE UploadId IN (SELECT Id FROM Uploads WHERE FileDefinitionId = @Id);
                DELETE FROM UploadSheets WHERE UploadId IN (SELECT Id FROM Uploads WHERE FileDefinitionId = @Id);
                DELETE FROM DeliveryRecords WHERE UploadId IN (SELECT Id FROM Uploads WHERE FileDefinitionId = @Id);
                DELETE FROM Uploads WHERE FileDefinitionId = @Id;
                DELETE FROM AuditLogs WHERE EntityId = @Id;
                DELETE FROM FileDefinitionVersions WHERE FileDefinitionId = @Id;
                DELETE FROM Rules WHERE FileDefinitionId = @Id;
                DELETE FROM FileDefinitionUserAccess WHERE FileDefinitionId = @Id;
                DELETE FROM FileDefinitions WHERE Id = @Id;
            `);
        }
        await m.db.closeConnection();
    });

    it('publishes sheet tables and table-scoped rules in version 1', async () => {
        const created = await createDefinition({ columns: [], tables: ordersTables, rules: [statusRule] });
        expect(created.status).toBe(201);
        expect(created.body.definition).toMatchObject({ columns: [], tables: ordersTables });

        const history = await call('GET', `/admin/file-definitions/${created.body.definition.id}/versions`);
        expect(history.body.versions[0]).toMatchObject({
            versionNumber: 1,
            columns: [],
            tables: ordersTables,
            rules: [expect.objectContaining({ name: 'Status allowed values', table: 'Orders' })],
        });
    });

    it.each([
        ['duplicate sheet names', { tables: [ordersTables[0], { ...ordersTables[1], sheet: 'orders' }] }, 'Sheet "orders" is defined more than once'],
        ['an invalid sheet name', { tables: [{ ...ordersTables[0], sheet: 'Q1/Q2' }] }, 'cannot contain'],
        ['a rule without a table', { tables: ordersTables, rules: [{ ...statusRule, table: undefined }] }, 'must name the sheet table'],
        ['a rule column in the wrong sheet', { tables: ordersTables, rules: [{ ...statusRule, table: 'Refunds' }] }, 'not in sheet "Refunds"'],
        ['a sheet rule on a single table', { columns: ordersTables[0].columns, rules: [statusRule] }, 'this definition has a single table'],
    ])('rejects %s', async (_label, body, message) => {
        const res = await createDefinition({ columns: [], ...body });
        expect(res.status).toBe(400);
        expect(res.body.message).toContain(message);
    });

    it('validates each sheet against its own table, ignoring other sheets', async () => {
        const created = await createDefinition({ columns: [], tables: ordersTables, rules: [statusRule] });
        const id = created.body.definition.id;

        const good = await validateFile(id, workbook({
            orders: [['OrderId', 'Status'], [1, 'Open'], [2, 'Closed']],
            REFUNDS: [['OrderId', 'Reason'], [2, 'Damaged']],
            ReadMe: [['Anything'], ['is ignored']],
        }), 'xlsx');
        expect(good.upload.Status).toBe('VALIDATED');
        expect(good.ruleDetails.map(r => [r.RuleName, r.Status])).toEqual([
            ['Sheet "Orders" columns', 'PASSED'],
            ['Sheet "Refunds" columns', 'PASSED'],
            ['Status allowed values (Orders)', 'PASSED'],
        ]);

        const bad = await validateFile(id, workbook({
            Orders: [['OrderId', 'Status'], [1, 'Pending']],
            Other: [['Status'], ['Anything']],
        }), 'xlsx');
        expect(bad.upload.Status).toBe('VALIDATION_FAILED');
        expect(bad.ruleDetails.map(r => [r.RuleName, r.Status])).toEqual([
            ['Sheet "Orders" columns', 'PASSED'],
            ['Sheet "Refunds" columns', 'FAILED'],
            ['Status allowed values (Orders)', 'FAILED'],
        ]);
        const errorsOf = (name: string) => JSON.parse(String(bad.ruleDetails.find(r => r.RuleName === name)!.FailedRows));
        expect(errorsOf('Sheet "Refunds" columns')).toEqual([{ sheet: 'Refunds', error: 'Required sheet "Refunds" not found' }]);
        // The rule only saw the Orders sheet, so only its one row failed.
        expect(bad.ruleDetails.find(r => r.RuleName === 'Status allowed values (Orders)')!.ErrorCount).toBe(1);
    });

    it('fails a CSV file validated against sheet tables, and rejects CSV uploads up front', async () => {
        const created = await createDefinition({ columns: [], tables: ordersTables });
        const id = created.body.definition.id;

        const result = await validateFile(id, 'OrderId,Status\n1,Open\n', 'csv');
        expect(result.upload.Status).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(result.ruleDetails)).toContain('CSV files have no sheets');

        const form = new FormData();
        form.append('definitionId', id);
        form.append('file', new Blob(['OrderId,Status\n1,Open\n'], { type: 'text/csv' }), 'orders.csv');
        const res = await fetch(`${baseUrl}/uploads`, { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: form });
        expect(res.status).toBe(400);
        expect((await res.json() as any).message).toBe('This definition expects an Excel workbook (.xlsx or .xls) with the sheets "Orders", "Refunds"');
    });

    it('keeps single-table definitions applying to every sheet', async () => {
        const created = await createDefinition({ columns: [{ name: 'Code', type: 'string', required: true }] });
        const result = await validateFile(created.body.definition.id, workbook({ A: [['Code'], ['x']], B: [['Code'], ['y']] }), 'xlsx');
        expect(result.upload.Status).toBe('VALIDATED');
        expect(result.ruleDetails.map(r => r.RuleName)).toEqual(['File definition columns']);
    });

    it('requires rules added later to name an existing sheet table before publishing', async () => {
        const created = await createDefinition({ columns: [], tables: ordersTables });
        const id = created.body.definition.id;
        const rule = { FileDefinitionId: id, Name: 'Reason required', RuleType: 'Required Values', SqlQuery: 'Reason' };

        const unscoped = await call('POST', '/rules', rule);
        expect(unscoped.status).toBe(201);
        const refused = await call('POST', `/admin/file-definitions/${id}/versions`, {});
        expect(refused.status).toBe(400);
        expect(refused.body.message).toContain('must name the sheet table');

        const scoped = await call('PUT', `/rules/${unscoped.body.rule.Id}`, { TableName: ' refunds ' });
        expect(scoped.status).toBe(200);
        expect(scoped.body.rule.TableName).toBe('refunds');
        const published = await call('POST', `/admin/file-definitions/${id}/versions`, {});
        expect(published.status).toBe(201);
        expect(published.body.version.rules).toEqual([expect.objectContaining({ name: 'Reason required', table: 'refunds' })]);
    });

    it('switches layouts as a draft and publishes the change', async () => {
        const created = await createDefinition({ columns: [{ name: 'OrderId', type: 'integer', required: true }] });
        const id = created.body.definition.id;

        const updated = await call('PUT', `/admin/file-definitions/${id}`, { columns: [], tables: ordersTables });
        expect(updated.status).toBe(200);
        const draft = await call('GET', `/admin/file-definitions/${id}/versions`);
        expect(draft.body).toMatchObject({ hasUnpublishedChanges: true });
        expect(draft.body.changes.columns.added).toContain('Sheet "Orders"');
        expect(draft.body.changes.columns.removed).toEqual(['OrderId']);

        const published = await call('POST', `/admin/file-definitions/${id}/versions`, {});
        expect(published.status).toBe(201);
        expect(published.body.version).toMatchObject({ versionNumber: 2, columns: [], tables: ordersTables });

        // Back to a single table.
        await call('PUT', `/admin/file-definitions/${id}`, { columns: [{ name: 'OrderId', type: 'integer', required: true }], tables: [] });
        const state = await m.versions.DefinitionVersionService.getDraftState(id);
        expect(state.draft.tables).toEqual([]);
        expect(state.draft.columns).toEqual([{ name: 'OrderId', type: 'integer', required: true }]);
    });
});

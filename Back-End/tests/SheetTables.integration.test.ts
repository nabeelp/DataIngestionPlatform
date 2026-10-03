// Functional tests for definitions with one table per workbook sheet, against a real SQL Server database.
// Run with TEST_DB_CONNECTION_STRING (see DefinitionVersioning.integration.test.ts); skipped otherwise.

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';

const TEST_DB = process.env.TEST_DB_CONNECTION_STRING;
const describeDb = TEST_DB ? describe : describe.skip;
const JWT_SECRET = 'sheet-tables-test-secret';

if (TEST_DB) {
    process.env.DB_CONNECTION_STRING = TEST_DB;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.LOG_LEVEL = 'error';
}

const load = () => ({
    db: require('../src/config/database') as typeof import('../src/config/database'),
    versions: require('../src/services/DefinitionVersion.service') as typeof import('../src/services/DefinitionVersion.service'),
});

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
    });

    afterAll(async () => {
        if (server) await new Promise<void>(resolve => server.close(() => resolve()));
        if (!m) return;
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

    it('rejects CSV uploads for definitions that require sheet tables', async () => {
        const created = await createDefinition({ columns: [], tables: ordersTables });
        const id = created.body.definition.id;

        const form = new FormData();
        form.append('definitionId', id);
        form.append('file', new Blob(['OrderId,Status\n1,Open\n'], { type: 'text/csv' }), 'orders.csv');
        const res = await fetch(`${baseUrl}/uploads`, { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: form });
        expect(res.status).toBe(400);
        expect((await res.json() as any).message).toBe('This definition expects an Excel workbook (.xlsx or .xls) with the sheets "Orders", "Refunds"');
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

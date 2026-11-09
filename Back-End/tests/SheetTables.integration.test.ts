// Functional tests for definitions with one table per workbook sheet, against a real SQL Server database.
// Run with TEST_DB_CONNECTION_STRING (see DefinitionVersioning.integration.test.ts); skipped otherwise.

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { randomUUID } from 'crypto';
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
    rules: require('../src/models/Rule.model') as typeof import('../src/models/Rule.model'),
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

    const column = (name: string, type = 'string') => ({ name, type, mustExist: true, nullable: false });
    const sheetTable = (sheet: string, columns: ReturnType<typeof column>[]) => ({
        sheet, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns,
    });
    const contractOf = (tables: ReturnType<typeof sheetTable>[], layout: 'sheets' | 'single' = 'sheets') => ({
        schemaVersion: 1,
        layout,
        ignoredSheets: [],
        encoding: 'auto',
        tables,
        rules: [],
        lookups: {},
    });
    const singleContract = (columns: ReturnType<typeof column>[]) =>
        contractOf([{ ...sheetTable('', columns), sheet: null as unknown as string }], 'single');

    const ordersTables = [
        sheetTable('Orders', [column('OrderId', 'integer'), column('Status')]),
        sheetTable('Refunds', [column('OrderId', 'integer'), column('Reason')]),
    ];
    const ordersContract = contractOf(ordersTables);
    const enumRule = (overrides: Record<string, unknown> = {}) => ({
        id: randomUUID(),
        name: 'Status allowed values',
        description: '',
        severity: 'Error',
        executionOrder: 1,
        enabled: true,
        table: 'Orders',
        type: 'enum',
        params: { column: 'Status', values: ['Closed', 'Open'] },
        ...overrides,
    });
    const statusRule = enumRule();

    beforeAll(async () => {
        m = load();
        const app = express();
        app.use(express.json());
        app.use('/api/admin', require('../src/routes/admin.routes').default);
        app.use('/api/uploads', require('../src/routes/upload.routes').default);
        app.use('/api/rules', require('../src/routes/rule.routes').default);
        app.use(require('../src/middleware/errorHandler').errorHandler);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

        const pool = await m.db.getConnection();
        const admin = await pool.request().query(`SELECT TOP 1 Id FROM Users WHERE Role = 'admin' AND IsActive = 1`);
        adminId = admin.recordset[0]?.Id;
        if (!adminId) throw new Error('The test database needs an admin user (run database/local/seed_local_users.sql)');
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
        const created = await createDefinition({ contract: ordersContract, rules: [statusRule] });
        expect(created.status).toBe(201);
        expect(created.body.definition.contract).toMatchObject({ layout: 'sheets', tables: ordersTables });

        const history = await call('GET', `/admin/file-definitions/${created.body.definition.id}/versions`);
        expect(history.body.versions[0]).toMatchObject({
            versionNumber: 1,
            contract: {
                layout: 'sheets',
                tables: ordersTables,
                rules: [expect.objectContaining({ name: 'Status allowed values', table: 'Orders' })],
            },
        });
    });

    it.each([
        ['duplicate sheet names', { contract: contractOf([ordersTables[0], { ...ordersTables[1], sheet: 'orders' }]) }, 'Sheet "orders" is defined more than once'],
        ['an invalid sheet name', { contract: contractOf([{ ...ordersTables[0], sheet: 'Q1/Q2' }]) }, 'cannot contain'],
        ['a rule without a table', { contract: ordersContract, rules: [enumRule({ table: null })] }, 'A sheet-layout rule must target a declared table'],
        ['a rule column in the wrong sheet', { contract: ordersContract, rules: [enumRule({ table: 'Refunds' })] }, 'undeclared column "Status" in table "Refunds"'],
        ['a sheet rule on a single table', { contract: singleContract(ordersTables[0].columns), rules: [statusRule] }, 'A single-layout rule cannot target an undeclared table'],
    ])('rejects %s', async (_label, body, message) => {
        const res = await createDefinition(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toContain(message);
    });

    it('rejects CSV uploads for definitions that require sheet tables', async () => {
        const created = await createDefinition({ contract: ordersContract });
        const id = created.body.definition.id;

        const form = new FormData();
        form.append('definitionId', id);
        form.append('file', new Blob(['OrderId,Status\n1,Open\n'], { type: 'text/csv' }), 'orders.csv');
        const res = await fetch(`${baseUrl}/uploads`, { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: form });
        expect(res.status).toBe(400);
        expect((await res.json() as any).message).toBe('This definition expects an Excel workbook (.xlsx or .xls) with the sheets "Orders", "Refunds"');
    });

    it('requires rules added later to name an existing sheet table before publishing', async () => {
        const created = await createDefinition({ contract: ordersContract });
        const id = created.body.definition.id;
        const unscoped = await m.rules.Rule.create({
            FileDefinitionId: id,
            Config: enumRule({ name: 'Reason required', table: null, params: { column: 'Reason', values: ['a', 'b'] } }) as any,
        }, adminId);
        const refused = await call('POST', `/admin/file-definitions/${id}/versions`, {});
        expect(refused.status).toBe(400);
        expect(refused.body.message).toContain('A sheet-layout rule must target a declared table');

        const scoped = await m.rules.Rule.update(unscoped.Id, { TableName: ' refunds ' });
        expect(scoped?.TableName).toBe('refunds');
        const published = await call('POST', `/admin/file-definitions/${id}/versions`, {});
        expect(published.status).toBe(201);
        expect(published.body.version.contract.rules).toEqual([expect.objectContaining({ name: 'Reason required', table: 'refunds' })]);
    });

    it('switches layouts as a draft and publishes the change', async () => {
        const created = await createDefinition({ contract: singleContract([column('OrderId', 'integer')]) });
        const id = created.body.definition.id;

        const updated = await call('PUT', `/admin/file-definitions/${id}`, { contract: ordersContract });
        expect(updated.status).toBe(200);
        const draft = await call('GET', `/admin/file-definitions/${id}/versions`);
        expect(draft.body).toMatchObject({ hasUnpublishedChanges: true });
        expect(draft.body.changes.columns.added).toContain('Sheet "Orders"');
        expect(draft.body.changes.columns.removed).toEqual(['OrderId']);

        const published = await call('POST', `/admin/file-definitions/${id}/versions`, {});
        expect(published.status).toBe(201);
        expect(published.body.version).toMatchObject({ versionNumber: 2, contract: { layout: 'sheets', tables: ordersTables } });

        // Back to a single table.
        await call('PUT', `/admin/file-definitions/${id}`, { contract: singleContract([column('OrderId', 'integer')]) });
        const state = await m.versions.DefinitionVersionService.getDraftState(id);
        expect(state.draft.layout).toBe('single');
        expect(state.draft.tables).toHaveLength(1);
        expect(state.draft.tables[0].sheet).toBeNull();
        expect(state.draft.tables[0].columns).toEqual([column('OrderId', 'integer')]);
    });
});

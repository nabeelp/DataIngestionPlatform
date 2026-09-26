// HTTP functional tests for definition versioning against a real SQL Server database.
// Run with TEST_DB_CONNECTION_STRING (see DefinitionVersioning.integration.test.ts); skipped otherwise.

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';

const TEST_DB = process.env.TEST_DB_CONNECTION_STRING;
const describeDb = TEST_DB ? describe : describe.skip;
const JWT_SECRET = 'versioning-routes-test-secret';

if (TEST_DB) {
    process.env.DB_CONNECTION_STRING = TEST_DB;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.REDIS_ENABLED = 'false';
    process.env.LOG_LEVEL = 'error';
}

describeDb('definition version routes', () => {
    jest.setTimeout(60_000);

    let server: Server;
    let baseUrl: string;
    let db: typeof import('../src/config/database');
    const users: Record<'admin' | 'user', string> = { admin: '', user: '' };
    const createdDefinitions: string[] = [];

    const call = async (role: 'admin' | 'user', method: string, path: string, body?: unknown) => {
        const token = jwt.sign({ userId: users[role], email: `${role}@test`, role, loginMethod: 'password' }, JWT_SECRET, { algorithm: 'HS256' });
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() as any };
    };

    beforeAll(async () => {
        db = require('../src/config/database');
        const app = express();
        app.use(express.json());
        app.use('/api/admin', require('../src/routes/admin.routes').default);
        app.use('/api/definitions', require('../src/routes/definition.routes').default);
        app.use('/api/rules', require('../src/routes/rule.routes').default);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

        const pool = await db.getConnection();
        const result = await pool.request().query(`SELECT Id, Role FROM Users WHERE Role IN ('admin', 'user') AND IsActive = 1`);
        for (const row of result.recordset) users[row.Role as 'admin' | 'user'] ||= row.Id;
        if (!users.admin || !users.user) throw new Error('The test database needs an admin and a user (run seed_local_users.sql)');
    });

    afterAll(async () => {
        if (server) await new Promise<void>(resolve => server.close(() => resolve()));
        if (!db) return;
        const pool = await db.getConnection();
        for (const id of createdDefinitions) {
            await pool.request().input('Id', id).query(`
                DELETE FROM AuditLogs WHERE EntityId = @Id;
                DELETE FROM FileDefinitionVersions WHERE FileDefinitionId = @Id;
                DELETE FROM Rules WHERE FileDefinitionId = @Id;
                DELETE FROM FileDefinitionUserAccess WHERE FileDefinitionId = @Id;
                DELETE FROM FileDefinitions WHERE Id = @Id;
            `);
        }
        await db.closeConnection();
    });

    it('lets admins review draft changes, publish them, and see the new version everywhere', async () => {
        const created = await call('admin', 'POST', '/admin/file-definitions', {
            name: `Routes ${Date.now()}`,
            columns: [{ name: 'Amount', type: 'decimal', required: true }],
        });
        expect(created.status).toBe(201);
        const id = created.body.definition.id;
        createdDefinitions.push(id);
        await call('admin', 'POST', `/admin/file-definitions/${id}/users`, { userIds: [users.user] });

        const listed = await call('admin', 'GET', '/admin/file-definitions');
        expect(listed.body.definitions.find((d: any) => d.id === id))
            .toMatchObject({ activeVersion: { versionNumber: 1 }, hasUnpublishedChanges: false });

        // Draft edits: a column type change and a new rule.
        await call('admin', 'PUT', `/admin/file-definitions/${id}`, { columns: [{ name: 'Amount', type: 'integer', required: true }] });
        const rule = await call('admin', 'POST', '/rules', {
            FileDefinitionId: id, Name: 'Amount range', RuleType: 'Range Check', SqlQuery: 'Amount: 0..10',
        });
        expect(rule.status).toBe(201);

        const draft = await call('admin', 'GET', `/admin/file-definitions/${id}/versions`);
        expect(draft.status).toBe(200);
        expect(draft.body).toMatchObject({
            activeVersionNumber: 1,
            hasUnpublishedChanges: true,
            changes: {
                columns: { added: [], removed: [], changed: ['Amount'] },
                rules: { added: ['Amount range'], removed: [], changed: [] },
            },
        });

        // Until publication, uploaders still see version 1.
        const userView = await call('user', 'GET', `/definitions/${id}`);
        expect(userView.body.definition).toMatchObject({
            Columns: [{ name: 'Amount', type: 'decimal', required: true }],
            ActiveVersion: { versionNumber: 1 },
        });
        expect((await call('user', 'GET', `/rules/definitions/${id}`)).body).toMatchObject({ rules: [], published: true, versionNumber: 1 });

        const published = await call('admin', 'POST', `/admin/file-definitions/${id}/versions`, { changeNote: 'Integer amounts' });
        expect(published.status).toBe(201);
        expect(published.body.version).toMatchObject({ versionNumber: 2, status: 'Active', changeNote: 'Integer amounts' });

        const history = await call('admin', 'GET', `/admin/file-definitions/${id}/versions`);
        expect(history.body.hasUnpublishedChanges).toBe(false);
        expect(history.body.versions.map((v: any) => [v.versionNumber, v.status])).toEqual([[2, 'Active'], [1, 'Superseded']]);
        expect(history.body.versions[0].rules).toEqual([
            expect.objectContaining({ name: 'Amount range', ruleType: 'Range Check', expression: 'Amount: 0..10' }),
        ]);

        const userAfter = await call('user', 'GET', `/definitions/${id}`);
        expect(userAfter.body.definition).toMatchObject({ Columns: [{ name: 'Amount', type: 'integer', required: true }], ActiveVersion: { versionNumber: 2 } });
        const userRules = await call('user', 'GET', `/rules/definitions/${id}`);
        expect(userRules.body).toMatchObject({ published: true, versionNumber: 2 });
        expect(userRules.body.rules.map((r: any) => r.Name)).toEqual(['Amount range']);

        const audit = await call('admin', 'GET', `/admin/audit-logs?action=DEFINITION_VERSION_PUBLISHED&limit=50`);
        expect(JSON.stringify(audit.body)).toContain(id);
    });

    it('rejects publishing with no changes', async () => {
        const created = await call('admin', 'POST', '/admin/file-definitions', {
            name: `Routes ${Date.now()}`,
            columns: [{ name: 'Code', type: 'string', required: true }],
        });
        createdDefinitions.push(created.body.definition.id);

        const res = await call('admin', 'POST', `/admin/file-definitions/${created.body.definition.id}/versions`, {});

        expect(res.status).toBe(409);
        expect(res.body.message).toContain('version 1 is already active');
    });

    it('returns 404 for an unknown definition', async () => {
        const res = await call('admin', 'GET', '/admin/file-definitions/00000000-0000-0000-0000-000000000000/versions');
        expect(res.status).toBe(404);
    });

    it.each([
        ['GET', '/admin/file-definitions/any/versions'],
        ['POST', '/admin/file-definitions/any/versions'],
    ])('forbids standard users from %s %s', async (method, path) => {
        expect((await call('user', method, path, method === 'POST' ? {} : undefined)).status).toBe(403);
    });
});

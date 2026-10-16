import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'unit-test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;

jest.mock('../src/controllers/rule.controller', () => {
    const ok = (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) =>
        res.status(200).json({ success: true });
    return {
        getRules: ok,
        getRuleById: ok,
        proposeRuleFromDescription: ok,
        validateRuleConfiguration: ok,
        testRuleConfiguration: ok,
    };
});

// Required after JWT_SECRET is set so appConfig picks it up.
const ruleRoutes: express.Router = require('../src/routes/rule.routes').default;

const RULE_ID = '5f0c2f7e-7a5c-4f0e-9d3e-2b1a4c6d8e90';
const DEFINITION_ID = '8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';

const tokenFor = (role: 'admin' | 'user') =>
    jwt.sign({ userId: `${role}-id`, email: `${role}@company.com`, role, loginMethod: 'password' }, JWT_SECRET, {
        algorithm: 'HS256',
    });

const validRule = {
    FileDefinitionId: DEFINITION_ID,
    Config: {
        id: 'd318c2a1-d431-44e3-9f28-cdf7de845707',
        name: 'Amount range',
        description: 'Amount must be between 0 and 100',
        severity: 'Error',
        executionOrder: 1,
        enabled: true,
        table: null,
        type: 'range',
        params: { column: 'Amount', min: 0, max: 100 },
    },
};

const workspaceDraft = {
    Contract: {
        schemaVersion: 1,
        layout: 'single',
        ignoredSheets: [],
        encoding: 'auto',
        tables: [{ sheet: null, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [] }],
        rules: [],
        lookups: {},
    },
    Rules: [],
};

describe('rule routes authorization', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/rules', ruleRoutes);
        await new Promise<void>(resolve => {
            server = app.listen(0, () => resolve());
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rules`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    const call = (role: 'admin' | 'user', method: string, path: string, body?: unknown) =>
        fetch(`${baseUrl}${path}`, {
            method,
            headers: { Authorization: `Bearer ${tokenFor(role)}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });

    const mutations: Array<[string, string, unknown]> = [
        ['POST', '/natural-language/propose', { ...workspaceDraft, Request: 'Amount must be positive' }],
        ['POST', '/validate', validRule],
        ['POST', '/validate', { ...workspaceDraft, Config: validRule.Config }],
        ['POST', '/test', { ...validRule, examples: [] }],
        ['POST', '/test', { ...workspaceDraft, Config: validRule.Config, examples: [] }],
    ];

    const removedRoutes: Array<[string, string, unknown]> = [
        ['POST', '', validRule],
        ['POST', '/natural-language', { FileDefinitionId: DEFINITION_ID, Request: 'Amount must be positive' }],
        ['POST', `/${RULE_ID}/regenerate`, { Request: 'Amount must be positive' }],
        ['PUT', `/${RULE_ID}`, { Config: { ...validRule.Config, id: RULE_ID } }],
        ['DELETE', `/${RULE_ID}`, null],
        ['PATCH', `/${RULE_ID}/toggle`, null],
    ];

    it.each(mutations)('rejects %s %s for standard users', async (method, path, body) => {
        const res = await call('user', method, path, body);
        expect(res.status).toBe(403);
    });

    it.each(mutations)('allows %s %s for admins', async (method, path, body) => {
        const res = await call('admin', method, path, body);
        expect(res.status).toBe(200);
    });

    it.each(removedRoutes)('no longer exposes %s %s', async (method, path, body) => {
        const res = await call('admin', method, path, body);
        expect(res.status).toBe(404);
    });

    it.each(['admin', 'user'] as const)('allows %s to read rules', async role => {
        expect((await call(role, 'GET', `/definitions/${DEFINITION_ID}`)).status).toBe(200);
        expect((await call(role, 'GET', `/${RULE_ID}`)).status).toBe(200);
    });

    it('rejects an empty natural-language request', async () => {
        const res = await call('admin', 'POST', '/natural-language/propose', { ...workspaceDraft, Request: '  ' });
        expect(res.status).toBe(400);
    });

    it('requires a contract or definition id to validate a rule', async () => {
        const res = await call('admin', 'POST', '/validate', { Config: validRule.Config });
        expect(res.status).toBe(400);
    });

    it('requires a workspace contract to propose a natural-language rule', async () => {
        const res = await call('admin', 'POST', '/natural-language/propose', { Request: 'Amount must be positive' });
        expect(res.status).toBe(400);
    });
});

import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getConnection } from '../src/config/database';
import { appConfig } from '../src/config/appConfig';
import type { DefinitionContract } from '../src/contracts/definition-contract';
import type { RuleConfig } from '../src/contracts/rule-config';
import { Rule } from '../src/models/Rule.model';
import { DefinitionVersionService } from '../src/services/DefinitionVersion.service';
import { errorHandler } from '../src/middleware/errorHandler';
import { testRuleConfiguration, validateRuleConfiguration } from '../src/controllers/rule.controller';

jest.mock('../src/config/database', () => ({ getConnection: jest.fn() }));
jest.mock('../src/models/Rule.model', () => ({
    Rule: { hasAccessToFileDefinition: jest.fn() },
}));

const definitionId = '8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
const lookupId = 'ef97534b-7226-4cbf-bf89-a4793d93f012';
const previousLookupId = '2f6f7d3a-5c3b-4a53-8d62-6d3c1f1f9a11';
const candidate: RuleConfig = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Benefit plan must be a valid value',
    description: '',
    severity: 'Error',
    executionOrder: 1,
    enabled: true,
    table: 'Benefits (2026)',
    type: 'lookup',
    params: { column: 'Plan', lookupId, caseSensitive: true },
};
const otherRule: RuleConfig = {
    ...candidate,
    id: '22222222-2222-4222-8222-222222222222',
    type: 'length',
    params: { column: 'Plan', min: 1 },
};
const contract: DefinitionContract = {
    schemaVersion: 1,
    layout: 'sheets',
    ignoredSheets: [],
    encoding: 'auto',
    tables: [{
        sheet: 'Benefits (2026)', headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null,
        columns: [{ name: 'Plan', type: 'string', mustExist: true, nullable: false }],
    }],
    rules: [otherRule],
    lookups: {},
};

describe('candidate authoring lookup snapshots', () => {
    let server: Server;
    let baseUrl: string;
    let serviceServer: Server;
    let serviceUrl: string;
    const forwarded = jest.fn();
    const originalServiceConfig = { ...appConfig.rulesService };
    const readDraft = jest.spyOn(DefinitionVersionService, 'getDraftContract');
    let lookupRows: Array<{ Id: string; Name: string; Values: string }>;
    let savedContract: DefinitionContract;

    beforeAll(async () => {
        const service = express();
        service.use(express.json());
        service.post(['/v1/rules/validate', '/v1/rules/test'], (req, res) => {
            forwarded(req.path, req.body);
            res.json({ ok: true, errors: [], normalizedRule: req.body.rule, explanation: null, results: [] });
        });
        await new Promise<void>((resolve, reject) => {
            serviceServer = service.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
        });
        serviceUrl = `http://127.0.0.1:${(serviceServer.address() as AddressInfo).port}`;

        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            Object.assign(req, { user: { userId: 'admin-id', role: 'admin' } });
            next();
        });
        app.post('/validate', validateRuleConfiguration);
        app.post('/test', testRuleConfiguration);
        app.use(errorHandler);
        await new Promise<void>((resolve, reject) => {
            server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        appConfig.rulesService.url = serviceUrl;
        appConfig.rulesService.internalKey = 'unit-test-key';
        appConfig.rulesService.aadScope = '';
        lookupRows = [{ Id: lookupId, Name: 'BenefitPlan', Values: '["Gold","Silver"]' }];
        savedContract = contract;
        const pool = {
            request: () => {
                const request = {
                    input: () => request,
                    query: async (sql: string) => {
                        if (sql.includes('FROM FileDefinitions')) {
                            return { recordset: [{
                                Id: definitionId, Name: 'Benefits', Description: '', Status: 'Active',
                                DeliveryFolder: null, TemplateFilename: null, Contract: JSON.stringify(savedContract),
                            }] };
                        }
                        if (sql.includes('FROM Rules')) {
                            return { recordset: savedContract.rules.map(rule => ({
                                Config: JSON.stringify(rule), IsEnabled: rule.enabled,
                            })) };
                        }
                        return { recordset: lookupRows };
                    },
                };
                return request;
            },
        };
        jest.mocked(getConnection).mockResolvedValue(pool as never);
        jest.mocked(Rule.hasAccessToFileDefinition).mockResolvedValue(true);
    });

    afterAll(async () => {
        Object.assign(appConfig.rulesService, originalServiceConfig);
        jest.restoreAllMocks();
        await Promise.all([
            new Promise<void>(resolve => server.close(() => resolve())),
            new Promise<void>(resolve => serviceServer.close(() => resolve())),
        ]);
    });

    const post = (path: string, body: object) => fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    it.each([
        ['/validate', 'workspace'], ['/test', 'workspace'],
        ['/validate', 'saved'], ['/test', 'saved'],
    ])('forwards authoritative candidate lookup values through %s for a %s request', async (path, source) => {
        const body = source === 'workspace'
            ? {
                Contract: { ...contract, lookups: { [lookupId]: { name: 'Untrusted', values: ['anything'] } } },
                Rules: [otherRule], Config: candidate, examples: [],
            }
            : { FileDefinitionId: definitionId, Config: candidate, examples: [] };

        const response = await post(path, body);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, ok: true });
        expect(forwarded).toHaveBeenCalledWith(`/v1/rules${path}`, expect.objectContaining({
            contract: {
                ...contract,
                lookups: { [lookupId]: { name: 'BenefitPlan', values: ['Gold', 'Silver'] } },
            },
            rule: candidate,
        }));
        if (source === 'saved') {
            expect(Rule.hasAccessToFileDefinition).toHaveBeenCalledWith(definitionId, 'admin-id');
            expect(readDraft).toHaveBeenCalledWith(definitionId, candidate.id);
        }
    });

    it.each(['workspace', 'saved'])('replaces an edited rule lookup in the %s snapshot', async source => {
        const previous: RuleConfig = { ...candidate, params: { column: 'Plan', lookupId: previousLookupId } };
        const saved: DefinitionContract = {
            ...contract, rules: [previous, otherRule],
            lookups: { [previousLookupId]: { name: 'Previous', values: ['Old'] } },
        };
        savedContract = saved;
        const response = await post('/validate', {
            ...(source === 'workspace' ? { Contract: saved, Rules: saved.rules } : { FileDefinitionId: definitionId }),
            Config: candidate,
        });

        expect(response.status).toBe(200);
        expect(forwarded).toHaveBeenCalledWith('/v1/rules/validate', expect.objectContaining({
            contract: {
                ...contract,
                lookups: { [lookupId]: { name: 'BenefitPlan', values: ['Gold', 'Silver'] } },
            },
        }));
    });

    it.each(['/validate', '/test'])('rejects a genuinely missing candidate lookup on %s', async path => {
        lookupRows = [];
        const response = await post(path, { Contract: contract, Rules: [], Config: candidate });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ success: false, message: expect.stringContaining('missing lookup') });
        expect(forwarded).not.toHaveBeenCalled();
    });

    it('keeps normal saved-draft lookup validation when no candidate is excluded', async () => {
        savedContract = { ...contract, rules: [candidate] };
        lookupRows = [];

        await expect(DefinitionVersionService.getDraftContract(definitionId)).rejects.toThrow(/missing lookup/);
    });

    it('rejects a malformed saved-definition candidate with an input error', async () => {
        const response = await post('/validate', { FileDefinitionId: definitionId, Config: { ...candidate, id: 42 } });

        expect(response.status).toBe(400);
        expect(forwarded).not.toHaveBeenCalled();
    });

    it.each(['/validate', '/test'])('preserves saved-definition access checks on %s', async path => {
        jest.mocked(Rule.hasAccessToFileDefinition).mockResolvedValue(false);
        const response = await post(path, { FileDefinitionId: definitionId, Config: candidate });

        expect(response.status).toBe(403);
        expect(readDraft).not.toHaveBeenCalled();
        expect(getConnection).not.toHaveBeenCalled();
        expect(forwarded).not.toHaveBeenCalled();
    });
});

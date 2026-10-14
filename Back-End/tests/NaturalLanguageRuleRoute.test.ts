import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';

const proposeNaturalLanguageRule = jest.fn();
jest.mock('../src/services/NaturalLanguageRule.service', () => {
    const actual = jest.requireActual('../src/services/NaturalLanguageRule.service');
    return {
        ...actual,
        proposeNaturalLanguageRule: (...args: unknown[]) => proposeNaturalLanguageRule(...args),
    };
});

const buildAuthoringContract = jest.fn();
jest.mock('../src/services/RuleAuthoring.service', () => ({
    ...jest.requireActual('../src/services/RuleAuthoring.service'),
    buildAuthoringContract: (...args: unknown[]) => buildAuthoringContract(...args),
}));

const { proposeRuleFromDescription } = require('../src/controllers/rule.controller') as typeof import('../src/controllers/rule.controller');
const { RuleGenerationError, RuleGenerationCancelledError } = require('../src/services/NaturalLanguageRule.service') as typeof import('../src/services/NaturalLanguageRule.service');
const { AuthoringInputError } = require('../src/services/RuleAuthoring.service') as typeof import('../src/services/RuleAuthoring.service');

const contract = { schemaVersion: 1, tables: [], rules: [], lookups: {} };
const body = { Request: ' Email must not end with microsoft.com ', Contract: { schemaVersion: 1 }, Rules: [] };
const readLines = async (response: globalThis.Response) => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

describe('natural-language rule proposal endpoint', () => {
    let server: Server;
    let url: string;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        app.post('/rules/natural-language/propose', (req, _res, next) => {
            (req as { user?: unknown }).user = { userId: 'admin-id', role: 'admin' };
            next();
        }, proposeRuleFromDescription);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rules/natural-language/propose`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    beforeEach(() => {
        jest.resetAllMocks();
        buildAuthoringContract.mockResolvedValue(contract);
    });

    const post = (accept: string, payload: object = body, signal?: AbortSignal) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: accept },
        body: JSON.stringify(payload),
        signal,
    });

    it('streams progress and then the result as NDJSON', async () => {
        proposeNaturalLanguageRule.mockImplementation(async (_contract, _request, options) => {
            options.onProgress({ level: 'info', message: 'Asking the model', elapsedMs: 5 });
            options.onProgress({ level: 'success', message: 'Proposed rule "No Microsoft"', elapsedMs: 9000 });
            return { outcome: 'natural_language', reason: 'No suffix type', config: { name: 'No Microsoft' } };
        });

        const response = await post('application/x-ndjson');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
        expect(await readLines(response)).toEqual([
            { type: 'progress', level: 'info', message: 'Asking the model', elapsedMs: 5 },
            { type: 'progress', level: 'success', message: 'Proposed rule "No Microsoft"', elapsedMs: 9000 },
            { type: 'result', success: true, outcome: 'natural_language', reason: 'No suffix type', config: { name: 'No Microsoft' } },
        ]);
        expect(buildAuthoringContract).toHaveBeenCalledWith(body.Contract, body.Rules, { excludeRuleId: undefined });
        expect(proposeNaturalLanguageRule).toHaveBeenCalledWith(contract, 'Email must not end with microsoft.com', expect.anything(), undefined);
    });

    it('streams the detailed reason when the review fails', async () => {
        proposeNaturalLanguageRule.mockImplementation(async (_contract, _request, options) => {
            options.onProgress({ level: 'error', message: 'The model reached its output limit', elapsedMs: 40000 });
            throw new RuleGenerationError('The model reached its output limit of 16000 tokens before finishing the proposal [response resp_1]');
        });

        const lines = await readLines(await post('application/x-ndjson'));

        expect(lines[lines.length - 1]).toEqual({
            type: 'error', success: false, statusCode: 502,
            message: 'The model reached its output limit of 16000 tokens before finishing the proposal [response resp_1]',
        });
    });

    it('does not expose unexpected errors', async () => {
        proposeNaturalLanguageRule.mockRejectedValue(new Error('Login failed for user sa'));
        const lines = await readLines(await post('application/x-ndjson'));
        expect(lines).toEqual([{ type: 'error', success: false, statusCode: 500, message: 'An unexpected error stopped the rule review; see the backend log for details' }]);
    });

    it('aborts the review when the client disconnects', async () => {
        let signal: AbortSignal | undefined;
        let finish: () => void = () => undefined;
        proposeNaturalLanguageRule.mockImplementation((_contract, _request, options) => new Promise((_resolve, reject) => {
            signal = options.signal;
            options.onProgress({ level: 'info', message: 'Asking the model', elapsedMs: 1 });
            signal!.addEventListener('abort', () => { reject(new RuleGenerationCancelledError()); finish(); });
        }));
        const aborted = new Promise<void>(resolve => { finish = resolve; });
        const client = new AbortController();

        const response = await post('application/x-ndjson', body, client.signal);
        const reader = response.body!.getReader();
        await reader.read();
        client.abort();
        await aborted;

        expect(signal!.aborted).toBe(true);
    });

    it('keeps the single JSON response for clients that do not ask for a stream', async () => {
        proposeNaturalLanguageRule.mockResolvedValue({ outcome: 'rejected', reason: 'Needs CRM data' });
        const response = await post('application/json');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, outcome: 'rejected', reason: 'Needs CRM data' });

        proposeNaturalLanguageRule.mockRejectedValue(new RuleGenerationError('Foundry denied access (403): nope'));
        const failed = await post('application/json');
        expect(failed.status).toBe(502);
        expect(await failed.json()).toEqual({ success: false, message: 'Foundry denied access (403): nope' });
    });

    it('reports an invalid draft contract before calling the model', async () => {
        buildAuthoringContract.mockRejectedValue(new AuthoringInputError('A definition contract is required'));

        const response = await post('application/x-ndjson');

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ success: false, message: 'A definition contract is required' });
        expect(proposeNaturalLanguageRule).not.toHaveBeenCalled();
    });

    it('streams regeneration progress and keeps the identity of the natural-language rule being replaced', async () => {
        const existing = {
            id: 'rule-1', name: 'Old', description: '', severity: 'Error', executionOrder: 3, enabled: false,
            table: null, type: 'naturalLanguage', params: {},
        };
        proposeNaturalLanguageRule.mockImplementation(async (_contract, _request, options) => {
            options.onProgress({ level: 'success', message: 'Regenerated rule "Revised"', elapsedMs: 1200 });
            return { outcome: 'natural_language', reason: 'Revised', config: { id: 'rule-1', name: 'Revised' } };
        });

        const response = await post('application/x-ndjson', { ...body, Request: ' Revised request ', Config: existing });

        expect(await readLines(response)).toEqual([
            { type: 'progress', level: 'success', message: 'Regenerated rule "Revised"', elapsedMs: 1200 },
            { type: 'result', success: true, outcome: 'natural_language', reason: 'Revised', config: { id: 'rule-1', name: 'Revised' } },
        ]);
        expect(buildAuthoringContract).toHaveBeenCalledWith(body.Contract, body.Rules, { excludeRuleId: 'rule-1' });
        expect(proposeNaturalLanguageRule).toHaveBeenCalledWith(contract, 'Revised request', expect.anything(), existing);
    });
});

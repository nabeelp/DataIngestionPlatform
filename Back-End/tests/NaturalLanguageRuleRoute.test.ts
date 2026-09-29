import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';

const createNaturalLanguageRule = jest.fn();
const regenerateNaturalLanguageRule = jest.fn();
jest.mock('../src/services/NaturalLanguageRule.service', () => {
    const actual = jest.requireActual('../src/services/NaturalLanguageRule.service');
    return {
        ...actual,
        createNaturalLanguageRule: (...args: unknown[]) => createNaturalLanguageRule(...args),
        regenerateNaturalLanguageRule: (...args: unknown[]) => regenerateNaturalLanguageRule(...args),
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRuleFromDescription, regenerateRuleFromDescription } = require('../src/controllers/rule.controller') as typeof import('../src/controllers/rule.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RuleGenerationError, RuleGenerationCancelledError } = require('../src/services/NaturalLanguageRule.service') as typeof import('../src/services/NaturalLanguageRule.service');

const body = { FileDefinitionId: '8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d', Request: ' Email must not end with microsoft.com ' };
const readLines = async (response: globalThis.Response) => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

describe('natural-language rule endpoint', () => {
    let server: Server;
    let url: string;
    let regenerateUrl: string;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        app.post('/rules/natural-language', (req, _res, next) => {
            (req as { user?: unknown }).user = { userId: 'admin-id', role: 'admin' };
            next();
        }, createRuleFromDescription);
        app.post('/rules/:id/regenerate', (req, _res, next) => {
            (req as { user?: unknown }).user = { userId: 'admin-id', role: 'admin' };
            next();
        }, regenerateRuleFromDescription);
        await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rules/natural-language`;
        regenerateUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rules/rule-1/regenerate`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    const post = (accept: string, signal?: AbortSignal) => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: accept },
        body: JSON.stringify(body),
        signal,
    });

    const postRegenerate = (accept: string) => fetch(regenerateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: accept },
        body: JSON.stringify({ Request: ' Revised request ' }),
    });

    it('streams progress and then the result as NDJSON', async () => {
        createNaturalLanguageRule.mockImplementation(async (_id, _request, _user, options) => {
            options.onProgress({ level: 'info', message: 'Asking the model', elapsedMs: 5 });
            options.onProgress({ level: 'success', message: 'Saved draft rule "No Microsoft"', elapsedMs: 9000 });
            return { outcome: 'natural_language', reason: 'No suffix type', rule: { Name: 'No Microsoft' }, pseudocode: 'p', typescript: 't' };
        });

        const response = await post('application/x-ndjson');

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
        expect(await readLines(response)).toEqual([
            { type: 'progress', level: 'info', message: 'Asking the model', elapsedMs: 5 },
            { type: 'progress', level: 'success', message: 'Saved draft rule "No Microsoft"', elapsedMs: 9000 },
            { type: 'result', success: true, outcome: 'natural_language', reason: 'No suffix type', rule: { Name: 'No Microsoft' }, pseudocode: 'p', typescript: 't' },
        ]);
        expect(createNaturalLanguageRule).toHaveBeenCalledWith(body.FileDefinitionId, 'Email must not end with microsoft.com', 'admin-id', expect.anything());
    });

    it('streams the detailed reason when the review fails', async () => {
        createNaturalLanguageRule.mockImplementation(async (_id, _request, _user, options) => {
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
        createNaturalLanguageRule.mockRejectedValue(new Error('Login failed for user sa'));
        const lines = await readLines(await post('application/x-ndjson'));
        expect(lines).toEqual([{ type: 'error', success: false, statusCode: 500, message: 'An unexpected error stopped the rule review; see the backend log for details' }]);
    });

    it('aborts the review when the client disconnects', async () => {
        let signal: AbortSignal | undefined;
        let finish: () => void = () => undefined;
        createNaturalLanguageRule.mockImplementation((_id, _request, _user, options) => new Promise((_resolve, reject) => {
            signal = options.signal;
            options.onProgress({ level: 'info', message: 'Asking the model', elapsedMs: 1 });
            signal!.addEventListener('abort', () => { reject(new RuleGenerationCancelledError()); finish(); });
        }));
        const aborted = new Promise<void>(resolve => { finish = resolve; });
        const client = new AbortController();

        const response = await post('application/x-ndjson', client.signal);
        const reader = response.body!.getReader();
        await reader.read();
        client.abort();
        await aborted;

        expect(signal!.aborted).toBe(true);
    });

    it('keeps the single JSON response for clients that do not ask for a stream', async () => {
        createNaturalLanguageRule.mockResolvedValue({ outcome: 'rejected', reason: 'Needs CRM data' });
        const response = await post('application/json');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, outcome: 'rejected', reason: 'Needs CRM data' });

        createNaturalLanguageRule.mockRejectedValue(new RuleGenerationError('Foundry denied access (403): nope'));
        const failed = await post('application/json');
        expect(failed.status).toBe(502);
        expect(await failed.json()).toEqual({ success: false, message: 'Foundry denied access (403): nope' });
    });

    it('streams regeneration progress and updates the requested rule', async () => {
        regenerateNaturalLanguageRule.mockImplementation(async (_id, _request, _user, options) => {
            options.onProgress({ level: 'success', message: 'Regenerated draft rule "Revised"', elapsedMs: 1200 });
            return { outcome: 'natural_language', reason: 'Revised', rule: { Id: 'rule-1', Name: 'Revised' }, pseudocode: 'p2', typescript: 't2' };
        });

        const response = await postRegenerate('application/x-ndjson');

        expect(await readLines(response)).toEqual([
            { type: 'progress', level: 'success', message: 'Regenerated draft rule "Revised"', elapsedMs: 1200 },
            { type: 'result', success: true, outcome: 'natural_language', reason: 'Revised', rule: { Id: 'rule-1', Name: 'Revised' }, pseudocode: 'p2', typescript: 't2' },
        ]);
        expect(regenerateNaturalLanguageRule).toHaveBeenCalledWith('rule-1', 'Revised request', 'admin-id', expect.anything());
    });
});

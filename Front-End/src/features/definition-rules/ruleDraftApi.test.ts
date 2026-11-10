import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import {
  getDraftRules,
  preflightDefinition,
  proposeNaturalLanguageRule,
  readNdjson,
  runDraftDryRun,
  testDraftRuleExamples,
  validateDraftRule,
  type DraftContext,
  type ReviewActivity,
} from './ruleDraftApi';

beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => 'tkn' }));
afterEach(() => vi.unstubAllGlobals());

/** A body that delivers the given chunks one at a time, as a slow network would. */
const chunked = (chunks: string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
};

const stubStream = (chunks: string[], init: ResponseInit = { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(chunked(chunks), init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const stubJson = (body: unknown, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const contract = {
  schemaVersion: 1,
  layout: 'single',
  ignoredSheets: [],
  encoding: 'auto',
  tables: [{ sheet: null, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [] }],
  rules: [{ id: 'stale' }],
  lookups: { stale: { name: 'x', values: [] } },
} as unknown as DefinitionContract;

const rule = (id: string): RuleConfig => ({
  id, name: id, description: '', severity: 'Error', executionOrder: 1, enabled: true, table: null,
  type: 'range', params: { column: 'Amount', min: 0 },
}) as RuleConfig;

const context: DraftContext = { contract, rules: [rule('a'), rule('b')] };

const propose = (onActivity: (activity: ReviewActivity) => void = () => undefined, signal?: AbortSignal, existing?: RuleConfig) =>
  proposeNaturalLanguageRule({ context, request: 'Email must not end with microsoft.com', existing, signal, onActivity });

describe('readNdjson', () => {
  it('parses lines split across chunks, including multi-byte characters and a final line without a newline', async () => {
    const events: unknown[] = [];
    await readNdjson(chunked(['{"a":1}\n{"b":', '"café"}\n\n', '{"c":3}']), event => events.push(event));
    expect(events).toEqual([{ a: 1 }, { b: 'café' }, { c: 3 }]);
  });

  it('rejects an unreadable line', async () => {
    await expect(readNdjson(chunked(['not json\n']), () => undefined)).rejects.toThrow('could not be read');
  });
});

describe('proposeNaturalLanguageRule', () => {
  it('sends the unsaved draft, asks for a stream and reports activity before resolving', async () => {
    const fetchMock = stubStream([
      '{"type":"progress","level":"info","message":"Asking gpt-6-luna","elapsedMs":10}\n',
      '{"type":"progress","level":"info","message":"The model is still reasoning about the rule (5.0 s)","elapsedMs":5010}\n',
      '{"type":"result","success":true,"outcome":"rejected","reason":"Needs CRM data"}\n',
    ]);
    const activity: ReviewActivity[] = [];

    await expect(propose(entry => activity.push(entry))).resolves.toMatchObject({ outcome: 'rejected', reason: 'Needs CRM data' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/rules\/natural-language\/propose$/);
    expect(init.headers).toMatchObject({ Accept: 'application/x-ndjson' });
    const body = JSON.parse(init.body);
    expect(body.Request).toBe('Email must not end with microsoft.com');
    expect(body.Contract.rules).toEqual([]);
    expect(body.Contract.lookups).toEqual({});
    expect(body.Rules.map((item: RuleConfig) => item.id)).toEqual(['a', 'b']);
    expect(body).not.toHaveProperty('Config');
    expect(activity.map(entry => entry.message)).toEqual(['Asking gpt-6-luna', 'The model is still reasoning about the rule (5.0 s)']);
  });

  it('sends the rule being regenerated and leaves it out of the other rules', async () => {
    const fetchMock = stubStream(['{"type":"result","success":true,"outcome":"rejected","reason":"x"}\n']);
    await propose(undefined, undefined, rule('a'));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.Config.id).toBe('a');
    expect(body.Rules.map((item: RuleConfig) => item.id)).toEqual(['b']);
  });

  it('rejects with the detailed reason the server streamed', async () => {
    stubStream([
      '{"type":"progress","level":"error","message":"The model reached its output limit","elapsedMs":40000}\n',
      '{"type":"error","success":false,"statusCode":502,"message":"The model reached its output limit of 16000 tokens [response resp_1]"}\n',
    ]);
    await expect(propose()).rejects.toThrow('The model reached its output limit of 16000 tokens [response resp_1]');
  });

  it('preserves the validation explanation and next step in a rejected result', async () => {
    const reason = 'The proposed rule was not saved. The generated SQL has invalid syntax. Split the request into simpler conditions.';
    stubStream([
      JSON.stringify({ type: 'progress', level: 'error', message: reason, elapsedMs: 32 }) + '\n',
      JSON.stringify({ type: 'result', success: true, outcome: 'rejected', reason }) + '\n',
    ]);
    const activity: ReviewActivity[] = [];

    await expect(propose(entry => activity.push(entry))).resolves.toMatchObject({ outcome: 'rejected', reason });
    expect(activity[0].message).toBe(reason);
  });

  it('explains a stream that ends without a result', async () => {
    stubStream(['{"type":"progress","level":"info","message":"Asking","elapsedMs":1}\n']);
    await expect(propose()).rejects.toThrow('The connection to the server closed before the rule review finished');
  });

  it('surfaces request validation and authorization errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ msg: 'Invalid value' }] }), { status: 400 })));
    await expect(propose()).rejects.toThrow('Invalid value');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429, statusText: 'Too Many Requests' })));
    await expect(propose()).rejects.toThrow('The server returned 429 Too Many Requests');
  });

  it('accepts a single JSON result when the server does not stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, outcome: 'rejected', reason: 'x' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    await expect(propose()).resolves.toMatchObject({ outcome: 'rejected' });
  });

  it('passes the abort signal to fetch', async () => {
    const fetchMock = stubStream(['{"type":"result","success":true,"outcome":"rejected","reason":"x"}\n']);
    const controller = new AbortController();
    await propose(undefined, controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe('draft requests', () => {
  it('validates a rule against the unsaved structure without the rule itself among the other rules', async () => {
    const fetchMock = stubJson({ success: true, ok: true, errors: [] });
    await expect(validateDraftRule(context, rule('a'))).resolves.toMatchObject({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/rules\/validate$/);
    const body = JSON.parse(init.body);
    expect(body.Config.id).toBe('a');
    expect(body.Rules.map((item: RuleConfig) => item.id)).toEqual(['b']);
    expect(body.Contract.rules).toEqual([]);
    expect(body).not.toHaveProperty('FileDefinitionId');
  });

  it('tests examples with the same draft context', async () => {
    const fetchMock = stubJson({ success: true, ok: true, errors: [], results: [] });
    await testDraftRuleExamples(context, rule('a'), [{ table: 'T' }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/rules\/test$/);
    expect(body.examples).toEqual([{ table: 'T' }]);
    expect(body.Rules).toHaveLength(1);
  });

  it('preflights the whole draft, naming the saved definition when there is one', async () => {
    const fetchMock = stubJson({ success: true, ok: true, errors: [], diff: null });
    await preflightDefinition(context, 'def-1');
    await preflightDefinition(context, null);
    const [first, second] = fetchMock.mock.calls.map(call => JSON.parse(call[1].body));
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/admin\/file-definitions\/preflight$/);
    expect(first.definitionId).toBe('def-1');
    expect(first.rules).toHaveLength(2);
    expect(second).not.toHaveProperty('definitionId');
  });

  it('previews the unsaved draft on a past upload', async () => {
    const fetchMock = stubJson({ success: true, status: 'passed' });
    await runDraftDryRun(context, 'upload 1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/uploads\/upload%201\/dry-run$/);
    expect(JSON.parse(init.body).Rules).toHaveLength(2);
  });

  it('reads the saved draft rules with the revision to send back when saving', async () => {
    stubJson({ success: true, rules: [rule('a')], revision: 'rev-1' });
    await expect(getDraftRules('def-1')).resolves.toEqual({ rules: [rule('a')], revision: 'rev-1' });
  });
});

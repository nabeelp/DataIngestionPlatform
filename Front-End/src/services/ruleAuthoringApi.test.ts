import { afterEach, describe, expect, it, vi } from 'vitest';
import { readNdjson, regenerateNaturalLanguageRule, reviewNaturalLanguageRule, type ReviewActivity } from './ruleAuthoringApi';

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

const review = (onActivity: (activity: ReviewActivity) => void = () => undefined, signal?: AbortSignal) =>
  reviewNaturalLanguageRule({ baseUrl: '/api/v1', token: 'tkn', fileDefinitionId: 'def-1', request: 'Email must not end with microsoft.com', signal, onActivity });

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

describe('reviewNaturalLanguageRule', () => {
  it('asks for a stream and reports activity before resolving with the result', async () => {
    const fetchMock = stubStream([
      '{"type":"progress","level":"info","message":"Asking gpt-5.3-codex","elapsedMs":10}\n',
      '{"type":"progress","level":"info","message":"The model is still reasoning about the rule (5.0 s)","elapsedMs":5010}\n',
      '{"type":"result","success":true,"outcome":"rejected","reason":"Needs CRM data"}\n',
    ]);
    const activity: ReviewActivity[] = [];

    await expect(review(entry => activity.push(entry))).resolves.toMatchObject({ outcome: 'rejected', reason: 'Needs CRM data' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/rules/natural-language');
    expect(init.headers).toMatchObject({ Accept: 'application/x-ndjson', Authorization: 'Bearer tkn' });
    expect(JSON.parse(init.body)).toEqual({ FileDefinitionId: 'def-1', Request: 'Email must not end with microsoft.com' });
    expect(activity.map(entry => entry.message)).toEqual(['Asking gpt-5.3-codex', 'The model is still reasoning about the rule (5.0 s)']);
  });

  it('rejects with the detailed reason the server streamed', async () => {
    stubStream([
      '{"type":"progress","level":"error","message":"The model reached its output limit","elapsedMs":40000}\n',
      '{"type":"error","success":false,"statusCode":502,"message":"The model reached its output limit of 16000 tokens [response resp_1]"}\n',
    ]);
    await expect(review()).rejects.toThrow('The model reached its output limit of 16000 tokens [response resp_1]');
  });

  it('explains a stream that ends without a result', async () => {
    stubStream(['{"type":"progress","level":"info","message":"Asking","elapsedMs":1}\n']);
    await expect(review()).rejects.toThrow('The connection to the server closed before the rule review finished');
  });

  it('surfaces request validation and authorization errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ msg: 'Invalid value' }] }), { status: 400 })));
    await expect(review()).rejects.toThrow('Invalid value');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429, statusText: 'Too Many Requests' })));
    await expect(review()).rejects.toThrow('The server returned 429 Too Many Requests');
  });

  it('accepts a single JSON result from an older backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, outcome: 'rejected', reason: 'x' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    await expect(review()).resolves.toMatchObject({ outcome: 'rejected' });
  });

  it('passes the abort signal to fetch', async () => {
    const fetchMock = stubStream(['{"type":"result","success":true,"outcome":"rejected","reason":"x"}\n']);
    const controller = new AbortController();
    await review(undefined, controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('regenerates an existing rule from revised natural-language text', async () => {
    const config = {
      id: 'rule-1',
      name: 'Revised',
      description: 'Email must be lowercase',
      severity: 'Error',
      executionOrder: 1,
      enabled: true,
      table: null,
      type: 'naturalLanguage',
      params: { mode: 'row', failWhen: 'Email != LOWER(Email)' },
    };
    const fetchMock = stubStream([JSON.stringify({
      type: 'result',
      success: true,
      outcome: 'natural_language',
      reason: 'revised',
      config,
    }) + '\n']);

    await expect(regenerateNaturalLanguageRule({
      baseUrl: '/api/v1',
      token: 'tkn',
      ruleId: 'rule-1',
      request: 'Email must be lowercase',
      onActivity: () => undefined,
    })).resolves.toMatchObject({ outcome: 'natural_language', config });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/rules/rule-1/regenerate');
    expect(JSON.parse(init.body)).toEqual({ Request: 'Email must be lowercase' });
  });
});

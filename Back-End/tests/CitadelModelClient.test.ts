import { appConfig } from '../src/config/appConfig';
import { callModel } from '../src/services/naturalLanguageRule/modelClient';
import type { ModelCall } from '../src/services/naturalLanguageRule/types';

const originalConfig = { ...appConfig.azure.citadel };
const fetchMock = jest.spyOn(globalThis, 'fetch');
const call: ModelCall = {
    instructions: 'Return JSON',
    input: 'Check the schema',
    schemaName: 'test',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    noun: 'proposal',
};

beforeEach(() => {
    fetchMock.mockReset();
    appConfig.azure.citadel = {
        endpoint: 'https://np-aigw-apim.azure-api.net/models/',
        subscriptionKey: 'unit-test-subscription-key',
        model: 'test-model',
    };
});

afterEach(() => {
    appConfig.azure.citadel = { ...originalConfig };
});

afterAll(() => fetchMock.mockRestore());

function mockResponse() {
    const response = {
        id: 'resp_citadel',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
        usage: { input_tokens: 10, output_tokens: 2 },
    };
    return fetchMock.mockImplementation(async () => new Response(
        `data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
    ));
}

it('sends streaming Responses requests only to Citadel with the APIM header and no bearer token', async () => {
    const fetch = mockResponse();
    const result = await callModel(call, jest.fn());
    expect(result).toMatchObject({ text: '{}', responseId: 'resp_citadel' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://np-aigw-apim.azure-api.net/models/responses');
    expect(options?.method).toBe('POST');
    const headers = new Headers(options?.headers);
    expect(headers.get('Ocp-Apim-Subscription-Key')).toBe('unit-test-subscription-key');
    expect(headers.has('Authorization')).toBe(false);
    expect(JSON.parse(String(options?.body))).toMatchObject({
        model: 'test-model', stream: true, store: false,
        text: { format: { type: 'json_schema', strict: true } },
    });

    appConfig.azure.citadel.subscriptionKey = 'rotated-test-key';
    await callModel(call, jest.fn());
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('Ocp-Apim-Subscription-Key')).toBe('rotated-test-key');
});

it.each([
    'http://np-aigw-apim.azure-api.net/models',
    'not-a-url',
    'https://user:password@example.com/models',
    'https://example.com/models?key=value',
    'https://example.com/models#fragment',
])('rejects unsafe or invalid endpoint %s before making a request', async endpoint => {
    const fetch = mockResponse();
    appConfig.azure.citadel.endpoint = endpoint;
    await expect(callModel(call, jest.fn())).rejects.toThrow('CITADEL_ENDPOINT');
    expect(fetch).not.toHaveBeenCalled();
});

it.each(['subscriptionKey', 'model'] as const)('rejects missing %s without direct Foundry fallback', async field => {
    const fetch = mockResponse();
    appConfig.azure.citadel[field] = ' ';
    await expect(callModel(call, jest.fn())).rejects.toThrow('Citadel requires');
    expect(fetch).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 429])('surfaces gateway error %s', async status => {
    fetchMock.mockImplementation(async () => new Response(
        JSON.stringify({ error: { message: 'Gateway failure' } }),
        { status, headers: { 'Content-Type': 'application/json' } },
    ));
    await expect(callModel(call, jest.fn())).rejects.toThrow(new RegExp(`Citadel.*${status}`));
});

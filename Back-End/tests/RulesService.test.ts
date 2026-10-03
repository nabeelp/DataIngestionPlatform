import { appConfig } from '../src/config/appConfig';
import { RulesService } from '../src/services/RulesService.service';
import type { DefinitionContract } from '../src/contracts/definition-contract';
import type { RuleConfig } from '../src/contracts/rule-config';

const contract = { schemaVersion: 1 } as DefinitionContract;
const rule: RuleConfig = {
    id: 'rule-1',
    name: 'Required email',
    description: '',
    severity: 'Error',
    executionOrder: 1,
    enabled: true,
    table: null,
    type: 'required',
    params: { columns: ['Email'] },
};

describe('RulesService HTTP client', () => {
    const originalKey = appConfig.rulesService.internalKey;
    const originalUrl = appConfig.rulesService.url;
    const originalTimeout = appConfig.rulesService.timeoutMs;
    const originalFetch = global.fetch;
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

    beforeEach(() => {
        appConfig.rulesService.internalKey = 'unit-test-key';
        appConfig.rulesService.url = 'http://127.0.0.1:8000';
        appConfig.rulesService.timeoutMs = 1000;
        fetchMock.mockReset();
        global.fetch = fetchMock;
    });

    afterAll(() => {
        appConfig.rulesService.internalKey = originalKey;
        appConfig.rulesService.url = originalUrl;
        appConfig.rulesService.timeoutMs = originalTimeout;
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('sends authenticated RuleConfig validation requests', async () => {
        const result = { ok: true, errors: [], normalizedRule: rule, explanation: null };
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => result,
        } as Response);

        await expect(RulesService.validateRule(contract, rule)).resolves.toEqual(result);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://127.0.0.1:8000/v1/rules/validate');
        expect(init?.headers).toEqual({
            'content-type': 'application/json',
            'x-rules-service-key': 'unit-test-key',
        });
        expect(JSON.parse(String(init?.body))).toEqual({ contract, rule });
    });

    it('maps validation HTTP errors to client validation responses', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 422 } as Response);

        await expect(RulesService.validateRule(contract, rule))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('fails explicitly when the internal credential is missing', async () => {
        appConfig.rulesService.internalKey = '';

        await expect(RulesService.validateRule(contract, rule))
            .rejects.toMatchObject({ statusCode: 503 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

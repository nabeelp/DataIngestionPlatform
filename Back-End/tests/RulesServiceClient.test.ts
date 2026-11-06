import { appConfig } from '../src/config/appConfig';
import { RulesServiceClient } from '../src/services/RulesServiceClient';
import { DefaultAzureCredential } from '@azure/identity';
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
    type: 'enum',
    params: { column: 'Email', values: ['a@x.com'] },
};

describe('RulesServiceClient HTTP client', () => {
    const originalKey = appConfig.rulesService.internalKey;
    const originalAadScope = appConfig.rulesService.aadScope;
    const originalUrl = appConfig.rulesService.url;
    const originalTimeout = appConfig.rulesService.timeoutMs;
    const originalFetch = global.fetch;
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

    beforeEach(() => {
        appConfig.rulesService.internalKey = 'unit-test-key';
        appConfig.rulesService.aadScope = '';
        appConfig.rulesService.url = 'http://127.0.0.1:8000';
        appConfig.rulesService.timeoutMs = 1000;
        fetchMock.mockReset();
        global.fetch = fetchMock;
    });

    afterAll(() => {
        appConfig.rulesService.internalKey = originalKey;
        appConfig.rulesService.aadScope = originalAadScope;
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

        await expect(RulesServiceClient.validateRule(contract, rule)).resolves.toEqual(result);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://127.0.0.1:8000/v1/rules/validate');
        expect(init?.headers).toEqual({
            'content-type': 'application/json',
            'x-rules-service-key': 'unit-test-key',
        });
        expect(JSON.parse(String(init?.body))).toEqual({ contract, rule });
    });

    it('checks a disabled rule as if it were enabled, because the rules service only runs enabled rules', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, errors: [] }) } as Response);
        const disabled = { ...rule, enabled: false };

        await RulesServiceClient.validateRule(contract, disabled);
                await RulesServiceClient.testRule(contract, disabled, []);

        for (const [, init] of fetchMock.mock.calls) {
            expect(JSON.parse(String(init?.body)).rule).toEqual({ ...rule, enabled: true });
        }
        expect(disabled.enabled).toBe(false);
    });

    it('preserves actionable candidate and contract configuration errors', async () => {
        const candidateError = {
            ok: false,
            errors: [{ path: '$.params', message: 'Enter a minimum or maximum row count.' }],
            normalizedRule: null,
            explanation: null,
        };
        const contractError = {
            ok: false,
            errors: [{ path: '$.rules[0].params', message: 'Enter a minimum or maximum row count.' }],
        };
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => candidateError } as Response)
            .mockResolvedValueOnce({ ok: true, json: async () => contractError } as Response);
        const candidate: RuleConfig = { ...rule, type: 'rowCount', params: {} };
        const withRules: DefinitionContract = { ...contract, rules: [candidate] };

        await expect(RulesServiceClient.validateRule(withRules, candidate)).resolves.toEqual(candidateError);
                await expect(RulesServiceClient.validateContract(withRules)).resolves.toEqual(contractError);
    });

    it('validates a contract without its disabled rules', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, errors: [] }) } as Response);
        const withRules = { schemaVersion: 1, rules: [rule, { ...rule, id: 'rule-2', enabled: false }] } as DefinitionContract;

        await RulesServiceClient.validateContract(withRules);

        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.contract.rules.map((item: RuleConfig) => item.id)).toEqual(['rule-1']);
    });

    it('sends a managed-identity bearer token when an Entra audience is configured', async () => {
        appConfig.rulesService.aadScope = 'api://rules-service/.default';
        const getToken = jest.spyOn(DefaultAzureCredential.prototype, 'getToken')
            .mockResolvedValue({ token: 'unit-test-token', expiresOnTimestamp: Date.now() + 60_000 });
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, errors: [], normalizedRule: rule, explanation: null }),
        } as Response);

        await RulesServiceClient.validateRule(contract, rule);

        expect(getToken).toHaveBeenCalledWith('api://rules-service/.default');
        expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
            'content-type': 'application/json',
            authorization: 'Bearer unit-test-token',
            'x-rules-service-key': 'unit-test-key',
        });
        getToken.mockRestore();
    });

    it('maps validation HTTP errors to client validation responses', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 422 } as Response);

        await expect(RulesServiceClient.validateRule(contract, rule))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('fails explicitly when the internal credential is missing', async () => {
        appConfig.rulesService.internalKey = '';

        await expect(RulesServiceClient.validateRule(contract, rule))
            .rejects.toMatchObject({ statusCode: 503 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

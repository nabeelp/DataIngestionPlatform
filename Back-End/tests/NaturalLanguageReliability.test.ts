import {
    proposeNaturalLanguageRule,
    type RuleDiagnosticEvent,
} from '../src/services/naturalLanguageRule';
import { RulesServiceClient } from '../src/services/RulesServiceClient';
import { appConfig } from '../src/config/appConfig';
import { goldenContract, loadGoldenCorpus, modelOutput, type GoldenCase } from './helpers/goldenCorpus';

const createResponse = jest.fn();
jest.mock('openai', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ responses: { create: createResponse } })),
}));
jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.mock('../src/models/Rule.model', () => ({ Rule: { create: jest.fn(), update: jest.fn() } }));
jest.mock('../src/services/RulesServiceClient', () => ({
    ...jest.requireActual('../src/services/RulesServiceClient'),
    RulesServiceClient: { validateRule: jest.fn(), testRule: jest.fn() },
}));

let responseCounter = 0;
const streamOf = (payload: object) => {
    const id = `resp_rel_${++responseCounter}`;
    return {
        async *[Symbol.asyncIterator]() {
            yield { type: 'response.created', response: { id } };
            yield {
                type: 'response.completed',
                response: {
                    id,
                    status: 'completed',
                    usage: { input_tokens: 300, output_tokens: 120 },
                    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
                },
            };
        },
    };
};

const corpus = loadGoldenCorpus();
const byId = (id: string): GoldenCase => corpus.cases.find(item => item.id === id) as GoldenCase;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fk = byId('xsheet-fk-orders-customers');
const sales = goldenContract(corpus, 'sales');
const contacts = goldenContract(corpus, 'contacts');
const examplesOf = (proposal: GoldenCase['referenceProposal']) => {
    const { passingExamples, failingExamples } = modelOutput(proposal);
    return { passingExamples, failingExamples };
};
const feedbackOf = (call: number): string => JSON.parse(createResponse.mock.calls[call][0].input).correctionFeedback;

/** A foreign-key proposal whose first passing example's related Customers row uses a column that does not exist. */
const withBadRelatedColumn = (): GoldenCase['referenceProposal'] => {
    const bad = clone(fk.referenceProposal);
    bad.examples[0].relatedRows[0].values = [{ column: 'Nope', value: 'x' }];
    return bad;
};

beforeEach(() => {
    jest.clearAllMocks();
    appConfig.azure.citadel = { endpoint: 'https://test.azure-api.net/models', subscriptionKey: 'test-key', model: 'test-model' };
    jest.mocked(RulesServiceClient.validateRule).mockImplementation(async (_contract, rule) => ({
        ok: true, errors: [], normalizedRule: rule, explanation: null,
    }));
    jest.mocked(RulesServiceClient.testRule).mockImplementation(async (_contract, _rule, examples) => ({
        ok: true,
        errors: [],
        results: (examples ?? []).map((example, index) => ({
            index: index + 1,
            table: 'Orders',
            expectedValid: Boolean((example as { expectedValid?: boolean }).expectedValid),
            actualValid: Boolean((example as { expectedValid?: boolean }).expectedValid),
            passed: true,
            error: null,
        })),
    }));
});

describe('examples are split into passing and failing lists', () => {
    it('combines the model lists (passing first) and stamps the verdict itself', async () => {
        createResponse.mockResolvedValue(streamOf(modelOutput(fk.referenceProposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        const examples = (result.config.params as unknown as { examples: Array<{ expectedValid: boolean }> }).examples;
        expect(examples.map(example => example.expectedValid)).toEqual([true, true, false]);
    });

    it('requires at least one passing and one failing example, with feedback naming the shortfall', async () => {
        const onlyPassing = { ...modelOutput(fk.referenceProposal), failingExamples: [] };
        createResponse
            .mockResolvedValueOnce(streamOf(onlyPassing))
            .mockResolvedValueOnce(streamOf(examplesOf(fk.referenceProposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        expect(result.outcome).toBe('natural_language');
        expect(feedbackOf(1)).toContain('at least one passingExamples and one failingExamples');
        expect(feedbackOf(1)).toContain('got 2 passing and 0 failing');
    });

    it('still reads a legacy single examples list with verdicts', async () => {
        createResponse.mockResolvedValue(streamOf({
            ...modelOutput(fk.referenceProposal),
            examples: fk.referenceProposal.examples,
        }));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        expect(result.outcome).toBe('natural_language');
    });
});

describe('correction feedback names the exact example, sheet and column', () => {
    it('points at the related row, the bad column and the declared schema', async () => {
        createResponse
            .mockResolvedValueOnce(streamOf(modelOutput(withBadRelatedColumn())))
            .mockResolvedValueOnce(streamOf(examplesOf(fk.referenceProposal)));

        await proposeNaturalLanguageRule(sales, fk.request);

        const feedback = feedbackOf(1);
        expect(feedback).toContain('passingExamples[0].relatedRows[0]');
        expect(feedback).toContain('"Nope"');
        expect(feedback).toContain('sheet "Customers"');
        expect(feedback).toContain('does not exist');
        expect(feedback).toContain('"Id"');
    });

    it('does not show model-supplied names to the user, only the generic reason', async () => {
        createResponse.mockResolvedValue(streamOf(modelOutput(withBadRelatedColumn())));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome !== 'rejected') throw new Error('Expected a rejection');
        expect(result.reason).toContain('An example contains a column that is not declared for the rule.');
        expect(result.reason).not.toContain('Nope');
    });

    it('lists the failing example by label when the rule accepts or rejects the wrong case', async () => {
        const proposal = modelOutput(fk.referenceProposal);
        createResponse.mockResolvedValue(streamOf(proposal));
        jest.mocked(RulesServiceClient.testRule).mockResolvedValue({
            ok: false,
            errors: [],
            results: [
                { index: 1, table: 'Orders', expectedValid: true, actualValid: true, passed: true, error: null },
                { index: 2, table: 'Orders', expectedValid: true, actualValid: true, passed: true, error: null },
                { index: 3, table: 'Orders', expectedValid: false, actualValid: true, passed: false, error: null },
            ],
        });

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        expect(result.outcome).toBe('rejected');
        expect(feedbackOf(1)).toContain('failingExamples[0] was expected to fail but the rule accepted it');
        expect(feedbackOf(1)).toContain('Decide whether the SQL or the example is wrong');
        // A behavior mismatch may be the SQL's fault, so the whole proposal is regenerated, not only the examples.
        expect(createResponse.mock.calls.every(([call]) => call.text.format.name === 'rule_config_proposal')).toBe(true);
    });

    it('explains a row example that uses a column the row rule does not declare', async () => {
        const row = clone(byId('single-row-sql-country-phone').referenceProposal);
        row.examples[0].values.push({ column: 'Email', value: 'a@x.com' });
        createResponse
            .mockResolvedValueOnce(streamOf(modelOutput(row)))
            .mockResolvedValueOnce(streamOf(examplesOf(byId('single-row-sql-country-phone').referenceProposal)));

        const result = await proposeNaturalLanguageRule(contacts, 'If the country is US the phone must start with +1.');

        expect(result.outcome).toBe('natural_language');
        expect(feedbackOf(1)).toContain('passingExamples[0]');
        expect(feedbackOf(1)).toContain('"Email"');
        expect(feedbackOf(1)).toContain('declared: ["Country", "Phone"]');
    });
});

describe('only the examples are regenerated when their shape is wrong', () => {
    it('keeps the validated rule, makes one examples-only call and returns the corrected rule', async () => {
        createResponse
            .mockResolvedValueOnce(streamOf(modelOutput(withBadRelatedColumn())))
            .mockResolvedValueOnce(streamOf(examplesOf(fk.referenceProposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        expect(createResponse).toHaveBeenCalledTimes(2);
        const second = createResponse.mock.calls[1][0];
        expect(second.text.format.name).toBe('rule_examples');
        expect(Object.keys(second.text.format.schema.properties).sort()).toEqual(['failingExamples', 'passingExamples']);
        const input = JSON.parse(second.input);
        expect(input.rule.query).toBe(fk.referenceProposal.params.query);
        expect(input.rule.mode).toBe('query');
        expect(input.rule.tableColumns).toEqual(fk.referenceProposal.params.tableColumns);
        expect(second.instructions).toContain('The rule\'s SQL is fixed');
        const params = result.config.params as unknown as { query: string; examples: unknown[] };
        expect(params.query).toBe(fk.referenceProposal.params.query);
        expect(params.examples).toHaveLength(3);
        expect(RulesServiceClient.validateRule).toHaveBeenCalledTimes(1);
    });

    it('falls back to a full correction when the examples are still wrong, then stops', async () => {
        createResponse.mockResolvedValue(streamOf(modelOutput(withBadRelatedColumn())));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        expect(result.outcome).toBe('rejected');
        const names = createResponse.mock.calls.map(([call]) => call.text.format.name);
        expect(names).toEqual(['rule_config_proposal', 'rule_examples', 'rule_config_proposal']);
    });

    it('recovers when the full correction fixes the examples', async () => {
        createResponse
            .mockResolvedValueOnce(streamOf(modelOutput(withBadRelatedColumn())))
            .mockResolvedValueOnce(streamOf(examplesOf(withBadRelatedColumn())))
            .mockResolvedValueOnce(streamOf(modelOutput(fk.referenceProposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        expect(result.outcome).toBe('natural_language');
        expect(createResponse).toHaveBeenCalledTimes(3);
    });

    it('keeps the original failure path if the examples call itself fails', async () => {
        createResponse
            .mockResolvedValueOnce(streamOf(modelOutput(withBadRelatedColumn())))
            .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 400 }))
            .mockResolvedValueOnce(streamOf(modelOutput(fk.referenceProposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        expect(result.outcome).toBe('natural_language');
    });
});

describe('deterministic proposal fields are normalised instead of rejected', () => {
    it('sets the target of a query rule to null even when the model names a sheet', async () => {
        const proposal = clone(fk.referenceProposal);
        proposal.table = 'Orders';
        createResponse.mockResolvedValue(streamOf(modelOutput(proposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        expect(result.config.table).toBeNull();
        expect(createResponse).toHaveBeenCalledTimes(1);
    });

    it('sets the target of a reconcile rule to null', async () => {
        const reconcile = clone(byId('xsheet-reconcile-totals').referenceProposal);
        reconcile.table = 'Payments';
        createResponse.mockResolvedValue(streamOf(modelOutput(reconcile)));

        const result = await proposeNaturalLanguageRule(sales, 'Payments must equal orders.');

        if (result.outcome === 'rejected') throw new Error(result.reason);
        expect(result.config.table).toBeNull();
    });

    it('declares schema columns that a query rule\'s examples use but its query does not read', async () => {
        const proposal = clone(fk.referenceProposal);
        proposal.examples[0].relatedRows[0].values.push({ column: 'Name', value: 'Ann' });
        createResponse.mockResolvedValue(streamOf(modelOutput(proposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        const params = result.config.params as unknown as { columns: Record<string, string[]>; query: string };
        expect(params.columns.Customers).toEqual(['Id', 'Name']);
        expect(params.columns.Orders).toEqual(['CustomerId']);
        expect(params.query).toBe(fk.referenceProposal.params.query);
        expect(createResponse).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(proposal.params.tableColumns)).not.toContain('Name');
    });

    it('declares a sheet that only an example\'s related row uses', async () => {
        const proposal = clone(fk.referenceProposal);
        proposal.examples[0].relatedRows.push({ table: 'Payments', values: [{ column: 'PaymentId', value: 'P1' }] });
        createResponse.mockResolvedValue(streamOf(modelOutput(proposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        expect((result.config.params as unknown as { columns: Record<string, string[]> }).columns.Payments)
            .toEqual(['PaymentId']);
    });

    it('does not add example columns to a row rule, because declared columns change which rows it skips', async () => {
        const row = clone(byId('single-row-sql-country-phone').referenceProposal);
        row.examples[0].values.push({ column: 'Email', value: 'a@x.com' });
        createResponse.mockResolvedValue(streamOf(modelOutput(row)));

        const result = await proposeNaturalLanguageRule(contacts, 'If the country is US the phone must start with +1.');

        expect(result.outcome).toBe('rejected');
        expect(RulesServiceClient.validateRule).not.toHaveBeenCalled();
    });

    it('drops the internal __row id when the model lists it as a column', async () => {
        const proposal = clone(fk.referenceProposal);
        proposal.params.tableColumns = [
            { table: 'Customers', columns: ['Id', '__row'] },
            { table: 'Orders', columns: ['CustomerId', '__ROW'] },
        ];
        createResponse.mockResolvedValue(streamOf(modelOutput(proposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        expect((result.config.params as unknown as { columns: Record<string, string[]> }).columns)
            .toEqual({ Customers: ['Id'], Orders: ['CustomerId'] });
        expect(createResponse).toHaveBeenCalledTimes(1);
    });

    it('keeps a table with no declared columns, as a count-only query needs', async () => {
        const proposal = clone(fk.referenceProposal);
        proposal.params.tableColumns = [{ table: 'Customers', columns: [] }, { table: 'Orders', columns: ['CustomerId'] }];
        proposal.examples.forEach(example => { example.relatedRows = []; });
        createResponse.mockResolvedValue(streamOf(modelOutput(proposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        expect((result.config.params as unknown as { columns: Record<string, string[]> }).columns.Customers).toEqual([]);
    });

    it('drops related rows from a row rule instead of failing the proposal', async () => {
        const row = clone(byId('single-row-sql-country-phone').referenceProposal);
        row.examples[0].relatedRows = [{ table: '', values: [{ column: 'Country', value: 'US' }] }];
        createResponse.mockResolvedValue(streamOf(modelOutput(row)));

        const result = await proposeNaturalLanguageRule(contacts, 'If the country is US the phone must start with +1.');

        if (result.outcome === 'rejected') throw new Error(result.reason);
        const examples = (result.config.params as unknown as { examples: Array<Record<string, unknown>> }).examples;
        expect(examples.every(example => !('relatedRows' in example))).toBe(true);
        expect(createResponse).toHaveBeenCalledTimes(1);
    });

    it('ignores examples the model attaches to a built-in rule', async () => {
        const range = clone(byId('builtin-range').referenceProposal);
        createResponse.mockResolvedValue(streamOf({
            ...modelOutput(range),
            passingExamples: [{ table: 'Orders', values: [{ column: 'Amount', value: '1' }], relatedRows: [] }],
            failingExamples: [{ table: 'Orders', values: [{ column: 'Amount', value: '-1' }], relatedRows: [] }],
        }));

        const result = await proposeNaturalLanguageRule(sales, 'The order amount must be between 0 and 10000.');

        if (result.outcome === 'rejected') throw new Error(result.reason);
        expect(result.outcome).toBe('mapped');
        expect(result.config.params).not.toHaveProperty('examples');
        expect(RulesServiceClient.testRule).not.toHaveBeenCalled();
    });
});

describe('prompt guidance', () => {
    it('steers common requests to the right mechanism and shows worked query patterns', async () => {
        createResponse.mockResolvedValue(streamOf(modelOutput(fk.referenceProposal)));

        await proposeNaturalLanguageRule(sales, fk.request);

        const { instructions } = createResponse.mock.calls[0][0];
        expect(instructions).toContain('is the pattern type');
        expect(instructions).toContain('is NOT the built-in unique type');
        expect(instructions).toContain('Uniqueness ignoring case');
        expect(instructions).toContain('Missing key with NOT EXISTS');
        expect(instructions).toContain('Matched rows compared');
        expect(instructions).toContain('Per-key total from another sheet');
        expect(instructions).toContain('Whole-file condition over two sheets');
        expect(instructions).toContain('A query rule always has proposal table null');
        expect(instructions).toContain('"passingExamples":[{"table":"Orders"');
        expect(instructions).toContain('BOTH arrays must be non-empty');
        expect(instructions).toContain('never substitute a sheet of this file for an external source');
        expect(instructions).toContain('The engine skips a row whenever ANY of the row rule\'s declared columns is');
        expect(instructions).toContain('never write a failing example that has a');
        expect(instructions).toContain('a failing duplicate example is the primary row plus a second row');
    });

    it('retries once after an unclassified connection failure instead of giving up', async () => {
        createResponse
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(streamOf(modelOutput(fk.referenceProposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request);

        expect(result.outcome).toBe('natural_language');
        expect(createResponse).toHaveBeenCalledTimes(2);
    });

    it('does not retry an authorization failure', async () => {
        createResponse.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }));

        await expect(proposeNaturalLanguageRule(sales, fk.request)).rejects.toThrow('Citadel denied access (403)');
        expect(createResponse).toHaveBeenCalledTimes(1);
    });
});

describe('evaluation diagnostics', () => {
    it('records every model call with response id, token usage and the proposal, plus each failure', async () => {
        createResponse
            .mockResolvedValueOnce(streamOf(modelOutput(withBadRelatedColumn())))
            .mockResolvedValueOnce(streamOf(examplesOf(fk.referenceProposal)));
        const events: RuleDiagnosticEvent[] = [];

        await proposeNaturalLanguageRule(sales, fk.request, { onDiagnostic: event => events.push(event) });

        expect(events.map(event => `${event.kind}:${event.purpose ?? event.scope}`))
            .toEqual(['model-call:rule', 'validation-failure:examples', 'model-call:examples']);
        expect(events[0]).toMatchObject({ attempt: 1, inputTokens: 300, outputTokens: 120 });
        expect(events[0].responseId).toMatch(/^resp_rel_/);
        expect(events[0].proposal).toMatchObject({ type: 'naturalLanguage' });
        expect(events[1]).toMatchObject({ phase: 'configuration' });
        expect(events[1].problem).toContain('"Nope"');
        expect(events[2].proposal).toHaveLength(3);
    });

    it('never lets a failing diagnostics hook change the outcome', async () => {
        createResponse.mockResolvedValue(streamOf(modelOutput(fk.referenceProposal)));

        const result = await proposeNaturalLanguageRule(sales, fk.request, {
            onDiagnostic: () => { throw new Error('hook failed'); },
        });

        expect(result.outcome).toBe('natural_language');
    });
});

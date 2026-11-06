import {
    proposeNaturalLanguageRule,
} from '../src/services/naturalLanguageRule';
import type { DefinitionContract } from '../src/contracts/definition-contract';
import { RulesServiceClient } from '../src/services/RulesServiceClient';
import { appConfig } from '../src/config/appConfig';
import {
    combinedExamples,
    goldenContract,
    loadGoldenCorpus,
    modelOutput,
    type GoldenCase,
} from './helpers/goldenCorpus';

const createResponse = jest.fn();
jest.mock('@azure/ai-projects', () => ({
    AIProjectClient: jest.fn().mockImplementation(() => ({
        getOpenAIClient: () => ({ responses: { create: createResponse } }),
    })),
}));
jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.mock('../src/models/Rule.model', () => ({ Rule: { create: jest.fn(), update: jest.fn() } }));
jest.mock('../src/services/RulesServiceClient', () => ({
    ...jest.requireActual('../src/services/RulesServiceClient'),
    RulesServiceClient: { validateRule: jest.fn(), testRule: jest.fn() },
}));

let responseCounter = 0;
const streamOf = (proposal: object) => {
    const id = `resp_golden_${++responseCounter}`;
    return {
        async *[Symbol.asyncIterator]() {
            yield { type: 'response.created', response: { id } };
            yield {
                type: 'response.completed',
                response: {
                    id,
                    status: 'completed',
                    usage: { input_tokens: 250, output_tokens: 100 },
                    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }],
                },
            };
        },
    };
};
/** What the model returns for a reference proposal: separate passing and failing example lists. */
const modelStream = (proposal: GoldenCase['referenceProposal']) => streamOf(modelOutput(proposal));

const corpus = loadGoldenCorpus();
const byId = (id: string): GoldenCase => corpus.cases.find(item => item.id === id) as GoldenCase;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

beforeEach(() => {
    jest.clearAllMocks();
    appConfig.azure.foundry = { resource: 'test-foundry', project: 'test-project', model: 'test-model' };
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

describe('golden corpus through the proposal pipeline (model stubbed with the reference proposal)', () => {
    it('covers a broad corpus including cross-sheet cases', () => {
        expect(corpus.cases.length).toBeGreaterThanOrEqual(25);
        expect(corpus.cases.filter(item => item.category === 'cross-sheet').length).toBeGreaterThanOrEqual(8);
    });

    it.each(corpus.cases.map(item => [item.id, item] as const))('%s', async (_id, item) => {
        createResponse.mockResolvedValue(modelStream(item.referenceProposal));
        const contract = goldenContract(corpus, item.definition);

        const result = await proposeNaturalLanguageRule(contract, item.request);

        if (item.expected.decision === 'rejected') {
            expect(result.outcome).toBe('rejected');
            expect(RulesServiceClient.validateRule).not.toHaveBeenCalled();
            return;
        }
        if (result.outcome === 'rejected') throw new Error(`Unexpected rejection: ${result.reason}`);
        expect(result.outcome).toBe(item.expected.decision);
        expect(result.config.type).toBe(item.expected.type);
        expect(result.config.severity).toBe(item.referenceProposal.severity);
        if (item.expected.type !== 'naturalLanguage') {
            expect(RulesServiceClient.testRule).not.toHaveBeenCalled();
            return;
        }
        const params = result.config.params as unknown as {
            mode: string;
            columns: Record<string, string[]>;
            examples: Array<{ table: string; relatedRows?: Array<{ table: string }> }>;
        };
        expect(params.mode).toBe(item.expected.mode);
        if (item.expected.mode === 'query') expect(result.config.table).toBeNull();
        const proposalColumns = (item.referenceProposal.params.tableColumns as Array<{ table: string; columns: string[] }>);
        expect(Object.keys(params.columns).sort()).toEqual(proposalColumns.map(entry => entry.table).sort());
        expect(params.examples).toHaveLength(item.referenceProposal.examples.length);
        combinedExamples(item.referenceProposal).forEach((example, index) => {
            expect(params.examples[index].relatedRows?.length ?? 0).toBe(example.relatedRows.length);
        });
        expect(RulesServiceClient.testRule).toHaveBeenCalledTimes(1);
    });
});

describe('cross-sheet proposal handling', () => {
    const fk = byId('xsheet-fk-orders-customers');
    const contract: DefinitionContract = goldenContract(corpus, 'sales');

    it('forwards related rows to the Python example tester with canonical sheet names and values', async () => {
        const proposal = clone(fk.referenceProposal);
        proposal.examples[0].relatedRows[0].table = 't_0';
        createResponse.mockResolvedValue(modelStream(proposal));

        const result = await proposeNaturalLanguageRule(contract, fk.request);

        if (result.outcome === 'rejected') throw new Error(result.reason);
        const examples = (result.config.params as unknown as { examples: Array<Record<string, unknown>> }).examples;
        expect(examples[0]).toMatchObject({
            table: 'Orders',
            values: { CustomerId: 'C1' },
            expectedValid: true,
            source: 'model',
            relatedRows: [{ table: 'Customers', values: { Id: 'C1' } }],
        });
        expect(examples[1]).not.toHaveProperty('relatedRows');
        expect(RulesServiceClient.testRule).toHaveBeenCalledWith(contract, expect.anything(), examples);
    });

    it('tells the model how to write cross-sheet queries and examples', async () => {
        createResponse.mockResolvedValue(modelStream(fk.referenceProposal));

        await proposeNaturalLanguageRule(contract, fk.request);

        const call = createResponse.mock.calls[0][0];
        expect(call.instructions).toContain('Use query mode whenever a rule needs data from');
        expect(call.instructions).toContain('declare ONLY the tables and columns the query reads');
        expect(call.instructions).toContain('__row');
        expect(call.instructions).toContain('LEFT JOIN');
        expect(call.instructions).toContain('NOT EXISTS');
        expect(call.instructions).toContain('relatedRows');
        expect(call.instructions).toContain('reconcile');
        const schema = call.text.format.schema;
        expect(schema.required).toEqual(expect.arrayContaining(['passingExamples', 'failingExamples']));
        expect(schema.properties).not.toHaveProperty('examples');
        const item = schema.properties.passingExamples.items;
        expect(item.required).toEqual(['table', 'values', 'relatedRows']);
        expect(item.properties.relatedRows.items.required).toEqual(['table', 'values']);
        expect(schema.properties.failingExamples.items).toEqual(item);
        expect(JSON.parse(call.input).untrustedData.tables.map((table: { sqlTable: string }) => table.sqlTable))
            .toEqual(['t_0', 't_1', 't_2']);
    });

    it('rejects a related row naming a sheet that is not in the definition', async () => {
        const bad = clone(fk.referenceProposal);
        bad.examples[0].relatedRows[0].table = 'Invoices';
        createResponse.mockResolvedValue(modelStream(bad));

        const result = await proposeNaturalLanguageRule(contract, fk.request);

        expect(result.outcome).toBe('rejected');
        expect(RulesServiceClient.validateRule).not.toHaveBeenCalled();
    });

    it('accepts proposals from models that omit relatedRows', async () => {
        const legacy = clone(byId('single-row-sql-adult-active').referenceProposal) as unknown as Record<string, unknown> & {
            examples: Array<Record<string, unknown>>;
        };
        legacy.examples.forEach(example => delete example.relatedRows);
        createResponse.mockResolvedValue(streamOf(legacy));

        const result = await proposeNaturalLanguageRule(goldenContract(corpus, 'contacts'), 'Active contacts must be at least 18.');

        expect(result.outcome).toBe('natural_language');
    });

    it('explains cross-sheet validation failures in plain language', async () => {
        createResponse.mockResolvedValue(modelStream(fk.referenceProposal));
        jest.mocked(RulesServiceClient.validateRule).mockResolvedValue({
            ok: false,
            errors: [{ path: '$.params.query', message: 'Natural-language SQL references an unregistered table.' }],
            normalizedRule: null,
            explanation: null,
        });

        const result = await proposeNaturalLanguageRule(contract, fk.request);

        expect(result.outcome).toBe('rejected');
        if (result.outcome === 'rejected') expect(result.reason.length).toBeGreaterThan(0);
        expect(JSON.parse(createResponse.mock.calls[1][0].input).correctionFeedback)
            .toContain('unregistered table');
    });
});

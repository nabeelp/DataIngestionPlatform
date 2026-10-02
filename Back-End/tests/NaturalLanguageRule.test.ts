import {
    MAX_WHITESPACE_RUN,
    createNaturalLanguageRule,
    regenerateNaturalLanguageRule,
    describeClientError,
    readProposal,
    RuleGenerationCancelledError,
    RuleGenerationError,
    pseudocodeForRule,
    trailingWhitespaceRun,
    type RuleProgressEvent,
} from '../src/services/NaturalLanguageRule.service';
import { Rule } from '../src/models/Rule.model';
import { DefinitionVersionService } from '../src/services/DefinitionVersion.service';

const createResponse = jest.fn();
jest.mock('@azure/ai-projects', () => ({
    AIProjectClient: jest.fn().mockImplementation(() => ({
        getOpenAIClient: () => ({ responses: { create: createResponse } }),
    })),
}));
jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.mock('../src/models/Rule.model', () => ({
    Rule: {
        hasAccessToFileDefinition: jest.fn(),
        hasAccessToRule: jest.fn(),
        findById: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
}));
jest.mock('../src/services/DefinitionVersion.service', () => ({
    DefinitionVersionService: { getDraftState: jest.fn() },
}));

const definitionId = '8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
type ModelResponse = Record<string, unknown> & { status: string };
const usage = { output_tokens: 900, output_tokens_details: { reasoning_tokens: 500 } };
const completed = (text: string): ModelResponse => ({
    id: 'resp_1', status: 'completed', usage,
    output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }],
});
/** A streamed Responses API call, as the OpenAI SDK yields it. Re-iterable, so one mock can serve retries. */
const streamOf = (final: ModelResponse | null, extra: object[] = []) => ({
    async *[Symbol.asyncIterator]() {
        yield { type: 'response.created', response: { id: final?.id ?? 'resp_1' } };
        yield { type: 'response.output_item.added', item: { type: 'reasoning' } };
        yield { type: 'response.output_text.delta', delta: '{"decision":' };
        for (const event of extra) yield event;
        if (final) yield { type: final.status === 'completed' ? 'response.completed' : `response.${final.status}`, response: final };
    },
});
const response = (proposal: object) => streamOf(completed(JSON.stringify(proposal)));

const empty = { ruleType: '', expression: '', columns: [], tables: [], pseudocode: '', typescript: '', examples: [] };
const mapped = {
    ...empty, decision: 'mapped', reason: 'An inclusive range check expresses this exactly.', name: 'Valid amount',
    severity: 'Error', tableName: 'Orders', ruleType: 'Range Check', expression: 'Amount: 0..100',
};
const SUFFIX_CODE = `function validateRow(row: Row, rowNumber: number): string | null {
    const email = row['Email'];
    if (email === null || email === '') return null;
    return String(email).endsWith('@contoso.example') ? null : 'Email must end with @contoso.example';
}`;
const example = (value: string | null, expectedValid: boolean) => ({ sheet: 'Orders', values: [{ column: 'Email', value }], expectedValid });
const naturalLanguage = {
    ...empty, decision: 'natural_language', reason: 'No declarative type checks a text suffix.', name: 'Contoso email',
    severity: 'Error', tableName: 'Orders', columns: ['Email'],
    pseudocode: 'FOR EACH row:\n  IF Email is not empty AND does not end with "@contoso.example": report issue',
    typescript: SUFFIX_CODE,
    examples: [example('a@contoso.example', true), example('b@example.org', false), example(null, true)],
};
const crossSheetCode = `const orderAmounts = new Map<string, number>();
const payments = new Map<string, number[]>();
function validateRow(row: Row, rowNumber: number, sheet?: string): string | null {
    if (sheet === 'Orders' && row['OrderId'] !== null && row['Amount'] !== null) {
        orderAmounts.set(String(row['OrderId']), Number(row['Amount']));
    }
    if (sheet === 'Payments' && row['PaymentOrderId'] !== null && row['Amount'] !== null) {
        const id = String(row['PaymentOrderId']);
        payments.set(id, [...(payments.get(id) ?? []), Number(row['Amount'])]);
    }
    return null;
}
function validateFile(): string | null {
    let orderTotal = 0;
    let paymentTotal = 0;
    for (const [id, amount] of orderAmounts) {
        orderTotal += amount;
        const matches = payments.get(id) ?? [];
        if (matches.length !== 1 || matches[0] !== amount) return 'Each order must have exactly one payment for the same amount';
    }
    for (const amounts of payments.values()) for (const amount of amounts) paymentTotal += amount;
    return orderTotal === paymentTotal ? null : 'Order and payment totals do not match';
}`;
const crossSheetProposal = {
    ...empty,
    decision: 'natural_language',
    reason: 'The rule correlates rows and totals across sheets.',
    name: 'Orders match payments',
    severity: 'Error',
    tableName: '',
    tables: [
        { sheet: 'Orders', columns: ['OrderId', 'Amount'] },
        { sheet: 'Payments', columns: ['PaymentOrderId', 'Amount'] },
    ],
    columns: ['OrderId', 'PaymentOrderId', 'Amount'],
    pseudocode: 'Collect orders and payments from both sheets; compare each keyed payment and compare their totals.',
    typescript: crossSheetCode,
    examples: [
        { sheet: 'Orders', values: [{ column: 'OrderId', value: 'O-1' }, { column: 'Amount', value: '100' }], expectedValid: true },
        { sheet: 'Payments', values: [{ column: 'PaymentOrderId', value: 'O-1' }, { column: 'Amount', value: '100' }], expectedValid: true },
        { sheet: 'Orders', values: [{ column: 'OrderId', value: 'O-2' }, { column: 'Amount', value: '50' }], expectedValid: true },
        { sheet: 'Payments', values: [{ column: 'PaymentOrderId', value: 'O-2' }, { column: 'Amount', value: '49' }], expectedValid: false },
    ],
};
const request = 'Email must end with @contoso.example';

describe('natural-language rule authoring', () => {
    beforeEach(() => {
        jest.mocked(Rule.hasAccessToFileDefinition).mockResolvedValue(true);
        jest.mocked(Rule.hasAccessToRule).mockResolvedValue(true);
        jest.mocked(Rule.findById).mockResolvedValue({
            Id: 'rule-1',
            FileDefinitionId: definitionId,
            RuleType: 'Natural Language',
            NaturalLanguageText: request,
        } as never);
        jest.mocked(DefinitionVersionService.getDraftState).mockResolvedValue({
            activeVersion: null,
            diff: {} as never,
            draft: {
                columns: [],
                tables: [{ sheet: 'Orders', columns: [{ name: 'Amount', type: 'decimal', required: false }, { name: 'Email', type: 'string', required: false }] }],
                rules: [],
            },
        });
        jest.mocked(Rule.create).mockImplementation(async dto => ({ Id: 'rule-1', ...dto }) as never);
        jest.mocked(Rule.update).mockImplementation(async (id, updates) => ({ Id: id, FileDefinitionId: definitionId, ...updates }) as never);
        createResponse.mockResolvedValue(response(mapped));
    });

    it('maps a request to a declarative rule when nothing is lost', async () => {
        const result = await createNaturalLanguageRule(definitionId, 'Amount must be between 0 and 100', 'admin');
        expect(result).toMatchObject({ outcome: 'mapped', pseudocode: expect.stringContaining('sheet "Orders"') });
        expect(Rule.create).toHaveBeenCalledWith(expect.objectContaining({
            FileDefinitionId: definitionId, RuleType: 'Range Check', SqlQuery: 'Amount: 0..100', TableName: 'Orders',
        }), 'admin');
        expect(jest.mocked(Rule.create).mock.calls[0][0]).not.toHaveProperty('GeneratedCode');
        expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({
            store: false,
            stream: true,
            model: 'gpt-5.3-codex',
            text: expect.objectContaining({ format: expect.objectContaining({ type: 'json_schema', strict: true }) }),
            input: expect.stringContaining('"sheet":"Orders"'),
        }), { signal: expect.any(AbortSignal) });
    });

    it('keeps a request that cannot be mapped as a Natural Language rule with its text, pseudocode and code', async () => {
        createResponse.mockResolvedValue(response(naturalLanguage));
        const result = await createNaturalLanguageRule(definitionId, request, 'admin');
        expect(result).toMatchObject({ outcome: 'natural_language', pseudocode: naturalLanguage.pseudocode, typescript: SUFFIX_CODE });
        expect(Rule.create).toHaveBeenCalledWith({
            FileDefinitionId: definitionId,
            Name: 'Contoso email',
            Description: request,
            Severity: 'Error',
            TableName: 'Orders',
            RuleType: 'Natural Language',
            SqlQuery: 'Email',
            NaturalLanguageText: request,
            Pseudocode: naturalLanguage.pseudocode,
            GeneratedCode: SUFFIX_CODE,
        }, 'admin');
    });

    it('generates and saves a natural-language rule correlating matching rows and totals across two sheets', async () => {
        jest.mocked(DefinitionVersionService.getDraftState).mockResolvedValue({
            activeVersion: null,
            diff: {} as never,
            draft: {
                columns: [],
                tables: [
                    { sheet: 'Orders', columns: [{ name: 'OrderId', type: 'string', required: true }, { name: 'Amount', type: 'decimal', required: true }] },
                    { sheet: 'Payments', columns: [{ name: 'PaymentOrderId', type: 'string', required: true }, { name: 'Amount', type: 'decimal', required: true }] },
                ],
                rules: [],
            },
        });
        createResponse.mockResolvedValue(response(crossSheetProposal));

        await expect(createNaturalLanguageRule(
            definitionId,
            'Every order must have exactly one payment for the same amount, and the totals across both sheets must match',
            'admin',
        )).resolves.toMatchObject({ outcome: 'natural_language', typescript: crossSheetCode });

        expect(JSON.parse(createResponse.mock.calls[0][0].input).tables).toEqual([
            { sheet: 'Orders', columns: [{ name: 'OrderId', type: 'string' }, { name: 'Amount', type: 'decimal' }] },
            { sheet: 'Payments', columns: [{ name: 'PaymentOrderId', type: 'string' }, { name: 'Amount', type: 'decimal' }] },
        ]);
        expect(Rule.create).toHaveBeenCalledWith(expect.objectContaining({
            RuleType: 'Natural Language',
            TableName: null,
            SqlQuery: '@sheet-columns:{"sheets":[{"sheet":"Orders","columns":["OrderId","Amount"]},{"sheet":"Payments","columns":["PaymentOrderId","Amount"]}]}',
            GeneratedCode: crossSheetCode,
        }), 'admin');
    });

    it('regenerates an existing Natural Language rule in place after the replacement passes all checks', async () => {
        const revisedRequest = 'Email must end with @contoso.example and be lowercase';
        createResponse.mockResolvedValue(response(naturalLanguage));

        await expect(regenerateNaturalLanguageRule('rule-1', revisedRequest, 'admin'))
            .resolves.toMatchObject({ outcome: 'natural_language', rule: { Id: 'rule-1' } });

        expect(Rule.create).not.toHaveBeenCalled();
        expect(Rule.update).toHaveBeenCalledWith('rule-1', {
            Name: 'Contoso email',
            Description: revisedRequest,
            RuleType: 'Natural Language',
            Severity: 'Error',
            SqlQuery: 'Email',
            TableName: 'Orders',
            NaturalLanguageText: revisedRequest,
            Pseudocode: naturalLanguage.pseudocode,
            GeneratedCode: SUFFIX_CODE,
        });
    });

    it('leaves the existing rule unchanged when regeneration is rejected', async () => {
        createResponse.mockResolvedValue(response({ ...mapped, decision: 'rejected', reason: 'Needs CRM data' }));

        await expect(regenerateNaturalLanguageRule('rule-1', 'Customer must exist in CRM', 'admin'))
            .resolves.toEqual({ outcome: 'rejected', reason: 'Needs CRM data' });

        expect(Rule.update).not.toHaveBeenCalled();
    });

    it('uses the single-table draft without a sheet name', async () => {
        jest.mocked(DefinitionVersionService.getDraftState).mockResolvedValue({
            activeVersion: null,
            diff: {} as never,
            draft: { columns: [{ name: 'Email', type: 'string', required: false }], tables: [], rules: [] },
        });
        createResponse.mockResolvedValue(response({ ...naturalLanguage, tableName: '' }));
        await expect(createNaturalLanguageRule(definitionId, request, 'admin')).resolves.toMatchObject({ outcome: 'natural_language' });
        expect(Rule.create).toHaveBeenCalledWith(expect.objectContaining({ TableName: null }), 'admin');
    });

    it.each([
        ['code that fails its own examples', { ...naturalLanguage, examples: [example('a@contoso.example', false), example('b@example.org', true)] }, 'did not match its own examples'],
        ['code that does not compile', { ...naturalLanguage, typescript: 'function validateRow(row: Row, rowNumber: number): string | null { return row.Email.trim(); }' }, 'does not compile'],
        ['module code', { ...naturalLanguage, typescript: `export ${SUFFIX_CODE}` }, 'must not use import or export'],
        ['an unknown column', { ...naturalLanguage, columns: ['Unknown'] }, 'column "Unknown" is not in the selected definition table'],
        ['examples without a failing row', { ...naturalLanguage, examples: [example('a@contoso.example', true), example(null, true)] }, 'none of its examples is expected to fail'],
        ['examples without a passing row', { ...naturalLanguage, examples: [example('a@example.org', false), example('b@example.org', false)] }, 'none of its examples is expected to pass'],
        ['no examples', { ...naturalLanguage, examples: [] }, 'it has no examples'],
        ['a single example', { ...naturalLanguage, examples: [example('b@example.org', false)] }, 'it has 1 example(s), but 2 to 20 are required'],
        ['examples for other columns', { ...naturalLanguage, examples: [...naturalLanguage.examples, { sheet: 'Orders', values: [{ column: 'Amount', value: '1' }], expectedValid: true }] }, 'example 4 gives a value for "Amount", which is not one of the columns the rule reads from sheet "Orders" (Email)'],
        ['a mapped rule with an invalid expression', { ...mapped, expression: 'Amount: now..tomorrow' }, 'cannot be implemented'],
        ['a mapped rule with a missing column', { ...mapped, expression: 'Unknown: 0..100' }, 'column "Unknown"'],
        ['an unknown sheet', { ...naturalLanguage, tableName: 'Other' }, 'tableName "Other" is not one of the definition\'s sheet tables ("Orders")'],
    ])('does not save %s, after giving the model one chance to correct it', async (_label, proposal, reason) => {
        createResponse.mockResolvedValue(response(proposal));
        const result = await createNaturalLanguageRule(definitionId, request, 'admin');
        expect(result).toMatchObject({ outcome: 'rejected', reason: expect.stringContaining(reason) });
        expect(Rule.create).not.toHaveBeenCalled();
        expect(createResponse).toHaveBeenCalledTimes(2);
        const retry = JSON.parse(createResponse.mock.calls[1][0].input);
        expect(retry.previousAttempt.problem).toContain(reason);
    });

    it('saves a proposal the model corrects after feedback', async () => {
        createResponse
            .mockResolvedValueOnce(response({ ...naturalLanguage, examples: [] }))
            .mockResolvedValueOnce(response(naturalLanguage));
        await expect(createNaturalLanguageRule(definitionId, request, 'admin')).resolves.toMatchObject({ outcome: 'natural_language' });
        expect(JSON.parse(createResponse.mock.calls[0][0].input)).not.toHaveProperty('previousAttempt');
        expect(JSON.parse(createResponse.mock.calls[1][0].input).previousAttempt).toMatchObject({
            problem: 'it has no examples',
            proposal: expect.objectContaining({ typescript: SUFFIX_CODE }),
        });
        expect(Rule.create).toHaveBeenCalledTimes(1);
    });

    it('returns the model explanation when a request is rejected', async () => {
        createResponse.mockResolvedValue(response({ ...empty, decision: 'rejected', reason: 'It needs data from another system.', name: '', severity: 'Error', tableName: '' }));
        await expect(createNaturalLanguageRule(definitionId, 'Customer must exist in CRM', 'admin'))
            .resolves.toEqual({ outcome: 'rejected', reason: 'It needs data from another system.' });
        expect(Rule.create).not.toHaveBeenCalled();
    });

    it('does not call the model without access', async () => {
        jest.mocked(Rule.hasAccessToFileDefinition).mockResolvedValue(false);
        await expect(createNaturalLanguageRule(definitionId, request, 'user')).rejects.toMatchObject({ statusCode: 403 });
        expect(createResponse).not.toHaveBeenCalled();
    });

    it('fails explicitly for malformed model output', () => {
        expect(() => readProposal('not JSON')).toThrow(RuleGenerationError);
        expect(() => readProposal('{}')).toThrow(RuleGenerationError);
        expect(() => readProposal('{}')).toThrow('missing or invalid fields: decision, reason, name');
        expect(() => readProposal('{"decision": "mapp')).toThrow(/malformed JSON .*18 characters received/);
        expect(() => readProposal(JSON.stringify({ ...naturalLanguage, examples: [{ sheet: 'Orders', values: [{ column: 'Email', value: 1 }], expectedValid: true }] })))
            .toThrow('missing or invalid fields: examples');
    });

    it('describes the actual parsed enum evaluation', () => {
        expect(pseudocodeForRule({ type: 'Enum Check', column: 'Status', values: ['Open', 'Closed'] }, null))
            .toContain('["Open","Closed"]');
    });

    describe('model failures', () => {
        const incomplete = (reason: string): ModelResponse => ({ id: 'resp_cut', status: 'incomplete', incomplete_details: { reason }, usage, output: [{ type: 'reasoning' }] });

        it.each([
            ['runs out of output tokens', streamOf(incomplete('max_output_tokens')), 'The model reached its output limit of 16000 tokens before finishing the proposal (900 output tokens, 500 of them reasoning) [response resp_cut]'],
            ['stops for another reason', streamOf(incomplete('something_new')), 'The model stopped before finishing (reason: something_new)'],
            ['fails on the server', streamOf({ id: 'resp_x', status: 'failed', error: { code: 'server_error', message: 'Internal failure' } }), 'The model failed to respond: server_error: Internal failure [response resp_x]'],
            ['finishes with no text', streamOf({ ...completed(''), id: 'resp_e' }), 'The model finished without returning a proposal (900 output tokens, 500 of them reasoning)'],
            ['sends a stream error', streamOf(null, [{ type: 'error', code: 'server_error', message: 'The server had an error' }]), 'The model service reported an error while responding: server_error: The server had an error'],
            ['closes the stream early', streamOf(null), 'The connection to the model closed before it finished responding'],
            ['returns malformed JSON', streamOf(completed('{"decision": "mapp')), 'The model returned malformed JSON'],
        ])('explains a model that %s, after two retries', async (_label, stream, message) => {
            createResponse.mockResolvedValue(stream);
            const progress: RuleProgressEvent[] = [];
            const error = await createNaturalLanguageRule(definitionId, request, 'admin', { onProgress: event => progress.push(event) }).catch(e => e);
            expect(error).toBeInstanceOf(RuleGenerationError);
            expect(error.message).toContain(message);
            expect(error.statusCode).toBe(502);
            expect(createResponse).toHaveBeenCalledTimes(3);
            const warnings = progress.filter(event => event.level === 'warning').map(event => event.message);
            expect(warnings).toEqual([expect.stringContaining(message.split(' [')[0]), expect.stringContaining(message.split(' [')[0])]);
            expect(progress[progress.length - 1]).toMatchObject({ level: 'error', message: error.message });
            expect(Rule.create).not.toHaveBeenCalled();
        });

        it.each([
            ['the content filter stops it', streamOf(incomplete('content_filter')), 'The Azure AI content filter stopped the model\'s response. Rephrase the rule and try again', 400],
            ['the model refuses', streamOf({ ...completed(''), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }] }), 'The model declined to review the rule: I cannot help with that.', 400],
        ])('does not retry when %s', async (_label, stream, message, statusCode) => {
            createResponse.mockResolvedValue(stream);
            const error = await createNaturalLanguageRule(definitionId, request, 'admin').catch(e => e);
            expect(error).toMatchObject({ message: expect.stringContaining(message), statusCode });
            expect(createResponse).toHaveBeenCalledTimes(1);
        });

        it('recovers when a retry succeeds', async () => {
            createResponse.mockResolvedValueOnce(streamOf(incomplete('max_output_tokens'))).mockResolvedValueOnce(response(mapped));
            await expect(createNaturalLanguageRule(definitionId, request, 'admin')).resolves.toMatchObject({ outcome: 'mapped' });
            expect(Rule.create).toHaveBeenCalledTimes(1);
        });

        const apiError = (status: number | undefined, name: string, message: string) => Object.assign(new Error(message), { status, name });
        it.each([
            [apiError(403, 'PermissionDeniedError', '403 Identity does not have permissions for agents/write'), 1, 'Foundry denied access (403): 403 Identity does not have permissions for agents/write. Check that the backend\'s Azure identity has the Azure AI User role on project "citadel-governance-project"'],
            [apiError(404, 'NotFoundError', 'Deployment not found'), 1, 'Foundry could not find model deployment "gpt-5.3-codex" in project "citadel-governance-project" (404)'],
            [apiError(429, 'RateLimitError', 'Too many requests'), 3, 'Foundry is rate-limiting requests to "gpt-5.3-codex" (429): Too many requests'],
            [apiError(503, 'InternalServerError', 'Service unavailable'), 3, 'Foundry returned an error (503): Service unavailable'],
            [apiError(undefined, 'APIConnectionTimeoutError', 'Request timed out.'), 3, 'The model did not respond within 120 seconds'],
            [apiError(undefined, 'APIConnectionError', 'Connection error.'), 3, 'Could not connect to Foundry: Connection error.'],
            [apiError(undefined, 'CredentialUnavailableError', 'DefaultAzureCredential failed to retrieve a token from the included credentials.\nAttempted credentials: ...'), 1,
                'Could not get an Azure access token for Foundry: DefaultAzureCredential failed to retrieve a token from the included credentials.. Sign in'],
        ])('explains a client error (%#)', async (thrown, calls, message) => {
            createResponse.mockRejectedValue(thrown);
            const error = await createNaturalLanguageRule(definitionId, request, 'admin').catch(e => e);
            expect(error).toBeInstanceOf(RuleGenerationError);
            expect(error.message).toContain(message);
            expect(createResponse).toHaveBeenCalledTimes(calls);
        });

        it('keeps only the first line of a multi-line error', () => {
            expect(describeClientError(new Error('first\nsecond'), { model: 'm', project: 'p' }).message).toBe('The call to the model failed: first');
        });

        // Captured from gpt-5.3-codex: valid JSON up to "pseudocode", then whitespace until the 16,000-token limit.
        const WHITESPACE = '  \t\n    \n';
        const runaway = (sent: { deltas: number }) => async (_body: unknown, options: { signal: AbortSignal }) => ({
            async *[Symbol.asyncIterator]() {
                yield { type: 'response.created', response: { id: 'resp_stuck' } };
                yield { type: 'response.output_text.delta', delta: '{"decision":"natural_language","reason":"A suffix prohibition cannot be expressed.","pseudocode":"For each' };
                for (let i = 0; i < 10_000; i++) {
                    if (options.signal.aborted) throw Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
                    sent.deltas++;
                    yield { type: 'response.output_text.delta', delta: WHITESPACE };
                }
                yield { type: 'response.incomplete', response: { id: 'resp_stuck', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } };
            },
        });

        it('stops a response that is stuck writing whitespace and retries it', async () => {
            const sent = { deltas: 0 };
            createResponse.mockImplementationOnce(runaway(sent)).mockResolvedValueOnce(response(naturalLanguage));
            const progress: RuleProgressEvent[] = [];

            await expect(createNaturalLanguageRule(definitionId, request, 'admin', { onProgress: event => progress.push(event) }))
                .resolves.toMatchObject({ outcome: 'natural_language' });

            // The stream stops at the first chunk that takes the run past the limit.
            expect(sent.deltas).toBe(Math.floor(MAX_WHITESPACE_RUN / WHITESPACE.length) + 1);
            expect(createResponse).toHaveBeenCalledTimes(2);
            expect(progress).toContainEqual(expect.objectContaining({
                level: 'warning',
                message: expect.stringMatching(/^The model got stuck writing whitespace instead of finishing its proposal \(stopped after \d+ characters and \d+\.\d s\)\. Retrying$/),
            }));
            expect(Rule.create).toHaveBeenCalledTimes(1);
        });

        it('explains a model that keeps getting stuck', async () => {
            createResponse.mockImplementation(runaway({ deltas: 0 }));
            const error = await createNaturalLanguageRule(definitionId, request, 'admin').catch(e => e);
            expect(error).toBeInstanceOf(RuleGenerationError);
            expect(error.message).toMatch(/^The model got stuck writing whitespace instead of finishing its proposal/);
            expect(createResponse).toHaveBeenCalledTimes(3);
            expect(Rule.create).not.toHaveBeenCalled();
        });

        it.each([
            [0, '  ', 2],
            [2, '\t\n', 4],
            [4, ' "a" ', 1],
            [4, 'abc', 0],
            [150, '\n'.repeat(60), 210],
        ])('tracks the trailing whitespace run (%#)', (previous, delta, expected) => {
            expect(trailingWhitespaceRun(previous, delta)).toBe(expected);
        });
    });

    describe('activity', () => {
        it('reports each step of a successful review', async () => {
            createResponse.mockResolvedValue(response(naturalLanguage));
            const progress: RuleProgressEvent[] = [];
            await createNaturalLanguageRule(definitionId, request, 'admin', { onProgress: event => progress.push(event) });
            expect(progress.map(event => event.message)).toEqual([
                'Read the draft schema: 1 sheet table(s), 2 column(s)',
                'Asking gpt-5.3-codex in Foundry project citadel-governance-project to review the rule (attempt 1 of 3)',
                expect.stringMatching(/^Foundry accepted the request after \d+\.\d s \(response resp_1\)$/),
                'The model is reasoning about how to enforce the rule',
                'The model is writing its proposal',
                expect.stringMatching(/^The model finished in \d+\.\d s \(900 output tokens\)$/),
                'The model proposes a Natural Language rule reading Email',
                'Type-checking the generated TypeScript',
                "Running the code in the sandbox on the model's 3 example rows",
                'The code compiled and gave the expected result for all 3 examples',
                'Saved draft rule "Contoso email"',
            ]);
            expect(progress[progress.length - 1].level).toBe('success');
            const elapsed = progress.map(event => event.elapsedMs);
            expect([...elapsed].sort((a, b) => a - b)).toEqual(elapsed);
        });

        it('reports a failed check and the corrected attempt', async () => {
            createResponse.mockResolvedValueOnce(response({ ...naturalLanguage, examples: [] })).mockResolvedValueOnce(response(naturalLanguage));
            const progress: RuleProgressEvent[] = [];
            await createNaturalLanguageRule(definitionId, request, 'admin', { onProgress: event => progress.push(event) });
            expect(progress).toContainEqual(expect.objectContaining({ level: 'warning', message: 'The proposal failed its checks: it has no examples. Asking the model to correct it' }));
            expect(progress).toContainEqual(expect.objectContaining({ message: expect.stringContaining('(attempt 2 of 3)') }));
        });

        it('keeps reviewing when the progress listener throws', async () => {
            await expect(createNaturalLanguageRule(definitionId, 'Amount between 0 and 100', 'admin', { onProgress: () => { throw new Error('closed'); } }))
                .resolves.toMatchObject({ outcome: 'mapped' });
        });

        it('confirms the model is still working while it is silent', async () => {
            jest.useFakeTimers();
            try {
                let release: () => void = () => undefined;
                const silence = new Promise<void>(resolve => { release = resolve; });
                createResponse.mockResolvedValue({
                    async *[Symbol.asyncIterator]() {
                        yield { type: 'response.created', response: { id: 'resp_slow' } };
                        yield { type: 'response.output_item.added', item: { type: 'reasoning' } };
                        await silence;
                        yield { type: 'response.completed', response: completed(JSON.stringify(mapped)) };
                    },
                });
                const progress: RuleProgressEvent[] = [];
                const review = createNaturalLanguageRule(definitionId, request, 'admin', { onProgress: event => progress.push(event) });
                await jest.advanceTimersByTimeAsync(11_000);
                release();
                await review;
                expect(progress.filter(event => event.message.startsWith('The model is still reasoning about the rule')).length).toBe(2);
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('cancellation', () => {
        it('stops the model call and saves nothing when aborted', async () => {
            const controller = new AbortController();
            createResponse.mockImplementation(async (_body, options: { signal: AbortSignal }) => {
                controller.abort();
                expect(options.signal.aborted).toBe(true);
                throw Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
            });
            await expect(createNaturalLanguageRule(definitionId, request, 'admin', { signal: controller.signal }))
                .rejects.toBeInstanceOf(RuleGenerationCancelledError);
            expect(Rule.create).not.toHaveBeenCalled();
        });

        it('does not save a rule when aborted after the model answered', async () => {
            const controller = new AbortController();
            createResponse.mockImplementation(async () => {
                controller.abort();
                return response(mapped);
            });
            await expect(createNaturalLanguageRule(definitionId, request, 'admin', { signal: controller.signal }))
                .rejects.toBeInstanceOf(RuleGenerationCancelledError);
            expect(Rule.create).not.toHaveBeenCalled();
        });
    });
});

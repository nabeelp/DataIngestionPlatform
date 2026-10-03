import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { RULE_CONFIG_TYPES } from '../src/contracts/rule-config-types';

const contractsDirectory = path.resolve(process.cwd(), '..', 'contracts');
const schemaFiles = [
    'definition-contract.schema.json',
    'rule-config.schema.json',
    'messages/validation-request.schema.json',
    'messages/validation-event.schema.json',
    'messages/delivery-request.schema.json',
];
const schemas = schemaFiles.map(file => JSON.parse(fs.readFileSync(path.join(contractsDirectory, file), 'utf8')));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
schemas.forEach(schema => ajv.addSchema(schema));

describe('contract examples', () => {
    it('keeps the backend RuleConfig type list aligned with the shared schema', () => {
        const schema = schemas.find(item => item.$id.endsWith('rule-config.schema.json'))!;
        expect(RULE_CONFIG_TYPES).toEqual(schema.properties.type.enum);
    });

    const examples: [string, string][] = [
        ['definition-contract.schema.json', 'definition-contract.json'],
        ['messages/validation-request.schema.json', 'validation-request.json'],
        ['messages/validation-event.schema.json', 'validation-event.json'],
        ['messages/delivery-request.schema.json', 'delivery-request.json'],
    ];

    it.each(examples)('%s accepts %s', (schemaFile, exampleFile) => {
        const schema = schemas.find(item => item.$id.endsWith(schemaFile))!;
        const example = JSON.parse(fs.readFileSync(path.join(contractsDirectory, 'examples', exampleFile), 'utf8'));
        const validate = ajv.getSchema(schema.$id)!;
        expect(validate(example)).toBe(true);
    });

    it('requires every rule variant to satisfy its params schema', () => {
        const rules = [
            ['columnsPresent', { columns: ['A'] }],
            ['required', { columns: ['A'] }],
            ['type', { column: 'A', dataType: 'decimal' }],
            ['enum', { column: 'A', values: ['x'] }],
            ['range', { column: 'A', min: 0 }],
            ['pattern', { column: 'A', pattern: '^x$' }],
            ['length', { column: 'A', max: 10 }],
            ['unique', { columns: ['A', 'B'] }],
            ['lookup', { column: 'A', lookupId: 'items' }],
            ['dateRange', { column: 'A', min: '2026-01-01' }],
            ['conditionalRequired', { columns: ['A'], when: { column: 'B', op: 'eq', value: 'yes' } }],
            ['compare', { left: 'A', op: 'lt', right: 'B', as: 'number' }],
            ['rowCount', { min: 1 }],
            ['aggregate', { column: 'A', fn: 'sum', min: 1 }],
            ['reconcile', {
                left: { table: 'A', column: 'Total', fn: 'sum' },
                right: { table: 'B', column: 'Total', fn: 'sum' },
            }],
            ['naturalLanguage', {
                request: 'A is positive',
                explanation: 'Fails when A is not positive.',
                mode: 'row',
                failWhen: 'TRY_CAST(A AS DOUBLE) <= 0',
                query: null,
                message: 'A must be positive',
                columns: { Orders: ['A'] },
                examples: [],
                provenance: {
                    model: 'test',
                    responseId: 'response',
                    promptSha256: 'a'.repeat(64),
                    createdAt: '2026-10-02T00:00:00Z',
                },
            }],
        ];
        const validate = ajv.getSchema('https://dataintegrationplatform.local/contracts/rule-config.schema.json')!;
        for (const [index, [type, params]] of rules.entries()) {
            expect(validate({
                id: `rule-${index}`,
                name: `Rule ${index}`,
                description: '',
                severity: 'Error',
                executionOrder: index,
                enabled: true,
                table: null,
                type,
                params,
            })).toBe(true);
        }
    });
});

import { assertValidRule, RuleValidationError } from '../src/services/Rule.service';

jest.mock('../src/models/Rule.model', () => ({ Rule: {} }));

describe('assertValidRule', () => {
    it('accepts supported types with valid expressions', () => {
        expect(() => assertValidRule('Range Check', 'Amount: 0..100')).not.toThrow();
    });

    it.each([
        ['Custom SQL', 'SELECT * FROM upload_data'],
        ['Regex Pattern', 'Code: ^[A-Z]+$'],
        [undefined, 'A'],
        ['Enum Check', 'Status'],
    ])('rejects %p / %p with a RuleValidationError', (type, expression) => {
        expect(() => assertValidRule(type as string | undefined, expression)).toThrow(RuleValidationError);
    });
});

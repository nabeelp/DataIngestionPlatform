import { describe, expect, it } from 'vitest';
import { naturalLanguageExamples } from './naturalLanguageExamples';

describe('naturalLanguageExamples', () => {
  const crossSheet = {
    table: 'Orders',
    values: { CustomerId: 'C1' },
    expectedValid: true,
    source: 'model',
    relatedRows: [{ table: 'Customers', values: { Id: 'C1' } }],
  };

  it('keeps related rows so editing an example never drops its other-sheet data', () => {
    expect(naturalLanguageExamples({ examples: [crossSheet] })).toEqual([crossSheet]);
  });

  it('leaves examples without related rows unchanged', () => {
    const { relatedRows: _ignored, ...plain } = crossSheet;
    void _ignored;
    const [example] = naturalLanguageExamples({ examples: [plain] });
    expect(example).toEqual(plain);
    expect(example).not.toHaveProperty('relatedRows');
  });

  it('defaults an unknown source to model and skips malformed examples and related rows', () => {
    const parsed = naturalLanguageExamples({
      examples: [
        { ...crossSheet, source: 'other' },
        { ...crossSheet, relatedRows: 'nope' },
        { ...crossSheet, relatedRows: [{ table: 'Customers', values: { Id: 1 } }] },
        { ...crossSheet, relatedRows: [{ values: { Id: 'C1' } }] },
        { table: 'Orders', values: {}, expectedValid: 'yes' },
        null,
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].source).toBe('model');
  });

  it('returns nothing when there are no examples', () => {
    expect(naturalLanguageExamples({})).toEqual([]);
  });
});

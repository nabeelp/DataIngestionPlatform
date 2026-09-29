import { describe, expect, it } from 'vitest';
import { getValidationIssueCount, parseValidationIssues } from './validationIssues';

describe('getValidationIssueCount', () => {
  it('uses the warning count for warning rules', () => {
    expect(getValidationIssueCount('Warning', 0, 4)).toBe(4);
  });

  it('uses the error count for failed rules', () => {
    expect(getValidationIssueCount('Failed', 3, 0)).toBe(3);
  });
});

describe('parseValidationIssues', () => {
  it('maps the persisted validation issue row to a display row number', () => {
    expect(parseValidationIssues(JSON.stringify([
      { row: 7, column: 'Email', value: 'invalid', error: 'Invalid email' },
    ]))).toEqual([
      { rowNumber: 7, column: 'Email', value: 'invalid', error: 'Invalid email' },
    ]);
  });

  it('supports legacy row_num values', () => {
    expect(parseValidationIssues(JSON.stringify([
      { row_num: '12', column: 'Amount', value: 5000, error: 'Outside range' },
    ]))).toEqual([
      { rowNumber: 12, column: 'Amount', value: '5000', error: 'Outside range' },
    ]);
  });

  it('returns no issues for malformed data', () => {
    expect(parseValidationIssues('not json')).toEqual([]);
    expect(parseValidationIssues('{}')).toEqual([]);
  });
});

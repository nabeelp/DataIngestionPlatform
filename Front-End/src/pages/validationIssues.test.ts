import { describe, expect, it } from 'vitest';
import { mapValidationCheckStatus, parseValidationIssues } from './validationIssues';

describe('mapValidationCheckStatus', () => {
  it('distinguishes execution errors from failed checks and never defaults to passed', () => {
    expect(mapValidationCheckStatus('ERROR')).toBe('Error');
    expect(mapValidationCheckStatus('FAILED')).toBe('Failed');
    expect(mapValidationCheckStatus('PASSED')).toBe('Passed');
    expect(mapValidationCheckStatus('PENDING')).toBe('Pending');
    expect(mapValidationCheckStatus('IN_PROGRESS')).toBe('In Progress');
    expect(mapValidationCheckStatus('unexpected')).toBe('Unknown');
  });
});

describe('parseValidationIssues', () => {
  it('reads current engine messages including structural and execution issues', () => {
    expect(parseValidationIssues(JSON.stringify([
      { sheet: null, row: null, column: null, value: null, message: 'Missing required sheet' },
      { sheet: 'Data', row: 3, column: 'Total', value: 0, message: 'Outside range' },
    ]))).toEqual([
      { rowNumber: undefined, column: '', value: '', error: 'Missing required sheet' },
      { rowNumber: 3, column: 'Total', value: '0', error: 'Outside range' },
    ]);
  });

  it('maps the persisted validation issue row to a display row number', () => {
    expect(parseValidationIssues(JSON.stringify([
      { row: 7, column: 'Email', value: 'invalid', message: 'Invalid email' },
      { row: '12', column: 'Amount', value: 5000, message: 'Outside range' },
    ]))).toEqual([
      { rowNumber: 7, column: 'Email', value: 'invalid', error: 'Invalid email' },
      { rowNumber: 12, column: 'Amount', value: '5000', error: 'Outside range' },
    ]);
  });

  it('returns no issues for malformed data', () => {
    expect(parseValidationIssues('not json')).toEqual([]);
    expect(parseValidationIssues('{}')).toEqual([]);
  });

  it('preserves file-level issues without inventing a row number', () => {
    for (const row of [null, undefined, '', 0, -1, 1.5, 'NaN', 'Infinity', false]) {
      expect(parseValidationIssues(JSON.stringify([
        { row, column: null, value: null, message: 'Missing sheet' },
      ]))).toEqual([{ rowNumber: undefined, column: '', value: '', error: 'Missing sheet' }]);
    }
  });

  it('ignores non-object entries', () => {
    expect(parseValidationIssues(JSON.stringify([
      null, false, 'invalid',
      { row: 23, column: 'Total', value: 0, message: 'Outside range' },
    ]))).toEqual([{ rowNumber: 23, column: 'Total', value: '0', error: 'Outside range' }]);
    expect(parseValidationIssues(null)).toEqual([]);
  });
});

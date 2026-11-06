import { describe, expect, it } from 'vitest';
import { columnRequirementLabel, isRequiredColumn, withRequired } from './columnRequirement';

describe('column requirement', () => {
  it('is required only when the column must exist and may not be empty', () => {
    expect(isRequiredColumn({ mustExist: true, nullable: false })).toBe(true);
    expect(isRequiredColumn({ mustExist: true, nullable: true })).toBe(false);
    expect(isRequiredColumn({ mustExist: false, nullable: false })).toBe(false);
    expect(isRequiredColumn({ mustExist: false, nullable: true })).toBe(false);
  });

  it('applies the single required choice to both contract flags without touching other settings', () => {
    const column = { name: 'Amount', type: 'decimal' as const, mustExist: false, nullable: true, scale: 2 };

    expect(withRequired(column, true)).toEqual({ ...column, mustExist: true, nullable: false });
    expect(withRequired(withRequired(column, true), false)).toEqual(column);
  });

  it('describes how strictly a column is checked', () => {
    expect(columnRequirementLabel({ mustExist: true, nullable: false })).toBe('required');
    expect(columnRequirementLabel({ mustExist: true, nullable: true })).toBe('must exist, may be empty');
    expect(columnRequirementLabel({ mustExist: false, nullable: false })).toBe('optional column, no empty values');
    expect(columnRequirementLabel({ mustExist: false, nullable: true })).toBe('');
  });
});

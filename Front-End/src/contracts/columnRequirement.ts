import type { Column } from './definition-contract';

type RequirementFlags = Pick<Column, 'mustExist' | 'nullable'>;

/** A column is required when it must be present in the file and its values may not be empty. */
export const isRequiredColumn = (column: RequirementFlags): boolean => column.mustExist && !column.nullable;

/** The column with the editor's single "Required" choice applied to the contract's two flags. */
export const withRequired = <T extends RequirementFlags>(column: T, required: boolean): T => ({
  ...column,
  mustExist: required,
  nullable: !required,
});

/** Plain wording for how strictly the column is checked; empty when it is fully optional. */
export const columnRequirementLabel = (column: RequirementFlags): string => {
  if (isRequiredColumn(column)) return 'required';
  if (column.mustExist) return 'must exist, may be empty';
  if (!column.nullable) return 'optional column, no empty values';
  return '';
};

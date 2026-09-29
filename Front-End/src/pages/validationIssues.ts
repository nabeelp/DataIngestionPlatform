export interface ValidationIssue {
  column: string;
  error: string;
  rowNumber?: number;
  value: string;
}

export const getValidationIssueCount = (
  status: 'Passed' | 'Failed' | 'Warning',
  errorCount: number | null | undefined,
  warningCount: number | null | undefined,
): number => status === 'Warning' ? warningCount ?? 0 : errorCount ?? 0;

const asDisplayText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
};

export const parseValidationIssues = (failedRows: unknown): ValidationIssue[] => {
  if (typeof failedRows !== 'string' || failedRows.trim() === '') {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(failedRows);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((issue): ValidationIssue[] => {
      if (!issue || typeof issue !== 'object') {
        return [];
      }

      const record = issue as Record<string, unknown>;
      const rawRowNumber = record.row ?? record.row_num ?? record.RowNumber;
      const rowNumber = typeof rawRowNumber === 'number'
        ? rawRowNumber
        : typeof rawRowNumber === 'string' && rawRowNumber.trim() !== ''
          ? Number(rawRowNumber)
          : undefined;

      return [{
        column: asDisplayText(record.column),
        error: asDisplayText(record.error),
        rowNumber: rowNumber !== undefined && Number.isFinite(rowNumber) ? rowNumber : undefined,
        value: asDisplayText(record.value),
      }];
    });
  } catch {
    return [];
  }
};

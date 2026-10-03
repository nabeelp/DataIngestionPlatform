export interface ValidationIssue {
  column: string;
  error: string;
  rowNumber?: number;
  value: string;
}

export type ValidationCheckStatus = 'Passed' | 'Failed' | 'Warning' | 'Error' | 'Pending' | 'In Progress' | 'Unknown';

export const mapValidationCheckStatus = (status: string): ValidationCheckStatus => {
  const statuses: Record<string, ValidationCheckStatus> = {
    PASSED: 'Passed',
    FAILED: 'Failed',
    WARNING: 'Warning',
    ERROR: 'Error',
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
  };
  return statuses[status] ?? 'Unknown';
};

export const getValidationIssueCount = (
  status: ValidationCheckStatus,
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
        error: asDisplayText(record.message ?? record.error),
        rowNumber: rowNumber !== undefined && Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber : undefined,
        value: asDisplayText(record.value),
      }];
    });
  } catch {
    return [];
  }
};

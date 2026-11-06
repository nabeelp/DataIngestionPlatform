// Example file analysis
import type { Column as ContractColumn } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import { apiRequest } from '../http';

export interface ExampleColumn extends ContractColumn {
  filledRows: number;
  sampleValues: string[];
}

export interface ExampleRuleSuggestion {
  rule: RuleConfig;
  reason: string;
}

export interface ExampleSheet {
  /** Worksheet name; null for CSV files, which have no sheets. */
  name: string | null;
  headerRow: number | null;
  rowsAnalyzed: number;
  truncated: boolean;
  columns: ExampleColumn[];
  suggestedRules: ExampleRuleSuggestion[];
  warnings: string[];
}

export interface ExampleAnalysis {
  fileName: string;
  fileType: 'csv' | 'xlsx';
  sheets: ExampleSheet[];
  warnings: string[];
}

/**
 * Analyze an example CSV/XLSX file and get proposed columns and rules. The server does not keep the file.
 */
export const analyzeExampleFile = async (file: File): Promise<ExampleAnalysis> => {
  const formData = new FormData();
  formData.append('file', file);

  const data = await apiRequest<ExampleAnalysis>('/admin/file-definitions/analyze-example', {
    method: 'POST',
    body: formData,
    fallbackMessage: 'Failed to analyze the example file',
  });
  return { fileName: data.fileName, fileType: data.fileType, sheets: data.sheets, warnings: data.warnings || [] };
};

import type { ExampleAnalysis, ExampleColumn, FileDefinitionColumn, InitialRule } from '../../services/adminApi';

export interface ColumnHint {
  filledRows: number;
  rowsAnalyzed: number;
  sampleValues: string[];
}

export interface ExampleProposal {
  source: string;
  columns: FileDefinitionColumn[];
  rules: InitialRule[];
  hints: Record<string, ColumnHint>;
  suggestedName: string;
}

/** A definition name derived from the example's file name ("customer_orders-2024.xlsx" -> "customer orders 2024"). */
export const suggestedDefinitionName = (fileName: string): string =>
  fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/** The first sheet that has columns, which is the sensible default selection. */
export const defaultSheetIndex = (analysis: ExampleAnalysis): number =>
  Math.max(0, analysis.sheets.findIndex(sheet => sheet.columns.length > 0));

/**
 * Build the columns, chosen rules and per-column hints to apply from one analyzed sheet.
 */
export function proposalFromSheet(analysis: ExampleAnalysis, sheetIndex: number, selectedRuleNames: Set<string>): ExampleProposal {
  const sheet = analysis.sheets[sheetIndex];
  const toColumn = ({ name, type, required }: ExampleColumn): FileDefinitionColumn => ({ name, type, required });
  return {
    source: sheet.name ? `${analysis.fileName} › ${sheet.name}` : analysis.fileName,
    columns: sheet.columns.map(toColumn),
    rules: sheet.suggestedRules
      .filter(rule => selectedRuleNames.has(rule.name))
      .map(({ name, ruleType, expression, severity }) => ({ name, ruleType, expression, severity })),
    hints: Object.fromEntries(sheet.columns.map(column => [
      column.name,
      { filledRows: column.filledRows, rowsAnalyzed: sheet.rowsAnalyzed, sampleValues: column.sampleValues },
    ])),
    suggestedName: suggestedDefinitionName(analysis.fileName),
  };
}

/** The column a single-column rule ("Column: ...") applies to. */
export const ruleColumn = (rule: InitialRule): string => rule.expression.split(':')[0].trim();

/**
 * Split rules into those whose column is still defined and those that would refer to a removed or renamed column.
 */
export function rulesForColumns(rules: InitialRule[], columns: FileDefinitionColumn[]): { kept: InitialRule[]; skipped: InitialRule[] } {
  const names = new Set(columns.map(column => column.name.trim()));
  const kept: InitialRule[] = [];
  const skipped: InitialRule[] = [];
  for (const rule of rules) (names.has(ruleColumn(rule)) ? kept : skipped).push(rule);
  return { kept, skipped };
}

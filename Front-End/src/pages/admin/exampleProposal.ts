import type { Column, Table } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import type { ExampleAnalysis, ExampleColumn, ExampleSheet } from '../../services/adminApi';

export type DefinitionLayout = 'single' | 'sheets';

export interface ColumnHint {
  filledRows: number;
  rowsAnalyzed: number;
  sampleValues: string[];
}

export interface ExampleProposal {
  source: string;
  layout: DefinitionLayout;
  /** Single-table columns (layout "single"). */
  columns: Column[];
  /** One table per sheet (layout "sheets"). */
  tables: Table[];
  /** The selected suggestions as rules, scoped to their sheet table (null for a single table). */
  rules: RuleConfig[];
  /** Keyed by hintKey(sheet, column). */
  hints: Record<string, ColumnHint>;
  suggestedName: string;
}

/** Sheet names match case-insensitively, ignoring surrounding spaces (as validation does). */
export const sameSheet = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const hintKey = (sheet: string | null, column: string): string => `${sheet === null ? '' : sheet.trim().toLowerCase()}\u0000${column}`;

/** Identifies a suggested rule within an analysis (names repeat across sheets). */
export const suggestionKey = (sheet: string | null, ruleName: string): string => `${sheet ?? ''}\u0000${ruleName}`;

/** A definition name derived from the example's file name ("customer_orders-2024.xlsx" -> "customer orders 2024"). */
export const suggestedDefinitionName = (fileName: string): string =>
  fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Indexes of the sheets that have columns. */
export const populatedSheetIndexes = (analysis: ExampleAnalysis): number[] =>
  analysis.sheets.flatMap((sheet, index) => (sheet.columns.length > 0 ? [index] : []));

/** The first sheet that has columns, which is the sensible default selection. */
export const defaultSheetIndex = (analysis: ExampleAnalysis): number => Math.max(0, populatedSheetIndexes(analysis)[0] ?? 0);

/** Workbooks with more than one populated sheet are proposed as one table per sheet. */
export const proposesSheetTables = (analysis: ExampleAnalysis): boolean =>
  analysis.fileType === 'xlsx' && populatedSheetIndexes(analysis).length > 1;

const toColumn = ({ name, type, mustExist, nullable }: ExampleColumn): Column => ({ name, type, mustExist, nullable });

/** Workbook sheets are proposed with the contract's default table settings; the editor can change them afterwards. */
const toTable = (sheet: ExampleSheet): Table => ({
  sheet: sheet.name,
  headerRow: null,
  allowExtraColumns: true,
  minRows: null,
  maxRows: null,
  columns: sheet.columns.map(toColumn),
});

const hintsFor = (sheet: ExampleSheet, key: string | null): Record<string, ColumnHint> =>
  Object.fromEntries(sheet.columns.map(column => [
    hintKey(key, column.name),
    { filledRows: column.filledRows, rowsAnalyzed: sheet.rowsAnalyzed, sampleValues: column.sampleValues },
  ]));

const chosenRules = (sheet: ExampleSheet, selected: Set<string>, table: string | null): RuleConfig[] =>
  sheet.suggestedRules
    .filter(({ rule }) => selected.has(suggestionKey(sheet.name, rule.name)))
    .map(({ rule }) => ({ ...rule, table }) as RuleConfig);

/**
 * A single-table proposal from one analyzed sheet (CSV files, or one sheet of a workbook).
 */
export function proposalFromSheet(analysis: ExampleAnalysis, sheetIndex: number, selectedRules: Set<string>): ExampleProposal {
  const sheet = analysis.sheets[sheetIndex];
  return {
    source: sheet.name ? `${analysis.fileName} › ${sheet.name}` : analysis.fileName,
    layout: 'single',
    columns: sheet.columns.map(toColumn),
    tables: [],
    rules: chosenRules(sheet, selectedRules, null),
    hints: hintsFor(sheet, null),
    suggestedName: suggestedDefinitionName(analysis.fileName),
  };
}

/**
 * A proposal with one table per chosen workbook sheet; each rule applies to its own sheet's table.
 */
export function proposalFromSheets(analysis: ExampleAnalysis, sheetIndexes: number[], selectedRules: Set<string>): ExampleProposal {
  const sheets = sheetIndexes.map(index => analysis.sheets[index]).filter(sheet => sheet.name && sheet.columns.length > 0);
  return {
    source: `${analysis.fileName} (${sheets.length} sheet${sheets.length === 1 ? '' : 's'})`,
    layout: 'sheets',
    columns: [],
    tables: sheets.map(toTable),
    rules: sheets.flatMap(sheet => chosenRules(sheet, selectedRules, sheet.name)),
    hints: Object.assign({}, ...sheets.map(sheet => hintsFor(sheet, sheet.name))),
    suggestedName: suggestedDefinitionName(analysis.fileName),
  };
}

/** The column a single-column rule (allowed values, range, ...) applies to. */
export const ruleColumn = (rule: RuleConfig): string => {
  const column = (rule.params as Record<string, unknown>).column;
  return typeof column === 'string' ? column.trim() : '';
};

/**
 * Split rules into those that still fit the definition being edited and those whose table or column was
 * removed or renamed (or that no longer match the layout).
 */
export function rulesForLayout(
  rules: RuleConfig[],
  definition: { layout: DefinitionLayout; columns: Column[]; tables: Table[] },
): { kept: RuleConfig[]; skipped: RuleConfig[] } {
  const kept: RuleConfig[] = [];
  const skipped: RuleConfig[] = [];
  for (const rule of rules) {
    const columns = definition.layout === 'sheets'
      ? (rule.table ? definition.tables.find(table => table.sheet !== null && sameSheet(table.sheet, rule.table!))?.columns : undefined)
      : (rule.table ? undefined : definition.columns);
    const fits = Boolean(columns?.some(column => column.name.trim() === ruleColumn(rule)));
    (fits ? kept : skipped).push(rule);
  }
  return { kept, skipped };
}

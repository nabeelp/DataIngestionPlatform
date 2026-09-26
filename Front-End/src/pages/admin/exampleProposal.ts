import type { ExampleAnalysis, ExampleColumn, ExampleSheet, FileDefinitionColumn, FileDefinitionTable, InitialRule } from '../../services/adminApi';

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
  columns: FileDefinitionColumn[];
  /** One table per sheet (layout "sheets"). */
  tables: FileDefinitionTable[];
  rules: InitialRule[];
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

const toColumn = ({ name, type, required }: ExampleColumn): FileDefinitionColumn => ({ name, type, required });

const hintsFor = (sheet: ExampleSheet, key: string | null): Record<string, ColumnHint> =>
  Object.fromEntries(sheet.columns.map(column => [
    hintKey(key, column.name),
    { filledRows: column.filledRows, rowsAnalyzed: sheet.rowsAnalyzed, sampleValues: column.sampleValues },
  ]));

const chosenRules = (sheet: ExampleSheet, selected: Set<string>, table: string | null): InitialRule[] =>
  sheet.suggestedRules
    .filter(rule => selected.has(suggestionKey(sheet.name, rule.name)))
    .map(({ name, ruleType, expression, severity }) => (table === null
      ? { name, ruleType, expression, severity }
      : { name, ruleType, expression, severity, table }));

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
    tables: sheets.map(sheet => ({ sheet: sheet.name!, columns: sheet.columns.map(toColumn) })),
    rules: sheets.flatMap(sheet => chosenRules(sheet, selectedRules, sheet.name)),
    hints: Object.assign({}, ...sheets.map(sheet => hintsFor(sheet, sheet.name))),
    suggestedName: suggestedDefinitionName(analysis.fileName),
  };
}

/** The column a single-column rule ("Column: ...") applies to. */
export const ruleColumn = (rule: InitialRule): string => rule.expression.split(':')[0].trim();

/**
 * Split rules into those that still fit the definition being edited and those whose table or column was
 * removed or renamed (or that no longer match the layout).
 */
export function rulesForLayout(
  rules: InitialRule[],
  definition: { layout: DefinitionLayout; columns: FileDefinitionColumn[]; tables: FileDefinitionTable[] },
): { kept: InitialRule[]; skipped: InitialRule[] } {
  const kept: InitialRule[] = [];
  const skipped: InitialRule[] = [];
  for (const rule of rules) {
    const columns = definition.layout === 'sheets'
      ? (rule.table ? definition.tables.find(table => sameSheet(table.sheet, rule.table!))?.columns : undefined)
      : (rule.table ? undefined : definition.columns);
    const fits = Boolean(columns?.some(column => column.name.trim() === ruleColumn(rule)));
    (fits ? kept : skipped).push(rule);
  }
  return { kept, skipped };
}

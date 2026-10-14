import type { RuleConfig } from '../../contracts/rule-config';

export interface StructureTable {
  /** Workbook sheet name; null for the single table of a CSV/single-table definition. */
  sheet: string | null;
  columns: string[];
}

export interface RuleStructure {
  layout: 'single' | 'sheets';
  tables: StructureTable[];
}

type Params = Record<string, unknown>;

const norm = (value: string) => value.trim().toLowerCase();

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asParams = (value: unknown): Params =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Params : {};

export interface ColumnReference {
  /** The table the column belongs to; null means the rule's own table. */
  table: string | null;
  column: string;
}

/** The columns a rule reads, as far as its parameters declare them. Natural-language rules declare them per table. */
export function ruleColumnReferences(rule: RuleConfig): ColumnReference[] {
  const params = asParams(rule.params);
  const own = (column: unknown): ColumnReference[] => text(column) ? [{ table: null, column: text(column) }] : [];
  switch (rule.type) {
    case 'unique':
      return strings(params.columns).map(column => ({ table: null, column }));
    case 'conditionalRequired':
      return [
        ...strings(params.columns).map(column => ({ table: null, column })),
        ...own(asParams(params.when).column),
      ];
    case 'compare':
      return [...own(params.left), ...own(params.right)];
    case 'rowCount':
      return [];
    case 'reconcile':
      return ['left', 'right'].flatMap(side => {
        const reference = asParams(params[side]);
        return text(reference.column) ? [{ table: text(reference.table) || null, column: text(reference.column) }] : [];
      });
    case 'naturalLanguage': {
      const columns = params.columns;
      if (!columns || typeof columns !== 'object' || Array.isArray(columns)) return [];
      return Object.entries(columns as Record<string, unknown>)
        .flatMap(([table, names]) => strings(names).map(column => ({ table, column })));
    }
    default:
      return own(params.column);
  }
}

const findTable = (structure: RuleStructure, sheet: string | null): StructureTable | undefined => {
  if (structure.layout === 'single') return structure.tables[0];
  return sheet === null ? undefined : structure.tables.find(table => table.sheet !== null && norm(table.sheet) === norm(sheet));
};

/**
 * Plain-language reasons why a rule no longer fits the structure it is saved with (a sheet or column that was
 * renamed or removed). The rules service stays the authority on validity; this gives instant feedback while editing.
 */
export function ruleProblems(rule: RuleConfig, structure: RuleStructure): string[] {
  const problems: string[] = [];
  const usesOwnTable = rule.type !== 'reconcile' && rule.type !== 'naturalLanguage';

  if (structure.layout === 'sheets' && usesOwnTable) {
    if (!rule.table) problems.push('Choose the sheet this rule applies to.');
    else if (!findTable(structure, rule.table)) problems.push(`Sheet "${rule.table}" is no longer defined.`);
  }

  const reported = new Set<string>();
  const report = (message: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    problems.push(message);
  };
  for (const reference of ruleColumnReferences(rule)) {
    const sheet = reference.table ?? rule.table;
    const table = findTable(structure, sheet);
    if (!table) {
      if (reference.table !== null && structure.layout === 'sheets') report(`Sheet "${reference.table}" is no longer defined.`);
      continue;
    }
    if (!table.columns.some(column => norm(column) === norm(reference.column))) {
      const label = structure.layout === 'sheets' && table.sheet ? `"${reference.column}" in sheet "${table.sheet}"` : `"${reference.column}"`;
      report(`Column ${label} is no longer defined.`);
    }
  }
  return problems;
}

/** Sheets and columns of the workspace's buffered definition, in the shape the rule checks need. */
export function structureOf(contract: {
  layout: 'single' | 'sheets';
  tables: Array<{ sheet: string | null; columns: Array<{ name: string }> }>;
}): RuleStructure {
  return {
    layout: contract.layout,
    tables: contract.tables.map(table => ({
      sheet: contract.layout === 'sheets' ? table.sheet : null,
      columns: table.columns.map(column => column.name).filter(name => name.trim() !== ''),
    })),
  };
}

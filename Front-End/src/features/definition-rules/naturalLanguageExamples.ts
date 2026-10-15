import type { NaturalLanguageExample } from './NaturalLanguageExamplesEditor';

const stringRecord = (value: unknown): Record<string, string> | null =>
  value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every(item => typeof item === 'string')
    ? value as Record<string, string>
    : null;

/** Reads the examples of a Natural Language rule, skipping malformed ones. Related rows (other sheets) are preserved. */
export const naturalLanguageExamples = (params: Record<string, unknown>): NaturalLanguageExample[] => {
  if (!Array.isArray(params.examples)) return [];
  return params.examples.flatMap((item): NaturalLanguageExample[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const example = item as Record<string, unknown>;
    const values = stringRecord(example.values);
    if (typeof example.table !== 'string' || typeof example.expectedValid !== 'boolean' || !values) return [];
    let relatedRows: NaturalLanguageExample['relatedRows'];
    if (example.relatedRows !== undefined) {
      if (!Array.isArray(example.relatedRows)) return [];
      relatedRows = [];
      for (const row of example.relatedRows) {
        const record = row && typeof row === 'object' ? row as Record<string, unknown> : null;
        const rowValues = record ? stringRecord(record.values) : null;
        if (!record || typeof record.table !== 'string' || !rowValues) return [];
        relatedRows.push({ table: record.table, values: rowValues });
      }
    }
    return [{
      table: example.table,
      expectedValid: example.expectedValid,
      values,
      source: example.source === 'admin' ? 'admin' : 'model',
      ...(relatedRows ? { relatedRows } : {}),
    }];
  });
};

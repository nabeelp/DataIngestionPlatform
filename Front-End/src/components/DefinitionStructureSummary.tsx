interface SummaryColumn {
  name: string;
  type: string;
  required?: boolean;
  mustExist?: boolean;
  nullable?: boolean;
}

interface SummaryTable {
  sheet: string | null;
  headerRow?: number | null;
  allowExtraColumns?: boolean;
  minRows?: number | null;
  maxRows?: number | null;
  columns: SummaryColumn[];
}

interface Props {
  tables: SummaryTable[];
  ariaLabelPrefix?: string;
  className?: string;
  showColumnCount?: boolean;
  showTableDetails?: boolean;
}

const isRequired = (column: SummaryColumn): boolean =>
  typeof column.required === 'boolean'
    ? column.required
    : (column.mustExist ?? false) && !(column.nullable ?? true);

/** Shared review-style summary of the tables and columns in a file definition. */
export default function DefinitionStructureSummary({
  tables,
  ariaLabelPrefix = 'Definition table',
  className = 'space-y-3',
  showColumnCount = true,
  showTableDetails = true,
}: Props) {
  return (
    <div className={className}>
      {tables.map((table, tableIndex) => {
        const tableName = table.sheet || 'Single table';
        return (
          <section
            key={`${tableName}-${tableIndex}`}
            className="rounded bg-white p-3"
            aria-label={`${ariaLabelPrefix} ${tableName}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="font-semibold text-gray-900">{tableName}</h4>
                {showTableDetails && (
                  <p className="text-xs text-gray-500">
                    Header row {table.headerRow ?? 'Auto detect'} · {(table.allowExtraColumns ?? true) ? 'Extra columns allowed' : 'Exact columns only'}
                    {' · '}Rows {table.minRows ?? 0}–{table.maxRows ?? 'Unlimited'}
                  </p>
                )}
              </div>
              {showColumnCount && (
                <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                  {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <ul className="mt-3 divide-y divide-gray-100 rounded border border-gray-200">
              {table.columns.map((column, columnIndex) => (
                <li
                  key={`${column.name}-${columnIndex}`}
                  className="grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(6.5rem,auto)_1.25rem]"
                >
                  <span className="font-medium text-gray-900">{column.name}</span>
                  <span className="text-gray-600">{column.type}</span>
                  {isRequired(column) ? (
                    <span aria-label="Required" title="Required" className="text-red-600">
                      <Asterisk className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Required</span>
                    </span>
                  ) : (
                    <span aria-label="Optional" title="Optional" className="text-gray-400">
                      <Circle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">Optional</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
import { Asterisk, Circle } from 'lucide-react';

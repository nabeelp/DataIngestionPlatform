import { Plus, Trash2 } from 'lucide-react';
import type { Table as ContractTable } from '../../../contracts/definition-contract';
import BasicColumnsEditor from './BasicColumnsEditor';

interface TablesStepProps {
  tables: ContractTable[];
  onAddTable: () => void;
  onRemoveTable: (index: number) => void;
  onUpdateTable: (index: number, changes: Partial<ContractTable>) => void;
}

/** "Tables and columns": one card per table with its settings and column editor. */
export default function TablesStep({ tables, onAddTable, onRemoveTable, onUpdateTable }: TablesStepProps) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-blue-950">Define tables and columns</h3>
          <p className="mt-1 text-sm text-blue-900">
            Add the tables you need. A single table supports CSV and workbooks with one shared structure;
            adding another table creates a named multi-sheet workbook definition.
          </p>
        </div>
        <button
          type="button"
          onClick={onAddTable}
          className="flex items-center gap-1 rounded-md border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
        >
          <Plus size={16} /> Add table
        </button>
      </div>
      <div className="space-y-4">
        {tables.map((table, tableIndex) => (
          <section
            key={tableIndex}
            aria-label={`Table ${tableIndex + 1}`}
            className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/50"
          >
            <div className="flex items-center gap-3 p-3">
              {tables.length === 1 ? (
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">Table 1</p>
                  <p className="text-xs text-gray-500">The name is not matched for a single-table definition.</p>
                </div>
              ) : (
                <label className="flex-1 text-xs font-medium text-gray-600">
                  Table name *
                  <input
                    type="text"
                    value={table.sheet ?? ''}
                    maxLength={31}
                    onChange={event => onUpdateTable(tableIndex, { sheet: event.target.value })}
                    required
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => onRemoveTable(tableIndex)}
                disabled={tables.length === 1}
                className="rounded p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`Remove table ${table.sheet || tableIndex + 1}`}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="border-t border-gray-200 bg-white p-3">
              <details className="mb-3 rounded-md border border-gray-200 p-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-700">
                  Table settings
                </summary>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <label className="text-xs text-gray-600">
                    Header row
                    <input
                      aria-label={`Header row for ${table.sheet}`}
                      type="number"
                      min="1"
                      value={table.headerRow ?? ''}
                      onChange={event => onUpdateTable(tableIndex, {
                        headerRow: event.target.value === '' ? null : Number(event.target.value),
                      })}
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={table.allowExtraColumns ?? true}
                      onChange={event => onUpdateTable(tableIndex, { allowExtraColumns: event.target.checked })}
                      className="rounded border-gray-300"
                    />
                    Allow extra columns
                  </label>
                  {(['minRows', 'maxRows'] as const).map(field => (
                    <label key={field} className="text-xs text-gray-600">
                      {field === 'minRows' ? 'Minimum rows' : 'Maximum rows'}
                      <input
                        aria-label={`${field === 'minRows' ? 'Minimum rows' : 'Maximum rows'} for ${table.sheet}`}
                        type="number"
                        min="0"
                        value={table[field] ?? ''}
                        onChange={event => onUpdateTable(tableIndex, {
                          [field]: event.target.value === '' ? null : Number(event.target.value),
                        })}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
                      />
                    </label>
                  ))}
                </div>
              </details>
              <BasicColumnsEditor
                columns={table.columns}
                onChange={columns => onUpdateTable(tableIndex, { columns })}
                tableLabel={table.sheet || `Table ${tableIndex + 1}`}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

import { Plus, Trash2 } from 'lucide-react';
import type { Column as ContractColumn } from '../../../contracts/definition-contract';
import { isRequiredColumn, withRequired } from '../../../contracts/columnRequirement';
import { EMPTY_COLUMN } from './definitionForm';

interface BasicColumnsEditorProps {
  columns: ContractColumn[];
  onChange: (columns: ContractColumn[]) => void;
  tableLabel: string;
}

export default function BasicColumnsEditor({ columns, onChange, tableLabel }: BasicColumnsEditorProps) {
  const update = (index: number, changes: Partial<ContractColumn>) => {
    onChange(columns.map((column, current) => current === index ? { ...column, ...changes } : column));
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-600">{columns.length} column{columns.length === 1 ? '' : 's'}</p>
        <button
          type="button"
          onClick={() => onChange([...columns, { ...EMPTY_COLUMN }])}
          className="flex items-center gap-1 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          <Plus size={16} /> Add column
        </button>
      </div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full text-xs" aria-label={`Columns for ${tableLabel}`}>
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Column</th>
              <th className="w-24 px-2 py-1.5 text-left font-medium">Type</th>
              <th className="w-28 px-2 py-1.5 text-left font-medium">Required</th>
              <th className="w-12 px-2 py-1.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {columns.map((column, index) => (
              <tr key={index}>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    aria-label={`Column name ${index + 1} in ${tableLabel}`}
                    value={column.name}
                    onChange={event => update(index, { name: event.target.value })}
                    placeholder="Column name"
                    required
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                  />
                </td>
                <td className="w-24 px-2 py-1.5">
                  <select
                    aria-label={`Data type for ${column.name || `column ${index + 1}`}`}
                    value={column.type}
                    onChange={event => update(index, { type: event.target.value as ContractColumn['type'] })}
                    className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                  >
                    <option value="string">String</option>
                    <option value="integer">Integer</option>
                    <option value="decimal">Decimal</option>
                    <option value="date">Date</option>
                    <option value="datetime">DateTime</option>
                    <option value="boolean">Boolean</option>
                  </select>
                </td>
                <td className="w-28 px-2 py-1.5">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Required for ${column.name || `column ${index + 1}`} in ${tableLabel}`}
                      checked={isRequiredColumn(column)}
                      onChange={event => onChange(columns.map((current, position) => (
                        position === index ? withRequired(current, event.target.checked) : current
                      )))}
                      className="rounded border-gray-300"
                    />
                    <span>{isRequiredColumn(column) ? 'Yes' : 'No'}</span>
                  </label>
                </td>
                <td className="w-12 px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onChange(columns.filter((_, current) => current !== index))}
                    disabled={columns.length === 1}
                    className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`Remove column ${column.name || index + 1}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

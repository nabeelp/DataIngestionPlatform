import type { DefinitionContract } from '../../../contracts/definition-contract';
import type { DefinitionForm } from './definitionForm';

interface ContractSettingsProps {
  contract: DefinitionForm['contract'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (changes: Partial<DefinitionContract>) => void;
}

/** Advanced parsing options (encoding, ignored sheets) of the file contract. */
export default function ContractSettings({ contract, open, onOpenChange, onChange }: ContractSettingsProps) {
  return (
    <details
      open={open}
      onToggle={event => onOpenChange(event.currentTarget.open)}
      className="mb-4 rounded-md border border-gray-200 p-3"
    >
      <summary className="cursor-pointer font-medium text-gray-800">File contract settings</summary>
      <p className="mt-1 text-xs text-gray-500">Advanced parsing options for text files and Excel workbooks.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-gray-700">
          Text encoding
          <select
            aria-label="Text encoding"
            value={contract.encoding}
            onChange={e => onChange({ encoding: e.target.value as DefinitionContract['encoding'] })}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="auto">Auto detect</option>
            <option value="utf-8">UTF-8</option>
            <option value="utf-16">UTF-16</option>
            <option value="windows-1252">Windows-1252</option>
            <option value="iso-8859-1">ISO-8859-1</option>
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Ignored workbook sheets
          <textarea
            aria-label="Ignored workbook sheets"
            value={contract.ignoredSheets.join('\n')}
            onChange={e => onChange({
              ignoredSheets: e.target.value.split('\n').map(sheet => sheet.trim()).filter(Boolean),
            })}
            rows={3}
            placeholder="One sheet name per line"
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <span className="mt-1 block text-xs text-gray-500">These workbook sheets are skipped during validation.</span>
        </label>
      </div>
    </details>
  );
}

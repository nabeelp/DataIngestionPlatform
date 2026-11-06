import { FilePlus2, FileUp } from 'lucide-react';
import type { DefinitionForm } from './definitionForm';
import type { CreationPath } from './wizardSteps';

interface DefinitionDetailsStepProps {
  form: DefinitionForm;
  onFormChange: (changes: Partial<DefinitionForm>) => void;
  isEditing: boolean;
  creationPath: CreationPath;
  onChooseExample: () => void;
  onChooseCleanSlate: () => void;
  templateFile: File | null;
  currentTemplateFilename: string | null;
  removeTemplateRequested: boolean;
  onTemplateFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveTemplate: () => void;
  onUndoRemoveTemplate: () => void;
}

/** Step 1: name, description and starting point; saved definitions also edit status, delivery and template. */
export default function DefinitionDetailsStep({
  form,
  onFormChange,
  isEditing,
  creationPath,
  onChooseExample,
  onChooseCleanSlate,
  templateFile,
  currentTemplateFilename,
  removeTemplateRequested,
  onTemplateFileChange,
  onRemoveTemplate,
  onUndoRemoveTemplate,
}: DefinitionDetailsStepProps) {
  return (
    <>
      <div className="mb-4">
        <label htmlFor="definition-name" className="block text-sm font-medium text-gray-700 mb-2">
          Name *
        </label>
        <input
          id="definition-name"
          type="text"
          value={form.name}
          onChange={(e) => onFormChange({ name: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      <div className="mb-5">
        <label htmlFor="definition-description" className="block text-sm font-medium text-gray-700 mb-2">
          Description
        </label>
        <textarea
          id="definition-description"
          value={form.description}
          onChange={(e) => onFormChange({ description: e.target.value })}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {!isEditing && (
      <section className="mb-5" aria-labelledby="definition-start-heading">
        <h2 id="definition-start-heading" className="mb-2 text-sm font-medium text-gray-700">
          How would you like to define the file structure?
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            aria-pressed={creationPath === 'example'}
            onClick={onChooseExample}
            className={`w-full rounded-lg border p-4 text-left transition-colors ${
              creationPath === 'example' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'
            }`}
          >
            <span className="flex items-start gap-3">
              <span className={`rounded-md p-2 ${creationPath === 'example' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                <FileUp size={20} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900">Start from an example file</span>
                <span className="mt-1 block text-sm text-gray-600">
                  Upload a representative CSV or Excel file to propose tables, columns, and suggested rules.
                </span>
              </span>
            </span>
          </button>

          <button
            type="button"
            aria-pressed={creationPath === 'clean'}
            onClick={onChooseCleanSlate}
            className={`w-full rounded-lg border p-4 text-left transition-colors ${
              creationPath === 'clean' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'
            }`}
          >
            <span className="flex items-start gap-3">
              <span className={`rounded-md p-2 ${creationPath === 'clean' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                <FilePlus2 size={20} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900">Start from a clean slate</span>
                <span className="mt-1 block text-sm text-gray-600">
                  Define the layout and columns yourself when no example file is available yet.
                </span>
              </span>
            </span>
          </button>
        </div>
      </section>
      )}

      {isEditing && (
        <div className="mb-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <select
              value={form.status}
              onChange={(e) => onFormChange({ status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      )}

      {isEditing && (
        <details className="mb-4 rounded-md border border-gray-200 p-3">
          <summary className="cursor-pointer font-medium text-gray-800">Delivery and reusable template</summary>
          <p className="mt-1 text-xs text-gray-500">Optional settings for what happens after validation and for helping users prepare files.</p>
        {/* Delivery Section */}
        <div className="mt-4 mb-4">
          <label htmlFor="deliveryFolder" className="block text-sm font-medium text-gray-700 mb-2">
            Delivery folder (optional)
          </label>
          <input
            id="deliveryFolder"
            type="text"
            value={form.deliveryFolder}
            onChange={(e) => onFormChange({ deliveryFolder: e.target.value })}
            placeholder="e.g. finance/customers"
            maxLength={200}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Relative to the server delivery root. Leave empty to finish uploads as validated without delivery.
          </p>
        </div>

        {/* Template Attachment Section */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Template File (Excel/CSV - optional)
          </label>
          {currentTemplateFilename && !removeTemplateRequested && (
            <div className="mb-2 p-2 bg-gray-50 rounded-md text-sm text-gray-600">
              <span>Current: {currentTemplateFilename}</span>
              <button
                type="button"
                onClick={onRemoveTemplate}
                className="ml-3 font-semibold text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          )}
          {removeTemplateRequested && (
            <div className="mb-2 flex items-center justify-between rounded-md bg-amber-50 p-2 text-sm text-amber-900">
              <span>The current template will be removed when this version is published.</span>
              <button type="button" onClick={onUndoRemoveTemplate} className="font-semibold underline">
                Undo
              </button>
            </div>
          )}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            onChange={onTemplateFileChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {templateFile && (
            <div className="mt-1 text-xs text-gray-500">
              Selected: {templateFile.name}
            </div>
          )}
        </div>
        </details>
      )}
    </>
  );
}

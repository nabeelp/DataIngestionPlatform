import DefinitionStructureSummary from '../../../components/DefinitionStructureSummary';
import {
  RuleList,
  removedRules,
  ruleChangeSummary,
  ruleStatus,
  type PreflightState,
  type RuleDraftState,
  type RuleHealth,
} from '../../../features/definition-rules';
import type { Table as ContractTable } from '../../../contracts/definition-contract';
import type { DefinitionForm } from './definitionForm';
import type { CreationPath } from './wizardSteps';

interface ReviewStepProps {
  form: DefinitionForm;
  isEditing: boolean;
  creationPath: CreationPath;
  nextPublishedVersionNumber: number;
  activeVersionNumber?: number;
  summaryTables: ContractTable[];
  templateFile: File | null;
  removeTemplateRequested: boolean;
  currentTemplateFilename: string | null;
  ruleDraft: RuleDraftState;
  health: RuleHealth;
  preflight: PreflightState;
  changeNote: string;
  onChangeNoteChange: (value: string) => void;
  onEditRules: () => void;
}

/** Final step: summary of the definition, its rules and the checks, plus the optional change note. */
export default function ReviewStep({
  form,
  isEditing,
  creationPath,
  nextPublishedVersionNumber,
  activeVersionNumber,
  summaryTables,
  templateFile,
  removeTemplateRequested,
  currentTemplateFilename,
  ruleDraft,
  health,
  preflight,
  changeNote,
  onChangeNoteChange,
  onEditRules,
}: ReviewStepProps) {
  return (
    <>
      <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-base font-semibold text-blue-950">Review and publish</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded bg-white p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Name</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{form.name || 'Untitled definition'}</dd>
          </div>
          <div className="rounded bg-white p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{isEditing ? 'Publishing' : 'Starting point'}</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">
              {isEditing ? `Version ${nextPublishedVersionNumber}` : creationPath === 'example' ? 'Example file' : 'Clean slate'}
            </dd>
          </div>
          <div className="rounded bg-white p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Layout</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{form.layout === 'single' ? 'Single table' : 'Multiple tables'}</dd>
          </div>
          <div className="rounded bg-white p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Tables &amp; columns</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">
              {form.layout === 'single'
                ? `${form.columns.length} columns in one table`
                : `${form.tables.length} table${form.tables.length === 1 ? '' : 's'} (${form.tables.reduce((total, table) => total + table.columns.length, 0)} columns)`}
            </dd>
          </div>
        </dl>
        {form.description && (
          <div className="mt-3 rounded bg-white p-3 text-sm text-gray-700">
            <span className="font-medium text-gray-900">Description:</span> {form.description}
          </div>
        )}
        {isEditing && (
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded bg-white p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</dt>
              <dd className="mt-1 text-sm font-semibold text-gray-900">{form.status}</dd>
            </div>
            <div className="rounded bg-white p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Delivery folder</dt>
              <dd className="mt-1 text-sm font-semibold text-gray-900">{form.deliveryFolder || 'None'}</dd>
            </div>
            <div className="rounded bg-white p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Reusable template</dt>
              <dd className="mt-1 text-sm font-semibold text-gray-900">
                {templateFile?.name || (removeTemplateRequested ? 'Remove current template' : currentTemplateFilename || 'None')}
              </dd>
            </div>
          </dl>
        )}
        <DefinitionStructureSummary
          tables={summaryTables}
          ariaLabelPrefix="Review table"
          className="mt-3 space-y-3"
        />
        <div className="mt-3 rounded bg-white p-3" aria-label="Review rules">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Rules</p>
            <button
              type="button"
              onClick={onEditRules}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900"
            >
              Edit rules
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-700">
            {ruleDraft.rules.length === 0
              ? 'No rules. Files are checked against the structure only.'
              : `${ruleDraft.rules.length} rule${ruleDraft.rules.length === 1 ? '' : 's'}: ${ruleDraft.rules.filter(rule => rule.enabled && rule.severity === 'Error').length} blocking (Error), ${ruleDraft.rules.filter(rule => rule.enabled && rule.severity === 'Warning').length} warning${ruleDraft.rules.filter(rule => rule.enabled && rule.severity === 'Warning').length === 1 ? '' : 's'}, ${ruleDraft.rules.filter(rule => !rule.enabled).length} disabled.`}
          </p>
          {isEditing && (() => {
            const summary = ruleChangeSummary(ruleDraft);
            const removed = removedRules(ruleDraft);
            return summary.added + summary.changed + summary.removed > 0 ? (
              <p className="mt-1 text-sm text-gray-700">
                Changes since the saved draft: {summary.added} added, {summary.changed} changed, {summary.removed} removed
                {removed.length > 0 ? ` (${removed.map(rule => rule.name).join(', ')})` : ''}.
              </p>
            ) : null;
          })()}
          {preflight.result?.diff && activeVersionNumber !== undefined && (
            <p className="mt-1 text-sm text-gray-700">
              Compared with v{activeVersionNumber}: rules {preflight.result.diff.rules.added.length} added,
              {' '}{preflight.result.diff.rules.changed.length} changed, {preflight.result.diff.rules.removed.length} removed;
              {' '}columns {preflight.result.diff.columns.added.length} added, {preflight.result.diff.columns.changed.length} changed,
              {' '}{preflight.result.diff.columns.removed.length} removed.
            </p>
          )}
          {ruleDraft.rules.length > 0 && (
            <div className="mt-3">
              <RuleList
                rules={ruleDraft.rules}
                layout={form.layout}
                statusOf={rule => ruleStatus(ruleDraft, rule.id)}
                problemsOf={rule => health.problemsByRule[rule.id] ?? []}
              />
            </div>
          )}
          {preflight.loading && <p role="status" className="mt-2 text-xs text-gray-500">Checking the definition…</p>}
          {preflight.error && <p role="alert" className="mt-2 text-xs text-red-700">{preflight.error}</p>}
          {(health.blocking > 0 || health.general.length > 0) && (
            <div role="alert" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
              <p className="font-semibold">
                {health.blocking > 0 ? `${health.blocking} rule${health.blocking === 1 ? ' needs' : 's need'} attention before you can publish.` : 'The definition cannot be published yet.'}
              </p>
              {health.general.length > 0 && (
                <ul className="mt-1 list-disc pl-5">{health.general.map(message => <li key={message}>{message}</li>)}</ul>
              )}
            </div>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3">
          <label htmlFor="change-note" className="mb-2 block text-sm font-medium text-gray-700">
            Change note (optional)
          </label>
          <textarea
            id="change-note"
            value={changeNote}
            onChange={e => onChangeNoteChange(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Describe the changes included in this version"
          />
        </div>
      )}
    </>
  );
}

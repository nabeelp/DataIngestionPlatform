import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { FileDefinitionAdmin } from '../../../services/adminApi';

interface WorkspaceHeaderProps {
  editingId: string | null;
  definitionName: string;
  editingDefinition?: FileDefinitionAdmin;
  isVersionsView: boolean;
  isRulesStep: boolean;
  ruleCount: number;
  rulesWizardStep: number;
  onClose: () => void;
  onOpenSection: (step: number) => void;
}

/** Title block and (for saved definitions) the Definition / Rules / Versions navigation. */
export default function WorkspaceHeader({
  editingId,
  definitionName,
  editingDefinition,
  isVersionsView,
  isRulesStep,
  ruleCount,
  rulesWizardStep,
  onClose,
  onOpenSection,
}: WorkspaceHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-4 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {editingId && (
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 flex min-h-11 min-w-11 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            aria-label="Back to file definitions"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-blue-700">File Definitions</p>
          <h1 id="definition-editor-title" className="truncate text-xl font-bold text-gray-900 sm:text-2xl">
            {editingId ? definitionName || 'Edit definition' : 'Create a new definition'}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {editingDefinition?.activeVersion
              ? `Published v${editingDefinition.activeVersion.versionNumber}${editingDefinition.hasUnpublishedChanges ? ' · Draft changes' : ''}`
              : 'Configure the structure, then publish version 1.'}
          </p>
        </div>
      </div>
      {editingId && (
        <nav aria-label="Definition workspace" className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            aria-current={!isVersionsView && !isRulesStep ? 'page' : undefined}
            onClick={() => onOpenSection(1)}
            className={`rounded-md px-3 py-2 font-semibold ${!isVersionsView && !isRulesStep ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Definition
          </button>
          <button
            type="button"
            aria-current={!isVersionsView && isRulesStep ? 'page' : undefined}
            onClick={() => onOpenSection(rulesWizardStep)}
            className={`rounded-md px-3 py-2 font-semibold ${!isVersionsView && isRulesStep ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Rules
            {ruleCount > 0 && <span className="ml-1.5 rounded-full bg-white/80 px-1.5 text-xs">{ruleCount}</span>}
          </button>
          <Link
            to={`/admin/file-definitions/${encodeURIComponent(editingId)}/versions`}
            aria-current={isVersionsView ? 'page' : undefined}
            className={`rounded-md px-3 py-2 font-semibold ${isVersionsView ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Versions
          </Link>
        </nav>
      )}
    </div>
  );
}

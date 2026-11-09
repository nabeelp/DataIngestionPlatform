import { Check } from 'lucide-react';

interface WizardFooterProps {
  isEditing: boolean;
  wizardStep: number;
  finalWizardStep: number;
  workspaceDirty: boolean;
  uploading: boolean;
  canAdvance: boolean;
  canJumpToReview: boolean;
  nextPublishedVersionNumber: number;
  onCancel: () => void;
  onJumpToReview: () => void;
  onNext: () => void;
}

/** Sticky footer: Back/Cancel, Next (or Review & publish shortcut) and the final Publish button. */
export default function WizardFooter({
  isEditing,
  wizardStep,
  finalWizardStep,
  workspaceDirty,
  uploading,
  canAdvance,
  canJumpToReview,
  nextPublishedVersionNumber,
  onCancel,
  onJumpToReview,
  onNext,
}: WizardFooterProps) {
  return (
    <div className="sticky bottom-0 -mx-4 flex justify-between gap-3 border-t bg-white px-4 pt-4 pb-1 shadow-[0_-8px_16px_-16px_rgba(15,23,42,0.5)]">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
      >
        {isEditing ? 'Back to definitions' : 'Cancel'}
      </button>

      {wizardStep < finalWizardStep ? (
        <div className="flex items-center gap-3">
          {workspaceDirty && isEditing && (
            <span role="status" className="hidden text-xs font-medium text-amber-800 sm:inline">Unsaved changes</span>
          )}
          {isEditing && (
            <button
              type="button"
              onClick={onJumpToReview}
              disabled={!canJumpToReview}
              className="px-4 py-2 border border-blue-300 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Review &amp; publish
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onNext();
            }}
            disabled={!canAdvance}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      ) : (
        <button
          type="submit"
          disabled={uploading || !canAdvance}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={18} />
          {uploading
            ? 'Publishing...'
            : `Publish version ${isEditing ? nextPublishedVersionNumber : 1}`}
        </button>
      )}
    </div>
  );
}

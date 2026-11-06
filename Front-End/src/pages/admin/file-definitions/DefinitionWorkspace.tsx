import { RulesStep } from '../../../features/definition-rules';
import DefinitionVersionsModal from '../DefinitionVersionsModal';
import ExampleFileAssistant from '../ExampleFileAssistant';
import type { DefinitionRoute } from './useDefinitionRoute';
import type { DefinitionEditor, DefinitionNotice } from './useDefinitionEditor';
import { isStructureComplete } from './definitionForm';
import { useNavigate } from 'react-router-dom';
import ContractSettings from './ContractSettings';
import DefinitionDetailsStep from './DefinitionDetailsStep';
import ReviewStep from './ReviewStep';
import TablesStep from './TablesStep';
import WizardFooter from './WizardFooter';
import WizardStepper from './WizardStepper';
import WorkspaceHeader from './WorkspaceHeader';

interface DefinitionWorkspaceProps {
  editor: DefinitionEditor;
  route: DefinitionRoute;
  error: string | null;
  token: string | null;
  setNotice: (notice: DefinitionNotice | null) => void;
  refreshVersionStates: () => Promise<void>;
}

/** The full-page definition workspace: header, versions view and the create/edit wizard. */
export default function DefinitionWorkspace({
  editor,
  route,
  error,
  token,
  setNotice,
  refreshVersionStates,
}: DefinitionWorkspaceProps) {
  const navigate = useNavigate();
  const { editingId, editingDefinition, formData, wizardStep, creationPath } = editor;
  const isVersionsView = Boolean(route.versionsDefinitionMatch);
  const structureComplete = isStructureComplete(formData);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <WorkspaceHeader
        editingId={editingId}
        definitionName={formData.name}
        editingDefinition={editingDefinition}
        isVersionsView={isVersionsView}
        isRulesStep={editor.isRulesStep}
        ruleCount={editor.ruleDraft.rules.length}
        rulesWizardStep={editor.rulesWizardStep}
        onClose={() => editor.closeWorkspace()}
        onOpenSection={editor.openSection}
      />

      {isVersionsView && editingDefinition && (
        <DefinitionVersionsModal
          definitionId={editingDefinition.id}
          definitionName={editingDefinition.name}
          embedded
          onClose={() => navigate(`/admin/file-definitions/${encodeURIComponent(editingDefinition.id)}/edit`)}
          onPublished={version => {
            setNotice({ text: `"${editingDefinition.name}" version ${version.versionNumber} is now active. New uploads are validated against it.` });
            void refreshVersionStates();
          }}
        />
      )}

      {!isVersionsView && (
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <form onSubmit={editor.handleSubmit} className="p-4 sm:p-6">
          {editingDefinition?.activeVersion && (
            <p className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900">
              Edit the definition below, then publish a new version when you are ready. Uploads keep using v{editingDefinition.activeVersion.versionNumber} until the new version is published.
            </p>
          )}
          <WizardStepper
            isEditing={Boolean(editingId)}
            intro={editingId
              ? `Update the definition details and structure, then review and publish version ${editor.nextPublishedVersionNumber}.`
              : 'Capture the definition details, choose how you want to start, then review and publish version 1.'}
            stepLabels={editor.wizardLayout.stepLabels}
            wizardStep={wizardStep}
            structureWizardStep={editor.structureWizardStep}
            nameFilled={Boolean(formData.name.trim())}
            structureComplete={structureComplete}
            onSelectStep={editor.setWizardStep}
          />
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          {wizardStep === 1 && (
            <DefinitionDetailsStep
              form={formData}
              onFormChange={editor.updateForm}
              isEditing={Boolean(editingId)}
              creationPath={creationPath}
              onChooseExample={editor.chooseExamplePath}
              onChooseCleanSlate={editor.chooseCleanSlatePath}
              templateFile={editor.templateFile}
              currentTemplateFilename={editor.currentTemplateFilename}
              removeTemplateRequested={editor.removeTemplateRequested}
              onTemplateFileChange={editor.handleTemplateFileChange}
              onRemoveTemplate={editor.requestTemplateRemoval}
              onUndoRemoveTemplate={editor.undoTemplateRemoval}
            />
          )}

          {((creationPath === 'example' && wizardStep === 2) || editor.isStructureWizardStep) && (
            <section className="mb-5" aria-live="polite">
              {creationPath === 'example' && wizardStep === 2 ? (
                <>
                  <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    Upload the example file, review the suggested sheets, then continue to tables and columns.
                  </div>
                  <ExampleFileAssistant allowRules onProposalChange={editor.setExampleProposal} embedded />
                </>
              ) : (
                <TablesStep
                  tables={editor.cleanSlateTables}
                  onAddTable={editor.addTable}
                  onRemoveTable={editor.removeTable}
                  onUpdateTable={editor.updateTable}
                />
              )}
            </section>
          )}

          {wizardStep === 2 && (
            <ContractSettings
              contract={formData.contract}
              open={editor.showContractSettings}
              onOpenChange={editor.setShowContractSettings}
              onChange={editor.updateContract}
            />
          )}

          {editor.isRulesStep && (
            <section className="mb-5">
              <RulesStep
                draft={editor.ruleDraft}
                dispatch={editor.dispatchRules}
                contract={editor.draftContract}
                definitionId={editingId}
                token={token}
                health={editor.health}
                preflight={editor.preflight}
                loading={Boolean(editingId) && editor.rulesState === 'loading'}
                loadError={editor.rulesLoadError}
                suggestedCount={editor.suggestedRuleCount}
              />
              {editingId && editor.rulesState === 'error' && (
                <button
                  type="button"
                  onClick={() => void editor.loadRules(editingId)}
                  className="mt-3 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Retry loading rules
                </button>
              )}
            </section>
          )}

          {editor.isReviewStep && (
            <ReviewStep
              form={formData}
              isEditing={Boolean(editingId)}
              creationPath={creationPath}
              nextPublishedVersionNumber={editor.nextPublishedVersionNumber}
              activeVersionNumber={editingDefinition?.activeVersion?.versionNumber}
              summaryTables={editor.summaryTables}
              templateFile={editor.templateFile}
              removeTemplateRequested={editor.removeTemplateRequested}
              currentTemplateFilename={editor.currentTemplateFilename}
              ruleDraft={editor.ruleDraft}
              health={editor.health}
              preflight={editor.preflight}
              changeNote={editor.changeNote}
              onChangeNoteChange={editor.setChangeNote}
              onEditRules={() => editor.setWizardStep(editor.rulesWizardStep)}
            />
          )}

          <WizardFooter
            isEditing={Boolean(editingId)}
            wizardStep={wizardStep}
            finalWizardStep={editor.finalWizardStep}
            workspaceDirty={editor.workspaceDirty}
            uploading={editor.uploading}
            canAdvance={editor.canAdvance}
            canJumpToReview={Boolean(formData.name.trim()) && structureComplete && editor.rulesReady}
            nextPublishedVersionNumber={editor.nextPublishedVersionNumber}
            onCancel={() => editor.closeWorkspace()}
            onJumpToReview={() => editor.setWizardStep(editor.finalWizardStep)}
            onNext={editor.goToNextStep}
          />

        </form>
      </div>
      )}
    </div>
  );
}

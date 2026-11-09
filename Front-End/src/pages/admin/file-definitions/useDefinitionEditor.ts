import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSaveDefinitionMutation } from '../../../services/hooks/definitions';
import type { FileDefinitionAdmin } from '../../../services/adminApi';
import {
  isRuleDraftDirty,
  ruleHealth,
  structureOf,
  usePreflight,
  useUnsavedChangesGuard,
  type DraftContext,
} from '../../../features/definition-rules';
import type { ExampleProposal } from '../exampleProposal';
import {
  EMPTY_FORM,
  addTableToForm,
  applyProposalToForm,
  buildDefinitionContract,
  cleanSlateTablesOf,
  formFromDefinition,
  isStructureComplete,
  removeTableFromForm,
  startFromCleanSlate,
  summaryTablesOf,
  updateTableInForm,
  type DefinitionForm,
} from './definitionForm';
import type { DefinitionRoute } from './useDefinitionRoute';
import { useRuleDraft } from './useRuleDraft';
import { canMoveToNextStep, getWizardLayout, type CreationPath } from './wizardSteps';

export interface DefinitionNotice {
  text: string;
  definition?: FileDefinitionAdmin;
}

interface Options {
  route: DefinitionRoute;
  definitions: FileDefinitionAdmin[];
  fetchDefinitions: () => Promise<FileDefinitionAdmin[]>;
  setError: (message: string | null) => void;
  setNotice: (notice: DefinitionNotice | null) => void;
}

/** Draft state of the definition workspace: form, template, wizard step, rules draft, and load/save/publish. */
export function useDefinitionEditor({ route, definitions, fetchDefinitions, setError, setNotice }: Options) {
  const { newDefinitionMatch, rulesDefinitionMatch, versionsDefinitionMatch, isDefinitionWorkspace, routeDefinitionId } = route;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initializedWorkspace = useRef('');
  const { mutateAsync: saveDefinition } = useSaveDefinitionMutation();
  const savedSnapshot = useRef('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<DefinitionForm>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [currentTemplateFilename, setCurrentTemplateFilename] = useState<string | null>(null);
  const [removeTemplateRequested, setRemoveTemplateRequested] = useState(false);
  const rules = useRuleDraft();
  const { ruleDraft, rulesState, draftRevision } = rules;
  const [showContractSettings, setShowContractSettings] = useState(false);
  const [creationPath, setCreationPath] = useState<CreationPath>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [changeNote, setChangeNote] = useState('');
  const [exampleProposal, setExampleProposal] = useState<ExampleProposal | null>(null);

  const editingDefinition = editingId ? definitions.find(def => def.id === editingId) : undefined;

  // The rules step and review check the whole draft with the rules service once the structure is complete.
  const draftContract = useMemo(
    () => buildDefinitionContract({ layout: formData.layout, columns: formData.columns, tables: formData.tables, contract: formData.contract }),
    [formData.layout, formData.columns, formData.tables, formData.contract],
  );
  const rulesReady = !editingId || rulesState === 'ready';
  const checkingDraft = wizardStep >= (creationPath === 'example' ? 4 : 3) && isDefinitionWorkspace && rulesReady;
  const ruleSet = ruleDraft.rules;
  const enabledRules = useMemo(() => ruleSet.filter(rule => rule.enabled), [ruleSet]);
  const preflightContext: DraftContext | null = useMemo(
    () => (checkingDraft && isStructureComplete(formData) ? { contract: draftContract, rules: enabledRules } : null),
    [checkingDraft, draftContract, formData, enabledRules],
  );
  const preflight = usePreflight(preflightContext, editingId);
  const health = useMemo(
    () => ruleHealth(ruleDraft.rules, structureOf(draftContract), preflight.result),
    [ruleDraft.rules, draftContract, preflight.result],
  );
  const preflightOk = !preflight.result || preflight.result.ok || health.blocking > 0;

  const workspaceDirty = isDefinitionWorkspace && savedSnapshot.current !== '' && (
    isRuleDraftDirty(ruleDraft)
    || JSON.stringify(formData) !== savedSnapshot.current
    || Boolean(templateFile)
    || removeTemplateRequested
    || Boolean(changeNote)
    || (!editingId && (Boolean(creationPath) || ruleDraft.rules.length > 0))
  );
  useUnsavedChangesGuard(workspaceDirty && !uploading, {
    keepPathPrefix: editingId ? `/admin/file-definitions/${encodeURIComponent(editingId)}` : '/admin/file-definitions/new',
  });

  const wizardLayout = getWizardLayout(creationPath);
  const { finalWizardStep, structureWizardStep, rulesWizardStep } = wizardLayout;
  const nextPublishedVersionNumber = editingDefinition?.activeVersion ? editingDefinition.activeVersion.versionNumber + 1 : 1;
  const canAdvance = canMoveToNextStep({
    editingId,
    wizardStep,
    layout: wizardLayout,
    formData,
    creationPath,
    exampleProposal,
    rulesReady,
    blockingRules: health.blocking,
    preflightOk,
  });

  const populateEditor = (def: FileDefinitionAdmin, initialStep?: string | null) => {
    const form = formFromDefinition(def);
    setEditingId(def.id);
    setFormData(form);
    savedSnapshot.current = JSON.stringify(form);
    setCurrentTemplateFilename(def.templateFilename || null);
    setTemplateFile(null);
    setRemoveTemplateRequested(false);
    rules.resetRules();
    void rules.loadRules(def.id);
    setShowContractSettings(false);
    setCreationPath('clean');
    setExampleProposal(null);
    // Edit workspaces have four sections: details, structure, rules, review.
    setWizardStep(initialStep === 'rules' ? 3 : 1);
    setChangeNote('');
  };

  useEffect(() => {
    if (newDefinitionMatch) {
      if (initializedWorkspace.current === 'new') return;
      initializedWorkspace.current = 'new';
      setEditingId(null);
      setFormData(EMPTY_FORM);
      setCurrentTemplateFilename(null);
      setTemplateFile(null);
      setRemoveTemplateRequested(false);
      rules.resetRules();
      rules.settleRules();
      savedSnapshot.current = JSON.stringify(EMPTY_FORM);
      setShowContractSettings(false);
      setCreationPath(null);
      setWizardStep(1);
      setChangeNote('');
      setExampleProposal(null);
      setError(null);
      return;
    }

    if (!routeDefinitionId || definitions.length === 0) return;
    const workspaceKey = `edit:${routeDefinitionId}`;
    if (initializedWorkspace.current === workspaceKey) return;
    const definition = definitions.find(item => item.id === routeDefinitionId);
    if (!definition) {
      initializedWorkspace.current = workspaceKey;
      setError('File definition not found');
      return;
    }
    initializedWorkspace.current = workspaceKey;
    populateEditor(definition, rulesDefinitionMatch ? 'rules' : searchParams.get('step'));
    // Initialization is keyed by `initializedWorkspace`; re-running on every handler/param change would reset edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitions, newDefinitionMatch, routeDefinitionId]);

  const closeWorkspace = (force = false) => {
    if (force !== true && workspaceDirty && !window.confirm('You have unsaved changes to this definition. Discard them?')) return;
    setEditingId(null);
    setTemplateFile(null);
    setRemoveTemplateRequested(false);
    setCurrentTemplateFilename(null);
    rules.resetRules();
    rules.settleRules();
    savedSnapshot.current = '';
    setShowContractSettings(false);
    setCreationPath(null);
    setExampleProposal(null);
    setWizardStep(1);
    setChangeNote('');
    setFormData(EMPTY_FORM);
    setError(null);
    initializedWorkspace.current = '';
    navigate('/admin/file-definitions');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return;
    if (editingId && rulesState !== 'ready') {
      setError('The rules have not loaded, so the definition cannot be saved yet.');
      return;
    }

    const contract = buildDefinitionContract(formData);
    const payload = {
      name: formData.name,
      description: formData.description,
      status: editingId ? formData.status : 'Active',
      deliveryFolder: formData.deliveryFolder.trim() || null,
      contract,
    };
    const draftRules = ruleDraft.rules;

    let savedId: string | null = null;
    const wasEditing = Boolean(editingId);
    let succeeded = false;
    let publishedVersion: { versionNumber: number } | null = null;

    try {
      setUploading(true);
      setError(null);

      const saved = await saveDefinition({
        editingId,
        payload,
        rules: draftRules,
        revision: draftRevision.current,
        templateFile,
        removeStoredTemplate: removeTemplateRequested && Boolean(currentTemplateFilename),
        changeNote,
        onRevision: revision => { draftRevision.current = revision; },
      });
      savedId = saved.savedId;
      publishedVersion = saved.publishedVersion;
      succeeded = true;
      savedSnapshot.current = JSON.stringify(formData);
      rules.dispatchRules({ type: 'load', rules: draftRules });
      closeWorkspace(true);
    } catch (err) {
      console.error('Failed to publish file definition:', err);
      setError(err instanceof Error ? err.message : 'Failed to publish file definition');
    } finally {
      setUploading(false);
      const refreshed = await fetchDefinitions();
      const current = refreshed.find(def => def.id === savedId);
      if (succeeded && current) {
        if (!wasEditing) {
          const ruleText = draftRules.length > 0 ? ` It includes ${draftRules.length} rule${draftRules.length === 1 ? '' : 's'}.` : '';
          setNotice({ text: `"${current.name}" was created and published as version ${current.activeVersion?.versionNumber ?? 1}.${ruleText}` });
        } else if (publishedVersion) {
          setNotice({ text: `"${current.name}" was published as version ${publishedVersion.versionNumber}.` });
        } else if (current.hasUnpublishedChanges) {
          setNotice({
            text: `"${current.name}" has unpublished changes. Uploads keep using v${current.activeVersion?.versionNumber ?? '-'} until you publish a new version.`,
            definition: current,
          });
        } else {
          setNotice({ text: `"${current.name}" was saved.` });
        }
      }
    }
  };

  const applyExample = (proposal: ExampleProposal) => {
    if (rules.isProposalApplied(proposal)) return;
    setFormData(prev => applyProposalToForm(prev, proposal));
    rules.applyProposalRules(proposal);
  };

  const updateForm = (changes: Partial<DefinitionForm>) => setFormData(prev => ({ ...prev, ...changes }));

  const updateContract = (changes: Partial<DefinitionForm['contract']>) => setFormData(prev => ({
    ...prev,
    contract: { ...prev.contract, ...changes },
  }));

  const chooseExamplePath = () => {
    setCreationPath('example');
    setExampleProposal(null);
    rules.resetRules();
  };

  const chooseCleanSlatePath = () => {
    setCreationPath('clean');
    setExampleProposal(null);
    rules.resetRules();
    setFormData(startFromCleanSlate);
  };

  const openSection = (step: number) => {
    setWizardStep(step);
    if (versionsDefinitionMatch && editingId) navigate(`/admin/file-definitions/${encodeURIComponent(editingId)}/edit`);
  };

  const goToNextStep = () => {
    if (wizardStep === 2 && creationPath === 'example' && exampleProposal) {
      applyExample(exampleProposal);
    }
    setWizardStep(prev => prev + 1);
  };

  const handleTemplateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setTemplateFile(file);
    if (file) setRemoveTemplateRequested(false);
  };

  const requestTemplateRemoval = () => {
    setTemplateFile(null);
    setRemoveTemplateRequested(true);
  };

  return {
    editingId,
    editingDefinition,
    formData,
    updateForm,
    updateContract,
    uploading,
    templateFile,
    currentTemplateFilename,
    removeTemplateRequested,
    handleTemplateFileChange,
    requestTemplateRemoval,
    undoTemplateRemoval: () => setRemoveTemplateRequested(false),
    ruleDraft,
    dispatchRules: rules.dispatchRules,
    rulesState,
    rulesLoadError: rules.rulesLoadError,
    suggestedRuleCount: rules.suggestedRuleCount,
    loadRules: rules.loadRules,
    showContractSettings,
    setShowContractSettings,
    creationPath,
    wizardStep,
    setWizardStep,
    wizardLayout,
    finalWizardStep,
    structureWizardStep,
    rulesWizardStep,
    isRulesStep: wizardStep === rulesWizardStep,
    isReviewStep: wizardStep === finalWizardStep,
    isStructureWizardStep: wizardStep === structureWizardStep,
    changeNote,
    setChangeNote,
    exampleProposal,
    setExampleProposal,
    draftContract,
    health,
    preflight,
    workspaceDirty,
    nextPublishedVersionNumber,
    canAdvance,
    rulesReady,
    cleanSlateTables: cleanSlateTablesOf(formData),
    summaryTables: summaryTablesOf(formData),
    addTable: () => setFormData(addTableToForm),
    removeTable: (index: number) => setFormData(prev => removeTableFromForm(prev, index)),
    updateTable: (index: number, changes: Partial<DefinitionForm['tables'][number]>) =>
      setFormData(prev => updateTableInForm(prev, index, changes)),
    chooseExamplePath,
    chooseCleanSlatePath,
    openSection,
    goToNextStep,
    closeWorkspace,
    handleSubmit,
  };
}

export type DefinitionEditor = ReturnType<typeof useDefinitionEditor>;

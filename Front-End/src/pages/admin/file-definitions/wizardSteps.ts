import type { ExampleProposal } from '../exampleProposal';
import { isStructureComplete, type DefinitionForm } from './definitionForm';

export type CreationPath = 'example' | 'clean' | null;

export interface WizardLayout {
  stepLabels: string[];
  finalWizardStep: number;
  structureWizardStep: number;
  rulesWizardStep: number;
}

export const getWizardLayout = (creationPath: CreationPath): WizardLayout => {
  const stepLabels = creationPath === 'example'
    ? ['Details', 'Example file', 'Tables and columns', 'Rules', 'Review']
    : ['Details', 'Tables and columns', 'Rules', 'Review'];
  const finalWizardStep = stepLabels.length;
  return {
    stepLabels,
    finalWizardStep,
    structureWizardStep: creationPath === 'example' ? 3 : 2,
    rulesWizardStep: finalWizardStep - 1,
  };
};

interface NextStepInput {
  editingId: string | null;
  wizardStep: number;
  layout: WizardLayout;
  formData: DefinitionForm;
  creationPath: CreationPath;
  exampleProposal: ExampleProposal | null;
  rulesReady: boolean;
  blockingRules: number;
  preflightOk: boolean;
}

export const canMoveToNextStep = ({
  editingId,
  wizardStep,
  layout,
  formData,
  creationPath,
  exampleProposal,
  rulesReady,
  blockingRules,
  preflightOk,
}: NextStepInput): boolean => {
  const isRulesStep = wizardStep === layout.rulesWizardStep;
  const isReviewStep = wizardStep === layout.finalWizardStep;
  if (editingId) {
    if (wizardStep === 1) return Boolean(formData.name.trim());
    if (wizardStep === layout.structureWizardStep) return isStructureComplete(formData);
    if (isRulesStep || isReviewStep) return rulesReady && blockingRules === 0 && preflightOk;
    return true;
  }
  if (wizardStep === 1) return Boolean(formData.name.trim()) && Boolean(creationPath);
  if (creationPath === 'example' && wizardStep === 2) return Boolean(exampleProposal);
  if (wizardStep === layout.structureWizardStep) return isStructureComplete(formData);
  if (isRulesStep || isReviewStep) return blockingRules === 0 && preflightOk;
  return true;
};

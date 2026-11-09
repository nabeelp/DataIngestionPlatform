// Saving a definition draft is one user action made of several calls: save, template change, publish.
import type { RuleConfig } from '../../contracts/rule-config';
import type { DefinitionContract } from '../../contracts/definition-contract';
import {
  createFileDefinitionAdmin,
  removeTemplate,
  updateFileDefinitionAdmin,
  uploadTemplate,
} from './fileDefinitions';
import { publishFileDefinitionVersion } from './fileDefinitionVersions';

export interface SaveDefinitionInput {
  /** The definition being edited; null creates a new one. */
  editingId: string | null;
  payload: {
    name: string;
    description: string;
    status: string;
    deliveryFolder: string | null;
    contract: DefinitionContract;
  };
  rules: RuleConfig[];
  /** The draft revision the editor loaded (detects edits made by someone else). */
  revision: string | null;
  templateFile: File | null;
  /** Delete the stored template (only when no replacement file is given). */
  removeStoredTemplate: boolean;
  changeNote: string;
  /** Called as soon as the draft is saved, before the later steps can fail. */
  onRevision?: (revision: string) => void;
}

export interface SaveDefinitionResult {
  savedId: string | null;
  /** Set when an existing definition was published; new definitions are published by the server. */
  publishedVersion: { versionNumber: number } | null;
}

export const saveDefinition = async (input: SaveDefinitionInput): Promise<SaveDefinitionResult> => {
  const { editingId, payload, rules, templateFile } = input;
  const saved = editingId
    ? await updateFileDefinitionAdmin(editingId, { ...payload, rules, revision: input.revision })
    : await createFileDefinitionAdmin({ ...payload, rules });
  const savedId = saved.id || editingId;
  const savedRevision = (saved as { revision?: string | null }).revision;
  if (savedRevision) input.onRevision?.(savedRevision);

  if (templateFile) {
    if (!savedId) throw new Error('Definition was saved, but its id was not returned');
    await uploadTemplate(savedId, templateFile);
  } else if (editingId && input.removeStoredTemplate) {
    await removeTemplate(editingId);
  }

  let publishedVersion: SaveDefinitionResult['publishedVersion'] = null;
  if (editingId) {
    const published = await publishFileDefinitionVersion(editingId, input.changeNote || undefined);
    publishedVersion = { versionNumber: published.versionNumber };
  }
  return { savedId, publishedVersion };
};

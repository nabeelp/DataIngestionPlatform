// File definitions (admin): CRUD, export and example template
import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import { saveBlob } from '../download';
import { apiRequest } from '../http';

export interface FileDefinitionAdmin {
  id: string;
  name: string;
  description: string;
  /** The draft structure; its rules are always empty here (rules live in the draft rules API). */
  contract: DefinitionContract;
  status: string;
  createdAt: string;
  updatedAt: string;
  templateFilename?: string | null;
  deliveryFolder?: string | null;
  activeVersion?: { id: string; versionNumber: number; activatedAt: string } | null;
  hasUnpublishedChanges?: boolean;
}

export interface FileDefinitionCreate {
  name: string;
  description?: string;
  contract: DefinitionContract;
  status?: string;
  deliveryFolder?: string | null;
  /** Rules published with version 1. */
  rules?: RuleConfig[];
}

export interface FileDefinitionUpdate {
  name?: string;
  description?: string;
  contract?: DefinitionContract;
  /** The complete rule set; rules missing from it are deleted. Requires `contract`. */
  rules?: RuleConfig[];
  /** The revision the editor loaded; the save fails with a conflict when the draft has changed since. */
  revision?: string | null;
  status?: string;
  deliveryFolder?: string | null;
}

const definitionPath = (id: string) => `/admin/file-definitions/${encodeURIComponent(id)}`;

export const removeTemplate = async (definitionId: string): Promise<void> => {
  await apiRequest<{ success: true }>(`${definitionPath(definitionId)}/template`, { method: 'DELETE' });
};

export interface AdminDefinitionList {
  definitions: FileDefinitionAdmin[];
  total: number;
}

export const getFileDefinitionsAdmin = (): Promise<AdminDefinitionList> =>
  apiRequest('/admin/file-definitions', { fallbackMessage: 'Failed to fetch file definitions' });

export const createFileDefinitionAdmin = async (defData: FileDefinitionCreate): Promise<FileDefinitionAdmin> => {
  const data = await apiRequest<{ definition: FileDefinitionAdmin }>('/admin/file-definitions', {
    method: 'POST',
    body: defData,
    fallbackMessage: 'Failed to create file definition',
  });
  return data.definition;
};

export const updateFileDefinitionAdmin = async (
  id: string,
  updates: FileDefinitionUpdate
): Promise<FileDefinitionAdmin & { revision?: string | null }> => {
  const data = await apiRequest<{ definition: FileDefinitionAdmin; revision?: string | null }>(definitionPath(id), {
    method: 'PUT',
    body: updates,
    fallbackMessage: 'Failed to update file definition',
  });
  return { ...data.definition, revision: data.revision ?? null };
};

export const deleteFileDefinitionAdmin = async (id: string): Promise<void> => {
  await apiRequest(definitionPath(id), { method: 'DELETE', fallbackMessage: 'Failed to delete file definition' });
};

/**
 * Export file definition as JSON download
 */
export const exportFileDefinition = async (definitionId: string): Promise<void> => {
  const content = await apiRequest<{ name: string }>(`${definitionPath(definitionId)}/export`, {
    fallbackMessage: 'Failed to export file definition',
  });
  const filename = `${content.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-definition.json`;
  saveBlob(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }), filename);
};

/**
 * Upload template file (admin)
 */
export const uploadTemplate = async (definitionId: string, file: File): Promise<{ templateFilename: string }> => {
  const formData = new FormData();
  formData.append('file', file);

  const data = await apiRequest<{ templateFilename: string }>(`${definitionPath(definitionId)}/template-upload`, {
    method: 'POST',
    body: formData,
    fallbackMessage: 'Failed to upload template',
  });
  return { templateFilename: data.templateFilename };
};

// File definitions (admin): CRUD, export and example template
import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import { apiRequest } from '../http';
import { getAuthToken, getBaseUrl, getFetchOptions } from './shared';

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

export const removeTemplate = async (definitionId: string): Promise<void> => {
  await apiRequest<{ success: true }>(
    `/admin/file-definitions/${encodeURIComponent(definitionId)}/template`,
    { method: 'DELETE' }
  );
};

export const getFileDefinitionsAdmin = async (): Promise<{
  definitions: FileDefinitionAdmin[];
  total: number;
}> => {
  const response = await fetch(`${getBaseUrl()}/admin/file-definitions`, getFetchOptions('GET'));
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch file definitions');
  }
  return data;
};

export const createFileDefinitionAdmin = async (defData: {
  name: string;
  description?: string;
  contract: DefinitionContract;
  status?: string;
  deliveryFolder?: string | null;
  /** Rules published with version 1. */
  rules?: RuleConfig[];
}): Promise<FileDefinitionAdmin> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions`,
    getFetchOptions('POST', defData)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to create file definition');
  }
  return data.definition;
};

export const updateFileDefinitionAdmin = async (
  id: string,
  updates: {
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
): Promise<FileDefinitionAdmin & { revision?: string | null }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${id}`,
    getFetchOptions('PUT', updates)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to update file definition');
  }
  return { ...data.definition, revision: data.revision ?? null };
};

export const deleteFileDefinitionAdmin = async (id: string): Promise<void> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${id}`,
    getFetchOptions('DELETE')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to delete file definition');
  }
};

/**
 * Export file definition as JSON download
 */
export const exportFileDefinition = async (definitionId: string): Promise<void> => {
  try {
    const response = await fetch(
      `${getBaseUrl()}/admin/file-definitions/${definitionId}/export`,
      getFetchOptions('GET')
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to export file definition');
    }

    const content = await response.json();
    const filename = `${content.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-definition.json`;
    
    // Create blob and trigger download
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Export failed:', error);
    throw new Error(error instanceof Error ? error.message : 'Export failed');
  }
};

/**
 * Upload template file (admin)
 */
export const uploadTemplate = async (definitionId: string, file: File): Promise<{ templateFilename: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  const token = getAuthToken();

  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${encodeURIComponent(definitionId)}/template-upload`,
    {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : undefined,
      body: formData,
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Failed to upload template');
  }
  return { templateFilename: data.templateFilename };
};

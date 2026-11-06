// File definition version history and publishing
import type { DefinitionContract } from '../../contracts/definition-contract';
import { apiRequest } from '../http';

export interface DefinitionVersion {
  id: string;
  versionNumber: number;
  status: 'Active' | 'Superseded';
  /** The published snapshot: layout, tables, columns and the enabled rules. */
  contract: DefinitionContract;
  definitionMetadata: DefinitionMetadataSnapshot | null;
  changeNote: string | null;
  createdByName: string | null;
  activatedAt: string;
  supersededAt: string | null;
}

export interface DefinitionMetadataSnapshot {
  name: string;
  description: string;
  status: 'Active' | 'Inactive';
  deliveryFolder: string | null;
  templateFilename: string | null;
}

export interface ContractChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface DefinitionVersionHistory {
  activeVersionNumber: number | null;
  hasUnpublishedChanges: boolean;
  changes: { metadata: ContractChanges; columns: ContractChanges; rules: ContractChanges };
  versions: DefinitionVersion[];
}

export const getFileDefinitionVersions = (definitionId: string): Promise<DefinitionVersionHistory> =>
  apiRequest<DefinitionVersionHistory>(`/admin/file-definitions/${encodeURIComponent(definitionId)}/versions`);

export const publishFileDefinitionVersion = async (definitionId: string, changeNote?: string): Promise<DefinitionVersion> => {
  const data = await apiRequest<{ version: DefinitionVersion }>(
    `/admin/file-definitions/${encodeURIComponent(definitionId)}/versions`,
    { method: 'POST', body: { changeNote: changeNote?.trim() || null } }
  );
  return data.version;
};

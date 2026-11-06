/**
 * Definition API Service - User-accessible file definitions
 * For regular users in upload flow (not admin-only)
 */

import type { Column, DefinitionContract } from '../contracts/definition-contract';
import { downloadApiFile } from './download';
import { apiRequest } from './http';

export interface DefinitionSummary {
  id: string;
  name: string;
  description: string;
  /** All columns (across sheet tables) for the summary chips. */
  columns: Column[];
  /** The published tables uploads are validated against; sheet is null for a single table. */
  tables: { sheet: string | null; columns: Column[] }[];
  /** The active version's contract; null until a version is published. */
  contract: DefinitionContract | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  hasTemplate: boolean;
  activeVersion: { id: string; versionNumber: number; activatedAt: string } | null;
  ruleCounts: {
    total: number;
    errors: number;
    warnings: number;
  };
}

/** A row of `GET /definitions`: the raw definition entity (PascalCase) with the active version's contract. */
export interface DefinitionRow {
  Id: string;
  Name: string;
  Description: string;
  Status: string;
  CreatedAt: string;
  UpdatedAt: string;
  TemplateFilename?: string | null;
  Contract: DefinitionContract | null;
  ActiveVersion: { id: string; versionNumber: number; activatedAt: string } | null;
}

export interface GetFileDefinitionsResponse {
  definitions: DefinitionSummary[];
  total: number;
}

export const mapDefinitionSummary = (raw: DefinitionRow): DefinitionSummary => {
  const contract = raw.Contract;
  const tables = contract?.tables.map(table => ({ sheet: table.sheet, columns: table.columns })) ?? [];
  const rules = contract?.rules ?? [];

  return {
    id: raw.Id,
    name: raw.Name,
    description: raw.Description,
    columns: tables.flatMap(table => table.columns),
    tables,
    contract,
    status: raw.Status,
    createdAt: raw.CreatedAt,
    updatedAt: raw.UpdatedAt,
    hasTemplate: Boolean(raw.TemplateFilename),
    activeVersion: raw.ActiveVersion,
    ruleCounts: {
      total: rules.filter(rule => rule.enabled).length,
      errors: rules.filter(rule => rule.enabled && rule.severity === 'Error').length,
      warnings: rules.filter(rule => rule.enabled && rule.severity === 'Warning').length,
    },
  };
};

/**
 * Download template file for file definition
 */
export const downloadTemplate = (definitionId: string): Promise<void> =>
  downloadApiFile(`/definitions/${encodeURIComponent(definitionId)}/template`, {
    fallbackFilename: `${definitionId}-template.xlsx`,
    failureMessage: 'Failed to download template',
  });

/**
 * Get file definitions accessible to current user
 * User sees only definitions they have access to
 */
export const getFileDefinitions = async (): Promise<GetFileDefinitionsResponse> => {
  const data = await apiRequest<{ definitions: DefinitionRow[]; total?: number }>('/definitions', {
    fallbackMessage: 'Failed to fetch file definitions',
  });
  const definitions = data.definitions.map(mapDefinitionSummary);
  return { definitions, total: data.total ?? definitions.length };
};

export default {
  getFileDefinitions,
};

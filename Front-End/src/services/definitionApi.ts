/**
 * Definition API Service - User-accessible file definitions
 * For regular users in upload flow (not admin-only)
 */

import { apiConfig } from '../config/api';
import type { DefinitionContract } from '../contracts/definition-contract';

// Reuse types from adminApi (same structure)
export interface FileDefinitionColumn {
  name: string;
  type: string;
  required: boolean;
}

export interface DefinitionSummary {
  id: string;
  name: string;
  description: string;
  columns: FileDefinitionColumn[];
  tables: { sheet: string | null; columns: FileDefinitionColumn[] }[];
  contract: DefinitionContract | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  hasTemplate: boolean;
  activeVersion: { id: string; versionNumber: number; activatedAt: string } | null;
  hasUnpublishedChanges: boolean;
  ruleCounts: {
    total: number;
    errors: number;
    warnings: number;
  };
}

export interface GetFileDefinitionsResponse {
  definitions: DefinitionSummary[];
  total: number;
}

const pick = <T,>(value: T | undefined, fallback: T | undefined): T | undefined => value ?? fallback;

export const mapDefinitionSummary = (raw: Record<string, unknown>): DefinitionSummary => {
  const contract = pick(raw.Contract, raw.contract) as DefinitionContract | undefined;
  const rawTables = (pick(raw.Tables, raw.tables) as Array<Record<string, unknown>> | undefined) ?? [];
  const rawColumns = (pick(raw.Columns, raw.columns) as FileDefinitionColumn[] | undefined) ?? [];
  const tables = rawTables.length > 0
    ? rawTables.map(table => ({
        sheet: String(pick(table.Sheet, table.sheet) ?? ''),
        columns: (pick(table.Columns, table.columns) as FileDefinitionColumn[] | undefined) ?? [],
      }))
    : contract?.tables.map(table => ({
        sheet: table.sheet,
        columns: table.columns.map(column => ({
          name: column.name,
          type: column.type,
          required: column.mustExist && !column.nullable,
        })),
      })) ?? [{ sheet: null, columns: rawColumns }];
  const rules = contract?.rules ?? [];
  const activeVersion = pick(raw.ActiveVersion, raw.activeVersion) as DefinitionSummary['activeVersion'] | undefined;

  return {
    id: String(pick(raw.Id, raw.id) ?? ''),
    name: String(pick(raw.Name, raw.name) ?? ''),
    description: String(pick(raw.Description, raw.description) ?? ''),
    columns: tables.flatMap(table => table.columns),
    tables,
    contract: contract ?? null,
    status: String(pick(raw.Status, raw.status) ?? ''),
    createdAt: String(pick(raw.CreatedAt, raw.createdAt) ?? ''),
    updatedAt: String(pick(raw.UpdatedAt, raw.updatedAt) ?? ''),
    hasTemplate: Boolean(pick(raw.TemplateFilename, raw.templateFilename)),
    activeVersion: activeVersion ?? null,
    hasUnpublishedChanges: Boolean(pick(raw.HasUnpublishedChanges, raw.hasUnpublishedChanges)),
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
export const downloadTemplate = async (definitionId: string): Promise<void> => {
  const token = localStorage.getItem('token');
  const url = `${apiConfig.getBaseUrl()}/definitions/${encodeURIComponent(definitionId)}/template`;
  
  try {
    const response = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to download template');
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    const filename = contentDisposition 
      ? contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)?.[1]?.replace(/['"]/g, '') || 'template.xlsx'
      : `${definitionId}-template.xlsx`;

    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Download failed');
  }
};

// Get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('token');
};

// Common fetch options
const getFetchOptions = (method: string): RequestInit => {
  const token = getAuthToken();
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
};

const getBaseUrl = () => apiConfig.getBaseUrl();

/**
 * Get file definitions accessible to current user
 * User sees only definitions they have access to
 */
export const getFileDefinitions = async (): Promise<GetFileDefinitionsResponse> => {
  const response = await fetch(`${getBaseUrl()}/definitions`, getFetchOptions('GET'));
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch file definitions');
  }
  
  const definitions = Array.isArray(data.definitions)
    ? data.definitions.map((definition: Record<string, unknown>) => mapDefinitionSummary(definition))
    : [];

  return { definitions, total: data.total ?? definitions.length };
};

export default {
  getFileDefinitions,
};

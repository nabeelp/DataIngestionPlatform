/**
 * Definition API Service - User-accessible file definitions
 * For regular users in upload flow (not admin-only)
 */

import { apiConfig } from '../config/api';

// Reuse types from adminApi (same structure)
export interface FileDefinitionColumn {
  name: string;
  type: string;
  required: boolean;
}

export interface FileDefinitionUser {
  id: string;
  name: string;
  description: string;
  columns: FileDefinitionColumn[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetFileDefinitionsResponse {
  definitions: FileDefinitionUser[];
  total: number;
}

/**
 * Download template file for file definition
 */
export const downloadTemplate = async (definitionId: string): Promise<void> => {
  const token = localStorage.getItem('token');
  const url = `${apiConfig.getBaseUrl()}/file-definitions/${definitionId}/template-download`;
  
  try {
    const response = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
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
    console.error('Download failed:', error);
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
  
  return data;
};

export default {
  getFileDefinitions,
};


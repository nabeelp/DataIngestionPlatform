// File definition user access management (admin)
import { getBaseUrl, getFetchOptions } from './shared';

export interface IFileDefinitionUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Get users assigned to a file definition
 */
export const getFileDefinitionUsers = async (definitionId: string): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${definitionId}/users`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch users for file definition');
  }
  return data;
};

/**
 * Add users to file definition
 */
export const addUsersToFileDefinition = async (
  definitionId: string,
  userIds: string[]
): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${definitionId}/users`,
    getFetchOptions('POST', { userIds })
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to add users to file definition');
  }
  return data;
};

/**
 * Remove user from file definition
 */
export const removeUserFromFileDefinition = async (
  definitionId: string,
  userId: string
): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/${definitionId}/users/${userId}`,
    getFetchOptions('DELETE')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to remove user from file definition');
  }
  return data;
};

/**
 * Get all available users for assignment dropdown
 */
export const getAvailableUsers = async (): Promise<{ users: IFileDefinitionUser[] }> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/users/all`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch available users');
  }
  return data;
};

/**
 * Get user counts for all file definitions
 */
export const getFileDefinitionUserCounts = async (): Promise<Record<string, number>> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/file-definitions/users/counts`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch user counts');
  }
  return data.counts;
};

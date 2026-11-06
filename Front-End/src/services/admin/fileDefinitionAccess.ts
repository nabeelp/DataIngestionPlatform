// File definition user access management (admin)
import { apiRequest } from '../http';

export interface IFileDefinitionUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

const accessPath = (definitionId: string) => `/admin/file-definitions/${encodeURIComponent(definitionId)}/users`;

/**
 * Get users assigned to a file definition
 */
export const getFileDefinitionUsers = (definitionId: string): Promise<{ users: IFileDefinitionUser[] }> =>
  apiRequest(accessPath(definitionId), { fallbackMessage: 'Failed to fetch users for file definition' });

/**
 * Add users to file definition
 */
export const addUsersToFileDefinition = (
  definitionId: string,
  userIds: string[]
): Promise<{ users: IFileDefinitionUser[] }> =>
  apiRequest(accessPath(definitionId), {
    method: 'POST',
    body: { userIds },
    fallbackMessage: 'Failed to add users to file definition',
  });

/**
 * Remove user from file definition
 */
export const removeUserFromFileDefinition = (
  definitionId: string,
  userId: string
): Promise<{ users: IFileDefinitionUser[] }> =>
  apiRequest(`${accessPath(definitionId)}/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    fallbackMessage: 'Failed to remove user from file definition',
  });

/**
 * Get all available users for assignment dropdown
 */
export const getAvailableUsers = (): Promise<{ users: IFileDefinitionUser[] }> =>
  apiRequest('/admin/file-definitions/users/all', { fallbackMessage: 'Failed to fetch available users' });

/**
 * Get user counts for all file definitions
 */
export const getFileDefinitionUserCounts = async (): Promise<Record<string, number>> =>
  (await apiRequest<{ counts: Record<string, number> }>('/admin/file-definitions/users/counts', {
    fallbackMessage: 'Failed to fetch user counts',
  })).counts;

export interface DefinitionAccessLists {
  assignedUsers: IFileDefinitionUser[];
  /** Users that can still be assigned (everyone not already assigned). */
  availableUsers: IFileDefinitionUser[];
}

/** The assigned users of a definition and the users that can still be added to it. */
export const getDefinitionAccessLists = async (definitionId: string): Promise<DefinitionAccessLists> => {
  const assigned = await getFileDefinitionUsers(definitionId);
  const available = await getAvailableUsers();
  const assignedIds = new Set(assigned.users.map(user => user.id));
  return {
    assignedUsers: assigned.users,
    availableUsers: (available.users || []).filter(user => !assignedIds.has(user.id)),
  };
};

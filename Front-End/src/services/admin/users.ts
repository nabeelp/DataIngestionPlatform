// User management
import { apiRequest } from '../http';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
}

export interface UserListParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface UserList {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export const getUsers = (params?: UserListParams): Promise<UserList> =>
  apiRequest<UserList>('/admin/users', { query: { ...params }, fallbackMessage: 'Failed to fetch users' });

export const createUser = async (userData: {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}): Promise<AdminUser> => {
  const data = await apiRequest<{ user: AdminUser }>('/admin/users', {
    method: 'POST',
    body: userData,
    fallbackMessage: 'Failed to create user',
  });
  return data.user;
};

export const updateUser = async (id: string, updates: {
  firstName?: string;
  lastName?: string;
  role?: string;
  isActive?: boolean;
}): Promise<AdminUser> => {
  const data = await apiRequest<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: updates,
    fallbackMessage: 'Failed to update user',
  });
  return data.user;
};

export const unlockUser = async (id: string): Promise<void> => {
  await apiRequest(`/admin/users/${encodeURIComponent(id)}/unlock`, {
    method: 'POST',
    fallbackMessage: 'Failed to unlock user',
  });
};

export const deleteUser = async (id: string): Promise<void> => {
  await apiRequest(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    fallbackMessage: 'Failed to delete user',
  });
};

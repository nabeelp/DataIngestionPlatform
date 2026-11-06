// User management
import { getBaseUrl, getFetchOptions } from './shared';

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

export const getUsers = async (params?: { page?: number; limit?: number; search?: string }): Promise<{
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}> => {
  const queryParams = new URLSearchParams();
  if (params?.page) queryParams.append('page', params.page.toString());
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.search) queryParams.append('search', params.search);

  const response = await fetch(
    `${getBaseUrl()}/admin/users?${queryParams}`,
    getFetchOptions('GET')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch users');
  }
  return data;
};

export const createUser = async (userData: {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}): Promise<AdminUser> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users`,
    getFetchOptions('POST', userData)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to create user');
  }
  return data.user;
};

export const updateUser = async (id: string, updates: {
  firstName?: string;
  lastName?: string;
  role?: string;
  isActive?: boolean;
}): Promise<AdminUser> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${id}`,
    getFetchOptions('PUT', updates)
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to update user');
  }
  return data.user;
};

export const unlockUser = async (id: string): Promise<void> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${id}/unlock`,
    getFetchOptions('POST')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to unlock user');
  }
};

export const deleteUser = async (id: string): Promise<void> => {
  const response = await fetch(
    `${getBaseUrl()}/admin/users/${id}`,
    getFetchOptions('DELETE')
  );
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to delete user');
  }
};

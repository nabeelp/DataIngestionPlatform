// =============================================================================
// User Service - Business logic for user management
// =============================================================================

import { User } from '../models/User.model';
import { logger } from '../utils/logger';

export interface AdminUserList {
  Id: string;
  Email: string;
  Username: string;
  FirstName: string | null;
  LastName: string | null;
  Role: string;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string;
  LastLoginAt: string | null;
  FailedLoginAttempts: number;
  LockedUntil: string | null;
}

export interface GetUsersResult {
  users: any[];
  total: number;
  page: number;
  limit: number;
}

/**
 * User Service - Handles all user-related business logic
 */
export class UserService {
  /**
   * Get all users (paginated with optional search)
   * Matches exact controller needs
   */
static async getUsers(page: number = 1, limit: number = 20, search: string = ''): Promise<GetUsersResult> {
    try {
      logger.debug('[USER_SERVICE] Fetching users - page:', page, 'limit:', limit, 'search:', search);
      const result = await User.findAll(page, limit, search);
      logger.debug('[USER_SERVICE] Raw model result - users count:', result.users?.length || 0, 'total:', result.total);

      // Transform to frontend expected camelCase AdminUser format
      const users = (result.users || []).map((user: any) => ({
        id: user.Id,
        email: user.Email,
        username: user.Username || '',
        firstName: user.FirstName || null,
        lastName: user.LastName || null,
        role: user.Role,
        isActive: Boolean(user.IsActive),
        createdAt: user.CreatedAt,
        updatedAt: user.UpdatedAt,
        lastLoginAt: user.LastLoginAt || null,
        failedLoginAttempts: user.FailedLoginAttempts || 0,
        lockedUntil: user.LockedUntil || null
      }));

      const response: GetUsersResult = {
        users,
        total: result.total || 0,
        page,
        limit
      };
      
      logger.debug('[USER_SERVICE] Returning transformed users:', response.users.length);
      return response;
    } catch (error) {
      logger.error('[USER_SERVICE] Error getting users:', error);
      throw error;
    }
  }
}


// =============================================================================
// Admin Controller - User management
// =============================================================================

import { hashPassword } from '../../utils/password';
import { User } from '../../models/User.model';
import { UserService, type GetUsersResult } from '../../services/User.service';
import { logAction } from '../../models/AuditLog.model';
import { AUDIT_ACTIONS, ENTITY_TYPES } from '../../interfaces/auditLog.interface';
import type { IUser } from '../../interfaces/user.interface';
import { asyncHandler } from '../../middleware/asyncHandler';
import { BadRequestError, NotFoundError } from '../../utils/httpError';

/**
 * Get all users (paginated)
 */
export const getUsers = asyncHandler(async (req, res) => {
    const page = parseInt((req.query.page as string ?? '1')) || 1;
    const limit = parseInt((req.query.limit as string ?? '20')) || 20;
    const search = (req.query.search as string ?? '') || '';

    const result: GetUsersResult = await UserService.getUsers(page, limit, search);

    // Log this action
    await logAction(
        req.user?.userId || null,
        'ADMIN_USER_LIST_VIEWED',
        ENTITY_TYPES.USER,
        undefined,
        { page, limit, search },
        req.ip || undefined,
        req.headers['user-agent']
    );

    res.json({
        success: true,
        users: result.users,
        total: result.total,
        page: result.page,
        limit: result.limit
    });
});

/**
 * Create new user
 */
export const createUser = asyncHandler(async (req, res) => {
    const { email, username, password, firstName, lastName, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
        throw new BadRequestError('User with this email already exists');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await User.create({
        Email: email,
        Username: username,
        Password: passwordHash,
        FirstName: firstName,
        LastName: lastName,
        Role: role || 'user'
    });

    // Log this action
    await logAction(
        req.user?.userId || null,
        AUDIT_ACTIONS.USER_CREATED,
        ENTITY_TYPES.USER,
        user.Id,
        { email, username, role: role || 'user' },
        req.ip || undefined,
        req.headers['user-agent']
    );

    res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: {
            id: user.Id,
            email: user.Email,
            username: user.Username,
            firstName: user.FirstName,
            lastName: user.LastName,
            role: user.Role
        }
    });
});

/**
 * Update user
 */
export const updateUser = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, role, isActive } = req.body;

    const existingUser = await User.findById(id);

    if (!existingUser) {
        throw new NotFoundError('User not found');
    }

    const updates: Partial<IUser> = {};
    if (firstName !== undefined) updates.FirstName = firstName;
    if (lastName !== undefined) updates.LastName = lastName;
    if (role !== undefined) updates.Role = role;
    if (isActive !== undefined) updates.IsActive = isActive;

    const updatedUser = await User.update(id, updates);

    // Log this action
    await logAction(
        req.user?.userId || null,
        AUDIT_ACTIONS.USER_UPDATED,
        ENTITY_TYPES.USER,
        id,
        { updates },
        req.ip || undefined,
        req.headers['user-agent']
    );

    res.json({
        success: true,
        message: 'User updated successfully',
        user: {
            id: updatedUser?.Id,
            email: updatedUser?.Email,
            username: updatedUser?.Username,
            firstName: updatedUser?.FirstName,
            lastName: updatedUser?.LastName,
            role: updatedUser?.Role,
            isActive: updatedUser?.IsActive
        }
    });
});

/**
 * Unlock user account
 */
export const unlockUser = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;

    const existingUser = await User.findById(id);

    if (!existingUser) {
        throw new NotFoundError('User not found');
    }

    await User.unlock(id);

    // Log this action
    await logAction(
        req.user?.userId || null,
        AUDIT_ACTIONS.USER_UNLOCKED,
        ENTITY_TYPES.USER,
        id,
        {},
        req.ip || undefined,
        req.headers['user-agent']
    );

    res.json({
        success: true,
        message: 'User unlocked successfully'
    });
});

/**
 * Delete (soft delete) user
 */
export const deleteUser = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.user?.userId) {
        throw new BadRequestError('You cannot delete your own account');
    }

    const existingUser = await User.findById(id);

    if (!existingUser) {
        throw new NotFoundError('User not found');
    }

    await User.softDelete(id);

    // Log this action
    await logAction(
        req.user?.userId || null,
        AUDIT_ACTIONS.USER_DELETED,
        ENTITY_TYPES.USER,
        id,
        {},
        req.ip || undefined,
        req.headers['user-agent']
    );

    res.json({
        success: true,
        message: 'User deleted successfully'
    });
});

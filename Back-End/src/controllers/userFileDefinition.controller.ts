// =============================================================================
// User FileDefinition Controller - Admin endpoints for user-definition assignments
// Symmetric to definition.controller.ts user endpoints
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { FileDefinitionService } from '../services/FileDefinition.service';
import type { IFileDefinition } from '../interfaces/fileDefinition.interface';
import { IJwtPayload } from '../interfaces/user.interface';

// Extend Request to include user
export interface AuthRequest extends Request {
    user?: IJwtPayload;
}

/**
 * Get all file definitions assigned to specific user (admin only)
 * GET /api/admin/users/:userId/file-definitions
 */
export const getUserFileDefinitions = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { userId } = req.params;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        const definitions = await FileDefinitionService.getFileDefinitionsForUser(userId);

        res.json({
            success: true,
            definitions,
            total: definitions.length
        });
    } catch (error) {
        console.error('[USER_FILEDEF_CTRL] Error getting user definitions:', error);
        next(error);
    }
};

/**
 * Assign file definitions to user (admin only)
 * POST /api/admin/users/:userId/file-definitions
 * Body: { fileDefinitionIds: string[] }
 */
export const assignFileDefinitionsToUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { userId } = req.params;
        const { fileDefinitionIds } = req.body;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        if (!Array.isArray(fileDefinitionIds) || fileDefinitionIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'fileDefinitionIds array is required and cannot be empty'
            });
        }

        const definitions = await FileDefinitionService.assignFileDefinitionsToUser(
            userId, 
            fileDefinitionIds, 
            adminUserId
        );

        res.json({
            success: true,
            definitions,
            message: `Assigned ${fileDefinitionIds.length} file definitions to user`
        });
    } catch (error) {
        console.error('[USER_FILEDEF_CTRL] Error assigning definitions:', error);
        next(error);
    }
};

/**
 * Remove file definition from user (admin only)
 * DELETE /api/admin/users/:userId/file-definitions/:definitionId
 */
export const removeFileDefinitionFromUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { userId, definitionId } = req.params;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        const remainingDefinitions = await FileDefinitionService.removeFileDefinitionFromUser(
            userId, 
            definitionId
        );

        res.json({
            success: true,
            definitions: remainingDefinitions,
            message: 'File definition access removed from user'
        });
    } catch (error) {
        console.error('[USER_FILEDEF_CTRL] Error removing definition:', error);
        next(error);
    }
};


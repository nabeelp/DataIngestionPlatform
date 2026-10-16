// =============================================================================
// Definition Controller - Business logic for File Definitions
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { FileDefinition } from '../models/FileDefinition.model';
import { FileDefinitionService } from '../services/FileDefinition.service';
import { DefinitionVersionService } from '../services/DefinitionVersion.service';
import { TemplateStorage, getTemplateContentType, getTemplateDisplayName } from '../services/TemplateStorage.service';
import { logger } from '../utils/logger';
import type { 
    ICreateFileDefinitionDto, 
    IUpdateFileDefinitionDto
} from '../interfaces/fileDefinition.interface';
import { IJwtPayload } from '../interfaces/user.interface';

// Extend Request to include user
export interface AuthRequest extends Request {
    user?: IJwtPayload;
}

/**
 * Get all definitions for the current user
 * Users see only their accessible definitions, admins see all
 */
export const getDefinitions = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        const userRole = req.user?.role;
        
        logger.debug('[DEFINITION_CONTROLLER] getDefinitions called:', { userId, userRole });
        
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        const definitions = await DefinitionVersionService.withPublishedColumns(await FileDefinition.findForUser(userId));
        
        logger.debug('[DEFINITION_CONTROLLER] Found definitions:', definitions.length);

        res.json({
            success: true,
            definitions,
            total: definitions.length
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error getting definitions:', error);
        next(error);
    }
};

/**
 * Get a single definition by ID
 */
export const getDefinitionById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Check if user has access to this definition
        const hasAccess = await FileDefinition.hasAccess(id, userId);
        
        if (!hasAccess) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this definition' 
            });
        }

        const found = await FileDefinition.findById(id);
        const [definition] = found ? await DefinitionVersionService.withPublishedColumns([found]) : [null];

        if (!definition) {
            return res.status(404).json({ 
                success: false, 
                message: 'Definition not found' 
            });
        }

        res.json({
            success: true,
            definition
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error getting definition:', error);
        next(error);
    }
};

/**
 * Create a new definition (Admin only)
 */
export const createDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        const userRole = req.user?.role;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Only admins can create definitions
        if (userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only admins can create file definitions' 
            });
        }

        const { Name, Description, Columns, Status, AllowedUserIds } = req.body;

        // Validate required fields
        if (!Name || !Columns || !Array.isArray(Columns)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name and Columns are required' 
            });
        }

        const dto: ICreateFileDefinitionDto = {
            Name,
            Description: Description || '',
            Columns,
            Status: Status || 'Active',
            AllowedUserIds
        };

        const definition = await FileDefinitionService.createDefinition(dto, userId);

        res.status(201).json({
            success: true,
            definition,
            message: 'Definition created successfully'
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error creating definition:', error);
        next(error);
    }
};

/**
 * Update a definition (Admin only)
 */
export const updateDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const userId = req.user?.userId;
        const userRole = req.user?.role;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Only admins can update definitions
        if (userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only admins can update file definitions' 
            });
        }

        const { Name, Description, Columns, Status } = req.body;

        const updates: IUpdateFileDefinitionDto = {};
        
        if (Name !== undefined) updates.Name = Name;
        if (Description !== undefined) updates.Description = Description;
        if (Columns !== undefined) updates.Columns = Columns;
        if (Status !== undefined) updates.Status = Status;

        const definition = await FileDefinition.update(id, updates);

        if (!definition) {
            return res.status(404).json({ 
                success: false, 
                message: 'Definition not found' 
            });
        }

        res.json({
            success: true,
            definition,
            message: 'Definition updated successfully'
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error updating definition:', error);
        next(error);
    }
};

/**
 * Delete a definition (Admin only)
 */
export const deleteDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const userId = req.user?.userId;
        const userRole = req.user?.role;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Only admins can delete definitions
        if (userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only admins can delete file definitions' 
            });
        }

        const existing = await FileDefinition.findById(id);
        
        if (!existing) {
            return res.status(404).json({ 
                success: false, 
                message: 'Definition not found' 
            });
        }

        await FileDefinition.delete(id);

        res.json({
            success: true,
            message: 'Definition deleted successfully'
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error deleting definition:', error);
        next(error);
    }
};

/**
 * Add users to a definition (Admin only)
 */
export const addUsersToDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const userId = req.user?.userId;
        const userRole = req.user?.role;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Only admins can manage user access
        if (userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only admins can manage definition access' 
            });
        }

        const { UserIds } = req.body;

        if (!UserIds || !Array.isArray(UserIds) || UserIds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'UserIds array is required' 
            });
        }

        // Check if definition exists
        const existing = await FileDefinition.findById(id);
        
        if (!existing) {
            return res.status(404).json({ 
                success: false, 
                message: 'Definition not found' 
            });
        }

        // Add each user
        for (const targetUserId of UserIds) {
            await FileDefinition.addUserAccess(id, targetUserId);
        }

        // Get updated allowed users
        const allowedUsers = await FileDefinition.getAllowedUsers(id);

        res.json({
            success: true,
            allowedUsers,
            message: 'Users added successfully'
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error adding users to definition:', error);
        next(error);
    }
};

/**
 * Remove a user from a definition (Admin only)
 */
export const removeUserFromDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id as string;
        const targetUserId = req.params.userId as string;
        const userId = req.user?.userId;
        const userRole = req.user?.role;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Only admins can manage user access
        if (userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only admins can manage definition access' 
            });
        }

        await FileDefinition.removeUserAccess(id, targetUserId);

        // Get updated allowed users
        const allowedUsers = await FileDefinition.getAllowedUsers(id);

        res.json({
            success: true,
            allowedUsers,
            message: 'User removed successfully'
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error removing user from definition:', error);
        next(error);
    }
};

/**
 * Get all available users (for admin to select)
 */
export const getAllUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        const userRole = req.user?.role;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Only admins can see all users
        if (userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Only admins can view all users' 
            });
        }

        const users = await FileDefinition.getAllUsers();

        res.json({
            success: true,
            users
        });
    } catch (error) {
        logger.error('[DEFINITION_CONTROLLER] Error getting users:', error);
        next(error);
    }
};

/**
 * Download template file
 * Users must have access to the definition
 */
export const downloadTemplate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const definitionId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        // Check access
        const hasAccess = await FileDefinition.hasAccess(definitionId, userId);
        if (!hasAccess) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this template' 
            });
        }

        const blobName = await FileDefinitionService.getTemplateBlobName(definitionId);
        if (!blobName) {
            return res.status(404).json({ 
                success: false, 
                message: 'No template available for this definition' 
            });
        }

        let template;
        try {
            template = await TemplateStorage.openReadStream(blobName);
        } catch (error) {
            logger.warn(`[DEFINITION_CTRL] Template ${blobName} could not be opened`, error);
            return res.status(404).json({
                success: false,
                message: 'Template file is missing'
            });
        }

        const downloadName = getTemplateDisplayName(blobName);
        res.attachment(downloadName);
        res.type(getTemplateContentType(downloadName));
        if (template.size !== undefined) {
            res.setHeader('Content-Length', String(template.size));
        }
        template.stream.on('error', (error) => {
            if (!res.headersSent) next(error);
            else res.destroy(error);
        });
        template.stream.pipe(res);
    } catch (error) {
        logger.error('[DEFINITION_CTRL] Error downloading template:', error);
        next(error);
    }
};


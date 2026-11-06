// =============================================================================
// Definition Controller - Business logic for File Definitions
// =============================================================================

import { asyncHandler } from '../middleware/asyncHandler';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from '../utils/httpError';
import { FileDefinition } from '../models/FileDefinition.model';
import { FileDefinitionService } from '../services/FileDefinition.service';
import { DefinitionVersionService } from '../services/DefinitionVersion.service';
import { TemplateStorage, getTemplateContentType, getTemplateDisplayName } from '../services/TemplateStorage.service';
import { logger } from '../utils/logger';

const unauthorized = () => new HttpError('Unauthorized', 401);

/**
 * Get all definitions for the current user
 * Users see only their accessible definitions, admins see all
 */
export const getDefinitions = asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    logger.debug('[DEFINITION_CONTROLLER] getDefinitions called:', { userId, userRole });

    if (!userId) {
        throw unauthorized();
    }

    const definitions = await DefinitionVersionService.withPublishedContract(await FileDefinition.findForUser(userId));

    logger.debug('[DEFINITION_CONTROLLER] Found definitions:', definitions.length);

    res.json({
        success: true,
        definitions,
        total: definitions.length
    });
});

/**
 * Get a single definition by ID
 */
export const getDefinitionById = asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const userId = req.user?.userId;

    if (!userId) {
        throw unauthorized();
    }

    // Check if user has access to this definition
    const hasAccess = await FileDefinition.hasAccess(id, userId);

    if (!hasAccess) {
        throw new ForbiddenError('Access denied to this definition');
    }

    const found = await FileDefinition.findById(id);
    const [definition] = found ? await DefinitionVersionService.withPublishedContract([found]) : [null];

    if (!definition) {
        throw new NotFoundError('Definition not found');
    }

    res.json({
        success: true,
        definition
    });
});

/**
 * Delete a definition (Admin only)
 */
export const deleteDefinition = asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId) {
        throw unauthorized();
    }

    // Only admins can delete definitions
    if (userRole !== 'admin') {
        throw new ForbiddenError('Only admins can delete file definitions');
    }

    const existing = await FileDefinition.findById(id);

    if (!existing) {
        throw new NotFoundError('Definition not found');
    }

    await FileDefinition.delete(id);

    res.json({
        success: true,
        message: 'Definition deleted successfully'
    });
});

/**
 * Add users to a definition (Admin only)
 */
export const addUsersToDefinition = asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId) {
        throw unauthorized();
    }

    // Only admins can manage user access
    if (userRole !== 'admin') {
        throw new ForbiddenError('Only admins can manage definition access');
    }

    const { UserIds } = req.body;

    if (!UserIds || !Array.isArray(UserIds) || UserIds.length === 0) {
        throw new BadRequestError('UserIds array is required');
    }

    // Check if definition exists
    const existing = await FileDefinition.findById(id);

    if (!existing) {
        throw new NotFoundError('Definition not found');
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
});

/**
 * Remove a user from a definition (Admin only)
 */
export const removeUserFromDefinition = asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId) {
        throw unauthorized();
    }

    // Only admins can manage user access
    if (userRole !== 'admin') {
        throw new ForbiddenError('Only admins can manage definition access');
    }

    await FileDefinition.removeUserAccess(id, targetUserId);

    // Get updated allowed users
    const allowedUsers = await FileDefinition.getAllowedUsers(id);

    res.json({
        success: true,
        allowedUsers,
        message: 'User removed successfully'
    });
});

/**
 * Get all available users (for admin to select)
 */
export const getAllUsers = asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId) {
        throw unauthorized();
    }

    // Only admins can see all users
    if (userRole !== 'admin') {
        throw new ForbiddenError('Only admins can view all users');
    }

    const users = await FileDefinition.getAllUsers();

    res.json({
        success: true,
        users
    });
});

/**
 * Download template file
 * Users must have access to the definition
 */
export const downloadTemplate = asyncHandler(async (req, res, next) => {
    const definitionId = req.params.id as string;
    const userId = req.user?.userId;

    if (!userId) {
        throw unauthorized();
    }

    // Check access
    const hasAccess = await FileDefinition.hasAccess(definitionId, userId);
    if (!hasAccess) {
        throw new ForbiddenError('Access denied to this template');
    }

    const blobName = await FileDefinitionService.getTemplateBlobName(definitionId);
    if (!blobName) {
        throw new NotFoundError('No template available for this definition');
    }

    let template;
    try {
        template = await TemplateStorage.openReadStream(blobName);
    } catch {
        logger.warn('[DEFINITION_CTRL] Template could not be opened');
        throw new NotFoundError('Template file is missing');
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
});


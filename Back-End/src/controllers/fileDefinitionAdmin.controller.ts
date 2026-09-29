// =============================================================================
// FileDefinition Admin Controller - FileDefinition user assignment endpoints
// Symmetric to userFileDefinition.controller.ts
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { FileDefinitionService } from '../services/FileDefinition.service';
import { DefinitionVersionError, DefinitionVersionService } from '../services/DefinitionVersion.service';
import { ExampleFileError, analyzeExampleFile, type ExampleAnalysis } from '../services/validation/ExampleFileAnalyzer';
import { TemplateStorage, getTemplateDisplayName } from '../services/TemplateStorage.service';
import { logAction } from '../models/AuditLog.model';
import { AUDIT_ACTIONS, ENTITY_TYPES } from '../interfaces/auditLog.interface';
import { logger } from '../utils/logger';
import type { IFileDefinitionUser, IFileDefinitionVersion } from '../interfaces/fileDefinition.interface';
import { IJwtPayload } from '../interfaces/user.interface';

// Extend Request to include user
export interface AuthRequest extends Request<Record<string, string>> {
    user?: IJwtPayload;
}

/**
 * Get users assigned to specific file definition (admin only)
 * GET /api/admin/file-definitions/:definitionId/users
 */
export const getFileDefinitionUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const definitionId: string = req.params.definitionId as string;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        const users = await FileDefinitionService.getAllowedUsers(definitionId);

        res.json({
            success: true,
            users,
            total: users.length
        });
    } catch (error) {
        logger.error('[FILEDEF_ADMIN_CTRL] Error getting definition users:', error);
        next(error);
    }
};

/**
 * Assign users to file definition (admin only)
 * POST /api/admin/file-definitions/:definitionId/users
 * Body: { userIds: string[] }
 */
export const addUsersToFileDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { definitionId } = req.params;
        const { userIds } = req.body;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'userIds array is required and cannot be empty'
            });
        }

        const updatedUsers = await FileDefinitionService.addUsersToDefinition(
            definitionId, 
            userIds, 
            adminUserId
        );

        res.json({
            success: true,
            users: updatedUsers,
            message: `Assigned ${userIds.length} users to file definition`
        });
    } catch (error) {
        logger.error('[FILEDEF_ADMIN_CTRL] Error adding users:', error);
        next(error);
    }
};

/**
 * Remove user from file definition (admin only)
 * DELETE /api/admin/file-definitions/:definitionId/users/:userId
 */
export const removeUserFromFileDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { definitionId, userId } = req.params;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        const remainingUsers = await FileDefinitionService.removeUserFromDefinition(
            definitionId, 
            userId
        );

        res.json({
            success: true,
            users: remainingUsers,
            message: 'User removed from file definition'
        });
    } catch (error) {
        logger.error('[FILEDEF_ADMIN_CTRL] Error removing user:', error);
        next(error);
    }
};

/**
 * Get all available users for assignment (admin)
 * GET /api/admin/file-definitions/users/all
 */
export const getAllAvailableUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const users = await FileDefinitionService.getAllAvailableUsers();

        res.json({
            success: true,
            users
        });
    } catch (error) {
        logger.error('[FILEDEF_ADMIN_CTRL] Error getting available users:', error);
        next(error);
    }
};

/**
 * Upload custom template file (admin only)
 * POST /api/admin/file-definitions/:id/template-upload
 * multipart/form-data file
 */
export const uploadTemplate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const definitionId = req.params.id as string;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'No file uploaded' 
            });
        }

        const previousTemplate = await FileDefinitionService.getTemplateBlobName(definitionId);
        const templateFilename = await TemplateStorage.save(req.file.buffer, req.file.originalname);
        try {
            await FileDefinitionService.setTemplateFilename(definitionId, templateFilename);
        } catch (error) {
            await TemplateStorage.delete(templateFilename).catch(() => undefined);
            throw error;
        }

        if (previousTemplate && previousTemplate !== templateFilename) {
            await TemplateStorage.delete(previousTemplate).catch(err =>
                logger.warn(`[FILEDEF_ADMIN_CTRL] Could not delete previous template ${previousTemplate}`, err)
            );
        }

        res.json({
            success: true,
            templateFilename: getTemplateDisplayName(templateFilename),
            message: 'Template uploaded successfully'
        });
    } catch (error) {
        logger.error('[FILEDEF_ADMIN_CTRL] Error uploading template:', error);
        next(error);
    }
};



/**
 * Export file definition for download (admin only)
 * GET /api/admin/file-definitions/:id/export
 */
export const exportFileDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const definitionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        const exportData = await FileDefinitionService.exportDefinition(definitionId);

        // Set download headers
        const filename = `${exportData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-definition.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/json');

        res.json(exportData);
    } catch (error) {
        logger.error('[FILEDEF_ADMIN_CTRL] Error exporting definition:', error);
        next(error);
    }
};

/**
 * Get user counts for all file definitions (admin dashboard)
 * GET /api/admin/file-definitions/users/counts
 */
export const getFileDefinitionUserCounts = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const adminUserId = req.user?.userId;

        if (!adminUserId || req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }

        const counts = await FileDefinitionService.getAllDefinitionUserCounts();

        res.json({
            success: true,
            counts
        });
    } catch (error) {
        logger.error('[FILEDEF_ADMIN_CTRL] Error getting user counts:', error);
        next(error);
    }
};

const mapVersion = (version: IFileDefinitionVersion) => ({
    id: version.Id,
    versionNumber: version.VersionNumber,
    status: version.Status,
    columns: version.Columns,
    tables: version.Tables,
    rules: version.Rules.map(rule => ({
        id: rule.Id,
        name: rule.Name,
        description: rule.Description,
        ruleType: rule.RuleType,
        severity: rule.Severity,
        executionOrder: rule.ExecutionOrder,
        expression: rule.SqlQuery,
        table: rule.Table,
        naturalLanguageText: rule.NaturalLanguageText ?? null,
    })),
    changeNote: version.ChangeNote,
    createdByName: version.CreatedByName,
    activatedAt: version.ActivatedAt,
    supersededAt: version.SupersededAt,
});

const handleVersionError = (error: unknown, res: Response): boolean => {
    if (error instanceof DefinitionVersionError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return true;
    }
    return false;
};

/**
 * Version history and unpublished changes (admin only)
 * GET /api/admin/file-definitions/:id/versions
 */
export const getFileDefinitionVersions = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const definitionId = req.params.id as string;
        const [state, versions] = await Promise.all([
            DefinitionVersionService.getDraftState(definitionId),
            DefinitionVersionService.listVersions(definitionId),
        ]);

        res.json({
            success: true,
            activeVersionNumber: state.activeVersion?.VersionNumber ?? null,
            hasUnpublishedChanges: state.diff.hasChanges,
            changes: { columns: state.diff.columns, rules: state.diff.rules },
            versions: versions.map(mapVersion),
        });
    } catch (error) {
        if (handleVersionError(error, res)) return;
        logger.error('[FILEDEF_ADMIN_CTRL] Error getting definition versions:', error);
        next(error);
    }
};

/**
 * Publish the draft as a new active version (admin only)
 * POST /api/admin/file-definitions/:id/versions
 */
export const publishFileDefinitionVersion = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const definitionId = req.params.id as string;
        const version = await DefinitionVersionService.publish(definitionId, req.user?.userId ?? null, req.body?.changeNote);

        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.DEFINITION_VERSION_PUBLISHED,
            ENTITY_TYPES.FILE_DEFINITION,
            definitionId,
            { versionNumber: version.VersionNumber, changeNote: version.ChangeNote },
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.status(201).json({
            success: true,
            version: mapVersion(version),
            message: `Version ${version.VersionNumber} is now active`
        });
    } catch (error) {
        if (handleVersionError(error, res)) return;
        logger.error('[FILEDEF_ADMIN_CTRL] Error publishing definition version:', error);
        next(error);
    }
};

/**
 * Analyze an example CSV/XLSX file and propose columns and candidate rules (admin only).
 * The example is deleted after analysis and never stored; nothing is saved until the admin saves the definition.
 * POST /api/admin/file-definitions/analyze-example (multipart/form-data "file")
 */
export const analyzeExample = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ success: false, message: 'No example file uploaded' });
    }

    let analysis: ExampleAnalysis;
    const fileType = path.extname(file.originalname).toLowerCase().slice(1);
    try {
        analysis = await analyzeExampleFile(file.path, fileType);
    } catch (error) {
        if (error instanceof ExampleFileError) {
            return res.status(400).json({ success: false, message: error.message });
        }
        logger.error('[FILEDEF_ADMIN_CTRL] Error analyzing example file:', error);
        return next(error);
    } finally {
        // Delete before responding: the example may contain customer data and is never kept.
        await fs.promises.rm(file.path, { force: true }).catch(err =>
            logger.warn('[FILEDEF_ADMIN_CTRL] Could not delete analyzed example file', err)
        );
    }

    logger.info(`[FILEDEF_ADMIN_CTRL] Example analyzed by ${req.user?.userId}: ${fileType}, ${file.size}B, ${analysis.sheets.length} sheet(s)`);
    res.json({ success: true, fileName: path.basename(file.originalname), ...analysis });
};


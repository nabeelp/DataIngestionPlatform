﻿// =============================================================================
// FileDefinition Service - Business logic wrapper for FileDefinition model
// =============================================================================

import { FileDefinition } from '../models/FileDefinition.model';
import { Rule } from '../models/Rule.model';
import { DefinitionVersionService } from './DefinitionVersion.service';
import { getConnection } from '../config/database';
import type { ICreateRuleDto } from '../interfaces/rule.interface';
import type { 
    IFileDefinition, 
    ICreateFileDefinitionDto, 
    IUpdateFileDefinitionDto,
    IFileDefinitionUser
} from '../interfaces/fileDefinition.interface';
import { logger } from '../utils/logger';

/**
 * FileDefinition Service - Handles all file definition business logic
 */
export class FileDefinitionService {
    /**
     * Get all file definitions (admin only)
     */
    static async getAllDefinitions(): Promise<IFileDefinition[]> {
        try {
            logger.info('[FILEDEF_SVC] Getting all definitions (admin)');
            return await FileDefinition.findAll();
        } catch (error) {
            logger.error('[FILEDEF_SVC] Error getting all definitions:', error);
            throw error;
        }
    }

    /**
     * Create new file definition (admin only). Initial rules (already validated by the caller) are created
     * with it, so version 1 publishes columns and rules together.
     */
    static async createDefinition(
        dto: ICreateFileDefinitionDto,
        createdByUserId: string,
        initialRules: Omit<ICreateRuleDto, 'FileDefinitionId'>[] = []
    ): Promise<IFileDefinition> {
        try {
            logger.info(`[FILEDEF_SVC] Creating definition "${dto.Name}" by user ${createdByUserId}`);

            const definition = await FileDefinition.create(dto, createdByUserId);
            const createdRuleIds: string[] = [];
            try {
                for (const rule of initialRules) {
                    const created = await Rule.create({ ...rule, FileDefinitionId: definition.Id }, createdByUserId);
                    createdRuleIds.push(created.Id);
                }
            } catch (error) {
                // Do not leave a half-created definition behind: it would publish version 1 without the rules.
                for (const ruleId of createdRuleIds) await Rule.delete(ruleId).catch(() => undefined);
                await FileDefinition.delete(definition.Id).catch(() => undefined);
                throw error;
            }
            await DefinitionVersionService.ensureActiveVersion(definition.Id, createdByUserId);
            logger.info(`[FILEDEF_SVC] Created definition ${definition.Id}: ${definition.Name} with ${initialRules.length} rule(s)`);
            return definition;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error creating definition:`, error);
            throw error;
        }
    }

    /**
     * Update file definition (admin only)
     */
    static async updateDefinition(id: string, updates: IUpdateFileDefinitionDto): Promise<IFileDefinition> {
        try {
            logger.info(`[FILEDEF_SVC] Updating definition ${id}`);

            const definition = await FileDefinition.update(id, updates);
            if (!definition) {
                throw new Error('File definition not found');
            }

            logger.info(`[FILEDEF_SVC] Updated definition ${id}: ${definition.Name}`);
            return definition;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error updating definition ${id}:`, error);
            throw error;
        }
    }

    /**
     * Delete file definition (admin only)
     */
    static async deleteDefinition(id: string): Promise<void> {
        try {
            logger.info(`[FILEDEF_SVC] Deleting definition ${id}`);
            await FileDefinition.delete(id);
            logger.info(`[FILEDEF_SVC] Deleted definition ${id}`);
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error deleting definition ${id}:`, error);
            throw error;
        }
    }

    /**
     * Get users assigned to a file definition (admin)
     */
    static async getAllowedUsers(fileDefinitionId: string): Promise<IFileDefinitionUser[]> {
        try {
            logger.info(`[FILEDEF_SVC] Getting allowed users for definition ${fileDefinitionId}`);
            return await FileDefinition.getAllowedUsers(fileDefinitionId);
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error getting allowed users:`, error);
            throw error;
        }
    }

    /**
     * Add users to file definition (admin)
     */
    static async addUsersToDefinition(
        fileDefinitionId: string, 
        userIds: string[]
    ): Promise<IFileDefinitionUser[]> {
        try {
            logger.info(`[FILEDEF_SVC] Adding ${userIds.length} users to definition ${fileDefinitionId}`);

            if (!Array.isArray(userIds) || userIds.length === 0) {
                throw new Error('UserIds must be a non-empty array');
            }

            // Add each user (model handles duplicates)
            for (const userId of userIds) {
                await FileDefinition.addUserAccess(fileDefinitionId, userId);
            }

            const allowedUsers = await FileDefinition.getAllowedUsers(fileDefinitionId);
            logger.info(`[FILEDEF_SVC] Added users to definition ${fileDefinitionId}, now has ${allowedUsers.length} users`);
            return allowedUsers;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error adding users to definition ${fileDefinitionId}:`, error);
            throw error;
        }
    }

    /**
     * Remove user from file definition (admin)
     */
    static async removeUserFromDefinition(
        fileDefinitionId: string, 
        userId: string
    ): Promise<IFileDefinitionUser[]> {
        try {
            logger.info(`[FILEDEF_SVC] Removing user ${userId} from definition ${fileDefinitionId}`);
            await FileDefinition.removeUserAccess(fileDefinitionId, userId);
            const allowedUsers = await FileDefinition.getAllowedUsers(fileDefinitionId);
            logger.info(`[FILEDEF_SVC] Removed user from definition ${fileDefinitionId}, now has ${allowedUsers.length} users`);
            return allowedUsers;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error removing user ${userId} from definition ${fileDefinitionId}:`, error);
            throw error;
        }
    }

    /**
     * Get all available users for assignment (admin)
     */
    static async getAllAvailableUsers(): Promise<IFileDefinitionUser[]> {
        try {
            logger.info('[FILEDEF_SVC] Getting all available users for assignment');
            return await FileDefinition.getAllUsers();
        } catch (error) {
            logger.error('[FILEDEF_SVC] Error getting available users:', error);
            throw error;
        }
    }

    /**
     * Get user count for all file definitions (admin dashboard table)
     */
    static async getAllDefinitionUserCounts(): Promise<Record<string, number>> {
        try {
            logger.info('[FILEDEF_SVC] Getting user counts for all definitions');
            const pool = await getConnection();
            const result = await pool.request()
                .query(`
                    SELECT 
                        ua.FileDefinitionId,
                        COUNT(ua.UserId) as userCount
                    FROM FileDefinitionUserAccess ua
                    GROUP BY ua.FileDefinitionId
                `);

            const counts: Record<string, number> = {};
            result.recordset.forEach((row: any) => {
                counts[row.FileDefinitionId] = row.userCount;
            });

            logger.info(`[FILEDEF_SVC] Retrieved counts for ${Object.keys(counts).length} definitions`);
            return counts;
        } catch (error) {
            logger.error('[FILEDEF_SVC] Error getting definition user counts:', error);
            throw error;
        }
    }

    /**
     * Export file definition as JSON for download
     */
    static async exportDefinition(id: string): Promise<any> {
        try {
            logger.info(`[FILEDEF_SVC] Exporting definition ${id}`);
            
            const definition = await FileDefinition.findById(id);
            if (!definition) {
                throw new Error('File definition not found');
            }

            // The export is the full draft contract: structure, enabled rules and the lookups they use.
            const exportData = {
                id: definition.Id,
                name: definition.Name,
                description: definition.Description || '',
                contract: await DefinitionVersionService.getDraftContract(id),
                status: definition.Status || 'Active',
                templateFilename: definition.TemplateFilename || null,
                createdAt: definition.CreatedAt,
                updatedAt: definition.UpdatedAt
            };


            logger.info(`[FILEDEF_SVC] Exported definition ${id}: ${exportData.name}`);
            return exportData;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error exporting definition ${id}:`, error);
            throw error;
        }
    }

    /**
     * Get template blob name for definition
     */
    static async getTemplateBlobName(definitionId: string): Promise<string | null> {
        const definition = await FileDefinition.findById(definitionId);
        return definition?.TemplateFilename || null;
    }

    /**
     * Update template filename (after upload)
     */
    static async setTemplateFilename(definitionId: string, templateFilename: string): Promise<IFileDefinition> {
        const updates = { TemplateFilename: templateFilename };
        const definition = await FileDefinition.update(definitionId, updates);
        if (!definition) {
            throw new Error('File definition not found');
        }
        logger.info(`[FILEDEF_SVC] Set template ${templateFilename} for definition ${definitionId}`);
        return definition;
    }

    static async clearTemplateFilename(definitionId: string): Promise<IFileDefinition> {
        const definition = await FileDefinition.update(definitionId, { TemplateFilename: null });
        if (!definition) {
            throw new Error('File definition not found');
        }
        logger.info(`[FILEDEF_SVC] Cleared template for definition ${definitionId}`);
        return definition;
    }

}



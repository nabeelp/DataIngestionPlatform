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
    IColumn,
    IFileDefinitionUser,
    IAddUsersToDefinitionDto
} from '../interfaces/fileDefinition.interface';
import type { IUser } from '../interfaces/user.interface';
import { logger } from '../utils/logger';

/**
 * FileDefinition Service - Handles all file definition business logic
 */
export class FileDefinitionService {
    /**
     * Get file definitions for current user (filtered by access)
     */
    /**
     * Get file definitions assigned to a specific user (admin view)
     */
    static async getFileDefinitionsForUser(userId: string): Promise<IFileDefinition[]> {
        try {
            logger.info(`[FILEDEF_SVC] Getting definitions for user (admin): ${userId}`);
            
            // Admin bypass: get all definitions and filter by access
            const allDefinitions = await FileDefinition.findAll();
            const accessibleDefinitions = await Promise.all(
                allDefinitions.map(async (def) => {
                    const hasAccess = await FileDefinition.hasAccess(def.Id, userId);
                    return hasAccess ? def : null;
                })
            );
            
            const definitions = accessibleDefinitions.filter(Boolean) as IFileDefinition[];
            logger.info(`[FILEDEF_SVC] Found ${definitions.length} definitions for user ${userId}`);
            return definitions;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error getting user definitions:`, error);
            throw error;
        }
    }

    /**
     * Assign file definitions to a user (admin)
     */
    static async assignFileDefinitionsToUser(
        userId: string, 
        fileDefinitionIds: string[], 
        assignedByUserId: string
    ): Promise<IFileDefinition[]> {
        try {
            logger.info(`[FILEDEF_SVC] Assigning ${fileDefinitionIds.length} definitions to user ${userId}`);
            
            if (!Array.isArray(fileDefinitionIds) || fileDefinitionIds.length === 0) {
                throw new Error('FileDefinitionIds must be a non-empty array');
            }

            for (const defId of fileDefinitionIds) {
                await FileDefinition.addUserAccess(defId, userId);
            }

            const assignedDefinitions = await this.getFileDefinitionsForUser(userId);
            logger.info(`[FILEDEF_SVC] Assigned definitions to user ${userId}`);
            return assignedDefinitions;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error assigning definitions to user:`, error);
            throw error;
        }
    }

    /**
     * Remove file definition from user (admin)
     */
    static async removeFileDefinitionFromUser(
        userId: string,
        fileDefinitionId: string
    ): Promise<IFileDefinition[]> {
        try {
            logger.info(`[FILEDEF_SVC] Removing definition ${fileDefinitionId} from user ${userId}`);
            await FileDefinition.removeUserAccess(fileDefinitionId, userId);
            const remainingDefinitions = await this.getFileDefinitionsForUser(userId);
            logger.info(`[FILEDEF_SVC] Removed definition from user ${userId}`);
            return remainingDefinitions;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error removing definition from user:`, error);
            throw error;
        }
    }

    static async getDefinitionsForUser(userId: string): Promise<IFileDefinition[]> {
        try {
            logger.info(`[FILEDEF_SVC] Getting definitions for user: ${userId}`);
            const definitions = await FileDefinition.findForUser(userId);
            logger.info(`[FILEDEF_SVC] Found ${definitions.length} definitions for user ${userId}`);
            return definitions;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error getting definitions for user ${userId}:`, error);
            throw error;
        }
    }

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
     * Get single file definition (checks user access)
     */
    static async getDefinitionById(id: string, userId: string): Promise<IFileDefinition> {
        try {
            logger.info(`[FILEDEF_SVC] Getting definition ${id} for user ${userId}`);
            
            // Check access first
            const hasAccess = await FileDefinition.hasAccess(id, userId);
            if (!hasAccess) {
                const error = new Error('Access denied to this file definition');
                logger.warn(`[FILEDEF_SVC] User ${userId} denied access to definition ${id}`);
                throw error;
            }

            const definition = await FileDefinition.findById(id);
            if (!definition) {
                throw new Error('File definition not found');
            }

            return definition;
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error getting definition ${id}:`, error);
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
            
            // Validate columns: a single table needs columns; sheet tables carry their own.
            const hasTables = Array.isArray(dto.Tables) && dto.Tables.length > 0;
            if (!hasTables && (!dto.Columns || !Array.isArray(dto.Columns) || dto.Columns.length === 0)) {
                throw new Error('Columns array is required and must not be empty');
            }

            const definition = await FileDefinition.create(dto, createdByUserId);
            const createdRuleIds: string[] = [];
            try {
                for (const [index, rule] of initialRules.entries()) {
                    const created = await Rule.create({ ...rule, FileDefinitionId: definition.Id, ExecutionOrder: index + 1 }, createdByUserId);
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

            // Validate columns if provided (sheet tables replace single-table columns)
            const hasTables = Array.isArray(updates.Tables) && updates.Tables.length > 0;
            if (updates.Columns && (!Array.isArray(updates.Columns) || (updates.Columns.length === 0 && !hasTables))) {
                throw new Error('Columns must be a non-empty array');
            }

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
        userIds: string[], 
        assignedByUserId: string
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
     * Get definition statistics for user dashboard
     */
    static async getDefinitionStats(userId: string): Promise<{ totalDefinitions: number; activeDefinitions: number }> {
        try {
            logger.info(`[FILEDEF_SVC] Getting stats for user ${userId}`);
            return await FileDefinition.getStatsForUser(userId);
        } catch (error) {
            logger.error(`[FILEDEF_SVC] Error getting stats:`, error);
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

            // Prepare export-safe data (ensure columns is array)
            const exportData = {
                id: definition.Id,
                name: definition.Name,
                description: definition.Description || '',
                columns: Array.isArray(definition.Columns) ? definition.Columns : JSON.parse(definition.Columns || '[]'),
                tables: definition.Tables ?? [],
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

}




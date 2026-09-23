// =============================================================================
// Admin API Service - NOT Frontend, Backend helper service for admin operations
// Wraps FileDefinitionService for controller reuse
// =============================================================================

import { FileDefinitionService } from './FileDefinition.service';
import type { IFileDefinition } from '../interfaces/fileDefinition.interface';

export class AdminFileDefinitionApi {
    /**
     * Get all file definitions (admin only)
     */
    static async getAll(): Promise<IFileDefinition[]> {
        return await FileDefinitionService.getAllDefinitions();
    }

    /**
     * Get file definition by ID (admin)
     */
    static async getById(id: string): Promise<IFileDefinition> {
        // Admin bypasses access check - just return definition
        const pool = await import('../config/database').then(m => m.getConnection());
        const result = await pool.request()
            .input('Id', id)
            .query('SELECT * FROM FileDefinitions WHERE Id = @Id');
        
        if (!result.recordset[0]) {
            throw new Error('File definition not found');
        }

        const definition = result.recordset[0];
        if (definition.Columns && typeof definition.Columns === 'string') {
            definition.Columns = JSON.parse(definition.Columns);
        }

        // Load allowed users for admin view
        definition.AllowedUsers = await FileDefinitionService.getAllowedUsers(id);
        return definition;
    }

    /**
     * Create file definition (admin)
     */
    static async create(dto: any, createdByUserId: string): Promise<IFileDefinition> {
        return await FileDefinitionService.createDefinition(dto, createdByUserId);
    }

    /**
     * Update file definition (admin)
     */
    static async update(id: string, updates: any): Promise<IFileDefinition> {
        return await FileDefinitionService.updateDefinition(id, updates);
    }

    /**
     * Delete file definition (admin)
     */
    static async delete(id: string): Promise<void> {
        await FileDefinitionService.deleteDefinition(id);
    }

    /**
     * Get users with access to definition (admin)
     */
    static async getAllowedUsers(definitionId: string): Promise<any[]> {
        return await FileDefinitionService.getAllowedUsers(definitionId);
    }

    /**
     * Get all users for assignment dropdown (admin)
     */
    static async getAllUsers(): Promise<any[]> {
        return await FileDefinitionService.getAllAvailableUsers();
    }
}


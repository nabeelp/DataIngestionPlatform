// =============================================================================
// FileDefinition Model - Database operations for FileDefinitions table
// =============================================================================

import { getConnection } from '../config/database';
import { FileDefinitionVersion } from './FileDefinitionVersion.model';
import { v4 as uuidv4 } from 'uuid';
import type { 
    IFileDefinition, 
    ICreateFileDefinitionDto, 
    IUpdateFileDefinitionDto,
    IColumn,
    IFileDefinitionUser 
} from '../interfaces/fileDefinition.interface';
import { logger } from '../utils/logger';

// Columns and Tables are stored as JSON; a definition without sheet tables has Tables = [].
const parseJsonColumns = (row: any): any => {
    if (row.Columns && typeof row.Columns === 'string') {
        row.Columns = JSON.parse(row.Columns);
    }
    if (typeof row.Tables === 'string' && row.Tables.trim()) {
        row.Tables = JSON.parse(row.Tables);
    }
    if (!Array.isArray(row.Tables)) row.Tables = [];
    return row;
};

const tablesJson = (tables: unknown): string | null =>
    Array.isArray(tables) && tables.length > 0 ? JSON.stringify(tables) : null;

export class FileDefinition {
    private static readonly TABLE_NAME = 'FileDefinitions';
    private static readonly USER_ACCESS_TABLE = 'FileDefinitionUserAccess';

    /**
     * Find file definition by ID
     */
    static async findById(id: string): Promise<IFileDefinition | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Id = @Id`);
        
        if (!result.recordset[0]) {
            return null;
        }

        const definition = parseJsonColumns(result.recordset[0]);

        // Get allowed users
        definition.AllowedUsers = await this.getAllowedUsers(id);

        return definition;
    }

    /**
     * Get all file definitions (admin only - returns all)
     */
    static async findAll(): Promise<IFileDefinition[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .query(`SELECT * FROM ${this.TABLE_NAME} ORDER BY CreatedAt DESC`);
        
        return result.recordset.map(parseJsonColumns);
    }

    /**
     * Get file definitions accessible to a specific user
     * Returns definitions where the user has access
     */
    static async findForUser(userId: string): Promise<IFileDefinition[]> {
        const pool = await getConnection();
        
        logger.debug('[FILEDEFINITION_MODEL] findForUser called with userId:', userId);
        
        // If user is admin, they can see all definitions
        // First check if user is admin
        const userResult = await pool.request()
            .input('UserId', userId)
            .query(`SELECT Role FROM Users WHERE Id = @UserId`);
        
        logger.debug('[FILEDEFINITION_MODEL] User role result:', userResult.recordset);
        
        if (userResult.recordset[0]?.Role === 'admin') {
            logger.debug('[FILEDEFINITION_MODEL] User is admin, returning all definitions');
            // Admin sees all definitions
            return this.findAll();
        }

        logger.debug('[FILEDEFINITION_MODEL] User is regular user, checking access table');
        
        // Regular users only see definitions they have access to
        const result = await pool.request()
            .input('UserId', userId)
            .query(`
                SELECT fd.* FROM ${this.TABLE_NAME} fd
                INNER JOIN ${this.USER_ACCESS_TABLE} ua ON fd.Id = ua.FileDefinitionId
                WHERE ua.UserId = @UserId
                ORDER BY fd.CreatedAt DESC
            `);

        logger.debug('[FILEDEFINITION_MODEL] Access query result count:', result.recordset.length);

        return result.recordset.map(parseJsonColumns);
    }

    /**
     * Get users who have access to a specific file definition
     */
    static async getAllowedUsers(fileDefinitionId: string): Promise<IFileDefinitionUser[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('FileDefinitionId', fileDefinitionId)
            .query(`
                SELECT u.Id as id, u.Email as email, u.Username as username, u.FirstName as firstName, u.LastName as lastName
                FROM Users u
                INNER JOIN ${this.USER_ACCESS_TABLE} ua ON u.Id = ua.UserId
                WHERE ua.FileDefinitionId = @FileDefinitionId
            `);

        return result.recordset;
    }

    /**
     * Create new file definition
     */
static async create(dto: ICreateFileDefinitionDto, createdByUserId: string): Promise<IFileDefinition> {
        const pool = await getConnection();
        const id = uuidv4();
        const now = new Date();

        // Ensure Columns is stored as JSON string
        const columnsJson = JSON.stringify(dto.Columns);

        const request = pool.request()
            .input('Id', id)
            .input('Name', dto.Name)
            .input('Description', dto.Description || '')
            .input('Columns', columnsJson)
            .input('Tables', tablesJson(dto.Tables))
            .input('Status', dto.Status || 'Active')
            .input('CreatedAt', now)
            .input('UpdatedAt', now);

        const columnsList = ['Id', 'Name', 'Description', 'Columns', 'Tables', 'Status', 'CreatedAt', 'UpdatedAt'];
        if (dto.TemplateFilename) {
            request.input('TemplateFilename', dto.TemplateFilename);
            columnsList.push('TemplateFilename');
        }
        if (dto.DeliveryFolder) {
            request.input('DeliveryFolder', dto.DeliveryFolder);
            columnsList.push('DeliveryFolder');
        }

        await request.query(`
            INSERT INTO ${this.TABLE_NAME} 
            (${columnsList.join(', ')})
            VALUES 
            (${columnsList.map(column => `@${column}`).join(', ')})
        `);

        // Add user access - the creator always has access
        await this.addUserAccess(id, createdByUserId);

        // Add additional user access if specified
        if (dto.AllowedUserIds && dto.AllowedUserIds.length > 0) {
            for (const userId of dto.AllowedUserIds) {
                await this.addUserAccess(id, userId);
            }
        }

        return (await this.findById(id))!;
    }

    /**
     * Update file definition
     */
    static async update(id: string, updates: IUpdateFileDefinitionDto): Promise<IFileDefinition | null> {
        const pool = await getConnection();
        const now = new Date();

        const setClauses: string[] = ['UpdatedAt = @UpdatedAt'];
        const request = pool.request()
            .input('Id', id)
            .input('UpdatedAt', now);

        if (updates.Name !== undefined) {
            setClauses.push('Name = @Name');
            request.input('Name', updates.Name);
        }
        if (updates.Description !== undefined) {
            setClauses.push('Description = @Description');
            request.input('Description', updates.Description);
        }
        if (updates.Columns !== undefined) {
            setClauses.push('Columns = @Columns');
            request.input('Columns', JSON.stringify(updates.Columns));
        }
        if (updates.Tables !== undefined) {
            setClauses.push('Tables = @Tables');
            request.input('Tables', tablesJson(updates.Tables));
        }
        if (updates.Status !== undefined) {
            setClauses.push('Status = @Status');
            request.input('Status', updates.Status);
        }
        if (updates.TemplateFilename !== undefined) {
            setClauses.push('TemplateFilename = @TemplateFilename');
            request.input('TemplateFilename', updates.TemplateFilename);
        }
        if (updates.DeliveryFolder !== undefined) {
            setClauses.push('DeliveryFolder = @DeliveryFolder');
            request.input('DeliveryFolder', updates.DeliveryFolder);
        }

        await request.query(`
            UPDATE ${this.TABLE_NAME} 
            SET ${setClauses.join(', ')}
            WHERE Id = @Id
        `);

        return await this.findById(id);
    }

    /**
     * Delete file definition
     */
    static async delete(id: string): Promise<void> {
        const pool = await getConnection();
        
        // First delete all user access records
        await pool.request()
            .input('Id', id)
            .query(`DELETE FROM ${this.USER_ACCESS_TABLE} WHERE FileDefinitionId = @Id`);

        // Then delete the definition
        await pool.request()
            .input('Id', id)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE Id = @Id`);

        await FileDefinitionVersion.deleteUnreferenced(pool, id);
    }

    /**
     * Add user access to a file definition
     */
    static async addUserAccess(fileDefinitionId: string, userId: string): Promise<void> {
        const pool = await getConnection();
        const id = uuidv4();

        await pool.request()
            .input('Id', id)
            .input('FileDefinitionId', fileDefinitionId)
            .input('UserId', userId)
            .query(`
                IF NOT EXISTS (
                    SELECT 1 FROM ${this.USER_ACCESS_TABLE} 
                    WHERE FileDefinitionId = @FileDefinitionId AND UserId = @UserId
                )
                BEGIN
                    INSERT INTO ${this.USER_ACCESS_TABLE} (Id, FileDefinitionId, UserId)
                    VALUES (@Id, @FileDefinitionId, @UserId)
                END
            `);
    }

    /**
     * Remove user access from a file definition
     */
    static async removeUserAccess(fileDefinitionId: string, userId: string): Promise<void> {
        const pool = await getConnection();

        await pool.request()
            .input('FileDefinitionId', fileDefinitionId)
            .input('UserId', userId)
            .query(`
                DELETE FROM ${this.USER_ACCESS_TABLE} 
                WHERE FileDefinitionId = @FileDefinitionId AND UserId = @UserId
            `);
    }

    /**
     * Check if a user has access to a file definition
     */
    static async hasAccess(fileDefinitionId: string, userId: string): Promise<boolean> {
        const pool = await getConnection();
        
        // First check if user is admin
        const userResult = await pool.request()
            .input('UserId', userId)
            .query(`SELECT Role FROM Users WHERE Id = @UserId`);
        
        if (userResult.recordset[0]?.Role === 'admin') {
            return true; // Admins have access to all
        }

        const result = await pool.request()
            .input('FileDefinitionId', fileDefinitionId)
            .input('UserId', userId)
            .query(`
                SELECT 1 FROM ${this.USER_ACCESS_TABLE}
                WHERE FileDefinitionId = @FileDefinitionId AND UserId = @UserId
            `);

        return result.recordset.length > 0;
    }

    /**
     * Get all users (for admin to select when adding access)
     */
    static async getAllUsers(): Promise<IFileDefinitionUser[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .query(`
                SELECT Id as id, Email as email, Username as username, FirstName as firstName, LastName as lastName
                FROM Users
                WHERE IsActive = 1
                ORDER BY Email
            `);

        return result.recordset;
    }

    /**
     * Get definition stats for a user (total and active counts)
     */
    static async getStatsForUser(userId: string): Promise<{ totalDefinitions: number; activeDefinitions: number }> {
        const pool = await getConnection();
        
        // Check if user is admin
        const userResult = await pool.request()
            .input('UserId', userId)
            .query(`SELECT Role FROM Users WHERE Id = @UserId`);

        let query: string;

        if (userResult.recordset[0]?.Role === 'admin') {
            // Admin sees all definitions
            query = `
                SELECT 
                    COUNT(*) as totalDefinitions,
                    SUM(CASE WHEN Status = 'Active' THEN 1 ELSE 0 END) as activeDefinitions
                FROM ${this.TABLE_NAME}
            `;
        } else {
            // Regular user sees only their accessible definitions
            query = `
                SELECT 
                    COUNT(*) as totalDefinitions,
                    SUM(CASE WHEN fd.Status = 'Active' THEN 1 ELSE 0 END) as activeDefinitions
                FROM ${this.TABLE_NAME} fd
                INNER JOIN ${this.USER_ACCESS_TABLE} ua ON fd.Id = ua.FileDefinitionId
                WHERE ua.UserId = @UserId
            `;
        }

        const result = await pool.request()
            .input('UserId', userId)
            .query(query);

        const row = result.recordset[0];
        return {
            totalDefinitions: row?.totalDefinitions || 0,
            activeDefinitions: row?.activeDefinitions || 0
        };
    }

    /**
     * Get total count of file definitions (admin dashboard)
     * Index: CREATE INDEX IX_FileDefinitions_Status ON FileDefinitions(Status);
     */
    static async getCount(): Promise<number> {
        const pool = await getConnection();
        const result = await pool.request()
            .query(`SELECT COUNT(*) as count FROM ${this.TABLE_NAME}`);
        return Number(result.recordset[0]?.count) || 0;
    }
}


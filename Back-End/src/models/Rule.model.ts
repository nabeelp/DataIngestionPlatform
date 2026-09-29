// =============================================================================
// Rule Model - Database operations for Rules table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { 
    IRule, 
    ICreateRuleDto, 
    IUpdateRuleDto 
} from '../interfaces/rule.interface';
import { FileDefinition } from './FileDefinition.model';

export class Rule {
    private static readonly TABLE_NAME = 'Rules';

    /**
     * Find rule by ID
     */
    static async findById(id: string): Promise<IRule | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Id = @Id`);
        
        if (!result.recordset[0]) {
            return null;
        }

        return result.recordset[0];
    }

    /**
     * Get all rules for a specific file definition
     * Sorted by ExecutionOrder
     */
    static async findByFileDefinitionId(fileDefinitionId: string): Promise<IRule[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('FileDefinitionId', fileDefinitionId)
            .query(`
                SELECT * FROM ${this.TABLE_NAME} 
                WHERE FileDefinitionId = @FileDefinitionId 
                ORDER BY ExecutionOrder ASC
            `);
        
        return result.recordset;
    }

    /**
     * Get all rules for a specific file definition with creator info
     * Sorted by ExecutionOrder
     */
    static async findByFileDefinitionIdWithCreator(fileDefinitionId: string): Promise<(IRule & { CreatorName?: string })[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('FileDefinitionId', fileDefinitionId)
            .query(`
                SELECT 
                    r.*,
                    CASE 
                        WHEN u.FirstName IS NOT NULL AND u.LastName IS NOT NULL 
                        THEN u.FirstName + ' ' + u.LastName
                        WHEN u.Username IS NOT NULL 
                        THEN u.Username
                        ELSE u.Email
                    END as CreatorName
                FROM ${this.TABLE_NAME} r
                LEFT JOIN Users u ON r.CreatedBy = u.Id
                WHERE r.FileDefinitionId = @FileDefinitionId 
                ORDER BY r.ExecutionOrder ASC
            `);
        
        return result.recordset;
    }

    /**
     * Get only enabled rules for a specific file definition
     * Sorted by ExecutionOrder - used for validation execution
     */
    static async findEnabledByFileDefinitionId(fileDefinitionId: string): Promise<IRule[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('FileDefinitionId', fileDefinitionId)
            .query(`
                SELECT * FROM ${this.TABLE_NAME} 
                WHERE FileDefinitionId = @FileDefinitionId 
                AND IsEnabled = 1
                ORDER BY ExecutionOrder ASC
            `);
        
        return result.recordset;
    }

    /**
     * Create new rule
     */
    static async create(dto: ICreateRuleDto, createdByUserId: string): Promise<IRule> {
        const pool = await getConnection();
        const id = uuidv4();
        const now = new Date();

        await pool.request()
            .input('Id', id)
            .input('FileDefinitionId', dto.FileDefinitionId)
            .input('Name', dto.Name)
            .input('Description', dto.Description || '')
            .input('RuleType', dto.RuleType)
            .input('Severity', dto.Severity || 'Error')
            .input('ExecutionOrder', dto.ExecutionOrder || 1)
            .input('SqlQuery', dto.SqlQuery)
            .input('IsEnabled', dto.IsEnabled !== undefined ? dto.IsEnabled : 1)
            .input('TableName', dto.TableName ?? null)
            .input('NaturalLanguageText', dto.NaturalLanguageText ?? null)
            .input('Pseudocode', dto.Pseudocode ?? null)
            .input('GeneratedCode', dto.GeneratedCode ?? null)
            .input('CreatedBy', createdByUserId)
            .input('CreatedAt', now)
            .input('UpdatedAt', now)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
                (Id, FileDefinitionId, Name, Description, RuleType, Severity, ExecutionOrder, SqlQuery, IsEnabled, TableName, NaturalLanguageText, Pseudocode, GeneratedCode, CreatedBy, CreatedAt, UpdatedAt)
                VALUES 
                (@Id, @FileDefinitionId, @Name, @Description, @RuleType, @Severity, @ExecutionOrder, @SqlQuery, @IsEnabled, @TableName, @NaturalLanguageText, @Pseudocode, @GeneratedCode, @CreatedBy, @CreatedAt, @UpdatedAt)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Update rule
     */
    static async update(id: string, updates: IUpdateRuleDto): Promise<IRule | null> {
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
        if (updates.RuleType !== undefined) {
            setClauses.push('RuleType = @RuleType');
            request.input('RuleType', updates.RuleType);
        }
        if (updates.Severity !== undefined) {
            setClauses.push('Severity = @Severity');
            request.input('Severity', updates.Severity);
        }
        if (updates.ExecutionOrder !== undefined) {
            setClauses.push('ExecutionOrder = @ExecutionOrder');
            request.input('ExecutionOrder', updates.ExecutionOrder);
        }
        if (updates.SqlQuery !== undefined) {
            setClauses.push('SqlQuery = @SqlQuery');
            request.input('SqlQuery', updates.SqlQuery);
        }
        if (updates.IsEnabled !== undefined) {
            setClauses.push('IsEnabled = @IsEnabled');
            request.input('IsEnabled', updates.IsEnabled);
        }
        if (updates.TableName !== undefined) {
            setClauses.push('TableName = @TableName');
            request.input('TableName', updates.TableName);
        }

        await request.query(`
            UPDATE ${this.TABLE_NAME} 
            SET ${setClauses.join(', ')}
            WHERE Id = @Id
        `);

        return await this.findById(id);
    }

    /**
     * Delete rule
     */
    static async delete(id: string): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('Id', id)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE Id = @Id`);
    }

    /**
     * Check if user has access to the file definition associated with a rule
     */
    static async hasAccessToRule(ruleId: string, userId: string): Promise<boolean> {
        const rule = await this.findById(ruleId);
        
        if (!rule) {
            return false;
        }

        return await FileDefinition.hasAccess(rule.FileDefinitionId, userId);
    }

    /**
     * Check if user has access to a file definition
     */
    static async hasAccessToFileDefinition(fileDefinitionId: string, userId: string): Promise<boolean> {
        return await FileDefinition.hasAccess(fileDefinitionId, userId);
    }
}


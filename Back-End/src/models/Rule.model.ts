// =============================================================================
// Rule Model - Database operations for Rules table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { RuleConfig } from '../contracts/rule-config';
import type { 
    IRule, 
    ICreateRuleDto, 
    IUpdateRuleDto 
} from '../interfaces/rule.interface';
import { FileDefinition } from './FileDefinition.model';
import { parseRuleConfig } from './contractMapper';

function parseStoredRule(row: any): IRule {
    let config: RuleConfig;
    try {
        config = parseRuleConfig(row.Config);
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown configuration error';
        throw new Error(`Rule ${String(row.Id)} contains invalid configuration: ${detail}`);
    }

    return {
        Id: row.Id,
        FileDefinitionId: row.FileDefinitionId,
        Config: config,
        ConfigSchemaVersion: row.ConfigSchemaVersion,
        Name: config.name,
        Description: config.description,
        Severity: config.severity,
        ExecutionOrder: config.executionOrder,
        IsEnabled: Boolean(row.IsEnabled),
        TableName: config.table,
        CreatedBy: row.CreatedBy ?? null,
        CreatedAt: row.CreatedAt,
        UpdatedAt: row.UpdatedAt,
    };
}

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

        return parseStoredRule(result.recordset[0]);
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
        
        return result.recordset.map(row => ({ ...parseStoredRule(row), CreatorName: row.CreatorName }));
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
        
        return result.recordset.map(parseStoredRule);
    }

    /**
     * Create new rule
     */
    static async create(dto: ICreateRuleDto, createdByUserId: string): Promise<IRule> {
        const pool = await getConnection();
        const id = dto.Config.id ?? uuidv4();
        const now = new Date();
        const enabled = dto.IsEnabled ?? dto.Config.enabled;
        const config = { ...dto.Config, id, enabled };

        await pool.request()
            .input('Id', id)
            .input('FileDefinitionId', dto.FileDefinitionId)
            .input('Config', JSON.stringify(config))
            .input('ConfigSchemaVersion', 1)
            .input('IsEnabled', enabled)
            .input('CreatedBy', createdByUserId)
            .input('CreatedAt', now)
            .input('UpdatedAt', now)
            .query(`
                INSERT INTO ${this.TABLE_NAME}
                    (Id, FileDefinitionId, Config, ConfigSchemaVersion, IsEnabled, CreatedBy, CreatedAt, UpdatedAt)
                VALUES
                    (@Id, @FileDefinitionId, @Config, @ConfigSchemaVersion, @IsEnabled, @CreatedBy, @CreatedAt, @UpdatedAt)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Update rule
     */
    static async update(id: string, updates: IUpdateRuleDto): Promise<IRule | null> {
        const pool = await getConnection();
        const existing = await this.findById(id);
        if (!existing) return null;
        const now = new Date();
        const enabled = updates.IsEnabled ?? updates.Config?.enabled ?? existing.IsEnabled;
        const config: RuleConfig = updates.Config
            ? { ...updates.Config, id: existing.Id, enabled }
            : {
                ...existing.Config,
                name: updates.Name ?? existing.Name,
                description: updates.Description ?? existing.Description,
                severity: updates.Severity ?? existing.Severity,
                executionOrder: updates.ExecutionOrder ?? existing.ExecutionOrder,
                enabled,
                table: updates.TableName !== undefined ? updates.TableName?.trim() || null : existing.TableName,
            };

        await pool.request()
            .input('Id', id)
            .input('Config', JSON.stringify(config))
            .input('IsEnabled', enabled)
            .input('UpdatedAt', now)
            .query(`
                UPDATE ${this.TABLE_NAME} 
                SET Config = @Config, IsEnabled = @IsEnabled, UpdatedAt = @UpdatedAt
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

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

type LegacyRule = Pick<IRule, 'Id' | 'Name' | 'Description' | 'RuleType' | 'Severity' | 'ExecutionOrder' | 'SqlQuery' | 'IsEnabled' | 'TableName' | 'NaturalLanguageText' | 'CreatedBy' | 'CreatedAt' | 'UpdatedAt'>;

const parseList = (expression: string): [string, ...string[]] => {
    const values = expression.split(',').map(value => value.trim()).filter(Boolean);
    if (values.length === 0 || new Set(values).size !== values.length) {
        throw new Error('Rule expression must contain one or more unique values.');
    }
    return [values[0], ...values.slice(1)];
};

export function ruleConfigFromLegacy(
    rule: Pick<LegacyRule, 'Id' | 'Name' | 'Description' | 'RuleType' | 'Severity' | 'ExecutionOrder' | 'SqlQuery' | 'IsEnabled' | 'TableName'>,
): RuleConfig {
    const common = {
        id: rule.Id,
        name: rule.Name,
        description: rule.Description,
        severity: rule.Severity,
        executionOrder: rule.ExecutionOrder,
        enabled: rule.IsEnabled,
        table: rule.TableName ?? null,
    };

    switch (rule.RuleType) {
        case 'Schema Validation':
            throw new Error('Schema Validation rules are no longer supported; column definitions enforce required columns, required values and data types.');
        case 'Enum Check': {
            const delimiter = rule.SqlQuery.indexOf(':');
            if (delimiter < 1) throw new Error('Enum Check must use the form "Column: Value1, Value2".');
            const column = rule.SqlQuery.slice(0, delimiter).trim();
            const values = parseList(rule.SqlQuery.slice(delimiter + 1));
            if (!column) throw new Error('Enum Check needs a column name.');
            return { ...common, type: 'enum', params: { column, values } };
        }
        case 'Range Check': {
            const match = /^\\s*([^:]+?)\\s*:\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))?\\s*\\.\\.\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))?\\s*$/.exec(rule.SqlQuery);
            if (!match || (!match[2] && !match[3])) {
                throw new Error('Range Check must use the form "Column: minimum..maximum" with at least one bound.');
            }
            return {
                ...common,
                type: 'range',
                params: {
                    column: match[1].trim(),
                    ...(match[2] ? { min: Number(match[2]) } : {}),
                    ...(match[3] ? { max: Number(match[3]) } : {}),
                },
            };
        }
        case 'Natural Language':
            throw new Error('Natural-language rules must be saved as a complete versioned RuleConfig.');
    }
}

function parseStoredRule(row: any): IRule {
    let config: RuleConfig;
    try {
        config = parseRuleConfig(row.Config);
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown configuration error';
        throw new Error(`Rule ${String(row.Id)} contains invalid configuration: ${detail}`);
    }
    if (!config || typeof config !== 'object' || typeof config.id !== 'string' || typeof config.name !== 'string') {
        throw new Error(`Rule ${String(row.Id)} does not match the RuleConfig contract.`);
    }

    const params = config.params as Record<string, unknown>;
    const ruleType: IRule['RuleType'] = (() => {
        switch (config.type) {
            case 'enum': return 'Enum Check';
            case 'range': return 'Range Check';
            default: return 'Natural Language';
        }
    })();
    let sqlQuery = '';
    if (config.type === 'enum') {
        sqlQuery = `${String(params.column ?? '')}: ${Array.isArray(params.values) ? params.values.join(', ') : ''}`;
    } else if (config.type === 'range') {
        sqlQuery = `${String(params.column ?? '')}: ${typeof params.min === 'number' ? params.min : ''}..${typeof params.max === 'number' ? params.max : ''}`;
    }

    return {
        Id: row.Id,
        FileDefinitionId: row.FileDefinitionId,
        Config: config,
        ConfigSchemaVersion: row.ConfigSchemaVersion,
        Name: config.name,
        Description: config.description,
        RuleType: ruleType,
        Severity: config.severity,
        ExecutionOrder: config.executionOrder,
        SqlQuery: sqlQuery,
        IsEnabled: Boolean(row.IsEnabled),
        TableName: config.table,
        NaturalLanguageText: config.type === 'naturalLanguage' && typeof params.request === 'string' ? params.request : null,
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
        const id = dto.Config?.id ?? uuidv4();
        const now = new Date();
        const config = dto.Config
            ? { ...dto.Config, id, enabled: dto.IsEnabled ?? dto.Config.enabled }
            : ruleConfigFromLegacy({
                Id: id,
                Name: dto.Name,
                Description: dto.Description || '',
                RuleType: dto.RuleType,
                Severity: dto.Severity || 'Error',
                ExecutionOrder: dto.ExecutionOrder ?? 1,
                SqlQuery: dto.SqlQuery,
                IsEnabled: dto.IsEnabled !== undefined ? dto.IsEnabled : true,
                TableName: dto.TableName ?? null,
            });

        await pool.request()
            .input('Id', id)
            .input('FileDefinitionId', dto.FileDefinitionId)
            .input('Config', JSON.stringify(config))
            .input('ConfigSchemaVersion', 1)
            .input('IsEnabled', dto.IsEnabled !== undefined ? dto.IsEnabled : 1)
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
        const config = updates.Config
            ? { ...updates.Config, id: existing.Id, enabled: updates.IsEnabled ?? updates.Config.enabled }
            : (updates.RuleType !== undefined || updates.SqlQuery !== undefined || updates.TableName !== undefined)
                ? ruleConfigFromLegacy({
                    ...existing,
                    ...updates,
                    Id: existing.Id,
                    Name: updates.Name ?? existing.Name,
                    Description: updates.Description ?? existing.Description,
                    RuleType: updates.RuleType ?? existing.RuleType,
                    Severity: updates.Severity ?? existing.Severity,
                    ExecutionOrder: updates.ExecutionOrder ?? existing.ExecutionOrder,
                    SqlQuery: updates.SqlQuery ?? existing.SqlQuery,
                    IsEnabled: updates.IsEnabled ?? existing.IsEnabled,
                    TableName: updates.TableName !== undefined ? updates.TableName : existing.TableName,
                })
                : {
                    ...existing.Config,
                    name: updates.Name ?? existing.Name,
                    description: updates.Description ?? existing.Description,
                    severity: updates.Severity ?? existing.Severity,
                    executionOrder: updates.ExecutionOrder ?? existing.ExecutionOrder,
                    enabled: updates.IsEnabled ?? existing.IsEnabled,
                    table: updates.TableName !== undefined ? updates.TableName : existing.TableName ?? null,
                };
        const request = pool.request()
            .input('Id', id)
            .input('Config', JSON.stringify(config))
            .input('IsEnabled', updates.IsEnabled ?? existing.IsEnabled)
            .input('UpdatedAt', now);

        await request.query(`
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

// =============================================================================
// ValidationRuleDetail Model - Database operations for ValidationRuleDetails table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { 
    IValidationRuleDetail, 
    ICreateValidationRuleDetailDto,
    IUpdateValidationRuleDetailDto
} from '../interfaces/upload.interface';

export class ValidationRuleDetail {
    private static readonly TABLE_NAME = 'ValidationRuleDetails';

    /**
     * Find validation rule detail by ID
     */
    static async findById(id: string): Promise<IValidationRuleDetail | null> {
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
     * Find all rule details for an upload
     */
    static async findByUploadId(uploadId: string): Promise<IValidationRuleDetail[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('UploadId', uploadId)
            .query(`
                SELECT * FROM ${this.TABLE_NAME} 
                WHERE UploadId = @UploadId 
                ORDER BY ExecutionOrder ASC
            `);
        
        return result.recordset;
    }

    /**
     * Find rule detail by validation result ID and rule ID
     */
    static async findByValidationResultAndRule(
        validationResultId: string, 
        ruleId: string
    ): Promise<IValidationRuleDetail | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('ValidationResultId', validationResultId)
            .input('RuleId', ruleId)
            .query(`
                SELECT * FROM ${this.TABLE_NAME} 
                WHERE ValidationResultId = @ValidationResultId AND RuleId = @RuleId
            `);
        
        if (!result.recordset[0]) {
            return null;
        }

        return result.recordset[0];
    }

    /**
     * Create new validation rule detail
     */
    static async create(dto: ICreateValidationRuleDetailDto): Promise<IValidationRuleDetail> {
        const pool = await getConnection();
        const id = uuidv4();

        await pool.request()
            .input('Id', id)
            .input('ValidationResultId', dto.ValidationResultId)
            .input('UploadId', dto.UploadId)
            .input('RuleId', dto.RuleId)
            .input('RuleName', dto.RuleName)
            .input('RuleType', dto.RuleType)
            .input('RuleSeverity', dto.RuleSeverity)
            .input('ExecutionOrder', dto.ExecutionOrder)
            .input('Status', 'PENDING')
            .input('ExecutionTimeMs', null)
            .input('ErrorCount', 0)
            .input('WarningCount', 0)
            .input('FailedRows', null)
            .input('FailedRowsCount', 0)
            .input('SampleErrorValue', null)
            .input('StartedAt', null)
            .input('CompletedAt', null)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
                (Id, ValidationResultId, UploadId, RuleId, RuleName, RuleType, RuleSeverity, ExecutionOrder, Status, ExecutionTimeMs, ErrorCount, WarningCount, FailedRows, FailedRowsCount, SampleErrorValue, StartedAt, CompletedAt)
                VALUES 
                (@Id, @ValidationResultId, @UploadId, @RuleId, @RuleName, @RuleType, @RuleSeverity, @ExecutionOrder, @Status, @ExecutionTimeMs, @ErrorCount, @WarningCount, @FailedRows, @FailedRowsCount, @SampleErrorValue, @StartedAt, @CompletedAt)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Update validation rule detail
     */
    static async update(id: string, updates: IUpdateValidationRuleDetailDto): Promise<IValidationRuleDetail | null> {
        const pool = await getConnection();

        const setClauses: string[] = [];
        const request = pool.request()
            .input('Id', id);

        if (updates.Status !== undefined) {
            setClauses.push('Status = @Status');
            request.input('Status', updates.Status);
        }
        if (updates.ExecutionTimeMs !== undefined) {
            setClauses.push('ExecutionTimeMs = @ExecutionTimeMs');
            request.input('ExecutionTimeMs', updates.ExecutionTimeMs);
        }
        if (updates.ErrorCount !== undefined) {
            setClauses.push('ErrorCount = @ErrorCount');
            request.input('ErrorCount', updates.ErrorCount);
        }
        if (updates.WarningCount !== undefined) {
            setClauses.push('WarningCount = @WarningCount');
            request.input('WarningCount', updates.WarningCount);
        }
        if (updates.FailedRows !== undefined) {
            setClauses.push('FailedRows = @FailedRows');
            request.input('FailedRows', updates.FailedRows);
        }
        if (updates.FailedRowsCount !== undefined) {
            setClauses.push('FailedRowsCount = @FailedRowsCount');
            request.input('FailedRowsCount', updates.FailedRowsCount);
        }
        if (updates.SampleErrorValue !== undefined) {
            setClauses.push('SampleErrorValue = @SampleErrorValue');
            request.input('SampleErrorValue', updates.SampleErrorValue);
        }
        if (updates.StartedAt !== undefined) {
            setClauses.push('StartedAt = @StartedAt');
            request.input('StartedAt', updates.StartedAt);
        }
        if (updates.CompletedAt !== undefined) {
            setClauses.push('CompletedAt = @CompletedAt');
            request.input('CompletedAt', updates.CompletedAt);
        }

        if (setClauses.length === 0) {
            return await this.findById(id);
        }

        await request.query(`
            UPDATE ${this.TABLE_NAME} 
            SET ${setClauses.join(', ')}
            WHERE Id = @Id
        `);

        return await this.findById(id);
    }

    /**
     * Mark rule as passed
     */
    static async markPassed(id: string, executionTimeMs: number): Promise<void> {
        await this.update(id, {
            Status: 'PASSED',
            ExecutionTimeMs: executionTimeMs,
            CompletedAt: new Date()
        });
    }

    /**
     * Mark rule as failed
     */
    static async markFailed(
        id: string, 
        executionTimeMs: number, 
        errorCount: number, 
        errors: any[]
    ): Promise<void> {
        const failedRows = errors.length > 0 ? JSON.stringify(errors.slice(0, 10)) : undefined;
        const sampleErrorValue = errors.length > 0 ? errors[0]?.value : undefined;

        await this.update(id, {
            Status: 'FAILED',
            ExecutionTimeMs: executionTimeMs,
            ErrorCount: errorCount,
            FailedRows: failedRows,
            FailedRowsCount: errorCount,
            SampleErrorValue: sampleErrorValue,
            CompletedAt: new Date()
        });
    }

    /**
     * Mark rule as warning
     */
    static async markWarning(
        id: string, 
        executionTimeMs: number, 
        warningCount: number, 
        errors: any[]
    ): Promise<void> {
        const failedRows = errors.length > 0 ? JSON.stringify(errors.slice(0, 10)) : undefined;

        await this.update(id, {
            Status: 'WARNING',
            ExecutionTimeMs: executionTimeMs,
            WarningCount: warningCount,
            FailedRows: failedRows,
            CompletedAt: new Date()
        });
    }

    /**
     * Mark rule as started
     */
    static async markStarted(id: string): Promise<void> {
        await this.update(id, {
            Status: 'IN_PROGRESS',
            StartedAt: new Date()
        });
    }

    /**
     * Delete validation rule details by upload ID
     */
    static async deleteByUploadId(uploadId: string): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('UploadId', uploadId)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE UploadId = @UploadId`);
    }

    /**
     * Delete validation rule details by validation result ID
     */
    static async deleteByValidationResultId(validationResultId: string): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('ValidationResultId', validationResultId)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE ValidationResultId = @ValidationResultId`);
    }
}


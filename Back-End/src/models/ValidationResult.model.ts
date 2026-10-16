// =============================================================================
// ValidationResult Model - Database operations for ValidationResults table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { 
    IValidationResult, 
    ICreateValidationResultDto,
    IUpdateValidationResultDto
} from '../interfaces/upload.interface';

export class ValidationResult {
    private static readonly TABLE_NAME = 'ValidationResults';

    /**
     * Find validation result by ID
     */
    static async findById(id: string): Promise<IValidationResult | null> {
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
     * Find validation result by upload ID
     */
    static async findByUploadId(uploadId: string): Promise<IValidationResult | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('UploadId', uploadId)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE UploadId = @UploadId`);
        
        if (!result.recordset[0]) {
            return null;
        }

        return result.recordset[0];
    }

    /**
     * Create new validation result
     */
    static async create(dto: ICreateValidationResultDto): Promise<IValidationResult> {
        const pool = await getConnection();
        const id = uuidv4();

        await pool.request()
            .input('Id', id)
            .input('UploadId', dto.UploadId)
            .input('TotalRules', dto.TotalRules)
            .input('PassedRules', 0)
            .input('FailedRules', 0)
            .input('WarningRules', 0)
            .input('ProgressPercent', 0)
            .input('CurrentRule', null)
            .input('Status', 'PENDING')
            .input('StartedAt', null)
            .input('CompletedAt', null)
            .input('TotalErrors', 0)
            .input('TotalWarnings', 0)
            .input('ErrorSummary', null)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
                (Id, UploadId, TotalRules, PassedRules, FailedRules, WarningRules, ProgressPercent, CurrentRule, Status, StartedAt, CompletedAt, TotalErrors, TotalWarnings, ErrorSummary)
                VALUES 
                (@Id, @UploadId, @TotalRules, @PassedRules, @FailedRules, @WarningRules, @ProgressPercent, @CurrentRule, @Status, @StartedAt, @CompletedAt, @TotalErrors, @TotalWarnings, @ErrorSummary)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Update validation result
     */
    static async update(id: string, updates: IUpdateValidationResultDto): Promise<IValidationResult | null> {
        const pool = await getConnection();

        const setClauses: string[] = [];
        const request = pool.request()
            .input('Id', id);

        if (updates.PassedRules !== undefined) {
            setClauses.push('PassedRules = @PassedRules');
            request.input('PassedRules', updates.PassedRules);
        }
        if (updates.FailedRules !== undefined) {
            setClauses.push('FailedRules = @FailedRules');
            request.input('FailedRules', updates.FailedRules);
        }
        if (updates.WarningRules !== undefined) {
            setClauses.push('WarningRules = @WarningRules');
            request.input('WarningRules', updates.WarningRules);
        }
        if (updates.ProgressPercent !== undefined) {
            setClauses.push('ProgressPercent = @ProgressPercent');
            request.input('ProgressPercent', updates.ProgressPercent);
        }
        if (updates.CurrentRule !== undefined) {
            setClauses.push('CurrentRule = @CurrentRule');
            request.input('CurrentRule', updates.CurrentRule);
        }
        if (updates.Status !== undefined) {
            setClauses.push('Status = @Status');
            request.input('Status', updates.Status);
        }
        if (updates.StartedAt !== undefined) {
            setClauses.push('StartedAt = @StartedAt');
            request.input('StartedAt', updates.StartedAt);
        }
        if (updates.CompletedAt !== undefined) {
            setClauses.push('CompletedAt = @CompletedAt');
            request.input('CompletedAt', updates.CompletedAt);
        }
        if (updates.TotalErrors !== undefined) {
            setClauses.push('TotalErrors = @TotalErrors');
            request.input('TotalErrors', updates.TotalErrors);
        }
        if (updates.TotalWarnings !== undefined) {
            setClauses.push('TotalWarnings = @TotalWarnings');
            request.input('TotalWarnings', updates.TotalWarnings);
        }
        if (updates.ErrorSummary !== undefined) {
            setClauses.push('ErrorSummary = @ErrorSummary');
            request.input('ErrorSummary', updates.ErrorSummary);
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
     * Mark validation as started
     */
    static async markStarted(id: string): Promise<void> {
        await this.update(id, {
            Status: 'IN_PROGRESS',
            StartedAt: new Date()
        });
    }

    /**
     * Delete validation result by upload ID
     */
    static async deleteByUploadId(uploadId: string): Promise<void> {
        const pool = await getConnection();
        
        await pool.request()
            .input('UploadId', uploadId)
            .query(`DELETE FROM ${this.TABLE_NAME} WHERE UploadId = @UploadId`);
    }
}


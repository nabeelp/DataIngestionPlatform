import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type {
    IValidationIssue,
    IValidationRuleDetail,
    ICreateValidationRuleDetailDto,
    IUpdateValidationRuleDetailDto,
} from '../interfaces/upload.interface';

const TABLE_NAME = 'ValidationRuleDetails';

function parseIssues(value: unknown): IValidationIssue[] {
    if (Array.isArray(value)) return value as IValidationIssue[];
    if (typeof value !== 'string') return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(value) as unknown;
    } catch {
        throw new Error('Stored validation issues are not valid JSON.');
    }
    if (!Array.isArray(parsed)) throw new Error('Stored validation issues must be a JSON array.');
    return parsed as IValidationIssue[];
}

function normalizeIssues(errors: unknown[]): IValidationIssue[] {
    return errors.slice(0, 100).map((error, index) => {
        if (!error || typeof error !== 'object') {
            throw new Error(`Validation issue ${index + 1} must be an object.`);
        }

        const rowValue = 'row' in error ? error.row : 'row_num' in error ? error.row_num : null;
        const row = typeof rowValue === 'number' && Number.isFinite(rowValue) ? rowValue : null;
        const columnValue = 'column' in error ? error.column : null;
        const sheetValue = 'sheet' in error ? error.sheet : null;
        const value = 'value' in error ? error.value : null;
        const messageValue = 'message' in error ? error.message : 'error' in error ? error.error : null;

        if (messageValue === null || messageValue === undefined) {
            throw new Error(`Validation issue ${index + 1} has no message.`);
        }
        const normalizedValue = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? value
            : value === null || value === undefined
                ? null
                : String(value);

        return {
            sheet: typeof sheetValue === 'string' ? sheetValue : null,
            row,
            column: typeof columnValue === 'string' ? columnValue : null,
            value: normalizedValue,
            message: String(messageValue),
        };
    });
}

function mapDetailRow(row: any): IValidationRuleDetail {
    const issues = parseIssues(row.Issues);
    const status = row.Status ?? 'PENDING';
    const issueCount = Number(row.IssueCount ?? issues.length);
    const elapsedMs = Number(row.ElapsedMs ?? 0);
    const isFailed = status === 'FAILED' || status === 'ERROR';
    const isWarning = status === 'WARNING';

    return {
        Id: row.Id,
        ValidationResultId: row.ValidationResultId,
        UploadId: row.UploadId,
        RuleId: row.RuleId ?? null,
        RuleName: row.RuleName,
        RuleType: row.RuleType,
        RuleSeverity: row.RuleSeverity,
        ExecutionOrder: row.ExecutionOrder,
        Status: status,
        IssueCount: issueCount,
        Issues: JSON.stringify(issues),
        ElapsedMs: elapsedMs,
        ErrorCount: isFailed ? issueCount : 0,
        WarningCount: isWarning ? issueCount : 0,
        ExecutionTimeMs: elapsedMs,
        FailedRows: issues.length > 0 ? JSON.stringify(issues) : null,
        FailedRowsCount: issueCount,
        SampleErrorValue: issues[0]?.value === null || issues[0]?.value === undefined
            ? null
            : String(issues[0].value),
        StartedAt: row.StartedAt ?? null,
        CompletedAt: row.Status ? row.CreatedAt : null,
        Sheet: row.Sheet ?? null,
    };
}

export class ValidationRuleDetail {
    static async findById(id: string): Promise<IValidationRuleDetail | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`SELECT * FROM ${TABLE_NAME} WHERE Id = @Id`);
        return result.recordset[0] ? mapDetailRow(result.recordset[0]) : null;
    }

    static async findByUploadId(uploadId: string): Promise<IValidationRuleDetail[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('UploadId', uploadId)
            .query(`SELECT * FROM ${TABLE_NAME} WHERE UploadId = @UploadId ORDER BY ExecutionOrder ASC`);
        return result.recordset.map(mapDetailRow);
    }

    static async findByValidationResultAndRule(
        validationResultId: string,
        ruleId: string,
    ): Promise<IValidationRuleDetail | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('ValidationResultId', validationResultId)
            .input('RuleId', ruleId)
            .query(`SELECT * FROM ${TABLE_NAME} WHERE ValidationResultId = @ValidationResultId AND RuleId = @RuleId`);
        return result.recordset[0] ? mapDetailRow(result.recordset[0]) : null;
    }

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
            .input('IssueCount', 0)
            .input('Issues', '[]')
            .input('ElapsedMs', 0)
            .input('Sheet', null)
            .query(`
                INSERT INTO ${TABLE_NAME}
                    (Id, ValidationResultId, UploadId, RuleId, RuleName, RuleType, RuleSeverity, ExecutionOrder, Status, IssueCount, Issues, ElapsedMs, Sheet)
                VALUES
                    (@Id, @ValidationResultId, @UploadId, @RuleId, @RuleName, @RuleType, @RuleSeverity, @ExecutionOrder, NULL, @IssueCount, @Issues, @ElapsedMs, @Sheet)
            `);

        return (await this.findById(id))!;
    }

    static async update(id: string, updates: IUpdateValidationRuleDetailDto): Promise<IValidationRuleDetail | null> {
        const pool = await getConnection();
        const setClauses: string[] = [];
        const request = pool.request().input('Id', id);
        const status = updates.Status === 'PENDING' || updates.Status === 'IN_PROGRESS'
            ? null
            : updates.Status === 'SKIPPED'
                ? 'ERROR'
                : updates.Status;

        if (updates.Status !== undefined) {
            setClauses.push('Status = @Status');
            request.input('Status', status);
        }
        if (updates.ElapsedMs !== undefined || updates.ExecutionTimeMs !== undefined) {
            setClauses.push('ElapsedMs = @ElapsedMs');
            request.input('ElapsedMs', updates.ElapsedMs ?? updates.ExecutionTimeMs);
        }
        if (updates.IssueCount !== undefined || updates.ErrorCount !== undefined ||
            updates.WarningCount !== undefined || updates.FailedRowsCount !== undefined) {
            const issueCount = updates.IssueCount ?? Math.max(
                updates.ErrorCount ?? 0,
                updates.WarningCount ?? 0,
                updates.FailedRowsCount ?? 0,
            );
            setClauses.push('IssueCount = @IssueCount');
            request.input('IssueCount', Math.max(0, issueCount));
        }
        if (updates.Issues !== undefined || updates.FailedRows !== undefined) {
            const issues = updates.Issues !== undefined
                ? parseIssues(updates.Issues)
                : normalizeIssues(JSON.parse(updates.FailedRows!) as unknown[]);
            setClauses.push('Issues = @Issues');
            request.input('Issues', JSON.stringify(issues));
        }
        if (updates.Sheet !== undefined) {
            setClauses.push('Sheet = @Sheet');
            request.input('Sheet', updates.Sheet);
        }
        if (updates.Status === 'PASSED' && updates.IssueCount === undefined &&
            updates.ErrorCount === undefined && updates.WarningCount === undefined) {
            setClauses.push('IssueCount = 0', 'Issues = N\'[]\'');
        }

        if (setClauses.length === 0) return this.findById(id);

        await request.query(`UPDATE ${TABLE_NAME} SET ${setClauses.join(', ')} WHERE Id = @Id`);
        return this.findById(id);
    }

    static async markPassed(id: string, executionTimeMs: number): Promise<void> {
        await this.update(id, {
            Status: 'PASSED',
            ExecutionTimeMs: executionTimeMs,
            IssueCount: 0,
            Issues: '[]',
            CompletedAt: new Date(),
        });
    }

    static async markFailed(id: string, executionTimeMs: number, errorCount: number, errors: unknown[]): Promise<void> {
        const issues = normalizeIssues(errors);
        await this.update(id, {
            Status: 'FAILED',
            ExecutionTimeMs: executionTimeMs,
            ErrorCount: errorCount,
            FailedRowsCount: errorCount,
            FailedRows: JSON.stringify(issues),
            Issues: JSON.stringify(issues),
            IssueCount: errorCount,
            CompletedAt: new Date(),
        });
    }

    static async markWarning(id: string, executionTimeMs: number, warningCount: number, errors: unknown[]): Promise<void> {
        const issues = normalizeIssues(errors);
        await this.update(id, {
            Status: 'WARNING',
            ExecutionTimeMs: executionTimeMs,
            WarningCount: warningCount,
            FailedRowsCount: warningCount,
            FailedRows: JSON.stringify(issues),
            Issues: JSON.stringify(issues),
            IssueCount: warningCount,
            CompletedAt: new Date(),
        });
    }

    static async markStarted(id: string): Promise<void> {
        await this.update(id, { Status: 'IN_PROGRESS', StartedAt: new Date() });
    }

    static async markSkipped(id: string, executionTimeMs: number): Promise<void> {
        await this.update(id, {
            Status: 'ERROR',
            ExecutionTimeMs: executionTimeMs,
            IssueCount: 1,
            Issues: JSON.stringify([{
                sheet: null,
                row: null,
                column: null,
                value: null,
                message: 'The check was skipped by the legacy validation pipeline.',
            }]),
            CompletedAt: new Date(),
        });
    }

    static async deleteByUploadId(uploadId: string): Promise<void> {
        const pool = await getConnection();
        await pool.request().input('UploadId', uploadId).query(`DELETE FROM ${TABLE_NAME} WHERE UploadId = @UploadId`);
    }

    static async deleteByValidationResultId(validationResultId: string): Promise<void> {
        const pool = await getConnection();
        await pool.request()
            .input('ValidationResultId', validationResultId)
            .query(`DELETE FROM ${TABLE_NAME} WHERE ValidationResultId = @ValidationResultId`);
    }
}

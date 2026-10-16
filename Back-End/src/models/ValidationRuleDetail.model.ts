import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type {
    IValidationIssue,
    IValidationRuleDetail,
    ICreateValidationRuleDetailDto,
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

function mapDetailRow(row: any): IValidationRuleDetail {
    const issues = parseIssues(row.Issues);
    const status = row.Status ?? 'PENDING';
    const issueCount = Number(row.IssueCount ?? issues.length);
    const elapsedMs = Number(row.ElapsedMs ?? 0);

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

    static async deleteByUploadId(uploadId: string): Promise<void> {
        const pool = await getConnection();
        await pool.request().input('UploadId', uploadId).query(`DELETE FROM ${TABLE_NAME} WHERE UploadId = @UploadId`);
    }
}

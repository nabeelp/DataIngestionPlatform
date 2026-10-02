import fs from 'fs';
import path from 'path';

const schema = (name: string): string => fs.readFileSync(path.join(__dirname, '..', 'database', name), 'utf8');

describe('clean-slate database schema', () => {
    it('stores rule configuration as JSON and exposes persisted computed listing columns', () => {
        const sql = schema('004_uploads.sql');
        expect(sql).toMatch(/Config NVARCHAR\(MAX\) NOT NULL/i);
        expect(sql).toMatch(/CHECK \(ISJSON\(Config\) = 1\)/i);
        for (const column of ['Name', 'RuleType', 'Severity', 'ExecutionOrder', 'TableName']) {
            expect(sql).toMatch(new RegExp(`${column} AS .*PERSISTED`, 'i'));
        }
        expect(sql).toMatch(/JSON_VALUE\(Config,/i);
    });

    it('stores FileDefinition versions as complete JSON contracts', () => {
        expect(schema('002_file_definitions.sql')).toMatch(/Contract NVARCHAR\(MAX\) NOT NULL/i);
        const sql = schema('005_file_definition_versions.sql');
        expect(sql).toMatch(/Contract NVARCHAR\(MAX\) NOT NULL/i);
        expect(sql).toMatch(/CHECK \(ISJSON\(Contract\) = 1\)/i);
    });

    it('stores blob metadata and omits local paths and validation job IDs', () => {
        const sql = schema('004_uploads.sql');
        const createUpload = sql.split('CREATE TABLE dbo.Uploads')[1]?.split('END;')[0] ?? '';
        for (const column of ['BlobContainer', 'BlobName', 'FileSha256', 'DetectedEncoding', 'ValidationDate', 'EngineVersion', 'ReportBlobName', 'ParquetPrefix']) {
            expect(createUpload).toContain(column);
        }
        expect(createUpload).not.toMatch(/TempLocalPath|ValidationJobId/);
        for (const table of ['ProcessingJobs', 'WorkerInstances', 'DeadLetterJobs', 'ValidationErrorBatches']) {
            expect(sql).toMatch(new RegExp(`DROP TABLE dbo\\.${table}`, 'i'));
        }
    });

    it('limits per-check results to the contracted statuses and structured issue fields', () => {
        const sql = schema('004_uploads.sql');
        expect(sql).toMatch(/Status IS NULL OR Status IN \(N'PASSED', N'WARNING', N'FAILED', N'ERROR'\)/);
        expect(sql).toMatch(/IssueCount BIGINT NOT NULL/);
        expect(sql).toMatch(/Issues NVARCHAR\(MAX\) NOT NULL/);
        expect(sql).toMatch(/ElapsedMs BIGINT NOT NULL/);
        expect(sql).toMatch(/Sheet NVARCHAR\(255\) NULL/);
    });

    it('applies scripts in fixed order and supports local and Entra authentication', () => {
        const sql = schema('apply.ps1');
        expect(sql.indexOf("'001_users.sql'")).toBeLessThan(sql.indexOf("'002_file_definitions.sql'"));
        expect(sql.indexOf("'002_file_definitions.sql'")).toBeLessThan(sql.indexOf("'003_lookups.sql'"));
        expect(sql.indexOf("'003_lookups.sql'")).toBeLessThan(sql.indexOf("'004_uploads.sql'"));
        expect(sql.indexOf("'004_uploads.sql'")).toBeLessThan(sql.indexOf("'005_file_definition_versions.sql'"));
        expect(sql.indexOf("'005_file_definition_versions.sql'")).toBeLessThan(sql.indexOf("'006_audit_logs.sql'"));
        expect(sql).toContain("'Local', 'Entra'");
        expect(sql).toContain('ActiveDirectoryDefault');
    });
});

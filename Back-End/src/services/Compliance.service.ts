// =============================================================================
// Compliance Service - operational control checks derived from platform data
// These are evidence indicators for reviewers, not a certification of regulatory compliance.
// =============================================================================

import { getConnection } from '../config/database';
import { RULE_CONFIG_TYPES } from '../contracts/rule-config-types';

export type ControlStatus = 'Pass' | 'Review' | 'Info';

export interface ComplianceControl {
    id: string;
    name: string;
    description: string;
    value: string;
    status: ControlStatus;
}

export interface DefinitionComplianceRow {
    id: string;
    name: string;
    status: string;
    enabledRules: number;
    assignedUsers: number;
    uploads: number;
    passed: number;
    failed: number;
    passRate: number | null;
}

export interface ComplianceReport {
    periodDays: number;
    from: string;
    generatedAt: string;
    controls: ComplianceControl[];
    definitions: DefinitionComplianceRow[];
}

const DORMANT_DAYS = 90;
const STALE_PROCESSING_HOURS = 1;
const PASS_RATE_TARGET = 90;

const percent = (numerator: number, denominator: number): number | null =>
    denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

export class ComplianceService {
    static async getReport(periodDays: number): Promise<ComplianceReport> {
        const days = Math.min(Math.max(Math.floor(periodDays) || 30, 1), 365);
        const now = new Date();
        const from = new Date(now.getTime() - days * 86400000);
        const dormantSince = new Date(now.getTime() - DORMANT_DAYS * 86400000);
        const staleSince = new Date(now.getTime() - STALE_PROCESSING_HOURS * 3600000);
        const supportedTypes = RULE_CONFIG_TYPES.map(type => `'${type}'`).join(', ');

        const pool = await getConnection();
        const bind = () => pool.request()
            .input('From', from)
            .input('DormantSince', dormantSince)
            .input('StaleSince', staleSince);

        const [definitionResult, uploadResult, staleResult, userResult, auditResult, legacyRuleResult] = await Promise.all([
            bind().query(`
                SELECT fd.Id AS id, fd.Name AS name, fd.Status AS status,
                    (SELECT COUNT(*) FROM Rules r WHERE r.FileDefinitionId = fd.Id AND r.IsEnabled = 1) AS enabledRules,
                    (SELECT COUNT(*) FROM FileDefinitionUserAccess a WHERE a.FileDefinitionId = fd.Id) AS assignedUsers,
                    (SELECT COUNT(*) FROM Uploads u WHERE u.FileDefinitionId = fd.Id AND u.UploadedAt >= @From) AS uploads,
                    (SELECT COUNT(*) FROM Uploads u WHERE u.FileDefinitionId = fd.Id AND u.UploadedAt >= @From
                        AND u.Status IN ('VALIDATION_PASSED', 'VALIDATED', 'DELIVERY_QUEUED', 'DELIVERY_IN_PROGRESS', 'DELIVERED', 'DELIVERY_FAILED')) AS passed,
                    (SELECT COUNT(*) FROM Uploads u WHERE u.FileDefinitionId = fd.Id AND u.UploadedAt >= @From
                        AND u.Status = 'VALIDATION_FAILED') AS failed
                FROM FileDefinitions fd
                ORDER BY fd.Name
            `),
            bind().query(`
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN Status = 'VALIDATION_FAILED' THEN 1 ELSE 0 END) AS validationFailed,
                    SUM(CASE WHEN Status = 'DELIVERY_FAILED' THEN 1 ELSE 0 END) AS deliveryFailed,
                    SUM(CASE WHEN Status IN ('VALIDATION_PASSED', 'VALIDATED', 'DELIVERY_QUEUED', 'DELIVERY_IN_PROGRESS', 'DELIVERED', 'DELIVERY_FAILED') THEN 1 ELSE 0 END) AS validationPassed
                FROM Uploads
                WHERE UploadedAt >= @From
            `),
            bind().query(`
                SELECT COUNT(*) AS stale FROM Uploads
                WHERE Status IN ('UPLOADED', 'VALIDATION_QUEUED', 'VALIDATION_IN_PROGRESS', 'DELIVERY_QUEUED', 'DELIVERY_IN_PROGRESS')
                  AND UploadedAt < @StaleSince
            `),
            bind().query(`
                SELECT
                    SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS activeUsers,
                    SUM(CASE WHEN IsActive = 1 AND Role = 'admin' THEN 1 ELSE 0 END) AS activeAdmins,
                    SUM(CASE WHEN IsActive = 1 AND (LastLoginAt IS NULL OR LastLoginAt < @DormantSince) THEN 1 ELSE 0 END) AS dormantUsers
                FROM Users
            `),
            bind().query(`SELECT COUNT(*) AS events FROM AuditLogs WHERE [Timestamp] >= @From`),
            bind().query(`SELECT COUNT(*) AS legacy FROM Rules WHERE RuleType NOT IN (${supportedTypes})`),
        ]);

        const definitions: DefinitionComplianceRow[] = definitionResult.recordset.map((row: any) => ({
            ...row,
            passRate: percent(row.passed, row.passed + row.failed),
        }));
        const activeDefinitions = definitions.filter(def => def.status === 'Active');
        const definitionsWithRules = activeDefinitions.filter(def => def.enabledRules > 0).length;
        const unassigned = activeDefinitions.filter(def => def.assignedUsers === 0).length;

        const uploads = uploadResult.recordset[0] || {};
        const finishedValidation = (uploads.validationPassed || 0) + (uploads.validationFailed || 0);
        const passRate = percent(uploads.validationPassed || 0, finishedValidation);
        const stale = staleResult.recordset[0]?.stale || 0;
        const users = userResult.recordset[0] || {};
        const auditEvents = auditResult.recordset[0]?.events || 0;
        const legacyRules = legacyRuleResult.recordset[0]?.legacy || 0;

        const controls: ComplianceControl[] = [
            {
                id: 'schema-enforcement',
                name: 'Schema enforcement',
                description: 'Every upload is checked against its file definition columns (required columns, required values, data types).',
                value: `${activeDefinitions.length} active definition(s) enforced`,
                status: 'Pass',
            },
            {
                id: 'rule-coverage',
                name: 'Business rule coverage',
                description: 'Active file definitions with at least one enabled validation rule.',
                value: activeDefinitions.length ? `${definitionsWithRules} of ${activeDefinitions.length}` : 'No active definitions',
                status: activeDefinitions.length === 0 || definitionsWithRules === activeDefinitions.length ? 'Pass' : 'Review',
            },
            {
                id: 'validation-pass-rate',
                name: 'Validation pass rate',
                description: `Share of uploads in the period that passed validation (target ${PASS_RATE_TARGET}%).`,
                value: passRate === null ? 'No completed uploads' : `${passRate}% of ${finishedValidation}`,
                status: passRate === null ? 'Info' : passRate >= PASS_RATE_TARGET ? 'Pass' : 'Review',
            },
            {
                id: 'failed-uploads',
                name: 'Failed uploads',
                description: 'Uploads in the period that failed validation or delivery and may need follow-up.',
                value: `${uploads.validationFailed || 0} validation, ${uploads.deliveryFailed || 0} delivery`,
                status: (uploads.validationFailed || 0) + (uploads.deliveryFailed || 0) > 0 ? 'Review' : 'Pass',
            },
            {
                id: 'stale-processing',
                name: 'Stalled processing',
                description: `Uploads still queued or processing more than ${STALE_PROCESSING_HOURS} hour(s) after upload.`,
                value: `${stale}`,
                status: stale > 0 ? 'Review' : 'Pass',
            },
            {
                id: 'dormant-accounts',
                name: 'Dormant accounts',
                description: `Active accounts with no sign-in for ${DORMANT_DAYS} days; review for access removal.`,
                value: `${users.dormantUsers || 0} of ${users.activeUsers || 0} active`,
                status: (users.dormantUsers || 0) > 0 ? 'Review' : 'Pass',
            },
            {
                id: 'admin-accounts',
                name: 'Administrator accounts',
                description: 'Active accounts with the admin role. Keep this to the minimum required.',
                value: `${users.activeAdmins || 0}`,
                status: 'Info',
            },
            {
                id: 'unassigned-definitions',
                name: 'Unassigned definitions',
                description: 'Active definitions with no users assigned.',
                value: `${unassigned}`,
                status: unassigned > 0 ? 'Review' : 'Pass',
            },
            {
                id: 'legacy-rules',
                name: 'Unsupported rules',
                description: 'Rules of retired types (Custom SQL, Regex Pattern) that are disabled and should be recreated.',
                value: `${legacyRules}`,
                status: legacyRules > 0 ? 'Review' : 'Pass',
            },
            {
                id: 'audit-trail',
                name: 'Audit trail activity',
                description: 'Audit log events recorded in the period.',
                value: `${auditEvents}`,
                status: auditEvents > 0 ? 'Pass' : 'Review',
            },
        ];

        return {
            periodDays: days,
            from: from.toISOString(),
            generatedAt: now.toISOString(),
            controls,
            definitions,
        };
    }
}

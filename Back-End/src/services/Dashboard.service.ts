// =============================================================================
// Dashboard Service - per-user upload statistics, trends, and global search
// Non-admin users only see uploads they made or that were shared with them.
// =============================================================================

import { getConnection } from '../config/database';
import { isUserAdmin } from '../utils/userUtils';

const SUCCESS_STATUSES = ['VALIDATION_PASSED', 'VALIDATED', 'DELIVERED'];
const FAILED_STATUSES = ['VALIDATION_FAILED', 'DELIVERY_FAILED'];
const IN_PROGRESS_STATUSES = ['UPLOADED', 'VALIDATION_QUEUED', 'VALIDATION_IN_PROGRESS', 'DELIVERY_QUEUED', 'DELIVERY_IN_PROGRESS'];

const sqlList = (values: string[]) => values.map(value => `'${value}'`).join(', ');

// Row-level scope for uploads (alias u). @IsAdmin and @UserId must be bound.
const UPLOAD_SCOPE = `(@IsAdmin = 1 OR u.UploadedBy = @UserId OR EXISTS (
    SELECT 1 FROM UploadAccess ua WHERE ua.UploadId = u.Id AND ua.UserId = @UserId))`;

export interface PeriodMetric {
    current: number;
    previous: number;
}

export interface UserDashboard {
    periodDays: number;
    from: string;
    to: string;
    kpis: {
        totalDefinitions: number;
        activeDefinitions: number;
        uploads: PeriodMetric;
        failedUploads: PeriodMetric;
        pendingUploads: number;
        avgProcessingSeconds: PeriodMetric;
    };
    activity: { date: string; uploads: number; failed: number }[];
    topDefinitions: { id: string; name: string; uploads: number; successRate: number | null }[];
    outcomes: { successful: number; failed: number; inProgress: number };
    recentTasks: {
        id: string;
        uploadId: string;
        filename: string;
        type: 'Validation' | 'Delivery';
        status: 'Completed' | 'Processing' | 'Failed' | 'Pending';
        startedAt: string | null;
        durationSeconds: number | null;
    }[];
}

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const secondsBetween = (start: Date | null, end: Date | null): number | null =>
    start && end ? Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)) : null;

export class DashboardService {
    static async getUserDashboard(userId: string, periodDays: number): Promise<UserDashboard> {
        const days = Math.min(Math.max(Math.floor(periodDays) || 7, 1), 90);
        const pool = await getConnection();
        const isAdmin = await isUserAdmin(userId);

        const now = new Date();
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const from = new Date(todayStart.getTime() - (days - 1) * 86400000);
        const previousFrom = new Date(from.getTime() - days * 86400000);

        const bind = () => pool.request()
            .input('UserId', userId)
            .input('IsAdmin', isAdmin ? 1 : 0)
            .input('From', from)
            .input('PreviousFrom', previousFrom);

        const [kpiResult, pendingResult, definitionResult, activityResult, topResult, outcomeResult, recentResult] = await Promise.all([
            bind().query(`
                SELECT
                    SUM(CASE WHEN u.UploadedAt >= @From THEN 1 ELSE 0 END) AS uploadsCurrent,
                    SUM(CASE WHEN u.UploadedAt < @From THEN 1 ELSE 0 END) AS uploadsPrevious,
                    SUM(CASE WHEN u.UploadedAt >= @From AND u.Status IN (${sqlList(FAILED_STATUSES)}) THEN 1 ELSE 0 END) AS failedCurrent,
                    SUM(CASE WHEN u.UploadedAt < @From AND u.Status IN (${sqlList(FAILED_STATUSES)}) THEN 1 ELSE 0 END) AS failedPrevious,
                    AVG(CASE WHEN u.UploadedAt >= @From AND u.ValidationCompletedAt IS NOT NULL
                        THEN CAST(DATEDIFF(SECOND, u.UploadedAt, COALESCE(u.DeliveryCompletedAt, u.ValidationCompletedAt)) AS FLOAT) END) AS avgCurrent,
                    AVG(CASE WHEN u.UploadedAt < @From AND u.ValidationCompletedAt IS NOT NULL
                        THEN CAST(DATEDIFF(SECOND, u.UploadedAt, COALESCE(u.DeliveryCompletedAt, u.ValidationCompletedAt)) AS FLOAT) END) AS avgPrevious
                FROM Uploads u
                WHERE u.UploadedAt >= @PreviousFrom AND ${UPLOAD_SCOPE}
            `),
            bind().query(`
                SELECT COUNT(*) AS pending FROM Uploads u
                WHERE u.Status IN (${sqlList(IN_PROGRESS_STATUSES)}) AND ${UPLOAD_SCOPE}
            `),
            bind().query(`
                SELECT COUNT(*) AS total, SUM(CASE WHEN fd.Status = 'Active' THEN 1 ELSE 0 END) AS active
                FROM FileDefinitions fd
                WHERE @IsAdmin = 1 OR EXISTS (
                    SELECT 1 FROM FileDefinitionUserAccess a WHERE a.FileDefinitionId = fd.Id AND a.UserId = @UserId)
            `),
            bind().query(`
                SELECT CAST(u.UploadedAt AS DATE) AS day,
                       COUNT(*) AS uploads,
                       SUM(CASE WHEN u.Status IN (${sqlList(FAILED_STATUSES)}) THEN 1 ELSE 0 END) AS failed
                FROM Uploads u
                WHERE u.UploadedAt >= @From AND ${UPLOAD_SCOPE}
                GROUP BY CAST(u.UploadedAt AS DATE)
            `),
            bind().query(`
                SELECT TOP 5 fd.Id AS id, fd.Name AS name, COUNT(*) AS uploads,
                       SUM(CASE WHEN u.Status IN (${sqlList(SUCCESS_STATUSES)}) THEN 1 ELSE 0 END) AS succeeded,
                       SUM(CASE WHEN u.Status IN (${sqlList([...SUCCESS_STATUSES, ...FAILED_STATUSES])}) THEN 1 ELSE 0 END) AS finished
                FROM Uploads u
                INNER JOIN FileDefinitions fd ON fd.Id = u.FileDefinitionId
                WHERE u.UploadedAt >= @From AND ${UPLOAD_SCOPE}
                GROUP BY fd.Id, fd.Name
                ORDER BY COUNT(*) DESC, fd.Name
            `),
            bind().query(`
                SELECT
                    SUM(CASE WHEN u.Status IN (${sqlList(SUCCESS_STATUSES)}) THEN 1 ELSE 0 END) AS successful,
                    SUM(CASE WHEN u.Status IN (${sqlList(FAILED_STATUSES)}) THEN 1 ELSE 0 END) AS failed,
                    SUM(CASE WHEN u.Status IN (${sqlList(IN_PROGRESS_STATUSES)}) THEN 1 ELSE 0 END) AS inProgress
                FROM Uploads u
                WHERE u.UploadedAt >= @From AND ${UPLOAD_SCOPE}
            `),
            bind().query(`
                SELECT TOP 5 u.Id, u.OriginalFilename, u.Status, u.UploadedAt, u.ValidationStartedAt,
                       u.ValidationCompletedAt, u.DeliveryStartedAt, u.DeliveryCompletedAt
                FROM Uploads u
                WHERE ${UPLOAD_SCOPE}
                ORDER BY u.UploadedAt DESC
            `),
        ]);

        const kpi = kpiResult.recordset[0] || {};
        const definitions = definitionResult.recordset[0] || {};
        const outcome = outcomeResult.recordset[0] || {};

        const activityByDay = new Map<string, { uploads: number; failed: number }>();
        for (const row of activityResult.recordset) {
            activityByDay.set(toIsoDate(new Date(row.day)), { uploads: row.uploads || 0, failed: row.failed || 0 });
        }
        const activity = Array.from({ length: days }, (_, index) => {
            const date = toIsoDate(new Date(from.getTime() + index * 86400000));
            return { date, ...(activityByDay.get(date) || { uploads: 0, failed: 0 }) };
        });

        const recentTasks: UserDashboard['recentTasks'] = [];
        for (const row of recentResult.recordset) {
            const status: string = row.Status;
            const validationStatus = status === 'VALIDATION_FAILED' ? 'Failed'
                : ['UPLOADED', 'VALIDATION_QUEUED'].includes(status) ? 'Pending'
                : status === 'VALIDATION_IN_PROGRESS' ? 'Processing'
                : 'Completed';
            recentTasks.push({
                id: `${row.Id}-validation`,
                uploadId: row.Id,
                filename: row.OriginalFilename,
                type: 'Validation',
                status: validationStatus,
                startedAt: row.ValidationStartedAt || row.UploadedAt,
                durationSeconds: secondsBetween(row.ValidationStartedAt || row.UploadedAt, row.ValidationCompletedAt),
            });

            if (row.DeliveryStartedAt || ['DELIVERY_QUEUED', 'DELIVERY_IN_PROGRESS', 'DELIVERED', 'DELIVERY_FAILED'].includes(status)) {
                recentTasks.push({
                    id: `${row.Id}-delivery`,
                    uploadId: row.Id,
                    filename: row.OriginalFilename,
                    type: 'Delivery',
                    status: status === 'DELIVERED' ? 'Completed' : status === 'DELIVERY_FAILED' ? 'Failed' : status === 'DELIVERY_QUEUED' ? 'Pending' : 'Processing',
                    startedAt: row.DeliveryStartedAt,
                    durationSeconds: secondsBetween(row.DeliveryStartedAt, row.DeliveryCompletedAt),
                });
            }
        }

        const round = (value: number | null | undefined) => (value === null || value === undefined ? 0 : Math.round(value));

        return {
            periodDays: days,
            from: from.toISOString(),
            to: now.toISOString(),
            kpis: {
                totalDefinitions: definitions.total || 0,
                activeDefinitions: definitions.active || 0,
                uploads: { current: kpi.uploadsCurrent || 0, previous: kpi.uploadsPrevious || 0 },
                failedUploads: { current: kpi.failedCurrent || 0, previous: kpi.failedPrevious || 0 },
                pendingUploads: pendingResult.recordset[0]?.pending || 0,
                avgProcessingSeconds: { current: round(kpi.avgCurrent), previous: round(kpi.avgPrevious) },
            },
            activity,
            topDefinitions: topResult.recordset.map((row: any) => ({
                id: row.id,
                name: row.name,
                uploads: row.uploads,
                successRate: row.finished > 0 ? Math.round((row.succeeded / row.finished) * 1000) / 10 : null,
            })),
            outcomes: {
                successful: outcome.successful || 0,
                failed: outcome.failed || 0,
                inProgress: outcome.inProgress || 0,
            },
            recentTasks: recentTasks.slice(0, 6),
        };
    }

    /**
     * Search definitions and uploads the user can access.
     */
    static async search(userId: string, term: string): Promise<{
        definitions: { id: string; name: string; description: string }[];
        uploads: { id: string; filename: string; status: string; uploadedAt: string }[];
    }> {
        const pool = await getConnection();
        const isAdmin = await isUserAdmin(userId);
        const like = `%${term.replace(/[[\]%_]/g, match => `[${match}]`)}%`;

        const bind = () => pool.request()
            .input('UserId', userId)
            .input('IsAdmin', isAdmin ? 1 : 0)
            .input('Term', like);

        const [definitionResult, uploadResult] = await Promise.all([
            bind().query(`
                SELECT TOP 5 fd.Id AS id, fd.Name AS name, fd.Description AS description
                FROM FileDefinitions fd
                WHERE (fd.Name LIKE @Term OR fd.Description LIKE @Term)
                  AND (@IsAdmin = 1 OR EXISTS (
                      SELECT 1 FROM FileDefinitionUserAccess a WHERE a.FileDefinitionId = fd.Id AND a.UserId = @UserId))
                ORDER BY fd.Name
            `),
            bind().query(`
                SELECT TOP 5 u.Id AS id, u.OriginalFilename AS filename, u.Status AS status, u.UploadedAt AS uploadedAt
                FROM Uploads u
                WHERE u.OriginalFilename LIKE @Term AND ${UPLOAD_SCOPE}
                ORDER BY u.UploadedAt DESC
            `),
        ]);

        return {
            definitions: definitionResult.recordset.map((row: any) => ({ ...row, description: row.description || '' })),
            uploads: uploadResult.recordset,
        };
    }
}

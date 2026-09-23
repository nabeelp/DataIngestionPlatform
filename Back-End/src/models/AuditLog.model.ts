// =============================================================================
// AuditLog Model - Database operations for AuditLogs table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { IAuditLog, ICreateAuditLogDto } from '../interfaces/auditLog.interface';

export class AuditLog {
    private static readonly TABLE_NAME = 'AuditLogs';

    /**
     * Create a new audit log entry
     */
    static async create(dto: ICreateAuditLogDto): Promise<IAuditLog> {
        const pool = await getConnection();
        const id = uuidv4();
        const now = new Date();

        await pool.request()
            .input('Id', id)
            .input('UserId', dto.UserId || null)
            .input('Action', dto.Action)
            .input('EntityType', dto.EntityType || null)
            .input('EntityId', dto.EntityId || null)
            .input('Details', JSON.stringify(dto.Details) || null)
            .input('IpAddress', dto.IpAddress || null)
            .input('UserAgent', dto.UserAgent || null)
            .input('Timestamp', now)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
                (Id, UserId, Action, EntityType, EntityId, Details, IpAddress, UserAgent, Timestamp)
                VALUES 
                (@Id, @UserId, @Action, @EntityType, @EntityId, @Details, @IpAddress, @UserAgent, @Timestamp)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Find audit log by ID
     */
    static async findById(id: string): Promise<IAuditLog | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Id = @Id`);

        if (!result.recordset[0]) {
            return null;
        }

        const log = result.recordset[0];
        // Parse Details JSON if it's a string
        if (log.Details && typeof log.Details === 'string') {
            log.Details = JSON.parse(log.Details);
        }
        return log;
    }

    /**
     * Get all audit logs with pagination and filters
     */
    static async findAll(options: {
        page?: number;
        pageSize?: number;
        userId?: string;
        action?: string;
        entityType?: string;
        startDate?: Date;
        endDate?: Date;
    } = {}): Promise<{ logs: IAuditLog[]; total: number }> {
        const pool = await getConnection();
        const { page = 1, pageSize = 50, userId, action, entityType, startDate, endDate } = options;
        const offset = (page - 1) * pageSize;

        let whereClauses: string[] = [];
        let request = pool.request();

        if (userId) {
            whereClauses.push('UserId = @UserId');
            request.input('UserId', userId);
        }
        if (action) {
            whereClauses.push('Action LIKE @Action');
            request.input('Action', `%${action}%`);
        }
        if (entityType) {
            whereClauses.push('EntityType = @EntityType');
            request.input('EntityType', entityType);
        }
        if (startDate) {
            whereClauses.push('Timestamp >= @StartDate');
            request.input('StartDate', startDate);
        }
        if (endDate) {
            whereClauses.push('Timestamp <= @EndDate');
            request.input('EndDate', endDate);
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const query = `
            SELECT * FROM ${this.TABLE_NAME} 
            ${whereClause}
            ORDER BY Timestamp DESC
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
        `;

        const countQuery = `
            SELECT COUNT(*) as total FROM ${this.TABLE_NAME} 
            ${whereClause}
        `;

        request.input('Offset', offset);
        request.input('PageSize', pageSize);

        const [logsResult, countResult] = await Promise.all([
            request.query(query),
            request.query(countQuery)
        ]);

        const logs = logsResult.recordset.map((row: any) => {
            if (row.Details && typeof row.Details === 'string') {
                row.Details = JSON.parse(row.Details);
            }
            return row;
        });

        return {
            logs,
            total: countResult.recordset[0]?.total || 0
        };
    }

    /**
     * Get audit logs for a specific user
     */
    static async findByUser(userId: string, limit: number = 50): Promise<IAuditLog[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('UserId', userId)
            .input('Limit', limit)
            .query(`
                SELECT TOP (@Limit) * FROM ${this.TABLE_NAME} 
                WHERE UserId = @UserId
                ORDER BY Timestamp DESC
            `);

        return result.recordset.map((row: any) => {
            if (row.Details && typeof row.Details === 'string') {
                row.Details = JSON.parse(row.Details);
            }
            return row;
        });
    }

    /**
     * Get audit logs by date range
     */
    static async findByDateRange(startDate: Date, endDate: Date, limit: number = 100): Promise<IAuditLog[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('StartDate', startDate)
            .input('EndDate', endDate)
            .input('Limit', limit)
            .query(`
                SELECT TOP (@Limit) * FROM ${this.TABLE_NAME} 
                WHERE Timestamp >= @StartDate AND Timestamp <= @EndDate
                ORDER BY Timestamp DESC
            `);

        return result.recordset.map((row: any) => {
            if (row.Details && typeof row.Details === 'string') {
                row.Details = JSON.parse(row.Details);
            }
            return row;
        });
    }

    /**
     * Get recent audit logs (for dashboard)
     */
    static async findRecent(limit: number = 20): Promise<IAuditLog[]> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Limit', limit)
            .query(`
                SELECT TOP (@Limit) * FROM ${this.TABLE_NAME} 
                ORDER BY Timestamp DESC
            `);

        return result.recordset.map((row: any) => {
            if (row.Details && typeof row.Details === 'string') {
                row.Details = JSON.parse(row.Details);
            }
            return row;
        });
    }

    /**
     * Get action counts by type (for statistics)
     */
    static async getActionCounts(days: number = 7): Promise<Record<string, number>> {
        const pool = await getConnection();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const result = await pool.request()
            .input('StartDate', startDate)
            .query(`
                SELECT Action, COUNT(*) as Count 
                FROM ${this.TABLE_NAME} 
                WHERE Timestamp >= @StartDate
                GROUP BY Action
            `);

        const counts: Record<string, number> = {};
        result.recordset.forEach((row: any) => {
            counts[row.Action] = row.Count;
        });
        return counts;
    }

    /**
     * Delete old audit logs (for cleanup)
     */
    static async deleteOlderThan(days: number): Promise<number> {
        const pool = await getConnection();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const result = await pool.request()
            .input('CutoffDate', cutoffDate)
            .query(`
                DELETE FROM ${this.TABLE_NAME} 
                WHERE Timestamp < @CutoffDate
            `);

        return result.rowsAffected[0];
    }
}

/**
 * Helper function to log an action
 */
export async function logAction(
    userId: string | null,
    action: string,
    entityType?: string,
    entityId?: string,
    details?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string
): Promise<IAuditLog> {
    return AuditLog.create({
        UserId: userId,
        Action: action,
        EntityType: entityType,
        EntityId: entityId,
        Details: details,
        IpAddress: ipAddress,
        UserAgent: userAgent
    });
}


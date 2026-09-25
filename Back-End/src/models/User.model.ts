// =============================================================================
// User Model - Database operations for Users table
// =============================================================================

import { getConnection } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import type { IUser, ICreateUserDto, UserRole, SsoProvider } from '../interfaces/user.interface';
import { logger } from '../utils/logger';

export class User {
    private static readonly TABLE_NAME = 'Users';

    /**
     * Find user by ID
     */
    static async findById(id: string): Promise<IUser | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Id = @Id`);
        
        return result.recordset[0] || null;
    }

    /**
     * Find user by email
     */
    static async findByEmail(email: string): Promise<IUser | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Email', email)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE Email = @Email`);
        logger.debug('finding user by email');
        logger.debug('[DB] Query result - rows:', result.recordset.length);
        return result.recordset[0] || null;
    }

    /**
     * Find user by SSO provider and subject ID
     */
    static async findBySso(ssoProvider: SsoProvider, ssoSubjectId: string): Promise<IUser | null> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('SsoProvider', ssoProvider)
            .input('SsoSubjectId', ssoSubjectId)
            .query(`SELECT * FROM ${this.TABLE_NAME} WHERE SsoProvider = @SsoProvider AND SsoSubjectId = @SsoSubjectId`);
        
        return result.recordset[0] || null;
    }

    /**
     * Create new user
     */
    static async create(userData: ICreateUserDto): Promise<IUser> {
        const pool = await getConnection();
        const id = uuidv4();
        const now = new Date();

        await pool.request()
            .input('Id', id)
            .input('Email', userData.Email)
            .input('Username', userData.Username)
            .input('PasswordHash', userData.Password || null)
            .input('FirstName', userData.FirstName || null)
            .input('LastName', userData.LastName || null)
            .input('Role', userData.Role || 'user')
            .input('SsoProvider', userData.SsoProvider || null)
            .input('SsoSubjectId', userData.SsoSubjectId || null)
            .input('IsPasswordAuthEnabled', userData.Password ? 1 : 0)
            .input('IsSsoAuthEnabled', userData.SsoProvider ? 1 : 0)
            .input('CreatedAt', now)
            .input('UpdatedAt', now)
            .query(`
                INSERT INTO ${this.TABLE_NAME} 
                (Id, Email, Username, PasswordHash, FirstName, LastName, Role, 
                 SsoProvider, SsoSubjectId, IsPasswordAuthEnabled, IsSsoAuthEnabled, CreatedAt, UpdatedAt)
                VALUES 
                (@Id, @Email, @Username, @PasswordHash, @FirstName, @LastName, @Role,
                 @SsoProvider, @SsoSubjectId, @IsPasswordAuthEnabled, @IsSsoAuthEnabled, @CreatedAt, @UpdatedAt)
            `);

        return (await this.findById(id))!;
    }

    /**
     * Update user
     */
    static async update(id: string, updates: Partial<IUser>): Promise<IUser | null> {
        const pool = await getConnection();
        const now = new Date();

        const setClauses: string[] = ['UpdatedAt = @UpdatedAt'];
        const request = pool.request()
            .input('Id', id)
            .input('UpdatedAt', now);

        if (updates.PasswordHash !== undefined) {
            setClauses.push('PasswordHash = @PasswordHash');
            request.input('PasswordHash', updates.PasswordHash);
        }
        if (updates.FirstName !== undefined) {
            setClauses.push('FirstName = @FirstName');
            request.input('FirstName', updates.FirstName);
        }
        if (updates.LastName !== undefined) {
            setClauses.push('LastName = @LastName');
            request.input('LastName', updates.LastName);
        }
        if (updates.Role !== undefined) {
            setClauses.push('Role = @Role');
            request.input('Role', updates.Role);
        }
        if (updates.IsActive !== undefined) {
            setClauses.push('IsActive = @IsActive');
            request.input('IsActive', updates.IsActive);
        }
        if (updates.LastLoginAt !== undefined) {
            setClauses.push('LastLoginAt = @LastLoginAt');
            request.input('LastLoginAt', updates.LastLoginAt);
        }
        if (updates.FailedLoginAttempts !== undefined) {
            setClauses.push('FailedLoginAttempts = @FailedLoginAttempts');
            request.input('FailedLoginAttempts', updates.FailedLoginAttempts);
        }
        if (updates.LockedUntil !== undefined) {
            setClauses.push('LockedUntil = @LockedUntil');
            request.input('LockedUntil', updates.LockedUntil);
        }

        await request.query(`
            UPDATE ${this.TABLE_NAME} 
            SET ${setClauses.join(', ')}
            WHERE Id = @Id
        `);

        return await this.findById(id);
    }

    /**
     * Update last login time
     */
    static async updateLastLogin(id: string): Promise<void> {
        const pool = await getConnection();
        await pool.request()
            .input('Id', id)
            .input('LastLoginAt', new Date())
            .input('FailedLoginAttempts', 0)
            .query(`
                UPDATE ${this.TABLE_NAME} 
                SET LastLoginAt = @LastLoginAt, FailedLoginAttempts = @FailedLoginAttempts
                WHERE Id = @Id
            `);
    }

    /**
     * Increment failed login attempts
     */
    static async incrementFailedAttempts(id: string): Promise<void> {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Id', id)
            .query(`
                UPDATE ${this.TABLE_NAME} 
                SET FailedLoginAttempts = FailedLoginAttempts + 1
                WHERE Id = @Id
            `);

        // Lock account after 5 failed attempts
        if (result.rowsAffected[0] > 0) {
            const user = await this.findById(id);
            if (user && user.FailedLoginAttempts >= 4) {
                const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
                await pool.request()
                    .input('Id', id)
                    .input('LockedUntil', lockUntil)
                    .query(`
                        UPDATE ${this.TABLE_NAME} 
                        SET LockedUntil = @LockedUntil
                        WHERE Id = @Id
                    `);
            }
        }
    }

    /**
     * Unlock user account
     */
    static async unlock(id: string): Promise<void> {
        const pool = await getConnection();
        await pool.request()
            .input('Id', id)
            .input('LockedUntil', null)
            .input('FailedLoginAttempts', 0)
            .query(`
                UPDATE ${this.TABLE_NAME} 
                SET LockedUntil = @LockedUntil, FailedLoginAttempts = @FailedLoginAttempts
                WHERE Id = @Id
            `);
    }

    /**
     * Bind an SSO identity to an account and enable SSO sign-in for it.
     */
    static async linkSso(id: string, ssoProvider: SsoProvider, ssoSubjectId: string): Promise<void> {
        const pool = await getConnection();
        await pool.request()
            .input('Id', id)
            .input('SsoProvider', ssoProvider)
            .input('SsoSubjectId', ssoSubjectId)
            .input('UpdatedAt', new Date())
            .query(`
                UPDATE ${this.TABLE_NAME}
                SET SsoProvider = @SsoProvider, SsoSubjectId = @SsoSubjectId, IsSsoAuthEnabled = 1, UpdatedAt = @UpdatedAt
                WHERE Id = @Id
            `);
    }

    /**
     * Find or create user from SSO
     */
    static async findOrCreateFromSso(
        ssoProvider: SsoProvider, 
        ssoSubjectId: string, 
        email: string,
        firstName?: string,
        lastName?: string
    ): Promise<IUser> {
        let user = await this.findBySso(ssoProvider, ssoSubjectId);
        
        if (!user) {
            // Check if user exists by email and link SSO
            user = email ? await this.findByEmail(email) : null;
            if (user) {
                // Link SSO to an existing account only if it is not already bound to another identity.
                if (user.SsoSubjectId && user.SsoSubjectId !== ssoSubjectId) {
                    throw new Error('This account is linked to a different SSO identity');
                }
                await this.linkSso(user.Id, ssoProvider, ssoSubjectId);
                user = await this.findById(user.Id);
            } else {
                // Create new user
                user = await this.create({
                    Email: email,
                    Username: email.split('@')[0],
                    SsoProvider: ssoProvider,
                    SsoSubjectId: ssoSubjectId,
                    FirstName: firstName,
                    LastName: lastName
                });
            }
        }
        
        return user!;
    }

    /**
     * Get all users (with pagination)
     */
static async findAll(page: number = 1, limit: number = 20, search: string = ''): Promise<{ users: IUser[], total: number }> {
        const pool = await getConnection();
        const offset = (page - 1) * limit;

        // Build query based on search
        let query = `
            SELECT Id, Email, Username, FirstName, LastName, Role, IsActive, 
                   FORMAT(CreatedAt, 'yyyy-MM-dd HH:mm:ss') as CreatedAt,
                   FORMAT(UpdatedAt, 'yyyy-MM-dd HH:mm:ss') as UpdatedAt,
                   LastLoginAt, FailedLoginAttempts, LockedUntil
            FROM ${this.TABLE_NAME}
        `;
        let countQuery = `SELECT COUNT(*) as Total FROM ${this.TABLE_NAME}`;

        const resultRequest = pool.request()
            .input('Offset', offset)
            .input('Limit', limit);

        const countRequest = pool.request();

        if (search.trim()) {
            query += ` WHERE (Email LIKE @Search OR Username LIKE @Search)`;
            resultRequest.input('Search', `%${search.trim()}%`);
            countQuery += ` WHERE Email LIKE @Search OR Username LIKE @Search`;
            countRequest.input('Search', `%${search.trim()}%`);
        }

        query += ` ORDER BY CreatedAt DESC OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY`;

const [result, countResult] = await Promise.all([
            resultRequest.query(query),
            countRequest.query(countQuery)
        ]);

        // Convert LockedUntil, LastLoginAt to string if not null for frontend compatibility
        const users = result.recordset.map((user: any) => ({
            ...user,
            LastLoginAt: user.LastLoginAt ? user.LastLoginAt.toISOString() : null,
            LockedUntil: user.LockedUntil ? user.LockedUntil.toISOString() : null
        })) as IUser[];


        return {
            users,
            total: countResult.recordset[0].Total as number
        };
    }


    /**
     * Delete user (soft delete - set IsActive = 0)
     */
    static async softDelete(id: string): Promise<void> {
        const pool = await getConnection();
        await pool.request()
            .input('Id', id)
            .input('IsActive', 0)
            .query(`UPDATE ${this.TABLE_NAME} SET IsActive = @IsActive WHERE Id = @Id`);
    }

    /**
     * Get count of active users (IsActive=1)
     * Index recommended: CREATE INDEX IX_Users_IsActive ON Users(IsActive);
     */
    static async getActiveCount(): Promise<number> {
        const pool = await getConnection();
        const result = await pool.request()
            .query(`SELECT COUNT(*) as count FROM ${this.TABLE_NAME} WHERE IsActive = 1`);
        return Number(result.recordset[0]?.count) || 0;
    }

    /**
     * Get approximate active sessions (users active in last N hours)
     * PROD NOTE: For true sessions, integrate with session store (Redis/mem)
     * Index: CREATE INDEX IX_Users_IsActive_LastLogin ON Users(IsActive, LastLoginAt DESC);
     */
    static async getActiveSessionsCount(hoursAgo: number = 1): Promise<number> {
        const pool = await getConnection();
        const since = new Date();
        since.setHours(since.getHours() - hoursAgo);
        
        const result = await pool.request()
            .input('Since', since)
            .query(`SELECT COUNT(DISTINCT Id) as count FROM ${this.TABLE_NAME} WHERE LastLoginAt >= @Since AND IsActive = 1`);
        return Number(result.recordset[0]?.count) || 0;
    }
}


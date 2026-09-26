// =============================================================================
// Admin Controller - Business logic for Admin Dashboard
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import * as bcrypt from 'bcryptjs';
import { User } from '../models/User.model';
import { Upload } from '../models/Upload.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { AuditLog } from '../models/AuditLog.model';
import { StatsService } from '../services/Stats.service';
import { UserService, type GetUsersResult } from '../services/User.service';
import { getConnection } from '../config/database';
import { logAction } from '../models/AuditLog.model';
import { getAllQueueStats, getStuckJobs } from '../services/Queue.service';
import { AUDIT_ACTIONS, ENTITY_TYPES } from '../interfaces/auditLog.interface';
import type { IUser, ICreateUserDto, UserRole } from '../interfaces/user.interface';
import type { IUpload, UploadStatus } from '../interfaces/upload.interface';
import { IJwtPayload } from '../interfaces/user.interface';
import { AdminStats } from '../interfaces/admin.interface';
import { FileDefinitionService } from '../services/FileDefinition.service';
import { DefinitionVersionService } from '../services/DefinitionVersion.service';
import { getTemplateDisplayName } from '../services/TemplateStorage.service';
import { normalizeDeliveryFolder } from '../services/DeliveryTargets.service';
import { COLUMN_TYPES, parseRuleExpression, sameSheet } from '../services/validation/ValidationEngine';
import { MAX_SHEET_NAME_LENGTH, ruleColumns } from '../services/validation/DefinitionContract';
import type { IColumn, ITable } from '../interfaces/fileDefinition.interface';
import { assertValidRule } from '../services/Rule.service';
import type { ICreateRuleDto, RuleSeverity, RuleType } from '../interfaces/rule.interface';
import { logger } from '../utils/logger';

// Extend Request to include user
export interface AuthRequest extends Request<Record<string, string>> {
    user?: IJwtPayload;
}

// ============================================================================
// Dashboard Stats
// ============================================================================

/**
 * Get dashboard statistics - Production ready with caching
 */
export const getStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const stats: AdminStats = await StatsService.getAdminStats();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting stats:', error);
        next(error);
    }
};

// ============================================================================
// User Management
// ============================================================================

/**
 * Get all users (paginated)
 */
export const getUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
const page = parseInt((req.query.page as string ?? '1')) || 1;
        const limit = parseInt((req.query.limit as string ?? '20')) || 20;
        const search = (req.query.search as string ?? '') || '';

const result: GetUsersResult = await UserService.getUsers(page, limit, search);

        // Log this action
        await logAction(
            req.user?.userId || null,
            'ADMIN_USER_LIST_VIEWED',
            ENTITY_TYPES.USER,
            undefined,
            { page, limit, search },
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.json({
            success: true,
            users: result.users,
            total: result.total,
            page: result.page,
            limit: result.limit
        });


    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting users:', error);
        next(error);
    }
};

/**
 * Get user by ID
 */
export const getUserById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        
        const user = await User.findById(id);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: {
                id: user.Id,
                email: user.Email,
                username: user.Username,
                firstName: user.FirstName,
                lastName: user.LastName,
                role: user.Role,
                isActive: user.IsActive,
                createdAt: user.CreatedAt,
                lastLoginAt: user.LastLoginAt,
                failedLoginAttempts: user.FailedLoginAttempts,
                lockedUntil: user.LockedUntil
            }
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting user:', error);
        next(error);
    }
};

/**
 * Create new user
 */
export const createUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { email, username, password, firstName, lastName, role } = req.body;

        // Check if user already exists
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user
        const user = await User.create({
            Email: email,
            Username: username,
            Password: passwordHash,
            FirstName: firstName,
            LastName: lastName,
            Role: role || 'user'
        });

        // Log this action
        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.USER_CREATED,
            ENTITY_TYPES.USER,
            user.Id,
            { email, username, role: role || 'user' },
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            user: {
                id: user.Id,
                email: user.Email,
                username: user.Username,
                firstName: user.FirstName,
                lastName: user.LastName,
                role: user.Role
            }
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error creating user:', error);
        next(error);
    }
};

/**
 * Update user
 */
export const updateUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, role, isActive } = req.body;

        const existingUser = await User.findById(id);
        
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const updates: Partial<IUser> = {};
        if (firstName !== undefined) updates.FirstName = firstName;
        if (lastName !== undefined) updates.LastName = lastName;
        if (role !== undefined) updates.Role = role;
        if (isActive !== undefined) updates.IsActive = isActive;

        const updatedUser = await User.update(id, updates);

        // Log this action
        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.USER_UPDATED,
            ENTITY_TYPES.USER,
            id,
            { updates },
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.json({
            success: true,
            message: 'User updated successfully',
            user: {
                id: updatedUser?.Id,
                email: updatedUser?.Email,
                username: updatedUser?.Username,
                firstName: updatedUser?.FirstName,
                lastName: updatedUser?.LastName,
                role: updatedUser?.Role,
                isActive: updatedUser?.IsActive
            }
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error updating user:', error);
        next(error);
    }
};

/**
 * Unlock user account
 */
export const unlockUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const existingUser = await User.findById(id);
        
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        await User.unlock(id);

        // Log this action
        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.USER_UNLOCKED,
            ENTITY_TYPES.USER,
            id,
            {},
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.json({
            success: true,
            message: 'User unlocked successfully'
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error unlocking user:', error);
        next(error);
    }
};

/**
 * Delete (soft delete) user
 */
export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        // Prevent deleting yourself
        if (id === req.user?.userId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete your own account'
            });
        }

        const existingUser = await User.findById(id);
        
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        await User.softDelete(id);

        // Log this action
        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.USER_DELETED,
            ENTITY_TYPES.USER,
            id,
            {},
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error deleting user:', error);
        next(error);
    }
};

// ============================================================================
// Audit Logs
// ============================================================================

/**
 * Get audit logs
 */
export const getAuditLogs = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const userId = req.query.userId as string;
        const action = req.query.action as string;
        const entityType = req.query.entityType as string;
        const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
        const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

        const result = await AuditLog.findAll({
            page,
            pageSize: limit,
            userId,
            action,
            entityType,
            startDate,
            endDate
        });

        res.json({
            success: true,
            logs: result.logs,
            total: result.total,
            page,
            limit
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting audit logs:', error);
        next(error);
    }
};

/**
 * Get recent audit logs (for dashboard)
 */
export const getRecentAuditLogs = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const limit = parseInt(req.query.limit as string) || 20;
        
        const logs = await AuditLog.findRecent(limit);

        res.json({
            success: true,
            logs
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting recent audit logs:', error);
        next(error);
    }
};

// ============================================================================
// Queue Monitoring
// ============================================================================

/**
 * Get queue statistics
 */
export const getQueueStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        let stats;
        
        try {
            stats = await getAllQueueStats();
        } catch (error) {
            logger.warn('[ADMIN_CONTROLLER] Failed to get queue stats:', error);
            stats = {
                validation: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                delivery: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                retry: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
            };
        }

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting queue stats:', error);
        next(error);
    }
};

/**
 * Get files currently being processed
 */
export const getProcessingFiles = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const pool = await getConnection();
        
        // Get files currently in validation or delivery
        const result = await pool.request()
            .query(`
                SELECT 
                    u.Id,
                    u.OriginalFilename,
                    u.Status,
                    u.UploadedAt,
                    u.ValidationStartedAt,
                    u.ValidationCompletedAt,
                    u.DeliveryStartedAt,
                    u.DeliveryCompletedAt,
                    u.ErrorMessage,
                    fd.Name as DefinitionName,
                    u.UploadedBy
                FROM Uploads u
                LEFT JOIN FileDefinitions fd ON u.FileDefinitionId = fd.Id
                WHERE u.Status IN (
                    'UPLOADED',
                    'VALIDATION_QUEUED',
                    'VALIDATION_IN_PROGRESS',
                    'VALIDATION_COMPLETED',
                    'DELIVERY_QUEUED',
                    'DELIVERY_IN_PROGRESS'
                )
                ORDER BY u.UploadedAt DESC
            `);

        // Calculate progress for each file
        const files = result.recordset.map((file: any) => {
            let progress = 0;
            let stage = 'pending';
            
            if (file.Status === 'VALIDATING') {
                stage = 'validating';
                // Estimate progress based on time elapsed (placeholder logic)
                const elapsed = file.ValidationStartedAt 
                    ? Date.now() - new Date(file.ValidationStartedAt).getTime()
                    : 0;
                progress = Math.min(50, Math.round(elapsed / 1000)); // Simplified progress
            } else if (file.Status === 'DELIVERING') {
                stage = 'delivering';
                const elapsed = file.DeliveryStartedAt 
                    ? Date.now() - new Date(file.DeliveryStartedAt).getTime()
                    : 0;
                progress = Math.min(100, 50 + Math.round(elapsed / 1000)); // Simplified progress
            } else if (file.Status === 'VALIDATION_COMPLETED') {
                stage = 'ready_for_delivery';
                progress = 75;
            } else if (file.Status === 'QUEUED') {
                stage = 'queued';
                progress = 10;
            }

            // Calculate processing time
            let processingTimeMs = 0;
            if (file.ValidationStartedAt) {
                const endTime = file.ValidationCompletedAt || new Date();
                processingTimeMs = new Date(endTime).getTime() - new Date(file.ValidationStartedAt).getTime();
            }

            return {
                ...file,
                progress,
                stage,
                processingTimeMs,
                processingTimeFormatted: formatProcessingTime(processingTimeMs)
            };
        });

        // Get stuck jobs
        let stuckJobs = { validationJobs: [] as any[], deliveryJobs: [] as any[] };
        try {
            stuckJobs = await getStuckJobs();
        } catch (error) {
            logger.warn('[ADMIN_CONTROLLER] Failed to get stuck jobs:', error);
        }

        res.json({
            success: true,
            files,
            stuckJobs
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting processing files:', error);
        next(error);
    }
};

// ============================================================================
// File Definitions Management (Admin view with full access)
// ============================================================================

/**
 * Get all file definitions (admin view)
 */
export const getFileDefinitions = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const definitions = await FileDefinitionService.getAllDefinitions();
        const versionStates = await DefinitionVersionService.getVersionStates(definitions);
        const camelCaseDefinitions = definitions.map((def: any) => ({
            ...mapFileDefinitionToCamelCase(def),
            activeVersion: versionStates.get(def.Id)?.activeVersion ?? null,
            hasUnpublishedChanges: versionStates.get(def.Id)?.hasUnpublishedChanges ?? true,
        }));

        res.json({
            success: true,
            definitions: camelCaseDefinitions,
            total: camelCaseDefinitions.length
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error getting file definitions:', error);
        next(error);
    }
};

/**
 * Create file definition
 */
export const createFileDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { name, description, columns, tables, status, deliveryFolder, rules } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Name is required'
            });
        }

        let normalizedDeliveryFolder: string | null;
        let layout: DefinitionLayout;
        let initialRules: InitialRule[];
        try {
            layout = validateDefinitionLayout(columns, tables);
            normalizedDeliveryFolder = normalizeDeliveryFolder(deliveryFolder);
            initialRules = validateInitialRules(rules, layout);
        } catch (validationError) {
            return res.status(400).json({ success: false, message: (validationError as Error).message });
        }

        const dto = {
            Name: name,
            Description: description || '',
            Columns: layout.columns,
            Tables: layout.tables,
            Status: status || 'Active',
            DeliveryFolder: normalizedDeliveryFolder
        };

        const definition = await FileDefinitionService.createDefinition(dto, req.user!.userId, initialRules);

        // Log this action
        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.DEFINITION_CREATED,
            ENTITY_TYPES.FILE_DEFINITION,
            definition.Id,
            { name, description, sheetTables: layout.tables.length, initialRules: initialRules.length },
            req.ip || undefined,
            req.headers['user-agent']
        );

        const camelCaseDefinition = mapFileDefinitionToCamelCase(definition);
        res.status(201).json({
            success: true,
            definition: camelCaseDefinition,
            message: 'File definition created successfully'
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error creating file definition:', error);
        next(error);
    }
};

/**
 * Update file definition
 */
export const updateFileDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { name, description, columns, tables, status, deliveryFolder } = req.body;

        const updates: any = {};
        try {
            // Tables decide the layout: sending them (even empty) sets it; sending only columns keeps the current one.
            if (tables !== undefined) {
                const layout = validateDefinitionLayout(columns, tables);
                updates.Columns = layout.columns;
                updates.Tables = layout.tables;
            } else if (columns !== undefined) {
                validateDefinitionColumns(columns);
                updates.Columns = columns;
            }
            if (deliveryFolder !== undefined) updates.DeliveryFolder = normalizeDeliveryFolder(deliveryFolder);
        } catch (validationError) {
            return res.status(400).json({ success: false, message: (validationError as Error).message });
        }
        if (name !== undefined) updates.Name = name;
        if (description !== undefined) updates.Description = description;
        if (status !== undefined) updates.Status = status;

        const definition = await FileDefinitionService.updateDefinition(id, updates);

        // Log this action
        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.DEFINITION_UPDATED,
            ENTITY_TYPES.FILE_DEFINITION,
            id,
            { updates },
            req.ip || undefined,
            req.headers['user-agent']
        );

        const camelCaseDefinition = mapFileDefinitionToCamelCase(definition);
        res.json({
            success: true,
            definition: camelCaseDefinition,
            message: 'File definition updated successfully'
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error updating file definition:', error);
        next(error);
    }
};


/**
 * Delete file definition
 */
export const deleteFileDefinition = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const existing = await FileDefinition.findById(id);
        
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'File definition not found'
            });
        }

        await FileDefinitionService.deleteDefinition(id);

        // Log this action
        await logAction(
            req.user?.userId || null,
            AUDIT_ACTIONS.DEFINITION_DELETED,
            ENTITY_TYPES.FILE_DEFINITION,
            id,
            { name: existing.Name },
            req.ip || undefined,
            req.headers['user-agent']
        );

        res.json({
            success: true,
            message: 'File definition deleted successfully'
        });
    } catch (error) {
        logger.error('[ADMIN_CONTROLLER] Error deleting file definition:', error);
        next(error);
    }
};


// ============================================================================
// Helper Functions
// ============================================================================

function formatProcessingTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

/**
 * Map FileDefinition from DB PascalCase to frontend camelCase
 */
interface MappedFileDefinition {
    id: string;
    name: string;
    description: string;
    columns: any[];
    tables: ITable[];
    status: string;
    createdAt: string;
    updatedAt: string;
    allowedUsers: any[];
    templateFilename: string | null;
    deliveryFolder: string | null;
}

/**
 * Validate file definition columns: non-empty unique names and supported types.
 */
function validateDefinitionColumns(columns: unknown, context = ''): void {
    const where = context ? ` in ${context}` : '';
    if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error(`At least one column is required${where}`);
    }
    const seen = new Set<string>();
    for (const column of columns) {
        const name = typeof column?.name === 'string' ? column.name.trim() : '';
        if (!name) throw new Error(`Every column needs a name${where}`);
        if (seen.has(name)) throw new Error(`Duplicate column name "${name}"${where}`);
        seen.add(name);
        if (!(COLUMN_TYPES as readonly string[]).includes(column.type)) {
            throw new Error(`Column "${name}"${where} has unsupported type "${column.type}". Use: ${COLUMN_TYPES.join(', ')}`);
        }
    }
}

interface DefinitionLayout {
    columns: IColumn[];
    tables: ITable[];
}

const MAX_SHEET_TABLES = 50;
// Characters Excel does not allow in sheet names.
const INVALID_SHEET_NAME = /[[\]:*?/\\]/;

/**
 * Validate a definition's layout: either single-table `columns`, or (when `tables` is non-empty) one table per
 * workbook sheet with a unique sheet name and its own columns.
 */
function validateDefinitionLayout(columns: unknown, tables: unknown): DefinitionLayout {
    if (tables === undefined || tables === null || (Array.isArray(tables) && tables.length === 0)) {
        validateDefinitionColumns(columns);
        return { columns: columns as IColumn[], tables: [] };
    }
    if (!Array.isArray(tables)) throw new Error('Tables must be an array');
    if (tables.length > MAX_SHEET_TABLES) throw new Error(`At most ${MAX_SHEET_TABLES} sheet tables are supported`);

    const seen = new Set<string>();
    const normalized = tables.map((table, index) => {
        const sheet = typeof table?.sheet === 'string' ? table.sheet.trim() : '';
        if (!sheet) throw new Error(`Sheet table ${index + 1} needs a sheet name`);
        if (sheet.length > MAX_SHEET_NAME_LENGTH) throw new Error(`Sheet name "${sheet}" is longer than ${MAX_SHEET_NAME_LENGTH} characters`);
        if (INVALID_SHEET_NAME.test(sheet)) throw new Error(`Sheet name "${sheet}" cannot contain [ ] : * ? / \\`);
        if (seen.has(sheet.toLowerCase())) throw new Error(`Sheet "${sheet}" is defined more than once`);
        seen.add(sheet.toLowerCase());
        validateDefinitionColumns(table.columns, `sheet "${sheet}"`);
        return { sheet, columns: table.columns as IColumn[] };
    });
    return { columns: [], tables: normalized };
}

type InitialRule = Omit<ICreateRuleDto, 'FileDefinitionId'>;

const MAX_INITIAL_RULES = 50;

/**
 * Validate the optional rules created together with a new definition (for example accepted suggestions from
 * an example file): supported type, valid expression, the sheet table (for sheet-table definitions), and every
 * referenced column defined in that table.
 */
function validateInitialRules(rules: unknown, layout: DefinitionLayout): InitialRule[] {
    if (rules === undefined || rules === null) return [];
    if (!Array.isArray(rules)) throw new Error('Rules must be an array');
    if (rules.length > MAX_INITIAL_RULES) throw new Error(`At most ${MAX_INITIAL_RULES} rules can be created with a definition`);

    return rules.map((rule, index) => {
        const name = typeof rule?.name === 'string' ? rule.name.trim() : '';
        if (!name || name.length > 255) throw new Error(`Rule ${index + 1} needs a name of at most 255 characters`);
        const severity = rule.severity ?? 'Error';
        if (severity !== 'Error' && severity !== 'Warning') throw new Error(`Rule "${name}" severity must be Error or Warning`);

        const expression = typeof rule.expression === 'string' ? rule.expression.trim() : '';
        try {
            assertValidRule(rule.ruleType, expression);
        } catch (error) {
            throw new Error(`Rule "${name}": ${(error as Error).message}`);
        }

        const tableName = typeof rule.table === 'string' && rule.table.trim() ? rule.table.trim() : null;
        let columns: IColumn[] = layout.columns;
        let where = 'the definition';
        if (layout.tables.length > 0) {
            const table = tableName ? layout.tables.find(t => sameSheet(t.sheet, tableName)) : undefined;
            if (!tableName) throw new Error(`Rule "${name}" must name the sheet table it applies to`);
            if (!table) throw new Error(`Rule "${name}" is for sheet "${tableName}", which is not defined`);
            columns = table.columns;
            where = `sheet "${table.sheet}"`;
        } else if (tableName) {
            throw new Error(`Rule "${name}" is for sheet "${tableName}", but this definition has a single table`);
        }

        const columnNames = new Set(columns.map(column => column.name.trim()));
        const missing = ruleColumns(parseRuleExpression(rule.ruleType, expression)).find(column => !columnNames.has(column));
        if (missing) throw new Error(`Rule "${name}" refers to column "${missing}", which is not in ${where}`);

        return {
            Name: name,
            Description: typeof rule.description === 'string' ? rule.description.slice(0, 1000) : '',
            RuleType: rule.ruleType as RuleType,
            Severity: severity as RuleSeverity,
            SqlQuery: expression,
            TableName: tableName,
        };
    });
}

function mapFileDefinitionToCamelCase(def: any): MappedFileDefinition {
    return {
        id: def.Id,
        name: def.Name,
        description: def.Description || '',
        columns: def.Columns || [],
        tables: Array.isArray(def.Tables) ? def.Tables : [],
        status: def.Status || 'Active',
        createdAt: def.CreatedAt,
        updatedAt: def.UpdatedAt,
        allowedUsers: def.AllowedUsers || [],
        templateFilename: def.TemplateFilename ? getTemplateDisplayName(def.TemplateFilename) : null,
        deliveryFolder: def.DeliveryFolder || null
    };
}

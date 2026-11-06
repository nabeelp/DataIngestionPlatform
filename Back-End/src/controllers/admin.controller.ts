// =============================================================================
// Admin Controller - Business logic for Admin Dashboard
// =============================================================================

import { hashPassword } from '../utils/password';
import { User } from '../models/User.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { AuditLog } from '../models/AuditLog.model';
import { StatsService } from '../services/Stats.service';
import { UserService, type GetUsersResult } from '../services/User.service';
import { logAction } from '../models/AuditLog.model';
import { AUDIT_ACTIONS, ENTITY_TYPES } from '../interfaces/auditLog.interface';
import type { IUser } from '../interfaces/user.interface';
import { AdminStats } from '../interfaces/admin.interface';
import { FileDefinitionService } from '../services/FileDefinition.service';
import { DefinitionVersionError, DefinitionVersionService } from '../services/DefinitionVersion.service';
import {
    buildAuthoringContract,
    getDraftRevision,
    saveDraftRules,
    type SavedRules,
} from '../services/RuleAuthoring.service';
import { getConnection } from '../config/database';
import { getTemplateDisplayName } from '../services/TemplateStorage.service';
import { normalizeDeliveryFolder } from '../services/DeliveryTargets.service';
import { COLUMN_TYPES, MAX_SHEET_NAME_LENGTH } from '../services/validation/DefinitionContract';
import { v4 as uuidv4 } from 'uuid';
import type { IColumn, IFileDefinition, IFileDefinitionUser, ITable, IUpdateFileDefinitionDto } from '../interfaces/fileDefinition.interface';
import type { ICreateRuleDto, RuleType } from '../interfaces/rule.interface';
import type { RuleConfig } from '../contracts/rule-config';
import type { DefinitionContract } from '../contracts/definition-contract';
import { contractFromLegacyColumns, parseRuleConfig } from '../models/contractMapper';
import { RulesService, RulesServiceError } from '../services/RulesService.service';
import { asyncHandler } from '../middleware/asyncHandler';
import { BadRequestError, NotFoundError } from '../utils/httpError';

// ============================================================================
// Dashboard Stats
// ============================================================================

/**
 * Get dashboard statistics - Production ready with caching
 */
export const getStats = asyncHandler(async (_req, res) => {
    const stats: AdminStats = await StatsService.getAdminStats();

    res.json({
        success: true,
        stats
    });
});

// ============================================================================
// User Management
// ============================================================================

/**
 * Get all users (paginated)
 */
export const getUsers = asyncHandler(async (req, res) => {
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
});

/**
 * Create new user
 */
export const createUser = asyncHandler(async (req, res) => {
    const { email, username, password, firstName, lastName, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
        throw new BadRequestError('User with this email already exists');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

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
});

/**
 * Update user
 */
export const updateUser = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, role, isActive } = req.body;

    const existingUser = await User.findById(id);

    if (!existingUser) {
        throw new NotFoundError('User not found');
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
});

/**
 * Unlock user account
 */
export const unlockUser = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;

    const existingUser = await User.findById(id);

    if (!existingUser) {
        throw new NotFoundError('User not found');
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
});

/**
 * Delete (soft delete) user
 */
export const deleteUser = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.user?.userId) {
        throw new BadRequestError('You cannot delete your own account');
    }

    const existingUser = await User.findById(id);

    if (!existingUser) {
        throw new NotFoundError('User not found');
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
});

// ============================================================================
// Audit Logs
// ============================================================================

/**
 * Get audit logs
 */
export const getAuditLogs = asyncHandler(async (req, res) => {
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
});

// ============================================================================
// Queue Monitoring
// ============================================================================

/**
 * Get queue statistics
 */
export const getQueueStats = asyncHandler(async (_req, res) => {
    const { stats, recentUploadThroughput } = await StatsService.getQueueMonitoring();
    res.json({
        success: true,
        stats,
        recentUploadThroughput,
    });
});

// ============================================================================
// File Definitions Management (Admin view with full access)
// ============================================================================

/**
 * Get all file definitions (admin view)
 */
export const getFileDefinitions = asyncHandler(async (_req, res) => {
    const definitions = await FileDefinitionService.getAllDefinitions();
    const versionStates = await DefinitionVersionService.getVersionStates(definitions);
    const camelCaseDefinitions = definitions.map(def => ({
        ...mapFileDefinitionToCamelCase(def),
        activeVersion: versionStates.get(def.Id)?.activeVersion ?? null,
        hasUnpublishedChanges: versionStates.get(def.Id)?.hasUnpublishedChanges ?? true,
    }));

    res.json({
        success: true,
        definitions: camelCaseDefinitions,
        total: camelCaseDefinitions.length
    });
});

/**
 * Create file definition
 */
export const createFileDefinition = asyncHandler(async (req, res) => {
    const { name, description, columns, tables, status, deliveryFolder, rules, contract: submittedContract } = req.body;

    if (!name) {
        throw new BadRequestError('Name is required');
    }

    let normalizedDeliveryFolder: string | null;
    let layout: DefinitionLayout;
    let initialRules: InitialRule[];
    let baseContract: DefinitionContract;
    try {
        if (submittedContract) {
            baseContract = submittedContract as DefinitionContract;
            await validateDefinitionContract(baseContract);
            layout = validateDefinitionLayout(...legacyLayoutArguments(baseContract));
        } else {
            layout = validateDefinitionLayout(columns, tables);
            baseContract = contractFromLegacyColumns(layout.columns, layout.tables);
        }
        normalizedDeliveryFolder = normalizeDeliveryFolder(deliveryFolder);
        const configs = [
            ...(Array.isArray(baseContract.rules) ? baseContract.rules : []),
            ...normalizeInitialRuleConfigs(rules),
        ];
        baseContract = { ...baseContract, rules: [] };
        initialRules = await validateInitialRules(configs, baseContract);
    } catch (validationError) {
        throw toValidationFailure(validationError);
    }

    const dto = {
        Name: name,
        Description: description || '',
        Columns: layout.columns,
        Tables: layout.tables,
        Contract: baseContract,
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
});

/**
 * Update file definition
 */
export const updateFileDefinition = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;
    const { name, description, columns, tables, status, deliveryFolder, contract: submittedContract, rules: submittedRules, revision } = req.body;

    const updates: DefinitionUpdates = {};
    let draftRules: RuleConfig[] | undefined;
    try {
        if (submittedContract) {
            const contract = { ...(submittedContract as DefinitionContract), rules: [] };
            if (Array.isArray(submittedRules)) {
                // The workspace saves its whole draft: structure and rules must be valid together before anything is written.
                const authored = await buildAuthoringContract(submittedContract, submittedRules);
                await validateDefinitionContract(authored);
                draftRules = authored.rules;
            } else {
                await validateDefinitionContract(contract);
            }
            const layout = validateDefinitionLayout(...legacyLayoutArguments(contract));
            updates.Columns = layout.columns;
            updates.Tables = layout.tables;
            updates.Contract = contract;
        } else if (submittedRules !== undefined) {
            throw new Error('Rules can only be saved together with the definition contract');
        } else if (tables !== undefined) {
            // Tables decide the layout: sending them (even empty) sets it; sending only columns keeps the current one.
            const layout = validateDefinitionLayout(columns, tables);
            updates.Columns = layout.columns;
            updates.Tables = layout.tables;
        } else if (columns !== undefined) {
            validateDefinitionColumns(columns);
            updates.Columns = columns;
        }
        if (deliveryFolder !== undefined) updates.DeliveryFolder = normalizeDeliveryFolder(deliveryFolder);
    } catch (validationError) {
        throw toValidationFailure(validationError);
    }
    if (name !== undefined) updates.Name = name;
    if (description !== undefined) updates.Description = description;
    if (status !== undefined) updates.Status = status;

    let ruleChanges: SavedRules | undefined;
    if (draftRules) {
        ruleChanges = await saveDraftRules(id, draftRules, req.user!.userId, typeof revision === 'string' ? revision : null);
    } else if (typeof revision === 'string' && await getDraftRevision(await getConnection(), id) !== revision) {
        throw new DefinitionVersionError(
            'This definition was changed by someone else after you opened it. Reload it to see their changes before saving.', 409);
    }

    const definition = await FileDefinitionService.updateDefinition(id, updates);

    // Log this action
    await logAction(
        req.user?.userId || null,
        AUDIT_ACTIONS.DEFINITION_UPDATED,
        ENTITY_TYPES.FILE_DEFINITION,
        id,
        {
            updates,
            ...(ruleChanges ? {
                ruleChanges: {
                    added: ruleChanges.added.length,
                    updated: ruleChanges.updated.length,
                    removed: ruleChanges.removed.length,
                },
            } : {}),
        },
        req.ip || undefined,
        req.headers['user-agent']
    );

    const camelCaseDefinition = mapFileDefinitionToCamelCase(definition);
    res.json({
        success: true,
        definition: camelCaseDefinition,
        revision: await getDraftRevision(await getConnection(), id),
        message: 'File definition updated successfully'
    });
});

/**
 * Check a definition draft held by the workspace without saving it: contract and rule validation errors plus what
 * publishing it would change relative to the active version.
 * POST /api/admin/file-definitions/preflight
 */
export const preflightFileDefinition = asyncHandler(async (req, res) => {
    const { contract, rules, definitionId } = req.body;
    // AuthoringInputError is an HttpError (400), so a malformed draft is reported by the central error handler.
    const authored: DefinitionContract = await buildAuthoringContract(contract, rules);
    const validation = await RulesService.validateContract(authored);
    let diff = null;
    if (typeof definitionId === 'string' && validation.ok) {
        try {
            diff = await DefinitionVersionService.previewDiff(definitionId, authored);
        } catch (diffError) {
            if (!(diffError instanceof DefinitionVersionError)) throw diffError;
        }
    }
    res.json({ success: true, ok: validation.ok, errors: validation.errors, diff });
});


/**
 * Delete file definition
 */
export const deleteFileDefinition = asyncHandler<Record<string, string>>(async (req, res) => {
    const { id } = req.params;

    const existing = await FileDefinition.findById(id);

    if (!existing) {
        throw new NotFoundError('File definition not found');
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
});


// ============================================================================
// Helper Functions
// ============================================================================

type DefinitionUpdates = IUpdateFileDefinitionDto;

/**
 * Failure for a rejected definition draft: rules-service errors keep their own status, anything else is a 400.
 */
function toValidationFailure(error: unknown): Error {
    if (error instanceof RulesServiceError) return error;
    return new BadRequestError(error instanceof Error ? error.message : 'Invalid definition');
}

/**
 * Map FileDefinition from DB PascalCase to frontend camelCase
 */
interface MappedFileDefinition {
    id: string;
    name: string;
    description: string;
    columns: IColumn[];
    tables: ITable[];
    status: string;
    createdAt: Date;
    updatedAt: Date;
    allowedUsers: IFileDefinitionUser[];
    templateFilename: string | null;
    deliveryFolder: string | null;
    contract: DefinitionContract | null;
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

function legacyLayoutArguments(contract: DefinitionContract): [unknown, unknown] {
    if (contract.layout === 'single' && contract.tables.length !== 1) {
        throw new Error('A single-table contract must contain exactly one table');
    }
    if (contract.layout === 'sheets' && contract.tables.some(table => !table.sheet)) {
        throw new Error('Every table in a sheet-table contract needs a sheet name');
    }

    const toColumns = (columns: DefinitionContract['tables'][number]['columns']): IColumn[] =>
        columns.map(column => ({
            name: column.name,
            type: column.type === 'date' ? 'datetime' : column.type,
            required: column.mustExist && !column.nullable,
        }));

    if (contract.layout === 'single') {
        return [toColumns(contract.tables[0].columns), []];
    }
    return [
        [],
        contract.tables.map(table => {
            if (!table.sheet) throw new Error('Every table in a sheet-table contract needs a sheet name');
            return { sheet: table.sheet, columns: toColumns(table.columns) };
        }),
    ];
}

type InitialRule = Omit<ICreateRuleDto, 'FileDefinitionId'>;

const MAX_INITIAL_RULES = 50;

const ruleTypeLabels: Record<RuleConfig['type'], RuleType> = {
    enum: 'Enum Check',
    range: 'Range Check',
    pattern: 'Schema Validation',
    length: 'Schema Validation',
    unique: 'Schema Validation',
    lookup: 'Schema Validation',
    dateRange: 'Schema Validation',
    conditionalRequired: 'Schema Validation',
    compare: 'Schema Validation',
    rowCount: 'Schema Validation',
    aggregate: 'Schema Validation',
    reconcile: 'Schema Validation',
    naturalLanguage: 'Natural Language',
};

const legacyRuleTypes: Record<string, RuleConfig['type']> = {
    'enum check': 'enum',
    'range check': 'range',
};

function normalizeInitialRuleConfigs(value: unknown): RuleConfig[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('Rules must be an array');

    return value.map((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new Error(`Rule ${index + 1} must be a RuleConfig or supported example suggestion`);
        }
        const rule = candidate as Record<string, unknown>;
        if (typeof rule.type === 'string' && rule.params && typeof rule.params === 'object' && !Array.isArray(rule.params)) {
            return parseRuleConfig(rule);
        }

        const ruleType = typeof rule.ruleType === 'string' ? legacyRuleTypes[rule.ruleType.trim().toLowerCase()] : undefined;
        const expression = typeof rule.expression === 'string' ? rule.expression : '';
        const separator = expression.indexOf(':');
        if (!ruleType) {
            throw new Error(`Rule ${index + 1}: Rule type must be one of the supported RuleConfig types or example suggestions`);
        }
        if (separator < 1) {
            throw new Error(`Rule ${index + 1} is not a supported typed rule or example suggestion`);
        }
        if (typeof rule.name !== 'string' || !rule.name.trim()) throw new Error(`Rule ${index + 1} needs a name`);
        if (rule.severity !== undefined && rule.severity !== 'Error' && rule.severity !== 'Warning') {
            throw new Error(`Rule ${index + 1} has an unsupported severity`);
        }
        if (rule.table !== undefined && rule.table !== null && typeof rule.table !== 'string') {
            throw new Error(`Rule ${index + 1} has an invalid table name`);
        }
        if (rule.executionOrder !== undefined &&
            (typeof rule.executionOrder !== 'number' || !Number.isInteger(rule.executionOrder) || rule.executionOrder < 1)) {
            throw new Error(`Rule ${index + 1} has an invalid execution order`);
        }
        const column = expression.slice(0, separator).trim();
        const valueText = expression.slice(separator + 1).trim();
        if (!column || !valueText) throw new Error(`Rule ${index + 1} needs a column and rule value`);

        let params: Record<string, unknown>;
        if (ruleType === 'enum') {
            const values = valueText.split(',').map(item => item.trim()).filter(Boolean);
            if (values.length === 0) throw new Error(`Rule ${index + 1} needs at least one allowed value`);
            params = { column, values };
        } else if (ruleType === 'range') {
            const match = valueText.match(/^(-?(?:\d+\.?\d*|\.\d+))\s*\.\.\s*(-?(?:\d+\.?\d*|\.\d+))$/);
            if (!match) throw new Error(`Rule ${index + 1} needs numeric range bounds in min..max format`);
            params = { column, min: Number(match[1]), max: Number(match[2]) };
        } else {
            throw new Error(`Rule ${index + 1} is not a supported typed rule or example suggestion`);
        }

        const severity = rule.severity === 'Warning' ? 'Warning' : 'Error';
        const table = typeof rule.table === 'string' && rule.table.trim() ? rule.table.trim() : null;
        return parseRuleConfig({
            id: uuidv4(),
            name: typeof rule.name === 'string' && rule.name.trim() ? rule.name.trim() : `Suggested rule ${index + 1}`,
            description: typeof rule.description === 'string' ? rule.description : '',
            severity,
            executionOrder: typeof rule.executionOrder === 'number' ? rule.executionOrder : index + 1,
            enabled: true,
            table,
            type: ruleType,
            params,
        });
    });
}

async function validateDefinitionContract(contract: DefinitionContract): Promise<void> {
    const validation = await RulesService.validateContract(contract);
    if (!validation.ok) {
        throw new Error(validation.errors.map(error => `${error.path}: ${error.message}`).join('; '));
    }
}

/**
 * Validate optional initial RuleConfig values with the Python contract validator.
 */
async function validateInitialRules(configs: RuleConfig[], baseContract: DefinitionContract): Promise<InitialRule[]> {
    if (configs.length > MAX_INITIAL_RULES) throw new Error(`At most ${MAX_INITIAL_RULES} rules can be created with a definition`);
    const contract: DefinitionContract = { ...baseContract, rules: configs };
    await validateDefinitionContract(contract);

    return configs.map(config => ({
        Config: config,
        Name: config.name,
        Description: config.description,
        RuleType: ruleTypeLabels[config.type],
        Severity: config.severity,
        ExecutionOrder: config.executionOrder,
        SqlQuery: '',
        IsEnabled: config.enabled,
        TableName: config.table,
    }));
}

function mapFileDefinitionToCamelCase(def: IFileDefinition): MappedFileDefinition {
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
        deliveryFolder: def.DeliveryFolder || null,
        contract: def.Contract || null
    };
}

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
import { validateContractLayout } from '../services/validation/ContractLayout';
import type { IFileDefinition, IFileDefinitionUser, IUpdateFileDefinitionDto } from '../interfaces/fileDefinition.interface';
import type { ICreateRuleDto } from '../interfaces/rule.interface';
import type { RuleConfig } from '../contracts/rule-config';
import type { DefinitionContract } from '../contracts/definition-contract';
import { parseRuleConfig } from '../models/contractMapper';
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
    rejectLegacyStructure(req.body);
    const { name, description, status, deliveryFolder, rules, contract: submittedContract } = req.body;

    if (!name) {
        throw new BadRequestError('Name is required');
    }

    let normalizedDeliveryFolder: string | null;
    let baseContract: DefinitionContract;
    let initialRules: InitialRule[];
    try {
        if (!submittedContract || typeof submittedContract !== 'object') {
            throw new Error('A definition contract is required');
        }
        baseContract = submittedContract as DefinitionContract;
        validateContractLayout(baseContract);
        await validateDefinitionContract(baseContract);
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
        {
            name,
            description,
            sheetTables: baseContract.layout === 'sheets' ? baseContract.tables.length : 0,
            initialRules: initialRules.length,
        },
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
    rejectLegacyStructure(req.body);
    const { name, description, status, deliveryFolder, contract: submittedContract, rules: submittedRules, revision } = req.body;

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
            validateContractLayout(contract);
            updates.Contract = contract;
        } else if (submittedRules !== undefined) {
            throw new Error('Rules can only be saved together with the definition contract');
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
    status: string;
    createdAt: Date;
    updatedAt: Date;
    allowedUsers: IFileDefinitionUser[];
    templateFilename: string | null;
    deliveryFolder: string | null;
    contract: DefinitionContract | null;
}

/**
 * Definition structure travels only as the contract; the older columns/tables request fields are rejected rather
 * than silently ignored.
 */
function rejectLegacyStructure(body: Record<string, unknown>): void {
    if (body.columns !== undefined || body.tables !== undefined) {
        throw new BadRequestError('Columns and tables are part of the definition contract; send the contract instead');
    }
}

type InitialRule = Omit<ICreateRuleDto, 'FileDefinitionId'>;

const MAX_INITIAL_RULES = 50;

function normalizeInitialRuleConfigs(value: unknown): RuleConfig[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('Rules must be an array');

    return value.map((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new Error(`Rule ${index + 1} must be a RuleConfig`);
        }
        return parseRuleConfig(candidate);
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
        IsEnabled: config.enabled,
    }));
}

function mapFileDefinitionToCamelCase(def: IFileDefinition): MappedFileDefinition {
    return {
        id: def.Id,
        name: def.Name,
        description: def.Description || '',
        status: def.Status || 'Active',
        createdAt: def.CreatedAt,
        updatedAt: def.UpdatedAt,
        allowedUsers: def.AllowedUsers || [],
        templateFilename: def.TemplateFilename ? getTemplateDisplayName(def.TemplateFilename) : null,
        deliveryFolder: def.DeliveryFolder || null,
        contract: def.Contract || null
    };
}

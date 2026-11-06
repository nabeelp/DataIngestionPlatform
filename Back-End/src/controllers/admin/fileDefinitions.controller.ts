// =============================================================================
// Admin Controller - File definition management (admin view with full access)
// =============================================================================

import { FileDefinition } from '../../models/FileDefinition.model';
import { logAction } from '../../models/AuditLog.model';
import { AUDIT_ACTIONS, ENTITY_TYPES } from '../../interfaces/auditLog.interface';
import { FileDefinitionService } from '../../services/FileDefinition.service';
import { DefinitionVersionError, DefinitionVersionService } from '../../services/DefinitionVersion.service';
import {
    buildAuthoringContract,
    getDraftRevision,
    saveDraftRules,
    type SavedRules,
} from '../../services/RuleDraft.service';
import { getConnection } from '../../config/database';
import { normalizeDeliveryFolder } from '../../services/DeliveryTargets.service';
import { validateContractLayout } from '../../services/validation/ContractLayout';
import type { RuleConfig } from '../../contracts/rule-config';
import type { DefinitionContract } from '../../contracts/definition-contract';
import { RulesServiceClient } from '../../services/RulesServiceClient';
import { asyncHandler } from '../../middleware/asyncHandler';
import { BadRequestError, NotFoundError } from '../../utils/httpError';
import {
    mapFileDefinitionToCamelCase,
    normalizeInitialRuleConfigs,
    rejectLegacyStructure,
    toValidationFailure,
    validateDefinitionContract,
    validateInitialRules,
    type DefinitionUpdates,
    type InitialRule,
} from './fileDefinitionRequest';

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
    const validation = await RulesServiceClient.validateContract(authored);
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

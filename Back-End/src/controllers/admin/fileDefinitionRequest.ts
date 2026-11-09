// =============================================================================
// Admin Controller - File definition request helpers (normalisation, validation, response mapping)
// =============================================================================

import { getTemplateDisplayName } from '../../services/TemplateStorage.service';
import type { IFileDefinition, IFileDefinitionUser, IUpdateFileDefinitionDto } from '../../interfaces/fileDefinition.interface';
import type { ICreateRuleDto } from '../../interfaces/rule.interface';
import type { RuleConfig } from '../../contracts/rule-config';
import type { DefinitionContract } from '../../contracts/definition-contract';
import { parseRuleConfig } from '../../models/contractMapper';
import { RulesServiceClient, RulesServiceError } from '../../services/RulesServiceClient';
import { BadRequestError } from '../../utils/httpError';

export type DefinitionUpdates = IUpdateFileDefinitionDto;

export type InitialRule = Omit<ICreateRuleDto, 'FileDefinitionId'>;

const MAX_INITIAL_RULES = 50;

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
 * Failure for a rejected definition draft: rules-service errors keep their own status, anything else is a 400.
 */
export function toValidationFailure(error: unknown): Error {
    if (error instanceof RulesServiceError) return error;
    return new BadRequestError(error instanceof Error ? error.message : 'Invalid definition');
}

/**
 * Definition structure travels only as the contract; the older columns/tables request fields are rejected rather
 * than silently ignored.
 */
export function rejectLegacyStructure(body: Record<string, unknown>): void {
    if (body.columns !== undefined || body.tables !== undefined) {
        throw new BadRequestError('Columns and tables are part of the definition contract; send the contract instead');
    }
}

export function normalizeInitialRuleConfigs(value: unknown): RuleConfig[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('Rules must be an array');

    return value.map((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            throw new Error(`Rule ${index + 1} must be a RuleConfig`);
        }
        return parseRuleConfig(candidate);
    });
}

export async function validateDefinitionContract(contract: DefinitionContract): Promise<void> {
    const validation = await RulesServiceClient.validateContract(contract);
    if (!validation.ok) {
        throw new Error(validation.errors.map(error => `${error.path}: ${error.message}`).join('; '));
    }
}

/**
 * Validate optional initial RuleConfig values with the Python contract validator.
 */
export async function validateInitialRules(configs: RuleConfig[], baseContract: DefinitionContract): Promise<InitialRule[]> {
    if (configs.length > MAX_INITIAL_RULES) throw new Error(`At most ${MAX_INITIAL_RULES} rules can be created with a definition`);
    const contract: DefinitionContract = { ...baseContract, rules: configs };
    await validateDefinitionContract(contract);

    return configs.map(config => ({
        Config: config,
        IsEnabled: config.enabled,
    }));
}

export function mapFileDefinitionToCamelCase(def: IFileDefinition): MappedFileDefinition {
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

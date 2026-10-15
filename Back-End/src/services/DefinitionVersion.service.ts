// =============================================================================
// Definition Version Service - draft, publish and resolve file definition versions
// The live FileDefinitions/Rules rows are the draft. Publishing snapshots them as a new active version;
// uploads are pinned to the version active when they arrive, so later edits never change their outcome.
// =============================================================================

import type { ConnectionPool, Transaction } from 'mssql';
import { getConnection } from '../config/database';
import { FileDefinitionVersion } from '../models/FileDefinitionVersion.model';
import { logger } from '../utils/logger';
import {
    diffContracts,
    type ContractDiff,
    type ContractSnapshot,
} from './validation/DefinitionContract';
import type { IDefinitionMetadataSnapshot, IFileDefinitionVersion } from '../interfaces/fileDefinition.interface';
import type { DefinitionContract } from '../contracts/definition-contract';
import type { RuleConfig } from '../contracts/rule-config';
import { isRemovedRuleConfig, legacySnapshotFromContract, parseDefinitionContract, parseRuleConfig } from '../models/contractMapper';
import { RulesService } from './RulesService.service';

export class DefinitionVersionError extends Error {
    constructor(message: string, readonly statusCode: 400 | 404 | 409) {
        super(message);
        this.name = 'DefinitionVersionError';
    }
}

export interface VersionSummary {
    id: string;
    versionNumber: number;
    activatedAt: Date;
}

export interface DraftState {
    activeVersion: IFileDefinitionVersion | null;
    draft: ContractSnapshot;
    diff: DefinitionDiff;
}

export interface DefinitionVersionState {
    activeVersion: VersionSummary | null;
    hasUnpublishedChanges: boolean;
}

export interface ValidationContract extends ContractSnapshot {
    version: IFileDefinitionVersion;
    contract: DefinitionContract;
}

export const toVersionSummary = (version: IFileDefinitionVersion | null): VersionSummary | null =>
    version ? { id: version.Id, versionNumber: version.VersionNumber, activatedAt: version.ActivatedAt } : null;

const contractOf = (version: IFileDefinitionVersion | null): ContractSnapshot | null =>
    version ? { columns: version.Columns, tables: version.Tables, rules: version.Rules } : null;

const MAX_CHANGE_NOTE_LENGTH = 500;

interface DraftContract {
    contract: DefinitionContract;
    snapshot: ContractSnapshot;
    metadata: IDefinitionMetadataSnapshot;
}

export interface DefinitionDiff extends ContractDiff {
    metadata: ContractDiff['columns'];
}

const METADATA_LABELS: Record<keyof IDefinitionMetadataSnapshot, string> = {
    name: 'Name',
    description: 'Description',
    status: 'Status',
    deliveryFolder: 'Delivery folder',
    templateFilename: 'Reusable template',
};

const diffDefinition = (
    active: IFileDefinitionVersion | null,
    draft: Pick<DraftContract, 'snapshot' | 'metadata'>,
): DefinitionDiff => {
    const contract = diffContracts(contractOf(active), draft.snapshot);
    const metadata: DefinitionDiff['metadata'] = { added: [], removed: [], changed: [] };
    if (!active?.DefinitionMetadata) {
        metadata.added = Object.values(METADATA_LABELS);
    } else {
        for (const key of Object.keys(METADATA_LABELS) as Array<keyof IDefinitionMetadataSnapshot>) {
            if (active.DefinitionMetadata[key] !== draft.metadata[key]) {
                metadata.changed.push(METADATA_LABELS[key]);
            }
        }
    }
    return {
        ...contract,
        metadata,
        hasChanges: contract.hasChanges || metadata.added.length > 0 || metadata.changed.length > 0,
    };
};

/** Loads the lookups that the given rules reference; clients never supply lookup values. */
export async function hydrateLookups(
    db: ConnectionPool | Transaction,
    ruleConfigs: RuleConfig[],
): Promise<DefinitionContract['lookups']> {
    const lookupIds = new Set(ruleConfigs
        .filter(rule => rule.type === 'lookup')
        .map(rule => rule.params.lookupId)
        .filter((id): id is string => typeof id === 'string'));
    const lookups: DefinitionContract['lookups'] = {};
    if (lookupIds.size === 0) return lookups;

    const lookupResult = await db.request().query('SELECT Id, Name, [Values] FROM Lookups');
    for (const row of lookupResult.recordset) {
        if (!lookupIds.has(String(row.Id))) continue;
        let values: unknown;
        try {
            values = typeof row.Values === 'string' ? JSON.parse(row.Values) as unknown : row.Values;
        } catch {
            throw new Error(`Lookup ${row.Id} contains invalid JSON values.`);
        }
        if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
            throw new Error(`Lookup ${row.Id} must contain a JSON array of strings.`);
        }
        lookups[String(row.Id)] = { name: String(row.Name), values: values as string[] };
    }
    const missingLookup = [...lookupIds].find(id => !lookups[id]);
    if (missingLookup) throw new Error(`Rule references missing lookup ${missingLookup}.`);
    return lookups;
}

async function readDraft(
    db: ConnectionPool | Transaction,
    fileDefinitionId: string,
    lock = false,
    excludeRuleId?: string,
): Promise<DraftContract | null> {
    const definition = await db.request()
        .input('Id', fileDefinitionId)
        .query(`
            SELECT Id, Name, Description, Status, DeliveryFolder, TemplateFilename, Contract
            FROM FileDefinitions ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
            WHERE Id = @Id
        `);
    if (!definition.recordset[0]) return null;

    const rules = await db.request()
        .input('FileDefinitionId', fileDefinitionId)
        .query(`SELECT Config, IsEnabled FROM Rules WHERE FileDefinitionId = @FileDefinitionId`);
    const ruleConfigs = rules.recordset
        .filter((row: { IsEnabled: boolean | number }) => Boolean(row.IsEnabled))
        .filter((row: { Config: unknown }) => !isRemovedRuleConfig(row.Config))
        .map((row: { Config: unknown }) => parseRuleConfig(row.Config))
        .filter((rule: RuleConfig) => rule.id.toLowerCase() !== excludeRuleId?.toLowerCase());
    const baseContract = parseDefinitionContract(definition.recordset[0].Contract);
    const lookups = await hydrateLookups(db, ruleConfigs);

    const contract: DefinitionContract = {
        ...baseContract,
        rules: ruleConfigs,
        lookups,
    };
    const row = definition.recordset[0];
    return {
        contract,
        snapshot: legacySnapshotFromContract(contract),
        metadata: {
            name: String(row.Name),
            description: String(row.Description ?? ''),
            status: row.Status === 'Inactive' ? 'Inactive' : 'Active',
            deliveryFolder: row.DeliveryFolder ?? null,
            templateFilename: row.TemplateFilename ?? null,
        },
    };
}

export class DefinitionVersionService {
    /**
     * Compare the definition's current (draft) configuration with its active version.
     */
    static async getDraftState(fileDefinitionId: string): Promise<DraftState> {
        const pool = await getConnection();
        const draft = await readDraft(pool, fileDefinitionId);
        if (!draft) throw new DefinitionVersionError('File definition not found', 404);

        const activeVersion = await FileDefinitionVersion.findActive(pool, fileDefinitionId);
        return { activeVersion, draft: draft.snapshot, diff: diffDefinition(activeVersion, draft) };
    }

    static async getDraftContract(fileDefinitionId: string, excludeRuleId?: string): Promise<DefinitionContract> {
        const draft = await readDraft(await getConnection(), fileDefinitionId, false, excludeRuleId);
        if (!draft) throw new DefinitionVersionError('File definition not found', 404);
        return draft.contract;
    }

    /**
     * What publishing the given (not yet saved) contract would change relative to the active version.
     */
    static async previewDiff(fileDefinitionId: string, contract: DefinitionContract): Promise<ContractDiff> {
        const pool = await getConnection();
        const activeVersion = await FileDefinitionVersion.findActive(pool, fileDefinitionId);
        return diffContracts(contractOf(activeVersion), legacySnapshotFromContract(contract));
    }

    /**
     * All versions of a definition, newest first.
     */
    static async listVersions(fileDefinitionId: string): Promise<IFileDefinitionVersion[]> {
        return FileDefinitionVersion.findByDefinition(await getConnection(), fileDefinitionId);
    }

    static async findVersion(versionId: string): Promise<IFileDefinitionVersion | null> {
        return FileDefinitionVersion.findById(await getConnection(), versionId);
    }

    /**
     * Publish the draft as the new active version. Throws DefinitionVersionError when the definition does not
     * exist (404), the draft is invalid (400) or there is nothing to publish (409).
     */
    static async publish(fileDefinitionId: string, userId: string | null, changeNote?: string | null): Promise<IFileDefinitionVersion> {
        return this.publishDraft(fileDefinitionId, userId, changeNote ?? null, { validate: true, onlyIfUnpublished: false });
    }

    /**
     * Return the active version, publishing the current configuration as the first version if the definition
     * has never been versioned (for example when it was created by a seed script).
     */
    static async ensureActiveVersion(fileDefinitionId: string, userId: string | null): Promise<IFileDefinitionVersion> {
        const active = await FileDefinitionVersion.findActive(await getConnection(), fileDefinitionId);
        if (active) return active;
        // The initial version records the configuration exactly as it validated before versioning existed.
        return this.publishDraft(fileDefinitionId, userId, 'Initial version', { validate: false, onlyIfUnpublished: true });
    }

    /**
     * Version state for each definition, for list views.
     */
    static async getVersionStates(definitions: { Id: string; Columns: unknown; Tables?: unknown }[]): Promise<Map<string, DefinitionVersionState>> {
        const pool = await getConnection();
        const activeVersions = await FileDefinitionVersion.findAllActive(pool);
        const activeByDefinition = new Map(activeVersions.map(v => [String(v.FileDefinitionId).toLowerCase(), v]));

        const states = new Map<string, DefinitionVersionState>();
        await Promise.all(definitions.map(async definition => {
            const key = String(definition.Id).toLowerCase();
            const active = activeByDefinition.get(key) || null;
            const draft = await readDraft(pool, definition.Id);
            if (!draft) return;
            states.set(definition.Id, {
                activeVersion: toVersionSummary(active),
                hasUnpublishedChanges: diffDefinition(active, draft).hasChanges,
            });
        }));
        return states;
    }

    /**
     * Present definitions as uploaders see them: with the columns and sheet tables of the active version rather
     * than the draft.
     */
    static async withPublishedColumns<T extends { Id: string; Columns: unknown }>(definitions: T[]): Promise<(T & { ActiveVersion: VersionSummary | null })[]> {
        if (definitions.length === 0) return [];
        const activeVersions = await FileDefinitionVersion.findAllActive(await getConnection());
        const activeByDefinition = new Map(activeVersions.map(v => [String(v.FileDefinitionId).toLowerCase(), v]));
        return definitions.map(definition => {
            const active = activeByDefinition.get(String(definition.Id).toLowerCase());
            return active
                ? {
                    ...definition,
                    Contract: active.Contract,
                    Columns: active.Columns,
                    Tables: active.Tables,
                    ActiveVersion: toVersionSummary(active),
                }
                : { ...definition, ActiveVersion: null };
        });
    }

    /**
     * The tables and rules an upload must be validated against: its pinned version, or the active version
     * for an unpinned upload. Unpublished draft edits never apply.
     */
    static async loadValidationContract(upload: { FileDefinitionId: string; FileDefinitionVersionId?: string | null }): Promise<ValidationContract> {
        const version = upload.FileDefinitionVersionId
            ? await FileDefinitionVersion.findById(await getConnection(), upload.FileDefinitionVersionId)
            : await this.ensureActiveVersion(upload.FileDefinitionId, null);
        if (!version) throw new Error(`File definition version ${upload.FileDefinitionVersionId} not found`);
        return {
            version,
            contract: version.Contract,
            columns: version.Columns,
            tables: version.Tables,
            rules: version.Rules,
        };
    }

    private static async publishDraft(
        fileDefinitionId: string,
        userId: string | null,
        changeNote: string | null,
        options: { validate: boolean; onlyIfUnpublished: boolean },
    ): Promise<IFileDefinitionVersion> {
        const note = changeNote?.trim().slice(0, MAX_CHANGE_NOTE_LENGTH) || null;
        const pool = await getConnection();
        const tx = pool.transaction();
        await tx.begin();

        let versionId: string;
        try {
            // Locking the definition row serialises publishes (and version numbers) per definition.
            const draft = await readDraft(tx, fileDefinitionId, true);
            if (!draft) throw new DefinitionVersionError('File definition not found', 404);

            const active = await FileDefinitionVersion.findActive(tx, fileDefinitionId);
            if (active && options.onlyIfUnpublished) {
                await tx.commit();
                return active;
            }
            if (active && !diffDefinition(active, draft).hasChanges) {
                throw new DefinitionVersionError(`There are no changes to publish; version ${active.VersionNumber} is already active`, 409);
            }
            if (options.validate) {
                const validation = await RulesService.validateContract(draft.contract);
                if (!validation.ok) {
                    const details = validation.errors
                        .map(item => `${item.path}: ${item.message}`)
                        .join('; ');
                    throw new DefinitionVersionError(`Definition contract validation failed: ${details}`, 400);
                }
            }

            versionId = await FileDefinitionVersion.activate(tx, fileDefinitionId, draft.contract, draft.metadata, userId, note);
            await tx.commit();
        } catch (error) {
            await tx.rollback().catch(rollbackError => logger.warn('[DEF_VERSION] Rollback failed', rollbackError));
            throw error;
        }

        const version = (await FileDefinitionVersion.findById(pool, versionId))!;
        logger.info(`[DEF_VERSION] Definition ${fileDefinitionId} version ${version.VersionNumber} activated by ${userId ?? 'system'}`);
        return version;
    }
}

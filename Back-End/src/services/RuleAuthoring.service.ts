// =============================================================================
// Rule Authoring Service - rules are authored against a draft held by the client (the definition workspace)
// and persisted together with the definition. Nothing here trusts client-supplied lookup values.
// =============================================================================

import { createHash } from 'node:crypto';
import type { ConnectionPool, Transaction } from 'mssql';
import sql from 'mssql';
import { getConnection } from '../config/database';
import type { DefinitionContract } from '../contracts/definition-contract';
import type { RuleConfig } from '../contracts/rule-config';
import { parseDefinitionContract, parseRuleConfig } from '../models/contractMapper';
import { DefinitionVersionError, hydrateLookups } from './DefinitionVersion.service';

export const MAX_DRAFT_RULES = 50;
const MAX_TABLES = 50;
const MAX_COLUMNS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthoringInputError extends Error {
    readonly statusCode = 400;
    constructor(message: string) {
        super(message);
        this.name = 'AuthoringInputError';
    }
}

/** Validates the shape and size of a rule set supplied by the client. */
export function parseDraftRules(value: unknown, excludeRuleId?: string): RuleConfig[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new AuthoringInputError('Rules must be an array');
    if (value.length > MAX_DRAFT_RULES) {
        throw new AuthoringInputError(`A definition can have at most ${MAX_DRAFT_RULES} rules`);
    }
    const rules = value.map((item, index) => {
        try {
            const rule = parseRuleConfig(item);
            if (!UUID.test(rule.id)) throw new Error('Rule ids must be UUIDs.');
            return rule;
        } catch (error) {
            throw new AuthoringInputError(`Rule ${index + 1}: ${(error as Error).message}`);
        }
    });
    const ids = new Set<string>();
    for (const rule of rules) {
        const id = rule.id.toLowerCase();
        if (ids.has(id)) throw new AuthoringInputError(`Rule id ${rule.id} is used more than once`);
        ids.add(id);
    }
    return excludeRuleId ? rules.filter(rule => rule.id.toLowerCase() !== excludeRuleId.toLowerCase()) : rules;
}

/**
 * The contract a rule is checked against: the client's structure, the client's other rules and lookups loaded
 * from the database for the rules that reference them, including the separately validated candidate.
 */
export async function buildAuthoringContract(
    contract: unknown,
    rules: unknown,
    options: { excludeRuleId?: string; candidate?: RuleConfig } = {},
): Promise<DefinitionContract> {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
        throw new AuthoringInputError('A definition contract is required');
    }
    let base: DefinitionContract;
    try {
        base = parseDefinitionContract({ ...contract, rules: [], lookups: {} });
    } catch (error) {
        throw new AuthoringInputError((error as Error).message);
    }
    if (base.tables.length > MAX_TABLES) throw new AuthoringInputError(`A definition can have at most ${MAX_TABLES} tables`);
    if (base.tables.reduce((count, table) => count + table.columns.length, 0) > MAX_COLUMNS) {
        throw new AuthoringInputError(`A definition can have at most ${MAX_COLUMNS} columns`);
    }

    let candidate: RuleConfig | undefined;
    if (options.candidate) {
        try {
            candidate = parseRuleConfig(options.candidate);
        } catch (error) {
            throw new AuthoringInputError((error as Error).message);
        }
    }
    const ruleConfigs = parseDraftRules(rules, candidate?.id ?? options.excludeRuleId);
    let lookups: DefinitionContract['lookups'];
    try {
        lookups = await hydrateLookups(await getConnection(), candidate ? [...ruleConfigs, candidate] : ruleConfigs);
    } catch (error) {
        throw new AuthoringInputError((error as Error).message);
    }
    return { ...base, rules: ruleConfigs, lookups };
}

type Db = ConnectionPool | Transaction;

/** Identifies the saved draft (definition row plus its rules) so concurrent edits can be detected. */
export async function getDraftRevision(db: Db, fileDefinitionId: string): Promise<string | null> {
    const definition = await db.request()
        .input('Id', fileDefinitionId)
        .query('SELECT UpdatedAt FROM FileDefinitions WHERE Id = @Id');
    if (!definition.recordset[0]) return null;
    const rules = await db.request()
        .input('FileDefinitionId', fileDefinitionId)
        .query('SELECT Id, UpdatedAt FROM Rules WHERE FileDefinitionId = @FileDefinitionId');
    const parts = rules.recordset
        .map((row: { Id: string; UpdatedAt: Date }) => `${String(row.Id).toLowerCase()}@${new Date(row.UpdatedAt).getTime()}`)
        .sort();
    const stamp = new Date(definition.recordset[0].UpdatedAt).getTime();
    return createHash('sha256').update([stamp, ...parts].join('|')).digest('hex').slice(0, 24);
}

export interface SavedRules {
    added: string[];
    updated: string[];
    removed: string[];
}

/**
 * Make the saved draft rules equal to `configs` in one transaction (insert new ids, update changed ones, delete the rest).
 * With `expectedRevision`, fails with 409 when someone else changed the draft since the client loaded it.
 */
export async function saveDraftRules(
    fileDefinitionId: string,
    configs: RuleConfig[],
    userId: string,
    expectedRevision?: string | null,
): Promise<SavedRules> {
    const pool = await getConnection();
    const tx = pool.transaction();
    await tx.begin();
    try {
        const lock = await tx.request()
            .input('Id', fileDefinitionId)
            .query('SELECT Id FROM FileDefinitions WITH (UPDLOCK, HOLDLOCK) WHERE Id = @Id');
        if (!lock.recordset[0]) throw new DefinitionVersionError('File definition not found', 404);

        if (expectedRevision && await getDraftRevision(tx, fileDefinitionId) !== expectedRevision) {
            throw new DefinitionVersionError(
                'This definition was changed by someone else after you opened it. Reload it to see their changes before saving.', 409);
        }

        const existing = await tx.request()
            .input('FileDefinitionId', fileDefinitionId)
            .query('SELECT Id, Config FROM Rules WHERE FileDefinitionId = @FileDefinitionId');
        const existingById = new Map<string, string>(existing.recordset.map(
            (row: { Id: string; Config: unknown }) => [String(row.Id).toLowerCase(), String(row.Config)]));
        const wanted = new Set(configs.map(config => config.id.toLowerCase()));

        const result: SavedRules = { added: [], updated: [], removed: [] };
        for (const id of existingById.keys()) {
            if (wanted.has(id)) continue;
            await tx.request().input('Id', id).query('DELETE FROM Rules WHERE Id = @Id');
            result.removed.push(id);
        }

        const foreign = configs.length === 0 ? { recordset: [] } : await tx.request()
            .input('FileDefinitionId', fileDefinitionId)
            .input('Ids', JSON.stringify(configs.map(config => config.id)))
            .query(`SELECT Id FROM Rules WHERE FileDefinitionId <> @FileDefinitionId
                    AND Id IN (SELECT value FROM OPENJSON(@Ids))`);
        if (foreign.recordset.length > 0) {
            throw new DefinitionVersionError('A rule id already belongs to another definition', 400);
        }

        const now = new Date();
        for (const config of configs) {
            const id = config.id.toLowerCase();
            const serialized = JSON.stringify(config);
            const previous = existingById.get(id);
            if (previous === undefined) {
                await tx.request()
                    .input('Id', config.id)
                    .input('FileDefinitionId', fileDefinitionId)
                    .input('Config', serialized)
                    .input('IsEnabled', sql.Bit, config.enabled)
                    .input('CreatedBy', userId)
                    .input('Now', now)
                    .query(`INSERT INTO Rules (Id, FileDefinitionId, Config, ConfigSchemaVersion, IsEnabled, CreatedBy, CreatedAt, UpdatedAt)
                            VALUES (@Id, @FileDefinitionId, @Config, 1, @IsEnabled, @CreatedBy, @Now, @Now)`);
                result.added.push(config.id);
            } else if (previous !== serialized && !sameJson(previous, serialized)) {
                await tx.request()
                    .input('Id', config.id)
                    .input('Config', serialized)
                    .input('IsEnabled', sql.Bit, config.enabled)
                    .input('Now', now)
                    .query('UPDATE Rules SET Config = @Config, IsEnabled = @IsEnabled, UpdatedAt = @Now WHERE Id = @Id');
                result.updated.push(config.id);
            }
        }
        await tx.commit();
        return result;
    } catch (error) {
        await tx.rollback().catch(() => undefined);
        throw error;
    }
}

function sameJson(left: string, right: string): boolean {
    try {
        return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right));
    } catch {
        return false;
    }
}

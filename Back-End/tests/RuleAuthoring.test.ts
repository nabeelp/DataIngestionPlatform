import { getConnection } from '../src/config/database';
import {
    AuthoringInputError,
    buildAuthoringContract,
    getDraftRevision,
    parseDraftRules,
    saveDraftRules,
} from '../src/services/RuleAuthoring.service';
import { DefinitionVersionError } from '../src/services/DefinitionVersion.service';

jest.mock('../src/config/database', () => ({ getConnection: jest.fn() }));

const definitionId = '8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
const lookupId = '2f6f7d3a-5c3b-4a53-8d62-6d3c1f1f9a11';

const column = { name: 'Amount', type: 'decimal', mustExist: true, nullable: false };
const contract = {
    schemaVersion: 1,
    layout: 'single',
    ignoredSheets: [],
    encoding: 'auto',
    tables: [{ sheet: null, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [column] }],
    rules: [],
    lookups: {},
};

const rule = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `Rule ${id.slice(0, 4)}`,
    description: '',
    severity: 'Error',
    executionOrder: 1,
    enabled: true,
    table: null,
    type: 'range',
    params: { column: 'Amount', min: 0, max: 100 },
    ...overrides,
});

const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
];

interface Call { sql: string; inputs: Record<string, unknown> }

/** A scripted SQL Server: each query is answered by the first handler whose pattern matches. */
function fakePool(handlers: Array<[RegExp, (inputs: Record<string, unknown>) => unknown[]]>) {
    const calls: Call[] = [];
    const request = () => {
        const inputs: Record<string, unknown> = {};
        const chain = {
            input(name: string, ...rest: unknown[]) {
                inputs[name] = rest[rest.length - 1];
                return chain;
            },
            async query(sql: string) {
                calls.push({ sql, inputs: { ...inputs } });
                const handler = handlers.find(([pattern]) => pattern.test(sql));
                return { recordset: handler ? handler[1](inputs) : [] };
            },
        };
        return chain;
    };
    const tx = { begin: jest.fn(), commit: jest.fn(), rollback: jest.fn().mockResolvedValue(undefined), request };
    return { pool: { request, transaction: () => tx }, tx, calls };
}

describe('rule authoring', () => {
    afterEach(() => jest.resetAllMocks());

    describe('parseDraftRules', () => {
        it('treats a missing rule set as empty', () => {
            expect(parseDraftRules(undefined)).toEqual([]);
            expect(parseDraftRules(null)).toEqual([]);
        });

        it('rejects more than 50 rules, non-uuid ids and duplicate ids', () => {
            expect(() => parseDraftRules(Array.from({ length: 51 }, (_, index) =>
                rule(`${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`)))).toThrow(/at most 50/);
            expect(() => parseDraftRules([rule('not-a-uuid')])).toThrow(AuthoringInputError);
            expect(() => parseDraftRules([rule(ids[0]), rule(ids[0].toUpperCase())])).toThrow(/more than once/);
        });

        it('can leave out the rule being edited', () => {
            expect(parseDraftRules([rule(ids[0]), rule(ids[1])], ids[0]).map(item => item.id)).toEqual([ids[1]]);
        });
    });

    describe('buildAuthoringContract', () => {
        it('uses the client structure and rules but never client-supplied lookups', async () => {
            const lookupRule = rule(ids[0], { type: 'lookup', params: { column: 'Amount', lookupId } });
            const { pool } = fakePool([[/FROM Lookups/, () => [{ Id: lookupId, Name: 'Currencies', Values: '["EUR","USD"]' }]]]);
            jest.mocked(getConnection).mockResolvedValue(pool as never);

            const built = await buildAuthoringContract(
                { ...contract, lookups: { [lookupId]: { name: 'Hostile', values: ['x'] } }, rules: [rule(ids[2])] },
                [lookupRule],
            );

            expect(built.rules.map(item => item.id)).toEqual([ids[0]]);
            expect(built.lookups).toEqual({ [lookupId]: { name: 'Currencies', values: ['EUR', 'USD'] } });
        });

        it('rejects a rule that references a lookup that does not exist', async () => {
            const { pool } = fakePool([]);
            jest.mocked(getConnection).mockResolvedValue(pool as never);
            await expect(buildAuthoringContract(contract, [rule(ids[0], { type: 'lookup', params: { column: 'Amount', lookupId } })]))
                .rejects.toThrow(/missing lookup/);
        });

        it('rejects a missing or malformed contract', async () => {
            await expect(buildAuthoringContract(undefined, [])).rejects.toBeInstanceOf(AuthoringInputError);
            await expect(buildAuthoringContract({ schemaVersion: 2 }, [])).rejects.toBeInstanceOf(AuthoringInputError);
        });

        it('limits the number of tables', async () => {
            const tables = Array.from({ length: 51 }, (_, index) => ({ ...contract.tables[0], sheet: `S${index}` }));
            await expect(buildAuthoringContract({ ...contract, layout: 'sheets', tables }, [])).rejects.toThrow(/at most 50 tables/);
        });
    });

    describe('getDraftRevision', () => {
        it('changes when a rule changes and is stable otherwise', async () => {
            const make = (ruleStamp: number) => fakePool([
                [/FROM FileDefinitions/, () => [{ UpdatedAt: new Date(1000) }]],
                [/FROM Rules/, () => [{ Id: ids[0], UpdatedAt: new Date(ruleStamp) }]],
            ]).pool as never;

            const first = await getDraftRevision(make(5), definitionId);
            expect(await getDraftRevision(make(5), definitionId)).toBe(first);
            expect(await getDraftRevision(make(6), definitionId)).not.toBe(first);
        });

        it('returns null for an unknown definition', async () => {
            expect(await getDraftRevision(fakePool([]).pool as never, definitionId)).toBeNull();
        });
    });

    describe('saveDraftRules', () => {
        const existing = (config: object) => [{ Id: ids[0], Config: JSON.stringify(config) }];

        it('inserts new rules, updates changed ones and deletes the rest in one transaction', async () => {
            const kept = rule(ids[0]);
            const { pool, tx, calls } = fakePool([
                [/WITH \(UPDLOCK/, () => [{ Id: definitionId }]],
                [/SELECT Id, Config FROM Rules/, () => [
                    ...existing(kept),
                    { Id: ids[1], Config: JSON.stringify(rule(ids[1])) },
                ]],
            ]);
            jest.mocked(getConnection).mockResolvedValue(pool as never);

            const result = await saveDraftRules(
                definitionId,
                [rule(ids[0], { severity: 'Warning' }), rule(ids[2])] as never,
                'admin-1',
            );

            expect(result).toEqual({ added: [ids[2]], updated: [ids[0]], removed: [ids[1]] });
            expect(tx.commit).toHaveBeenCalledTimes(1);
            expect(tx.rollback).not.toHaveBeenCalled();
            expect(calls.some(call => /^DELETE FROM Rules/.test(call.sql.trim()))).toBe(true);
        });

        it('leaves unchanged rules alone', async () => {
            const kept = rule(ids[0]);
            const { pool, calls } = fakePool([
                [/WITH \(UPDLOCK/, () => [{ Id: definitionId }]],
                [/SELECT Id, Config FROM Rules/, () => existing(kept)],
            ]);
            jest.mocked(getConnection).mockResolvedValue(pool as never);

            const result = await saveDraftRules(definitionId, [kept] as never, 'admin-1');

            expect(result).toEqual({ added: [], updated: [], removed: [] });
            expect(calls.some(call => /UPDATE Rules|INSERT INTO Rules/.test(call.sql))).toBe(false);
        });

        it('rolls back and reports a conflict when the draft changed after it was loaded', async () => {
            const { pool, tx, calls } = fakePool([
                [/WITH \(UPDLOCK/, () => [{ Id: definitionId }]],
                [/SELECT UpdatedAt FROM FileDefinitions/, () => [{ UpdatedAt: new Date(2000) }]],
            ]);
            jest.mocked(getConnection).mockResolvedValue(pool as never);

            const failure = await saveDraftRules(definitionId, [rule(ids[0])] as never, 'admin-1', 'stale-revision')
                .catch(error => error);

            expect(failure).toBeInstanceOf(DefinitionVersionError);
            expect(failure.statusCode).toBe(409);
            expect(tx.rollback).toHaveBeenCalledTimes(1);
            expect(tx.commit).not.toHaveBeenCalled();
            expect(calls.some(call => /INSERT INTO Rules|DELETE FROM Rules/.test(call.sql))).toBe(false);
        });

        it('rejects a rule id that belongs to another definition', async () => {
            const { pool, tx } = fakePool([
                [/WITH \(UPDLOCK/, () => [{ Id: definitionId }]],
                [/FileDefinitionId <> @FileDefinitionId/, () => [{ Id: ids[0] }]],
            ]);
            jest.mocked(getConnection).mockResolvedValue(pool as never);

            await expect(saveDraftRules(definitionId, [rule(ids[0])] as never, 'admin-1'))
                .rejects.toThrow(/another definition/);
            expect(tx.rollback).toHaveBeenCalledTimes(1);
        });

        it('reports an unknown definition', async () => {
            const { pool } = fakePool([]);
            jest.mocked(getConnection).mockResolvedValue(pool as never);
            await expect(saveDraftRules(definitionId, [], 'admin-1')).rejects.toMatchObject({ statusCode: 404 });
        });
    });
});

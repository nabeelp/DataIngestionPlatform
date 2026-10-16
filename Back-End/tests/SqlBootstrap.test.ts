import { expandSqlCmdVariables, splitSqlBatches } from '../src/scripts/bootstrapSql';

describe('SQL bootstrap helpers', () => {
    describe('splitSqlBatches', () => {
        it('splits on standalone GO separators and removes empty batches', () => {
            const batches = splitSqlBatches(`
                CREATE TABLE dbo.Example (Id INT);
                GO

                INSERT INTO dbo.Example (Id) VALUES (1);
                GO -- next batch
            `);

            expect(batches).toEqual([
                'CREATE TABLE dbo.Example (Id INT);',
                'INSERT INTO dbo.Example (Id) VALUES (1);',
            ]);
        });

        it('does not split when GO appears inside a statement', () => {
            expect(splitSqlBatches("SELECT N'GO';")).toEqual(["SELECT N'GO';"]);
        });
    });

    describe('expandSqlCmdVariables', () => {
        it('substitutes validated principal names and object IDs', () => {
            const expanded = expandSqlCmdVariables(
                'CREATE USER [$(IdentityName)] WITH OBJECT_ID = \'$(IdentityId)\';',
                {
                    IdentityName: 'id-dataingest-api-sbingest',
                    IdentityId: 'aabbccdd-1122-3344-5566-77889900aabb',
                },
            );

            expect(expanded).toBe(
                "CREATE USER [id-dataingest-api-sbingest] WITH OBJECT_ID = 'aabbccdd-1122-3344-5566-77889900aabb';",
            );
        });

        it('rejects unsafe principal names and unresolved tokens', () => {
            expect(() => expandSqlCmdVariables('$(IdentityName)', {
                IdentityName: 'name]; DROP TABLE dbo.Users;--',
            })).toThrow('Invalid SQL principal name');

            expect(() => expandSqlCmdVariables('$(MissingName)', {
                IdentityName: 'valid-name',
            })).toThrow('unresolved variable');
        });
    });
});

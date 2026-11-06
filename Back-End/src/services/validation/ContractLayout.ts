// =============================================================================
// Contract layout validation - structural checks the contract schema does not express
// =============================================================================

import type { DefinitionContract } from '../../contracts/definition-contract';
import { COLUMN_TYPES, MAX_SHEET_NAME_LENGTH } from './DefinitionContract';

const MAX_SHEET_TABLES = 50;
// Characters Excel does not allow in sheet names.
const INVALID_SHEET_NAME = /[[\]:*?/\\]/;

type ContractTable = DefinitionContract['tables'][number];

/** Columns need non-empty unique names and a supported type. */
function validateColumns(columns: ContractTable['columns'], context = ''): void {
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

/**
 * Validate a definition's layout: a single-table contract has exactly one table with columns; a sheet-table contract
 * has one table per workbook sheet, each with a unique, valid sheet name and its own columns.
 */
export function validateContractLayout(contract: DefinitionContract): void {
    if (contract.layout === 'single') {
        if (contract.tables.length !== 1) {
            throw new Error('A single-table contract must contain exactly one table');
        }
        validateColumns(contract.tables[0].columns);
        return;
    }

    if (contract.tables.length > MAX_SHEET_TABLES) {
        throw new Error(`At most ${MAX_SHEET_TABLES} sheet tables are supported`);
    }
    const seen = new Set<string>();
    contract.tables.forEach((table, index) => {
        const sheet = typeof table.sheet === 'string' ? table.sheet.trim() : '';
        if (!sheet) throw new Error(`Sheet table ${index + 1} needs a sheet name`);
        if (sheet.length > MAX_SHEET_NAME_LENGTH) throw new Error(`Sheet name "${sheet}" is longer than ${MAX_SHEET_NAME_LENGTH} characters`);
        if (INVALID_SHEET_NAME.test(sheet)) throw new Error(`Sheet name "${sheet}" cannot contain [ ] : * ? / \\`);
        if (seen.has(sheet.toLowerCase())) throw new Error(`Sheet "${sheet}" is defined more than once`);
        seen.add(sheet.toLowerCase());
        validateColumns(table.columns, `sheet "${sheet}"`);
    });
}

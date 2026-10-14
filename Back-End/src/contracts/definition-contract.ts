/* This file is generated from contracts/*.schema.json. Do not edit. */

export type DefinitionContract = {
  [k: string]: unknown;
} & {
  schemaVersion: 1;
  layout: 'single' | 'sheets';
  ignoredSheets: string[];
  encoding: 'auto' | 'utf-8' | 'utf-16' | 'windows-1252' | 'iso-8859-1';
  /**
   * @minItems 1
   */
  tables: [Table, ...Table[]];
  rules: RuleConfig[];
  lookups: {
    [k: string]: {
      name: string;
      values: string[];
    };
  };
};
export type DateFormat = string | [string, ...string[]];
/**
 * A versioned declarative rule configuration.
 */
export type RuleConfig = {
  id: string;
  name: string;
  description: string;
  severity: 'Error' | 'Warning';
  executionOrder: number;
  enabled: boolean;
  table: string | null;
  type:
    | 'columnsPresent'
    | 'required'
    | 'type'
    | 'enum'
    | 'range'
    | 'pattern'
    | 'length'
    | 'unique'
    | 'lookup'
    | 'dateRange'
    | 'conditionalRequired'
    | 'compare'
    | 'rowCount'
    | 'aggregate'
    | 'reconcile'
    | 'naturalLanguage';
  params: {
    [k: string]: unknown;
  };
} & (
  | {
      type?: 'columnsPresent';
      params?: {
        columns: Columns;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'required';
      params?: {
        columns: Columns;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'type';
      params?: {
        column: string;
        dataType: 'string' | 'integer' | 'decimal' | 'date' | 'datetime' | 'boolean';
        format?: string | [string, ...string[]];
        decimalSeparator?: string;
        thousandsSeparator?: string | null;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'enum';
      params?: {
        column: string;
        /**
         * @minItems 1
         */
        values: [string, ...string[]];
        caseSensitive?: boolean;
        trim?: boolean;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'range';
      params?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'pattern';
      params?: {
        column: string;
        pattern: string;
        caseSensitive?: boolean;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'length';
      params?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'unique';
      params?: {
        columns: Columns;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'lookup';
      params?: {
        column: string;
        lookupId: string;
        caseSensitive?: boolean;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'dateRange';
      params?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'conditionalRequired';
      params?: {
        columns: Columns;
        when:
          | {
              column: string;
              op: 'eq' | 'ne';
              value: string;
            }
          | {
              column: string;
              op: 'in';
              /**
               * @minItems 1
               */
              values: [string, ...string[]];
            }
          | {
              column: string;
              op: 'empty' | 'notEmpty';
            };
      };
      [k: string]: unknown;
    }
  | {
      type?: 'compare';
      params?: {
        left: string;
        op: 'lt' | 'le' | 'eq' | 'ne' | 'ge' | 'gt';
        right: string;
        as: 'number' | 'date' | 'string';
      };
      [k: string]: unknown;
    }
  | {
      type?: 'rowCount';
      params?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'aggregate';
      params?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'reconcile';
      params?: {
        left: AggregateRef;
        right: AggregateRef;
        tolerance?: number;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'naturalLanguage';
      params?: {
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }
);
/**
 * @minItems 1
 */
export type Columns = [string, ...string[]];

export interface Table {
  sheet: string | null;
  headerRow: number | null;
  allowExtraColumns: boolean;
  minRows: number | null;
  maxRows: number | null;
  columns: Column[];
}
export interface Column {
  name: string;
  description?: string;
  type: 'string' | 'integer' | 'decimal' | 'date' | 'datetime' | 'boolean';
  mustExist: boolean;
  nullable: boolean;
  format?: null | DateFormat;
  decimalSeparator?: string;
  thousandsSeparator?: string | null;
  precision?: number | null;
  scale?: number | null;
  maxLength?: number | null;
  unique?: boolean;
}
export interface AggregateRef {
  table: string;
  column: string;
  fn: 'sum' | 'min' | 'max' | 'avg' | 'count' | 'countDistinct';
}

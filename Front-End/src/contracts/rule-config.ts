/* This file is generated from contracts/*.schema.json. Do not edit. */

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
        column: Column;
        dataType: 'string' | 'integer' | 'decimal' | 'date' | 'datetime' | 'boolean';
        format?: Format;
        decimalSeparator?: string;
        thousandsSeparator?: string | null;
      };
      [k: string]: unknown;
    }
  | {
      type?: 'enum';
      params?: {
        column: Column;
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
        column: Column;
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
        column: Column;
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
              column: Column;
              op: 'eq' | 'ne';
              value: string;
            }
          | {
              column: Column;
              op: 'in';
              /**
               * @minItems 1
               */
              values: [string, ...string[]];
            }
          | {
              column: Column;
              op: 'empty' | 'notEmpty';
            };
      };
      [k: string]: unknown;
    }
  | {
      type?: 'compare';
      params?: {
        left: Column;
        op: 'lt' | 'le' | 'eq' | 'ne' | 'ge' | 'gt';
        right: Column;
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
export type Columns = [Column, ...Column[]];
export type Column = string;
export type Format = string | [string, ...string[]];

export interface AggregateRef {
  table: string;
  column: Column;
  fn: 'sum' | 'min' | 'max' | 'avg' | 'count' | 'countDistinct';
}

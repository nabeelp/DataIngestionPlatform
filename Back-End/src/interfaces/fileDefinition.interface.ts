// =============================================================================
// File Definition Interface - Defines types for File Definitions
// =============================================================================

import type { ContractSnapshot } from '../services/validation/DefinitionContract';

/**
 * Column definition for a file definition
 */
export interface IColumn {
    name: string;
    type: 'string' | 'integer' | 'decimal' | 'datetime' | 'boolean';
    required: boolean;
}

/**
 * A table for one workbook sheet (definitions with one table per sheet).
 */
export interface ITable {
    sheet: string;
    columns: IColumn[];
}

/**
 * File Definition entity interface
 */
export interface IFileDefinition {
    Id: string;
    Name: string;
    Description: string;
    /** Single-table columns; empty when the definition has sheet tables. */
    Columns: IColumn[];
    /** One table per workbook sheet; empty (or absent) for single-table definitions. */
    Tables?: ITable[];
    Status: 'Active' | 'Inactive';
    CreatedAt: Date;
    UpdatedAt: Date;
    TemplateFilename?: string;
    /** Optional delivery folder relative to DELIVERY_ROOT_PATH */
    DeliveryFolder?: string | null;
    // User access (populated when fetching)
    AllowedUsers?: IFileDefinitionUser[];
}

/**
 * User access info for a file definition
 */
export interface IFileDefinitionUser {
    id: string;
    email: string;
    username: string;
    firstName: string | null;
    lastName: string | null;
}

/**
 * Create File Definition DTO
 */
export interface ICreateFileDefinitionDto {
    Name: string;
    Description: string;
    Columns: IColumn[];
    Tables?: ITable[];
    Status?: 'Active' | 'Inactive';
    TemplateFilename?: string;
    DeliveryFolder?: string | null;
    AllowedUserIds?: string[];
}

/**
 * Update File Definition DTO
 */
export interface IUpdateFileDefinitionDto {
    Name?: string;
    Description?: string;
    Columns?: IColumn[];
    Tables?: ITable[];
    Status?: 'Active' | 'Inactive';
    TemplateFilename?: string;
    DeliveryFolder?: string | null;
}

/**
 * Add users to file definition DTO
 */
export interface IAddUsersToDefinitionDto {
    UserIds: string[];
}

/**
 * Immutable snapshot of a definition's columns and enabled rules.
 */
export interface IFileDefinitionVersion {
    Id: string;
    FileDefinitionId: string;
    VersionNumber: number;
    Status: 'Active' | 'Superseded';
    Columns: ContractSnapshot['columns'];
    Tables: ContractSnapshot['tables'];
    Rules: ContractSnapshot['rules'];
    ChangeNote: string | null;
    CreatedBy: string | null;
    CreatedByName: string | null;
    ActivatedAt: Date;
    SupersededAt: Date | null;
}

/**
 * API Response for definitions list
 */
export interface IDefinitionsResponse {
    success: boolean;
    definitions: IFileDefinition[];
    total?: number;
}

/**
 * API Response for single definition
 */
export interface IDefinitionResponse {
    success: boolean;
    definition: IFileDefinition;
}


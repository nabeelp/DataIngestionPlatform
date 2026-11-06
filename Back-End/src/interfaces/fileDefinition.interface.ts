// =============================================================================
// File Definition Interface - Defines types for File Definitions
// =============================================================================

import type { DefinitionContract } from '../contracts/definition-contract';

/**
 * File Definition entity interface. The contract holds the tables, columns, layout and rules that validate a file.
 */
export interface IFileDefinition {
    Id: string;
    Name: string;
    Description: string;
    Contract: DefinitionContract;
    Status: 'Active' | 'Inactive';
    CreatedAt: Date;
    UpdatedAt: Date;
    TemplateFilename?: string | null;
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
    Contract: DefinitionContract;
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
    Contract?: DefinitionContract;
    Status?: 'Active' | 'Inactive';
    TemplateFilename?: string | null;
    DeliveryFolder?: string | null;
}

/**
 * Immutable snapshot of a definition's contract (tables, columns, enabled rules and the lookups they use).
 */
export interface IFileDefinitionVersion {
    Id: string;
    FileDefinitionId: string;
    VersionNumber: number;
    Status: 'Active' | 'Superseded';
    Contract: DefinitionContract;
    DefinitionMetadata: IDefinitionMetadataSnapshot | null;
    ChangeNote: string | null;
    CreatedBy: string | null;
    CreatedByName: string | null;
    ActivatedAt: Date;
    SupersededAt: Date | null;
}

export interface IDefinitionMetadataSnapshot {
    name: string;
    description: string;
    status: 'Active' | 'Inactive';
    deliveryFolder: string | null;
    templateFilename: string | null;
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

// =============================================================================
// File Definition Interface - Defines types for File Definitions
// =============================================================================

/**
 * Column definition for a file definition
 */
export interface IColumn {
    name: string;
    type: 'string' | 'integer' | 'decimal' | 'datetime' | 'boolean';
    required: boolean;
}

/**
 * File Definition entity interface
 */
export interface IFileDefinition {
    Id: string;
    Name: string;
    Description: string;
    Columns: IColumn[];
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


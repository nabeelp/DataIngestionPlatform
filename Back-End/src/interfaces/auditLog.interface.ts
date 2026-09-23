// =============================================================================
// AuditLog Interface - Type definitions for Audit Logs
// =============================================================================

export interface IAuditLog {
    Id: string;
    UserId: string | null;
    Action: string;
    EntityType: string | null;
    EntityId: string | null;
    Details: Record<string, any> | null;
    IpAddress: string | null;
    UserAgent: string | null;
    Timestamp: Date;
}

export interface ICreateAuditLogDto {
    UserId: string | null;
    Action: string;
    EntityType?: string | null;
    EntityId?: string | null;
    Details?: Record<string, any> | null;
    IpAddress?: string | null;
    UserAgent?: string | null;
}

// Common audit actions
export const AUDIT_ACTIONS = {
    // Authentication
    LOGIN: 'LOGIN',
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGOUT: 'LOGOUT',
    SSO_LOGIN: 'SSO_LOGIN',
    SSO_LOGIN_FAILED: 'SSO_LOGIN_FAILED',
    
    // User Management
    USER_CREATED: 'USER_CREATED',
    USER_UPDATED: 'USER_UPDATED',
    USER_DELETED: 'USER_DELETED',
    USER_UNLOCKED: 'USER_UNLOCKED',
    USER_SUSPENDED: 'USER_SUSPENDED',
    USER_ACTIVATED: 'USER_ACTIVATED',
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
    PASSWORD_RESET: 'PASSWORD_RESET',
    
    // File Definitions
    DEFINITION_CREATED: 'DEFINITION_CREATED',
    DEFINITION_UPDATED: 'DEFINITION_UPDATED',
    DEFINITION_DELETED: 'DEFINITION_DELETED',
    DEFINITION_ACCESS_GRANTED: 'DEFINITION_ACCESS_GRANTED',
    DEFINITION_ACCESS_REVOKED: 'DEFINITION_ACCESS_REVOKED',
    
    // Uploads
    FILE_UPLOADED: 'FILE_UPLOADED',
    FILE_VALIDATION_STARTED: 'FILE_VALIDATION_STARTED',
    FILE_VALIDATION_COMPLETED: 'FILE_VALIDATION_COMPLETED',
    FILE_VALIDATION_FAILED: 'FILE_VALIDATION_FAILED',
    FILE_DELIVERY_STARTED: 'FILE_DELIVERY_STARTED',
    FILE_DELIVERY_COMPLETED: 'FILE_DELIVERY_COMPLETED',
    FILE_DELIVERY_FAILED: 'FILE_DELIVERY_FAILED',
    FILE_DOWNLOADED: 'FILE_DOWNLOADED',
    FILE_DELETED: 'FILE_DELETED',
    
    // Rules
    RULE_CREATED: 'RULE_CREATED',
    RULE_UPDATED: 'RULE_UPDATED',
    RULE_DELETED: 'RULE_DELETED',
    RULE_ENABLED: 'RULE_ENABLED',
    RULE_DISABLED: 'RULE_DISABLED',
    
    // Admin Actions
    SYSTEM_SETTINGS_UPDATED: 'SYSTEM_SETTINGS_UPDATED',
    EXPORT_DATA: 'EXPORT_DATA',
    IMPORT_DATA: 'IMPORT_DATA',
} as const;

// Entity types for audit logs
export const ENTITY_TYPES = {
    USER: 'USER',
    FILE_DEFINITION: 'FILE_DEFINITION',
    UPLOAD: 'UPLOAD',
    RULE: 'RULE',
    VALIDATION_RESULT: 'VALIDATION_RESULT',
    DELIVERY_RECORD: 'DELIVERY_RECORD',
    SYSTEM: 'SYSTEM',
} as const;


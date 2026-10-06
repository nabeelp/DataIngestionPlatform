// =============================================================================
// Application Configuration - SSO and Auth Settings
// =============================================================================

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config();

// Ensure temp directory exists at startup
const ensureTempDirectory = (): string => {
    const tempDir = process.env.UPLOAD_TEMP_DIR || path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
};

// Initialize temp directory immediately
const TEMP_DIR = ensureTempDirectory();

const deliveryProvider = process.env.DELIVERY_PROVIDER ?? 'local';
if (deliveryProvider !== 'local' && deliveryProvider !== 'azure') {
    throw new Error('DELIVERY_PROVIDER must be either "local" or "azure".');
}

export const appConfig = {
    // Server
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    database: {
        connectionString: process.env.DB_CONNECTION_STRING || '',
        server: process.env.DB_SERVER || '',
        database: process.env.DB_DATABASE || '',
    },

    // JWT Configuration
    jwt: {
        secret: process.env.JWT_SECRET || '',
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },

    // Microsoft Azure AD SSO Configuration
    sso: {
        microsoft: {
            enabled: process.env.MS_SSO_ENABLED === 'true',
            clientId: process.env.MS_CLIENT_ID || '',
            clientSecret: process.env.MS_CLIENT_SECRET || '',
            tenantId: process.env.MS_TENANT_ID || '',
            authority: process.env.MS_AUTHORITY || 'https://login.microsoftonline.com',
            redirectUri: process.env.MS_REDIRECT_URI || 'http://localhost:5173/auth/callback',
            scopes: ['openid', 'profile', 'email', 'User.Read'],
        },
    },

    // Security
    security: {
        bcryptRounds: 10,
        maxLoginAttempts: 5,
        lockoutDurationMinutes: 30,
        passwordMinLength: 8,
    },

    // Frontend URL for CORS - allow multiple origins for development
    cors: {
        origin: process.env.CORS_ORIGIN 
            ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
            : ['http://localhost:5173', 'http://localhost:5174'],
        credentials: true,
    },

    // Rate Limiting (per client IP across /api). SPA pages issue several requests per view, so keep headroom.
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000)),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '1000'),
        loginMaxAttempts: 5, // limit login attempts
    },

    // Worker Configuration
    workers: {
        validation: {
            concurrency: parseInt(process.env.VALIDATION_WORKER_CONCURRENCY || '5'),
        },
        delivery: {
            concurrency: parseInt(process.env.DELIVERY_WORKER_CONCURRENCY || '5'),
        },
    },

    // Azure Storage Configuration
    azure: {
        foundry: {
            resource: process.env.AZURE_FOUNDRY_RESOURCE || 'aif-zlyway6g7icoy-0',
            project: process.env.AZURE_FOUNDRY_PROJECT || 'citadel-governance-project',
            model: process.env.AZURE_FOUNDRY_MODEL || 'gpt-5.3-codex',
        },
        storage: {
            connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
            accountUrl: process.env.AZURE_STORAGE_ACCOUNT_URL || '',
            containerName: process.env.AZURE_STORAGE_UPLOADS_CONTAINER || 'uploads',
            reportsContainerName: process.env.AZURE_STORAGE_REPORTS_CONTAINER || 'reports',
            stagingContainerName: process.env.AZURE_STORAGE_STAGING_CONTAINER || 'staging',
            deliveriesContainerName: process.env.AZURE_STORAGE_DELIVERIES_CONTAINER || 'deliveries',
            compressedContainerName: process.env.AZURE_STORAGE_COMPRESSED_CONTAINER || 'compressed',
        }
    },

    rulesService: {
        url: process.env.RULES_SERVICE_URL || 'http://localhost:8000',
        internalKey: process.env.RULES_SERVICE_DEV_KEY || '',
        aadScope: process.env.RULES_SERVICE_AAD_SCOPE || '',
        timeoutMs: parseInt(process.env.RULES_SERVICE_TIMEOUT_MS || '30000', 10),
    },

    serviceBus: {
        connectionString: process.env.SERVICEBUS_CONNECTION_STRING || '',
        namespace: process.env.SERVICEBUS_NAMESPACE || '',
        validationQueue: process.env.SERVICEBUS_VALIDATION_QUEUE || 'validation-requests',
        eventsTopic: process.env.SERVICEBUS_EVENTS_TOPIC || 'validation-events',
        eventsSubscription: process.env.SERVICEBUS_EVENTS_SUBSCRIPTION || 'api',
        deliveryQueue: process.env.SERVICEBUS_DELIVERY_QUEUE || 'delivery-requests',
        deliveryRetryBaseMs: parseInt(process.env.SERVICEBUS_DELIVERY_RETRY_BASE_MS || '5000', 10),
    },

    // SharePoint/Local Storage Configuration (Temporary replacement for Azure)
    sharePoint: {
        enabled: process.env.SHAREPOINT_ENABLED === 'true' || process.env.STORAGE_PROVIDER === 'sharepoint',
        localPath: process.env.SHAREPOINT_LOCAL_PATH || path.join(process.cwd(), 'sharepoint'),
    },

    // Storage Provider Configuration
    storage: {
        provider: process.env.STORAGE_PROVIDER ||
            (process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AZURE_STORAGE_ACCOUNT_URL ? 'azure' : 'sharepoint'),
    },

    // Stats Configuration
    stats: {
        cacheTtl: parseInt(process.env.STATS_CACHE_TTL || '300'), // seconds
        healthThresholds: {
            warning: 80,
            critical: 50
        }
    },

    // Upload Configuration
    upload: {
        tempDirectory: process.env.UPLOAD_TEMP_DIR || path.join(process.cwd(), 'temp'),
        maxFileSize: parseInt(process.env.UPLOAD_MAX_FILE_SIZE || '100'), // MB
        // Only tabular formats can be validated against a file definition.
        allowedExtensions: ['.csv', '.tsv', '.txt', '.xlsx', '.xlsm', '.xls', '.xlsb'],
    },

    // Optional file-copy delivery. Definition delivery folders are resolved under this root.
    delivery: {
        provider: deliveryProvider,
        rootPath: process.env.DELIVERY_ROOT_PATH || path.join(process.cwd(), 'deliveries'),
    }
};

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

const isRedisEnabled = (): boolean => {
    const value = process.env.REDIS_ENABLED;
    if (value === undefined) return (process.env.NODE_ENV || 'development') !== 'development';
    if (value !== 'true' && value !== 'false') {
        throw new Error('REDIS_ENABLED must be true or false');
    }
    return value === 'true';
};

export const appConfig = {
    // Server
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    database: {
        connectionString: process.env.DB_CONNECTION_STRING || '',
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

    // Redis Configuration
    redis: {
        enabled: isRedisEnabled(),
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
    },

    // Worker Configuration
    workers: {
        validation: {
            concurrency: parseInt(process.env.VALIDATION_WORKER_CONCURRENCY || '5'),
            maxJobsPerSecond: parseInt(process.env.VALIDATION_WORKER_MAX_JOBS || '10'),
        },
        delivery: {
            concurrency: parseInt(process.env.DELIVERY_WORKER_CONCURRENCY || '5'),
            maxJobsPerSecond: parseInt(process.env.DELIVERY_WORKER_MAX_JOBS || '10'),
        },
        // Job timeout configuration (in milliseconds)
        // Jobs running longer than this will be failed
        jobTimeout: parseInt(process.env.JOB_TIMEOUT_MS || '60000'), // default 1 minute
        // Sandbox limits for the generated code of each Natural Language rule, per upload.
        ruleSandbox: {
            timeLimitMs: parseInt(process.env.RULE_SANDBOX_TIME_LIMIT_MS || '20000'),
            memoryLimitBytes: parseInt(process.env.RULE_SANDBOX_MEMORY_LIMIT_MB || '64') * 1024 * 1024,
        },
    },

    // Azure Storage Configuration
    azure: {
        foundry: {
            resource: process.env.AZURE_FOUNDRY_RESOURCE || 'aif-zlyway6g7icoy-0',
            project: process.env.AZURE_FOUNDRY_PROJECT || 'citadel-governance-project',
            model: process.env.AZURE_FOUNDRY_MODEL || 'gpt-5.6-luna',
        },
        storage: {
            connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
            containerName: process.env.AZURE_STORAGE_CONTAINER || 'uploads',
            compressedContainerName: process.env.AZURE_STORAGE_COMPRESSED_CONTAINER || 'compressed',
        }
    },

    // SharePoint/Local Storage Configuration (Temporary replacement for Azure)
    sharePoint: {
        enabled: process.env.SHAREPOINT_ENABLED === 'true' || process.env.STORAGE_PROVIDER === 'sharepoint',
        localPath: process.env.SHAREPOINT_LOCAL_PATH || path.join(process.cwd(), 'sharepoint'),
    },

    // Storage Provider Configuration
    storage: {
        provider: process.env.STORAGE_PROVIDER || 'sharepoint', // 'azure' or 'sharepoint'
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
        allowedExtensions: ['.csv', '.tsv', '.txt', '.xlsx', '.xls'],
    },

    // Optional file-copy delivery. Definition delivery folders are resolved under this root.
    delivery: {
        rootPath: process.env.DELIVERY_ROOT_PATH || path.join(process.cwd(), 'deliveries'),
    }
};

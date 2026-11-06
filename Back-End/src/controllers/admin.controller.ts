// =============================================================================
// Admin Controller - barrel re-exporting the per-domain admin handlers
// =============================================================================

export { getStats } from './admin/stats.controller';
export { getUsers, createUser, updateUser, unlockUser, deleteUser } from './admin/users.controller';
export { getAuditLogs } from './admin/auditLogs.controller';
export { getQueueStats } from './admin/queue.controller';
export {
    getFileDefinitions,
    createFileDefinition,
    updateFileDefinition,
    preflightFileDefinition,
    deleteFileDefinition,
} from './admin/fileDefinitions.controller';

// =============================================================================
// Rule Controller - Business logic for Validation Rules
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import * as RuleService from '../services/Rule.service';
import {
    createNaturalLanguageRule,
    RuleGenerationCancelledError,
    RuleGenerationError,
} from '../services/NaturalLanguageRule.service';
import { DefinitionVersionError } from '../services/DefinitionVersion.service';
import type { 
    ICreateRuleDto, 
    IUpdateRuleDto 
} from '../interfaces/rule.interface';
import { IJwtPayload } from '../interfaces/user.interface';
import { logger } from '../utils/logger';

// Extend Request to include user
export interface AuthRequest extends Request {
    user?: IJwtPayload;
}

// A blank table name means the rule applies to a single-table definition.
const normalizeTableName = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

const NDJSON = 'application/x-ndjson';

/** A failure of the review as the client sees it: known errors keep their message, others are logged only. */
function describeGenerationFailure(error: unknown): { statusCode: number; message: string } {
    if (error instanceof RuleGenerationError) return { statusCode: error.statusCode, message: error.message };
    if (error instanceof DefinitionVersionError) return { statusCode: error.statusCode, message: error.message };
    return { statusCode: 500, message: 'An unexpected error stopped the rule review; see the backend log for details' };
}

/**
 * POST /rules/natural-language. With `Accept: application/x-ndjson` the response streams one JSON object per line:
 * `{ type: 'progress', level, message, elapsedMs }` while the review runs, then a final
 * `{ type: 'result', ... }` or `{ type: 'error', statusCode, message }`. Otherwise it returns a single JSON result.
 */
export const createRuleFromDescription = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const request = String(req.body.Request).trim();
    if (!String(req.headers.accept || '').includes(NDJSON)) {
        try {
            const result = await createNaturalLanguageRule(req.body.FileDefinitionId, request, req.user!.userId);
            return res.status(result.outcome === 'rejected' ? 200 : 201).json({ success: true, ...result });
        } catch (error) {
            logger.error('[RULE_CONTROLLER] Error creating rule from description:', error);
            if (error instanceof RuleGenerationError || error instanceof DefinitionVersionError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return next(error);
        }
    }

    res.status(200);
    res.setHeader('Content-Type', `${NDJSON}; charset=utf-8`);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Closing the drawer or navigating away closes the connection: stop the model call and save nothing.
    const abort = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded) abort.abort();
    });
    const send = (payload: object) => {
        if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
        const result = await createNaturalLanguageRule(req.body.FileDefinitionId, request, req.user!.userId, {
            signal: abort.signal,
            onProgress: event => send({ type: 'progress', ...event }),
        });
        send({ type: 'result', success: true, ...result });
    } catch (error) {
        if (error instanceof RuleGenerationCancelledError) {
            logger.info('[RULE_CONTROLLER] Natural-language rule review stopped by the client');
        } else {
            logger.error('[RULE_CONTROLLER] Error creating rule from description:', error);
            send({ type: 'error', success: false, ...describeGenerationFailure(error) });
        }
    } finally {
        res.end();
    }
};

/**
 * Get all rules for a specific file definition
 */
export const getRules = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const fileDefinitionId = req.params.fileDefinitionId as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!fileDefinitionId) {
            return res.status(400).json({ 
                success: false, 
                message: 'File Definition ID is required' 
            });
        }

        // Admins edit the draft rules; everyone else sees the rules of the active version that uploads are validated against.
        const published = req.user?.role !== 'admin';
        const { rules, versionNumber } = published
            ? await RuleService.getPublishedRules(fileDefinitionId, userId)
            : { rules: await RuleService.getRulesByFileDefinitionId(fileDefinitionId, userId), versionNumber: null };

        res.json({
            success: true,
            rules,
            total: rules.length,
            published,
            versionNumber
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error getting rules:', error);
        
        // Handle access denied error
        if (error instanceof Error && error.message === 'Access denied to this file definition') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this file definition' 
            });
        }
        
        next(error);
    }
};

/**
 * Get a single rule by ID
 */
export const getRuleById = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        const rule = await RuleService.getRuleById(ruleId, userId);

        if (!rule) {
            return res.status(404).json({ 
                success: false, 
                message: 'Rule not found' 
            });
        }

        res.json({
            success: true,
            rule
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error getting rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        next(error);
    }
};

/**
 * Create a new rule
 */
export const createRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        const { 
            FileDefinitionId, 
            Name, 
            Description, 
            RuleType, 
            Severity, 
            ExecutionOrder, 
            SqlQuery, 
            IsEnabled,
            TableName
        } = req.body;

        // Validate required fields
        if (!FileDefinitionId || !Name || !SqlQuery) {
            return res.status(400).json({ 
                success: false, 
                message: 'FileDefinitionId, Name, and SqlQuery are required' 
            });
        }

        const dto: ICreateRuleDto = {
            FileDefinitionId,
            Name,
            Description,
            RuleType,
            Severity,
            ExecutionOrder,
            SqlQuery,
            IsEnabled,
            TableName: normalizeTableName(TableName)
        };

        const rule = await RuleService.createRule(dto, userId);

        res.status(201).json({
            success: true,
            rule,
            message: 'Rule created successfully'
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error creating rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this file definition') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this file definition' 
            });
        }
        
        if (error instanceof RuleService.RuleValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }

        next(error);
    }
};

/**
 * Update a rule
 */
export const updateRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        const { 
            Name, 
            Description, 
            RuleType, 
            Severity, 
            ExecutionOrder, 
            SqlQuery, 
            IsEnabled,
            TableName
        } = req.body;

        const updates: IUpdateRuleDto = {};
        
        if (Name !== undefined) updates.Name = Name;
        if (Description !== undefined) updates.Description = Description;
        if (RuleType !== undefined) updates.RuleType = RuleType;
        if (Severity !== undefined) updates.Severity = Severity;
        if (ExecutionOrder !== undefined) updates.ExecutionOrder = ExecutionOrder;
        if (SqlQuery !== undefined) updates.SqlQuery = SqlQuery;
        if (IsEnabled !== undefined) updates.IsEnabled = IsEnabled;
        if (TableName !== undefined) updates.TableName = normalizeTableName(TableName);

        const rule = await RuleService.updateRule(ruleId, updates, userId);

        if (!rule) {
            return res.status(404).json({ 
                success: false, 
                message: 'Rule not found' 
            });
        }

        res.json({
            success: true,
            rule,
            message: 'Rule updated successfully'
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error updating rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        if (error instanceof RuleService.RuleValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }

        next(error);
    }
};

/**
 * Delete a rule
 */
export const deleteRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        await RuleService.deleteRule(ruleId, userId);

        res.json({
            success: true,
            message: 'Rule deleted successfully'
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error deleting rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        next(error);
    }
};

/**
 * Toggle rule enabled/disabled status
 */
export const toggleRule = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const ruleId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized' 
            });
        }

        if (!ruleId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Rule ID is required' 
            });
        }

        const rule = await RuleService.toggleRuleEnabled(ruleId, userId);

        if (!rule) {
            return res.status(404).json({ 
                success: false, 
                message: 'Rule not found' 
            });
        }

        res.json({
            success: true,
            rule,
            message: `Rule ${rule.IsEnabled ? 'enabled' : 'disabled'} successfully`
        });
    } catch (error) {
        logger.error('[RULE_CONTROLLER] Error toggling rule:', error);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        if (error instanceof RuleService.RuleValidationError) {
            return res.status(400).json({ success: false, message: error.message });
        }

        next(error);
    }
};

// =============================================================================
// Rule Controller - Business logic for Validation Rules
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import * as RuleService from '../services/Rule.service';
import {
    proposeNaturalLanguageRule,
    RuleGenerationCancelledError,
    RuleGenerationError,
} from '../services/NaturalLanguageRule.service';
import { DefinitionVersionError, DefinitionVersionService } from '../services/DefinitionVersion.service';
import { AuthoringInputError, buildAuthoringContract, getDraftRevision } from '../services/RuleAuthoring.service';
import { getConnection } from '../config/database';
import type { DefinitionContract } from '../contracts/definition-contract';
import { RulesService } from '../services/RulesService.service';
import { Rule } from '../models/Rule.model';
import type { RuleConfig } from '../contracts/rule-config';
import { IJwtPayload } from '../interfaces/user.interface';
import { logger } from '../utils/logger';

// Extend Request to include user
export interface AuthRequest extends Request {
    user?: IJwtPayload;
}

const NDJSON = 'application/x-ndjson';

/** A failure of the review as the client sees it: known errors keep their message, others are logged only. */
function describeGenerationFailure(error: unknown): { statusCode: number; message: string } {
    if (error instanceof RuleGenerationError) return { statusCode: error.statusCode, message: error.message };
    if (error instanceof DefinitionVersionError) return { statusCode: error.statusCode, message: error.message };
    if (error instanceof AuthoringInputError) return { statusCode: error.statusCode, message: error.message };
    return { statusCode: 500, message: 'An unexpected error stopped the rule review; see the backend log for details' };
}

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

        // Admins edit the draft rules; everyone else (and admins asking for `?published=true`) sees the rules of the
        // active version that uploads are validated against.
        const published = req.user?.role !== 'admin' || req.query.published === 'true';
        const { rules, versionNumber } = published
            ? await RuleService.getPublishedRules(fileDefinitionId, userId)
            : { rules: await RuleService.getRulesByFileDefinitionId(fileDefinitionId, userId), versionNumber: null };

        const revision = published ? null : await getDraftRevision(await getConnection(), fileDefinitionId);

        res.json({
            success: true,
            rules: rules.map(rule => rule.Config),
            total: rules.length,
            published,
            versionNumber,
            revision
        });
    } catch (error) {
        logger.error(`[RULE_CONTROLLER] Rule listing failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
        
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
 * The contract a rule is checked against. The definition workspace sends its unsaved structure and rules as
 * `Contract`/`Rules`; without them the saved draft of `FileDefinitionId` is used.
 */
async function resolveAuthoringContract(
    req: AuthRequest,
    config: RuleConfig | undefined,
): Promise<DefinitionContract> {
    if (req.body.Contract) {
        return buildAuthoringContract(req.body.Contract, req.body.Rules, { candidate: config });
    }
    const fileDefinitionId = String(req.body.FileDefinitionId || '');
    if (!await Rule.hasAccessToFileDefinition(fileDefinitionId, req.user!.userId)) {
        throw new RuleGenerationError('Access denied to this file definition', 403);
    }
    const excludeRuleId = typeof config?.id === 'string' ? config.id : undefined;
    const contract = await DefinitionVersionService.getDraftContract(fileDefinitionId, excludeRuleId);
    return buildAuthoringContract(contract, contract.rules, { candidate: config });
}

const respondAuthoringFailure = (error: unknown, res: Response, next: NextFunction) => {
    if (error instanceof AuthoringInputError || error instanceof RuleGenerationError || error instanceof DefinitionVersionError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
};

export const validateRuleConfiguration = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        const config = req.body.Config as RuleConfig | undefined;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        if (!config) return res.status(400).json({ success: false, message: 'RuleConfig is required' });
        const contract = await resolveAuthoringContract(req, config);
        const result = await RulesService.validateRule(contract, config);
        return res.json({ success: true, ...result });
    } catch (error) {
        logger.error(`[RULE_CONTROLLER] Rule configuration validation failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
        return respondAuthoringFailure(error, res, next);
    }
};

export const testRuleConfiguration = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.user?.userId;
        const config = req.body.Config as RuleConfig | undefined;
        const examples = Array.isArray(req.body.examples) ? req.body.examples as unknown[] : undefined;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        if (!config) return res.status(400).json({ success: false, message: 'RuleConfig is required' });
        const contract = await resolveAuthoringContract(req, config);
        const result = await RulesService.testRule(contract, config, examples);
        return res.json({ success: true, ...result });
    } catch (error) {
        logger.error(`[RULE_CONTROLLER] Rule example test failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
        return respondAuthoringFailure(error, res, next);
    }
};

/**
 * POST /rules/natural-language/propose. Reviews a plain-language rule against the workspace's unsaved draft and
 * returns the proposed RuleConfig without saving it. With `Accept: application/x-ndjson` the response streams one
 * JSON object per line: `{ type: 'progress', level, message, elapsedMs }` while the review runs, then a final
 * `{ type: 'result', ... }` or `{ type: 'error', statusCode, message }`. Otherwise it returns a single JSON result.
 */
export const proposeRuleFromDescription = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const request = String(req.body.Request).trim();
    const existing = req.body.Config as RuleConfig | undefined;
    let contract: DefinitionContract;
    try {
        contract = await buildAuthoringContract(req.body.Contract, req.body.Rules, { excludeRuleId: existing?.id });
    } catch (error) {
        return respondAuthoringFailure(error, res, next);
    }
    const identity = existing && existing.type === 'naturalLanguage' ? existing : undefined;

    if (!String(req.headers.accept || '').includes(NDJSON)) {
        try {
            const result = await proposeNaturalLanguageRule(contract, request, {}, identity);
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            logger.error(`[RULE_CONTROLLER] Natural-language rule proposal failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            return respondAuthoringFailure(error, res, next);
        }
    }

    res.status(200);
    res.setHeader('Content-Type', `${NDJSON}; charset=utf-8`);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded) abort.abort();
    });
    const send = (payload: object) => {
        if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
        const result = await proposeNaturalLanguageRule(contract, request, {
            signal: abort.signal,
            onProgress: event => send({ type: 'progress', ...event }),
        }, identity);
        send({ type: 'result', success: true, ...result });
    } catch (error) {
        if (error instanceof RuleGenerationCancelledError) {
            logger.info('[RULE_CONTROLLER] Natural-language rule proposal stopped by the client');
        } else {
            logger.error(`[RULE_CONTROLLER] Natural-language rule proposal failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
            send({ type: 'error', success: false, ...describeGenerationFailure(error) });
        }
    } finally {
        res.end();
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
            rule: rule.Config
        });
    } catch (error) {
        logger.error(`[RULE_CONTROLLER] Rule lookup failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
        
        if (error instanceof Error && error.message === 'Access denied to this rule') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied to this rule' 
            });
        }
        
        next(error);
    }
};

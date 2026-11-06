// =============================================================================
// Rule Controller - Business logic for Validation Rules
// =============================================================================

import type { Request } from 'express';
import * as RuleService from '../services/Rule.service';
import {
    proposeNaturalLanguageRule,
    RuleGenerationCancelledError,
} from '../services/NaturalLanguageRule.service';
import { DefinitionVersionService } from '../services/DefinitionVersion.service';
import { buildAuthoringContract, getDraftRevision } from '../services/RuleAuthoring.service';
import { getConnection } from '../config/database';
import type { DefinitionContract } from '../contracts/definition-contract';
import { RulesService } from '../services/RulesService.service';
import { Rule } from '../models/Rule.model';
import type { RuleConfig } from '../contracts/rule-config';
import { asyncHandler } from '../middleware/asyncHandler';
import { toHttpFailure } from '../middleware/errorHandler';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from '../utils/httpError';
import { logger } from '../utils/logger';

const NDJSON = 'application/x-ndjson';

const unauthorized = () => new HttpError('Unauthorized', 401);

/** A failure of the review as the client sees it: known errors keep their message, others are logged only. */
function describeGenerationFailure(error: unknown): { statusCode: number; message: string } {
    if (error instanceof HttpError) return toHttpFailure(error);
    return { statusCode: 500, message: 'An unexpected error stopped the rule review; see the backend log for details' };
}

/**
 * Get all rules for a specific file definition
 */
export const getRules = asyncHandler(async (req, res) => {
    const fileDefinitionId = req.params.fileDefinitionId as string;
    const userId = req.user?.userId;

    if (!userId) {
        throw unauthorized();
    }

    if (!fileDefinitionId) {
        throw new BadRequestError('File Definition ID is required');
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
});

/**
 * The contract a rule is checked against. The definition workspace sends its unsaved structure and rules as
 * `Contract`/`Rules`; without them the saved draft of `FileDefinitionId` is used.
 */
async function resolveAuthoringContract(
    req: Request,
    config: RuleConfig | undefined,
): Promise<DefinitionContract> {
    if (req.body.Contract) {
        return buildAuthoringContract(req.body.Contract, req.body.Rules, { candidate: config });
    }
    const fileDefinitionId = String(req.body.FileDefinitionId || '');
    if (!await Rule.hasAccessToFileDefinition(fileDefinitionId, req.user!.userId)) {
        throw new ForbiddenError('Access denied to this file definition');
    }
    const excludeRuleId = typeof config?.id === 'string' ? config.id : undefined;
    const contract = await DefinitionVersionService.getDraftContract(fileDefinitionId, excludeRuleId);
    return buildAuthoringContract(contract, contract.rules, { candidate: config });
}

export const validateRuleConfiguration = asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    const config = req.body.Config as RuleConfig | undefined;
    if (!userId) throw unauthorized();
    if (!config) throw new BadRequestError('RuleConfig is required');
    const contract = await resolveAuthoringContract(req, config);
    const result = await RulesService.validateRule(contract, config);
    res.json({ success: true, ...result });
});

export const testRuleConfiguration = asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    const config = req.body.Config as RuleConfig | undefined;
    const examples = Array.isArray(req.body.examples) ? req.body.examples as unknown[] : undefined;
    if (!userId) throw unauthorized();
    if (!config) throw new BadRequestError('RuleConfig is required');
    const contract = await resolveAuthoringContract(req, config);
    const result = await RulesService.testRule(contract, config, examples);
    res.json({ success: true, ...result });
});

/**
 * POST /rules/natural-language/propose. Reviews a plain-language rule against the workspace's unsaved draft and
 * returns the proposed RuleConfig without saving it. With `Accept: application/x-ndjson` the response streams one
 * JSON object per line: `{ type: 'progress', level, message, elapsedMs }` while the review runs, then a final
 * `{ type: 'result', ... }` or `{ type: 'error', statusCode, message }`. Otherwise it returns a single JSON result.
 */
export const proposeRuleFromDescription = asyncHandler(async (req, res) => {
    const request = String(req.body.Request).trim();
    const existing = req.body.Config as RuleConfig | undefined;
    const contract = await buildAuthoringContract(req.body.Contract, req.body.Rules, { excludeRuleId: existing?.id });
    const identity = existing && existing.type === 'naturalLanguage' ? existing : undefined;

    if (!String(req.headers.accept || '').includes(NDJSON)) {
        const result = await proposeNaturalLanguageRule(contract, request, {}, identity);
        res.status(200).json({ success: true, ...result });
        return;
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
});

/**
 * Get a single rule by ID
 */
export const getRuleById = asyncHandler(async (req, res) => {
    const ruleId = req.params.id as string;
    const userId = req.user?.userId;

    if (!userId) {
        throw unauthorized();
    }

    if (!ruleId) {
        throw new BadRequestError('Rule ID is required');
    }

    const rule = await RuleService.getRuleById(ruleId, userId);

    if (!rule) {
        throw new NotFoundError('Rule not found');
    }

    res.json({
        success: true,
        rule: rule.Config
    });
});

import type { DefinitionContract } from '../contracts/definition-contract';
import type { RuleConfig } from '../contracts/rule-config';
import { appConfig } from '../config/appConfig';

export interface RulesServiceErrorItem {
    path: string;
    message: string;
}

export interface RuleValidationResponse {
    ok: boolean;
    errors: RulesServiceErrorItem[];
    normalizedRule: RuleConfig | null;
    explanation: string | null;
}

export interface RuleTestResponse {
    ok: boolean;
    errors: RulesServiceErrorItem[];
    results: Array<{
        index: number;
        table: string;
        expectedValid: boolean;
        actualValid: boolean;
        passed: boolean;
        error: string | null;
    }>;
}

export interface ContractValidationResponse {
    ok: boolean;
    errors: RulesServiceErrorItem[];
}

export interface DryRunResponse {
    status: string;
    [key: string]: unknown;
}

export class RulesServiceError extends Error {
    constructor(message: string, readonly statusCode = 502) {
        super(message);
        this.name = 'RulesServiceError';
    }
}

async function post<T>(path: string, body: unknown): Promise<T> {
    if (!appConfig.rulesService.internalKey) {
        throw new RulesServiceError('The rules service credential is not configured.', 503);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), appConfig.rulesService.timeoutMs);
    timeout.unref();

    try {
        const response = await fetch(new URL(path, appConfig.rulesService.url), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-rules-service-key': appConfig.rulesService.internalKey,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const statusCode = response.status === 400 || response.status === 422 ? 400 : 502;
            throw new RulesServiceError(`The rules service returned HTTP ${response.status}.`, statusCode);
        }
        try {
            return await response.json() as T;
        } catch {
            throw new RulesServiceError('The rules service returned an invalid response.', 502);
        }
    } catch (error) {
        if (error instanceof RulesServiceError) throw error;
        if (controller.signal.aborted) {
            throw new RulesServiceError('The rules service request timed out.', 504);
        }
        throw new RulesServiceError('The rules service could not be reached.', 502);
    } finally {
        clearTimeout(timeout);
    }
}

export const RulesService = {
    validateRule(contract: DefinitionContract, rule: RuleConfig): Promise<RuleValidationResponse> {
        return post('/v1/rules/validate', { contract, rule });
    },

    testRule(
        contract: DefinitionContract,
        rule: RuleConfig,
        examples?: unknown[],
    ): Promise<RuleTestResponse> {
        return post('/v1/rules/test', { contract, rule, examples });
    },

    validateContract(contract: DefinitionContract): Promise<ContractValidationResponse> {
        return post('/v1/contracts/validate', { contract });
    },

    dryRun(contract: DefinitionContract, uploadId: string): Promise<DryRunResponse> {
        return post('/v1/dry-run', { contract, uploadId });
    },

    analyzeExample(blob: { container: string; name: string }): Promise<Record<string, unknown>> {
        return post('/v1/examples/analyze', { blob });
    },
};

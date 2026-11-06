import type { RuleConfig } from '../../contracts/rule-config';
import type { RuleSeverity } from '../../interfaces/rule.interface';

export type Decision = 'mapped' | 'natural_language' | 'rejected';

export interface Proposal {
    decision: Decision;
    reason: string;
    name: string;
    severity: RuleSeverity;
    table: string | null;
    type: RuleConfig['type'];
    params: Record<string, unknown>;
    examples: ProposalExample[];
}

export interface ProposalExampleValue {
    column: string;
    value: string | null;
}

export interface ProposalExample {
    /** Where the model wrote the example (for example "failingExamples[1]"), so feedback can point at it. */
    label: string;
    table: string;
    values: ProposalExampleValue[];
    expectedValid: boolean;
    relatedRows: Array<{ table: string; values: ProposalExampleValue[] }>;
}

export interface ModelUsage {
    inputTokens: number | null;
    outputTokens: number | null;
}

export interface ModelProposal {
    proposal: Proposal;
    responseId: string;
    promptSha256: string;
    usage: ModelUsage;
}

export interface ModelExamples {
    examples: ProposalExample[];
    responseId: string;
    usage: ModelUsage;
}

export type NaturalLanguageRuleResult =
    | { outcome: 'rejected'; reason: string }
    | { outcome: 'mapped' | 'natural_language'; reason: string; config: RuleConfig };

export type ProgressLevel = 'info' | 'success' | 'warning' | 'error';

export interface RuleProgressEvent {
    level: ProgressLevel;
    message: string;
    elapsedMs: number;
}

/**
 * Detailed, per-attempt records for offline evaluation (npm run eval:nl-rules). They contain the model's proposals and the
 * validator's precise problems, so they must never be sent to a client or written to service logs.
 */
export interface RuleDiagnosticEvent {
    kind: 'model-call' | 'validation-failure';
    purpose?: 'rule' | 'examples';
    attempt: number;
    responseId?: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    proposal?: unknown;
    phase?: 'configuration' | 'validation' | 'examples';
    scope?: 'rule' | 'examples';
    problem?: string;
    paths?: string[];
}

export interface NaturalLanguageRuleOptions {
    onProgress?: (event: RuleProgressEvent) => void;
    onDiagnostic?: (event: RuleDiagnosticEvent) => void;
    signal?: AbortSignal;
}

export interface PreviousAttempt {
    problem: string;
}

export type Report = (level: ProgressLevel, message: string) => void;

export interface ModelCall {
    instructions: string;
    input: string;
    schemaName: string;
    schema: object;
    noun: string;
}

export interface ModelCallResult {
    text: string;
    responseId: string;
    promptSha256: string;
    usage: ModelUsage;
}

export { proposeNaturalLanguageRule } from './proposal';
export { RuleGenerationCancelledError, RuleGenerationError } from './errors';
export { MAX_WHITESPACE_RUN } from './constants';
export { responseText, trailingWhitespaceRun } from './modelClient';
export type {
    NaturalLanguageRuleOptions,
    NaturalLanguageRuleResult,
    ProgressLevel,
    RuleDiagnosticEvent,
    RuleProgressEvent,
} from './types';

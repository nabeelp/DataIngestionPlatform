import {
    isInfrastructureFailure,
    liveEvaluationConfirmed,
    rulesServiceSupportsCrossSheet,
} from '../scripts/eval-nl-rules';

describe('infrastructure failures are separated from model quality', () => {
    it.each([
        'RuleGenerationError: The rules service could not complete validation. Nothing was saved.',
        'ModelCallError: Could not connect to Foundry',
        'ModelCallError: The call to the model failed',
        'ModelCallError: The model did not respond within 120 seconds',
        'ModelCallError: Foundry returned an error (503)',
        'ModelCallError: Foundry is rate-limiting requests to "gpt" (429)',
    ])('treats "%s" as an outage', message => {
        expect(isInfrastructureFailure(message)).toBe(true);
    });

    it.each([
        'ModelCallError: The model declined to review the rule',
        'ModelCallError: Foundry denied access (403)',
        'RuleGenerationError: A Natural Language rule request is required',
    ])('does not hide "%s" as an outage', message => {
        expect(isInfrastructureFailure(message)).toBe(false);
    });
});

describe('rules service capability check for the live evaluation', () => {
    it('accepts a service that reports the cross-sheet feature', () => {
        expect(rulesServiceSupportsCrossSheet({ status: 'ok', features: ['nl-cross-sheet-v1'] })).toBe(true);
    });

    it('rejects a stale service that reports no features', () => {
        expect(rulesServiceSupportsCrossSheet({ status: 'ok' })).toBe(false);
        expect(rulesServiceSupportsCrossSheet({ status: 'ok', features: [] })).toBe(false);
        expect(rulesServiceSupportsCrossSheet(null)).toBe(false);
    });
});

describe('live natural-language evaluation confirmation', () => {
    it('accepts --yes when it is forwarded to the script', () => {
        expect(liveEvaluationConfirmed(['--yes'], {})).toBe(true);
    });

    it('accepts npm run eval:nl-rules --yes, which npm exposes through npm_config_yes', () => {
        expect(liveEvaluationConfirmed([], { npm_config_yes: 'true' })).toBe(true);
    });

    it('remains a dry run without explicit confirmation', () => {
        expect(liveEvaluationConfirmed([], {})).toBe(false);
    });
});

import type { DefinitionContract } from '../../contracts/definition-contract';
import { callModel } from './modelClient';
import { readExamplesResponse, readProposal } from './modelResponse';
import { buildExamplesCall, buildProposalCall } from './prompt';
import type { ModelExamples, ModelProposal, PreviousAttempt, Proposal, Report } from './types';

export async function requestProposal(
    request: string,
    contract: DefinitionContract,
    previousAttempt: PreviousAttempt | null,
    report: Report,
    signal?: AbortSignal,
): Promise<ModelProposal> {
    const result = await callModel(buildProposalCall(request, contract, previousAttempt), report, signal);
    return {
        proposal: readProposal(result.text),
        responseId: result.responseId,
        promptSha256: result.promptSha256,
        usage: result.usage,
    };
}

/** Asks for new examples for a rule whose SQL was already accepted, so a bad example does not discard the SQL. */
export async function requestExamples(
    request: string,
    contract: DefinitionContract,
    proposal: Proposal,
    feedback: string,
    report: Report,
    signal?: AbortSignal,
): Promise<ModelExamples> {
    const result = await callModel(buildExamplesCall(request, contract, proposal, feedback), report, signal);
    return { examples: readExamplesResponse(result.text), responseId: result.responseId, usage: result.usage };
}

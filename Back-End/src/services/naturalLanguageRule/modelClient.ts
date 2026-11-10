import { createHash } from 'node:crypto';
import { validateHeaderName } from 'node:http';
import OpenAI from 'openai';
import type { Response as ModelResponse, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { appConfig } from '../../config/appConfig';
import { logger } from '../../utils/logger';
import { HEARTBEAT_MS, MAX_OUTPUT_TOKENS, MAX_WHITESPACE_RUN, MODEL_TIMEOUT_MS } from './constants';
import { ModelCallError, RuleGenerationCancelledError, RuleGenerationError } from './errors';
import type { ModelCall, ModelCallResult, Report } from './types';

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

export function trailingWhitespaceRun(previousRun: number, delta: string): number {
    const trimmed = delta.replace(/\s+$/, '');
    const trailing = delta.length - trimmed.length;
    return trimmed.length === 0 ? previousRun + trailing : trailing;
}

export function responseText(response: Pick<ModelResponse, 'output'>): { text: string; refusal: string | null } {
    let text = '';
    let refusal: string | null = null;
    for (const item of response.output ?? []) {
        if (item.type !== 'message') continue;
        for (const part of item.content) {
            if (part.type === 'output_text') text += part.text;
            else if (part.type === 'refusal') refusal = (refusal ?? '') + part.refusal;
        }
    }
    return { text, refusal };
}

const isAbort = (error: unknown, signal?: AbortSignal): boolean =>
    Boolean(signal?.aborted) || (error as Error)?.name === 'AbortError' || (error as Error)?.name === 'APIUserAbortError';

let cachedClient: { key: string; client: OpenAI } | null = null;

function modelClient(config: { endpoint: string; subscriptionKey: string; subscriptionKeyHeader: string }): OpenAI {
    const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if (cachedClient?.key !== key) {
        cachedClient = {
            key,
            client: new OpenAI({
                baseURL: config.endpoint.replace(/\/+$/, ''),
                apiKey: config.subscriptionKey,
                defaultHeaders: {
                    Authorization: null,
                    [config.subscriptionKeyHeader]: config.subscriptionKey,
                },
                timeout: MODEL_TIMEOUT_MS,
                maxRetries: 1,
            }),
        };
    }
    return cachedClient.client;
}

export async function callModel(
    call: ModelCall,
    report: Report,
    signal?: AbortSignal,
): Promise<ModelCallResult> {
    const config = appConfig.azure.citadel;
    let endpoint: URL;
    try {
        endpoint = new URL(config.endpoint);
    } catch {
        throw new RuleGenerationError('CITADEL_ENDPOINT must be a valid HTTPS URL');
    }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new RuleGenerationError('CITADEL_ENDPOINT must be an HTTPS URL without credentials, query parameters or a fragment');
    }
    if (!config.subscriptionKey.trim() || !config.model.trim()) {
        throw new RuleGenerationError('Citadel requires CITADEL_SUBSCRIPTION_KEY and a non-empty CITADEL_MODEL');
    }
    try {
        validateHeaderName(config.subscriptionKeyHeader);
    } catch {
        throw new RuleGenerationError('CITADEL_SUBSCRIPTION_KEY_HEADER must be a valid, non-empty HTTP header name');
    }

    const { instructions, input } = call;
    const promptSha256 = createHash('sha256').update(`${instructions}\n${input}`).digest('hex');
    const client = modelClient(config);
    const started = Date.now();
    let phase: 'connecting' | 'reasoning' | 'writing' = 'connecting';
    let received = 0;
    let finalResponse: ModelResponse | undefined;
    let streamError: string | null = null;
    let lastEventAt = Date.now();
    let whitespaceRun = 0;
    let runaway = false;
    const abortCall = new AbortController();
    const forwardAbort = () => abortCall.abort();
    signal?.addEventListener('abort', forwardAbort);

    const heartbeat = setInterval(() => {
        if (Date.now() - lastEventAt < HEARTBEAT_MS - 100) return;
        const waited = seconds(Date.now() - started);
        report('info', phase === 'connecting'
            ? `Still waiting for Citadel to accept the request (${waited})`
            : phase === 'reasoning'
                ? `The model is still reasoning about the rule (${waited})`
                : `Still receiving the ${call.noun} (${received} characters, ${waited})`);
        lastEventAt = Date.now();
    }, HEARTBEAT_MS);

    try {
        const stream = await client.responses.create({
            model: config.model,
            instructions,
            text: { format: { type: 'json_schema', name: call.schemaName, strict: true, schema: call.schema as Record<string, unknown> } },
            input,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            store: false,
            stream: true,
        }, { signal: abortCall.signal });

        for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
            switch (event.type) {
                case 'response.created':
                    lastEventAt = Date.now();
                    report('info', `Citadel accepted the request after ${seconds(Date.now() - started)} (response ${event.response.id})`);
                    break;
                case 'response.output_item.added':
                    if (event.item.type === 'reasoning' && phase === 'connecting') {
                        phase = 'reasoning';
                        lastEventAt = Date.now();
                        report('info', 'The model is reasoning about the rule');
                    }
                    break;
                case 'response.output_text.delta':
                    received += event.delta.length;
                    if (phase !== 'writing') {
                        phase = 'writing';
                        lastEventAt = Date.now();
                        report('info', `The model is writing its ${call.noun}`);
                    }
                    whitespaceRun = trailingWhitespaceRun(whitespaceRun, event.delta);
                    if (whitespaceRun > MAX_WHITESPACE_RUN) {
                        runaway = true;
                        abortCall.abort();
                    }
                    break;
                case 'response.completed':
                case 'response.incomplete':
                case 'response.failed':
                    finalResponse = event.response;
                    break;
                case 'error':
                    streamError = `${event.code ?? 'error'}: ${event.message}`;
                    break;
            }
        }
    } catch (error) {
        if (signal?.aborted || (!runaway && isAbort(error, signal))) throw new RuleGenerationCancelledError();
        if (!runaway) {
            const status = typeof (error as { status?: unknown })?.status === 'number'
                ? (error as { status: number }).status
                : undefined;
            const name = (error as Error)?.name ?? '';
            if (status === 401 || status === 403) {
                throw new ModelCallError(`Citadel denied access (${status})`, false);
            }
            if (status === 404) throw new ModelCallError(`Citadel could not find model deployment "${config.model}" (404)`, false, 404);
            if (status === 429) throw new ModelCallError(`Citadel is rate-limiting requests to "${config.model}" (429)`, true);
            if (status !== undefined) throw new ModelCallError(`Citadel returned an error (${status})`, status >= 500);
            if (/Timeout/i.test(name)) throw new ModelCallError(`The model did not respond within ${MODEL_TIMEOUT_MS / 1000} seconds`, true);
            if (/Connection/i.test(name)) throw new ModelCallError('Could not connect to Citadel', true);
            // An unclassified failure (typically a dropped connection) is worth one more try; auth and 4xx are classified above.
            throw new ModelCallError('The call to the model failed', true);
        }
    } finally {
        clearInterval(heartbeat);
        signal?.removeEventListener('abort', forwardAbort);
    }

    if (runaway) throw new ModelCallError('The model got stuck writing whitespace instead of finishing its proposal', true);
    const responseId = finalResponse?.id;
    const output = finalResponse ? responseText(finalResponse) : { text: '', refusal: null };
    if (finalResponse && process.env.NATURAL_LANGUAGE_RULE_DEBUG === 'true') {
        logger.info(`[NATURAL_LANGUAGE_RULE_DEBUG] ${JSON.stringify({
            responseId,
            status: finalResponse.status,
            usage: finalResponse.usage,
            refusal: output.refusal,
            output: output.text,
        })}`);
    }
    if (streamError || !finalResponse || finalResponse.status !== 'completed') {
        const status = finalResponse?.status ?? 'connection closed';
        if (finalResponse && output.refusal) {
            throw new ModelCallError('The model declined to review the rule', false, 400);
        }
        const retryable = !finalResponse || finalResponse.status !== 'failed'
            || ['server_error', 'rate_limit_exceeded'].includes(finalResponse.error?.code ?? '');
        const message = streamError
            ? 'The model service reported an error while responding'
            : `The model stopped before returning a complete proposal (${status})`;
        throw new ModelCallError(`${message}${responseId ? ` [response ${responseId}]` : ''}`, retryable);
    }
    if (!responseId) throw new ModelCallError('The model response did not include a response ID', true);
    if (output.refusal) {
        throw new ModelCallError('The model declined to review the rule', false, 400);
    }
    const text = output.text;
    if (!text.trim()) throw new ModelCallError('The model finished without returning a proposal', true);
    const usage = finalResponse.usage;
    report('info', `The model finished in ${seconds(Date.now() - started)}${usage ? ` (${usage.output_tokens} output tokens)` : ''}`);
    return {
        text,
        responseId,
        promptSha256,
        usage: { inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null },
    };
}

// =============================================================================
// Natural-language rule authoring API - streams the review's activity while the model works
// =============================================================================

import type { RuleConfig } from '../contracts/rule-config';

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';

export interface ReviewActivity {
  level: ActivityLevel;
  message: string;
  /** Milliseconds since the review started on the server. */
  elapsedMs: number;
}

export type ReviewResult =
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'mapped' | 'natural_language'; reason: string; config: RuleConfig };

export interface RuleConfigValidationResult {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
}

export interface RuleExampleTestResult extends RuleConfigValidationResult {
  results: Array<{
    index: number;
    table: string;
    expectedValid: boolean;
    actualValid: boolean;
    passed: boolean;
    error: string | null;
  }>;
}

const NDJSON = 'application/x-ndjson';

const requestHeaders = (token: string | null, accept?: string): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(accept ? { Accept: accept } : {}),
  ...(token ? { Authorization: ['Bearer', token].join(' ') } : {}),
});

/**
 * Parse a newline-delimited JSON stream, calling `onEvent` for every complete line as it arrives.
 */
export async function readNdjson(body: ReadableStream<Uint8Array>, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('The server sent an update that could not be read');
    }
    if (event && typeof event === 'object' && !Array.isArray(event)) onEvent(event as Record<string, unknown>);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      emit(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  emit(buffer + decoder.decode());
}

interface ReviewOptions {
  baseUrl: string;
  token: string | null;
  fileDefinitionId: string;
  request: string;
  signal?: AbortSignal;
  onActivity: (activity: ReviewActivity) => void;
}

interface RegenerateOptions extends Omit<ReviewOptions, 'fileDefinitionId'> {
  ruleId: string;
}

const errorMessage = async (response: Response): Promise<string> => {
  const data = await response.json().catch(() => ({})) as {
    message?: string;
    errors?: Array<{ msg?: string }>;
  };
  return data.message || data.errors?.[0]?.msg ||
    `The server returned ${response.status} ${response.statusText}`.trim();
};

/**
 * Ask the backend to review a plain-language rule. Resolves with the outcome, reporting activity as it streams in;
 * rejects with the server's explanation when the review fails. Aborting the signal stops the review on the server.
 */
export async function reviewNaturalLanguageRule({
  baseUrl,
  token,
  fileDefinitionId,
  request,
  signal,
  onActivity,
}: ReviewOptions): Promise<ReviewResult> {
  return submitNaturalLanguageRule(
    `${baseUrl}/rules/natural-language`,
    token,
    signal,
    onActivity,
    { FileDefinitionId: fileDefinitionId, Request: request },
  );
}

export async function regenerateNaturalLanguageRule({
  baseUrl,
  token,
  ruleId,
  request,
  signal,
  onActivity,
}: RegenerateOptions): Promise<ReviewResult> {
  return submitNaturalLanguageRule(
    `${baseUrl}/rules/${encodeURIComponent(ruleId)}/regenerate`,
    token,
    signal,
    onActivity,
    { Request: request },
  );
}

export async function validateRuleConfig(
  baseUrl: string,
  token: string | null,
  fileDefinitionId: string,
  config: RuleConfig,
): Promise<RuleConfigValidationResult> {
  const response = await fetch(`${baseUrl}/rules/validate`, {
    method: 'POST',
    headers: requestHeaders(token),
    body: JSON.stringify({ FileDefinitionId: fileDefinitionId, Config: config }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function testNaturalLanguageRuleExamples(
  baseUrl: string,
  token: string | null,
  fileDefinitionId: string,
  config: RuleConfig,
  examples: unknown[],
): Promise<RuleExampleTestResult> {
  const response = await fetch(`${baseUrl}/rules/test`, {
    method: 'POST',
    headers: requestHeaders(token),
    body: JSON.stringify({ FileDefinitionId: fileDefinitionId, Config: config, examples }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

export async function runUploadDryRun(
  baseUrl: string,
  token: string | null,
  uploadId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/uploads/${encodeURIComponent(uploadId)}/dry-run`, {
    method: 'POST',
    headers: requestHeaders(token),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

async function submitNaturalLanguageRule(
  url: string,
  token: string | null,
  signal: AbortSignal | undefined,
  onActivity: (activity: ReviewActivity) => void,
  payload: Record<string, string>,
): Promise<ReviewResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders(token, NDJSON),
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));

  if (!response.headers.get('content-type')?.includes(NDJSON) || !response.body) {
    return response.json();
  }

  let result: ReviewResult | null = null;
  let failure: string | null = null;
  await readNdjson(response.body, event => {
    if (event.type === 'progress') {
      onActivity({
        level: event.level as ActivityLevel,
        message: String(event.message),
        elapsedMs: Number(event.elapsedMs) || 0,
      });
    } else if (event.type === 'result') {
      result = event as unknown as ReviewResult;
    } else if (event.type === 'error') {
      failure = String(event.message || 'The rule review failed');
    }
  });
  if (failure) throw new Error(failure);
  if (!result) {
    throw new Error('The connection to the server closed before the rule review finished. The backend may have restarted; check the rules list before trying again.');
  }
  return result;
}

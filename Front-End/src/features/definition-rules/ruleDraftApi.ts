// =============================================================================
// Rule draft API - rules are authored against the workspace's unsaved definition, so every call carries the
// buffered structure (and the other rules) instead of naming a stored definition.
// =============================================================================

import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import { apiUrl, authHeaders, apiRequest } from '../../services/http';

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

export interface DraftContext {
  /** The definition's structure as currently edited. Rules and lookups are ignored; send them as `rules`. */
  contract: DefinitionContract;
  /** The workspace's other rules, for rules that refer to them. */
  rules: RuleConfig[];
}

export interface PreflightResult {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
  diff: {
    hasChanges: boolean;
    columns: { added: string[]; removed: string[]; changed: string[] };
    rules: { added: string[]; removed: string[]; changed: string[] };
  } | null;
}

const NDJSON = 'application/x-ndjson';

const structureOnly = (contract: DefinitionContract): DefinitionContract => ({ ...contract, rules: [], lookups: {} });

const body = (context: DraftContext, excludeId?: string) => ({
  Contract: structureOnly(context.contract),
  Rules: excludeId ? context.rules.filter(rule => rule.id !== excludeId) : context.rules,
});

export interface SavedDraftRules {
  rules: RuleConfig[];
  /** Identifies the saved draft; send it back when saving to detect edits made by someone else. */
  revision: string | null;
}

/** The saved draft rules of a definition (what an admin edits) and the revision they were read at. */
export async function getDraftRules(definitionId: string): Promise<SavedDraftRules> {
  const data = await apiRequest<{ rules: RuleConfig[]; revision?: string | null }>(
    `/rules/definitions/${encodeURIComponent(definitionId)}`,
  );
  return { rules: data.rules ?? [], revision: data.revision ?? null };
}

export interface PublishedRules {
  rules: RuleConfig[];
  versionNumber: number | null;
}

/** The rules of the version uploads are validated against. */
export async function getPublishedRules(definitionId: string): Promise<PublishedRules> {
  const data = await apiRequest<{ rules: RuleConfig[]; versionNumber?: number | null }>(
    `/rules/definitions/${encodeURIComponent(definitionId)}`,
    { query: { published: true } },
  );
  return { rules: data.rules ?? [], versionNumber: data.versionNumber ?? null };
}

export function validateDraftRule(context: DraftContext, config: RuleConfig): Promise<RuleConfigValidationResult> {
  return apiRequest('/rules/validate', { method: 'POST', body: { ...body(context, config.id), Config: config } });
}

export function testDraftRuleExamples(
  context: DraftContext,
  config: RuleConfig,
  examples: unknown[],
): Promise<RuleExampleTestResult> {
  return apiRequest('/rules/test', { method: 'POST', body: { ...body(context, config.id), Config: config, examples } });
}

export function preflightDefinition(context: DraftContext, definitionId: string | null): Promise<PreflightResult> {
  return apiRequest('/admin/file-definitions/preflight', {
    method: 'POST',
    body: {
      contract: structureOnly(context.contract),
      rules: context.rules,
      ...(definitionId ? { definitionId } : {}),
    },
  });
}

export async function runDraftDryRun(
  context: DraftContext,
  uploadId: string,
): Promise<Record<string, unknown>> {
  return apiRequest(`/uploads/${encodeURIComponent(uploadId)}/dry-run`, {
    method: 'POST',
    body: body(context),
  });
}

interface ProposeOptions {
  context: DraftContext;
  request: string;
  /** Set when regenerating an existing natural-language rule, so the proposal keeps its identity. */
  existing?: RuleConfig;
  signal?: AbortSignal;
  onActivity: (activity: ReviewActivity) => void;
}

/**
 * Ask the server to review a plain-language rule against the unsaved definition. Nothing is saved: the proposed
 * RuleConfig is returned for the workspace to add to its draft. Aborting the signal stops the review on the server.
 */
export async function proposeNaturalLanguageRule({
  context,
  request,
  existing,
  signal,
  onActivity,
}: ProposeOptions): Promise<ReviewResult> {
  // Streamed (NDJSON) responses cannot go through apiRequest, so this call uses fetch with the shared auth header.
  const response = await fetch(apiUrl('/rules/natural-language/propose'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: NDJSON,
      ...authHeaders(),
    },
    body: JSON.stringify({
      ...body(context, existing?.id),
      Request: request,
      ...(existing ? { Config: existing } : {}),
    }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string; errors?: Array<{ msg?: string }> };
    throw new Error(data.message || data.errors?.[0]?.msg || `The server returned ${response.status} ${response.statusText}`.trim());
  }
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
    throw new Error('The connection to the server closed before the rule review finished. Try again.');
  }
  return result;
}

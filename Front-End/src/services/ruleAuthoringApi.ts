// =============================================================================
// Natural-language rule authoring API - streams the review's activity while the model works
// =============================================================================

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';

export interface ReviewActivity {
  level: ActivityLevel;
  message: string;
  /** Milliseconds since the review started on the server. */
  elapsedMs: number;
}

export interface ReviewedRule {
  Name: string;
  RuleType: string;
  SqlQuery: string;
  NaturalLanguageText?: string | null;
}

export type ReviewResult =
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'mapped'; reason: string; rule: ReviewedRule; pseudocode: string }
  | { outcome: 'natural_language'; reason: string; rule: ReviewedRule; pseudocode: string; typescript: string };

const NDJSON = 'application/x-ndjson';

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
    if (event && typeof event === 'object') onEvent(event as Record<string, unknown>);
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

const errorMessage = async (response: Response): Promise<string> => {
  const data = await response.json().catch(() => ({}));
  return data.message || data.errors?.[0]?.msg || `The server returned ${response.status} ${response.statusText}`.trim();
};

/**
 * Ask the backend to review a plain-language rule. Resolves with the outcome, reporting activity as it streams in;
 * rejects with the server's explanation when the review fails. Aborting the signal stops the review on the server.
 */
export async function reviewNaturalLanguageRule({ baseUrl, token, fileDefinitionId, request, signal, onActivity }: ReviewOptions): Promise<ReviewResult> {
  const response = await fetch(`${baseUrl}/rules/natural-language`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: NDJSON, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ FileDefinitionId: fileDefinitionId, Request: request }),
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response));

  // An older backend answers with a single JSON document.
  if (!response.headers.get('content-type')?.includes(NDJSON) || !response.body) {
    return response.json();
  }

  let result: ReviewResult | null = null;
  let failure: string | null = null;
  await readNdjson(response.body, event => {
    if (event.type === 'progress') {
      onActivity({ level: event.level as ActivityLevel, message: String(event.message), elapsedMs: Number(event.elapsedMs) || 0 });
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

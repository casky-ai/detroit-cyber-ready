// The LLM layer. Two disciplines carried over from prior architecture work,
// because getting them wrong is how a demo hangs on stage:
//
// 1. AbortController is passed in the SDK call's OPTIONS argument, never
//    mixed into params. Passing it in options is what actually closes the
//    underlying connection on abort; passing it in params silently does
//    nothing and the stream keeps running after the caller thinks it quit.
// 2. Model JSON is treated as unreliable by default. Every structured call
//    goes through extractJson(), which strips code fences and recovers a
//    JSON object even if the model wrapped it in prose.

import Anthropic from '@anthropic-ai/sdk';

// Current models as of this build. Haiku for cheap, fast, deterministic-ish
// classification work; Sonnet for the narrative a human actually reads.
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
export const MODEL_SONNET = 'claude-sonnet-5';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface StreamTextParams {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  /** Called with each incremental chunk of text as it streams in. */
  onChunk?: (chunk: string) => void;
}

export interface StreamTextResult {
  text: string;
  /** True if the stream was cut off by the timeout rather than finishing naturally. */
  timedOut: boolean;
}

/**
 * Streams a text completion with a hard wall-clock timeout. On timeout, the
 * partial text accumulated so far is returned rather than thrown — an
 * investigation that ran out of time should show what it got, not vanish.
 *
 * System prompt is sent as a cacheable block: this function is called
 * repeatedly across investigations with the same system prompt text, and
 * prompt caching turns that repetition into a real cost and latency win.
 */
export async function streamText(params: StreamTextParams): Promise<StreamTextResult> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), params.timeoutMs);
  let text = '';
  let timedOut = false;

  try {
    const stream = getClient().messages.stream(
      {
        model: params.model,
        max_tokens: params.maxTokens,
        system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: params.user }],
      },
      { signal: ac.signal } // the signal MUST be here, in options, not in the params object above
    );

    stream.on('text', (chunk) => {
      text += chunk;
      params.onChunk?.(chunk);
    });

    await stream.finalMessage();
  } catch (err) {
    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      (err instanceof Anthropic.APIError && ac.signal.aborted);
    if (isAbort) {
      timedOut = true;
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timeout);
  }

  return { text, timedOut };
}

export interface StructuredCallParams {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * Non-streaming call for structured JSON output. Not worth the SSE
 * complexity: this is a single short call producing a small JSON object,
 * analogous to the "P4" pattern of a fast final-synthesis call.
 */
export async function callStructured<T>(
  params: StructuredCallParams,
  validate: (value: unknown) => value is T
): Promise<T> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), params.timeoutMs);

  try {
    const message = await getClient().messages.create(
      {
        model: params.model,
        max_tokens: params.maxTokens,
        system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: params.user }],
      },
      { signal: ac.signal }
    );

    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const parsed = extractJson(raw);
    if (!validate(parsed)) {
      throw new Error(`Model output failed validation: ${raw.slice(0, 500)}`);
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Recovers a JSON value from model output that may be wrapped in prose or
 * markdown code fences. Model JSON is unreliable by default — this is the
 * one place that assumption is dealt with, so callers can trust the result.
 */
export function extractJson(raw: string): unknown {
  let candidate = raw.trim();

  // Strip a ```json ... ``` or ``` ... ``` fence if present.
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    candidate = fenceMatch[1].trim();
  }

  // If there's leading/trailing prose around the JSON, slice from the first
  // { or [ to the matching last } or ].
  const firstBrace = candidate.search(/[{[]/);
  if (firstBrace > 0) {
    candidate = candidate.slice(firstBrace);
  }
  const lastBrace = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (lastBrace >= 0 && lastBrace < candidate.length - 1) {
    candidate = candidate.slice(0, lastBrace + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error(`Could not parse JSON from model output: ${raw.slice(0, 500)}`);
  }
}

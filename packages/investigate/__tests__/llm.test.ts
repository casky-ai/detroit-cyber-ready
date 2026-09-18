// L1 boundary: the Anthropic SDK is mocked so these tests are fast,
// deterministic, and never touch the network — they exist to prove OUR
// abort-wiring and timeout-recovery code is correct, not to test Anthropic's
// API. Live-API confidence lives in agent.integration.test.ts instead.

import { describe, it, expect, vi, afterEach } from 'vitest';

const streamMock = vi.fn();
const createMock = vi.fn();
const constructorOptionsCalls: unknown[] = [];

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAPIError extends Error {}
  return {
    default: class FakeAnthropic {
      messages = { stream: streamMock, create: createMock };
      static APIError = FakeAPIError;
      constructor(options: unknown) {
        constructorOptionsCalls.push(options);
      }
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
  constructorOptionsCalls.length = 0;
  delete process.env.ANTHROPIC_API_KEY;
});

describe('getClient (via any call)', () => {
  it('disables the SDK\'s own retry logic, so timeoutMs is a genuine hard wall', async () => {
    // Regression test for a real incident: the SDK's default retry-with-
    // backoff silently turned a 20-second callStructured() timeout into a
    // 718-second call in practice, because our AbortController only
    // cancelled one attempt while the SDK retried underneath it. Without
    // maxRetries: 0, every timeoutMs in this file is a lie.
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const { streamText } = await import('../src/llm');

    streamMock.mockImplementation(() => ({ on: () => {}, finalMessage: async () => ({}) }));
    await streamText({ model: 'm', system: 's', user: 'u', maxTokens: 10, timeoutMs: 1000 });

    expect(constructorOptionsCalls).toHaveLength(1);
    expect(constructorOptionsCalls[0]).toMatchObject({ maxRetries: 0 });
  });
});

describe('streamText', () => {
  it('passes the abort signal in the OPTIONS argument, not mixed into params', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { streamText } = await import('../src/llm');

    let capturedParams: unknown;
    let capturedOptions: unknown;
    streamMock.mockImplementation((params: unknown, options: unknown) => {
      capturedParams = params;
      capturedOptions = options;
      return {
        on: (_event: string, _handler: (chunk: string) => void) => {},
        finalMessage: async () => ({}),
      };
    });

    await streamText({
      model: 'test-model',
      system: 'system prompt',
      user: 'user prompt',
      maxTokens: 100,
      timeoutMs: 1000,
    });

    expect(capturedParams).not.toHaveProperty('signal');
    expect(capturedOptions).toHaveProperty('signal');
    expect((capturedOptions as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  it('sends the system prompt as a cacheable block, not a plain string', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { streamText } = await import('../src/llm');

    let capturedParams: any;
    streamMock.mockImplementation((params: any) => {
      capturedParams = params;
      return { on: () => {}, finalMessage: async () => ({}) };
    });

    await streamText({ model: 'm', system: 'be helpful', user: 'hi', maxTokens: 10, timeoutMs: 1000 });

    expect(Array.isArray(capturedParams.system)).toBe(true);
    expect(capturedParams.system[0]).toMatchObject({ type: 'text', text: 'be helpful' });
    expect(capturedParams.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('accumulates streamed chunks and relays them via onChunk', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { streamText } = await import('../src/llm');

    const handlers: Record<string, (chunk: string) => void> = {};
    streamMock.mockImplementation(() => ({
      on: (event: string, handler: (chunk: string) => void) => {
        handlers[event] = handler;
      },
      finalMessage: async () => {
        handlers.text?.('Hello, ');
        handlers.text?.('world.');
        return {};
      },
    }));

    const chunks: string[] = [];
    const result = await streamText({
      model: 'm',
      system: 's',
      user: 'u',
      maxTokens: 10,
      timeoutMs: 1000,
      onChunk: (c) => chunks.push(c),
    });

    expect(result.text).toBe('Hello, world.');
    expect(result.timedOut).toBe(false);
    expect(chunks).toEqual(['Hello, ', 'world.']);
  });

  it('a hung stream that the abort signal cuts off returns partial content, not a throw', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { streamText } = await import('../src/llm');

    streamMock.mockImplementation((_params: any, options: { signal: AbortSignal }) => ({
      on: (event: string, handler: (chunk: string) => void) => {
        if (event === 'text') {
          // Emit some text immediately, then simulate the abort landing
          // before the stream would otherwise finish.
          handler('partial output before the timeout');
        }
      },
      finalMessage: () =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        }),
    }));

    const result = await streamText({ model: 'm', system: 's', user: 'u', maxTokens: 10, timeoutMs: 50 });

    expect(result.timedOut).toBe(true);
    expect(result.text).toBe('partial output before the timeout');
  });

  it('a non-abort error is rethrown, not swallowed as a timeout', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const { streamText } = await import('../src/llm');

    streamMock.mockImplementation(() => ({
      on: () => {},
      finalMessage: async () => {
        throw new Error('rate limited');
      },
    }));

    await expect(
      streamText({ model: 'm', system: 's', user: 'u', maxTokens: 10, timeoutMs: 1000 })
    ).rejects.toThrow('rate limited');
  });

  it('throws clearly when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    const { streamText } = await import('../src/llm');
    await expect(
      streamText({ model: 'm', system: 's', user: 'u', maxTokens: 10, timeoutMs: 1000 })
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('callStructured', () => {
  it('passes the abort signal in the options argument for the non-streaming call too', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const { callStructured } = await import('../src/llm');

    let capturedOptions: unknown;
    createMock.mockImplementation((_params: unknown, options: unknown) => {
      capturedOptions = options;
      return Promise.resolve({ content: [{ type: 'text', text: '{"ok":true}' }] });
    });

    await callStructured(
      { model: 'm', system: 's', user: 'u', maxTokens: 10, timeoutMs: 1000 },
      (v): v is { ok: boolean } => typeof v === 'object' && v !== null && 'ok' in v
    );

    expect(capturedOptions).toHaveProperty('signal');
  });

  it('throws when the model output fails validation, instead of returning garbage', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const { callStructured } = await import('../src/llm');

    createMock.mockResolvedValue({ content: [{ type: 'text', text: '{"wrong":"shape"}' }] });

    await expect(
      callStructured(
        { model: 'm', system: 's', user: 'u', maxTokens: 10, timeoutMs: 1000 },
        (v): v is { ok: boolean } => typeof v === 'object' && v !== null && 'ok' in v
      )
    ).rejects.toThrow(/failed validation/);
  });
});

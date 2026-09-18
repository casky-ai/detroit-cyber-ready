// Shared fetch discipline for every live SignalSource. Not exported outside
// this package — sources/*.ts is the only place permitted to call fetch(),
// and this is the one place inside it that actually does.

export interface FetchJsonResult<T> {
  data: T | null;
  gap: string | null;
}

/**
 * Fetch and parse JSON with a hard timeout, never throwing. A timeout, a
 * non-2xx response, or a JSON parse failure all become a gap string instead
 * of an exception — see docs/connectors.md and the SignalSource contract.
 */
export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs: number; headers?: Record<string, string>; sourceName: string }
): Promise<FetchJsonResult<T>> {
  try {
    const res = await fetch(url, {
      headers: opts.headers,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) {
      return { data: null, gap: `${opts.sourceName}: HTTP ${res.status} from ${url}` };
    }
    const data = (await res.json()) as T;
    return { data, gap: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { data: null, gap: `${opts.sourceName}: ${reason}` };
  }
}

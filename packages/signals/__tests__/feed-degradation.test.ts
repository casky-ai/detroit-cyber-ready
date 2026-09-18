// A dead feed must never fail a poll. This is the property the whole
// architecture depends on: one dead source becomes a gap, never an
// exception, and the caller (Promise.allSettled fan-out) never sees it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeCisaKevSource } from '../src/sources/cisa-kev';
import { makeNvdSource } from '../src/sources/nvd';
import { makeAbuseChSource } from '../src/sources/abusech';
import { pollForCves } from '../src/sources/epss';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('feed degradation', () => {
  it('cisa-kev: a network failure yields a gap, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const source = makeCisaKevSource();
    const result = await source.poll(new Date('2000-01-01'));
    expect(result.signals).toEqual([]);
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps[0]).toContain('cisa-kev');
  });

  it('cisa-kev: a non-2xx response yields a gap, not a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    );
    const source = makeCisaKevSource();
    const result = await source.poll(new Date('2000-01-01'));
    expect(result.signals).toEqual([]);
    expect(result.gaps[0]).toContain('503');
  });

  it('cisa-kev: malformed JSON yields a gap, not a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      })
    );
    const source = makeCisaKevSource();
    const result = await source.poll(new Date('2000-01-01'));
    expect(result.signals).toEqual([]);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('cisa-kev: an aborted request (what a timeout produces) yields a gap, not a throw', async () => {
    // A real timeout firing rejects the in-flight fetch with an AbortError.
    // We simulate that directly rather than waiting out a real 8s timer,
    // which would make this suite slow without testing anything more.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
        expect(opts.signal).toBeInstanceOf(AbortSignal); // the signal IS passed, in options
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      })
    );
    const source = makeCisaKevSource();
    const result = await source.poll(new Date('2000-01-01'));
    expect(result.signals).toEqual([]);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('nvd: a network failure yields a gap, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS resolution failed')));
    const source = makeNvdSource();
    const result = await source.poll(new Date('2000-01-01'));
    expect(result.signals).toEqual([]);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('abusech: missing API key yields a gap, not a throw, and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const source = makeAbuseChSource(undefined);
    const result = await source.poll(new Date('2000-01-01'));
    expect(result.signals).toEqual([]);
    expect(result.gaps[0]).toContain('ABUSECH_API_KEY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('epss: a network failure yields a gap, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));
    const result = await pollForCves(['CVE-2025-4427']);
    expect(result.signals).toEqual([]);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('epss: an empty CVE list never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await pollForCves([]);
    expect(result.signals).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

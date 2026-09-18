import { describe, it, expect } from 'vitest';
import { fingerprintSignal, dedupeSignals } from '../src/normalize';
import type { RawSignal } from '../src/contracts';

function makeSignal(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    source: 'cisa-kev',
    provenance: 'live',
    external_id: 'CVE-2023-46805',
    kind: 'kev-addition',
    title: 'Ivanti Connect Secure vulnerability',
    summary: null,
    published_at: '2026-09-17T00:00:00.000Z',
    severity: null,
    vendor_project: 'Ivanti',
    product: 'Connect Secure',
    cpe: null,
    cvss_score: null,
    epss_percentile: null,
    raw: {},
    ...overrides,
  };
}

describe('fingerprintSignal', () => {
  it('is stable across repeated calls for the same signal', () => {
    const signal = makeSignal();
    expect(fingerprintSignal(signal)).toBe(fingerprintSignal(makeSignal()));
  });

  it('is stable even when unrelated fields differ (re-polling the same signal)', () => {
    const first = fingerprintSignal(makeSignal({ summary: 'first poll' }));
    const second = fingerprintSignal(makeSignal({ summary: 'second poll, more detail' }));
    expect(first).toBe(second);
  });

  it('differs when the underlying identity differs', () => {
    const a = fingerprintSignal(makeSignal({ external_id: 'CVE-2023-46805' }));
    const b = fingerprintSignal(makeSignal({ external_id: 'CVE-2025-9999' }));
    expect(a).not.toBe(b);
  });

  it('differs across sources for the same external_id (a KEV entry and an NVD record are different facts)', () => {
    const kev = fingerprintSignal(makeSignal({ source: 'cisa-kev' }));
    const nvd = fingerprintSignal(makeSignal({ source: 'nvd' }));
    expect(kev).not.toBe(nvd);
  });
});

describe('dedupeSignals', () => {
  it('collapses re-polled duplicates to one entry, keeping the first', () => {
    const first = makeSignal({ summary: 'original' });
    const duplicate = makeSignal({ summary: 'same signal, re-fetched' });
    const result = dedupeSignals([first, duplicate]);
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('original');
  });

  it('keeps distinct signals distinct', () => {
    const a = makeSignal({ external_id: 'CVE-2023-46805' });
    const b = makeSignal({ external_id: 'CVE-2025-9999' });
    expect(dedupeSignals([a, b])).toHaveLength(2);
  });

  it('handles an empty batch', () => {
    expect(dedupeSignals([])).toEqual([]);
  });
});

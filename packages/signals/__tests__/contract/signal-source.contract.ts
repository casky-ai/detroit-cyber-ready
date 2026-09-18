// Shared contract every SignalSource must satisfy, live or synthetic.
//
// This is not a test file itself — vitest only collects files matching
// *.test.ts. It is a reusable assertion function that a real *.test.ts file
// calls once per implementation. A future live connector (a second GreyNoise
// tier, a new advisory feed) proves itself by passing this file UNCHANGED.
//
// If you are tempted to special-case an implementation inside this function,
// stop: that defeats the entire point of having one contract. Fix the
// implementation instead.

import { describe, it, expect } from 'vitest';
import type { SignalSource } from '../../src/contracts';

export function runSignalSourceContract(name: string, make: () => SignalSource) {
  describe(`SignalSource contract: ${name}`, () => {
    it('declares its identity', () => {
      const source = make();
      expect(source.name).toBeTruthy();
      expect(['live', 'synthetic']).toContain(source.mode);
      expect(typeof source.requiresKey).toBe('boolean');
    });

    it('never throws, even on a request that will fail', async () => {
      const source = make();
      // A date far enough in the future that a live source's upstream query
      // returns nothing, and a synthetic source's fixture window misses too.
      // The point is not "returns results", it is "does not throw".
      const farFuture = new Date('2999-01-01T00:00:00Z');
      await expect(source.poll(farFuture)).resolves.toBeDefined();
    });

    it('returns a well-formed result shape even when empty', async () => {
      const source = make();
      const result = await source.poll(new Date('2999-01-01T00:00:00Z'));
      expect(Array.isArray(result.signals)).toBe(true);
      expect(Array.isArray(result.gaps)).toBe(true);
    });

    it('stamps every emitted signal with this source\'s own mode', async () => {
      const source = make();
      // A wide-open window so a source with any fixture/live data returns something.
      const result = await source.poll(new Date('2000-01-01T00:00:00Z'));
      for (const signal of result.signals) {
        expect(signal.provenance).toBe(source.mode);
      }
    });

    it('never emits a published_at timestamp in the future', async () => {
      const source = make();
      const result = await source.poll(new Date('2000-01-01T00:00:00Z'));
      const now = Date.now();
      for (const signal of result.signals) {
        expect(new Date(signal.published_at).getTime()).toBeLessThanOrEqual(now);
      }
    });

    it('never emits a signal with an empty external_id or title', async () => {
      const source = make();
      const result = await source.poll(new Date('2000-01-01T00:00:00Z'));
      for (const signal of result.signals) {
        expect(signal.external_id.length).toBeGreaterThan(0);
        expect(signal.title.length).toBeGreaterThan(0);
      }
    });
  });
}

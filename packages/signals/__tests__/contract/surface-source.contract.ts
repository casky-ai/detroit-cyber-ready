// Shared contract every SurfaceSource must satisfy, live or synthetic.
//
// The synthetic implementation passes this today. A future Shodan or Censys
// connector proves itself by passing this file UNCHANGED — that is the whole
// point of the productization claim in docs/connectors.md.

import { describe, it, expect } from 'vitest';
import { SurfaceObservationSchema, type SurfaceSource } from '../../src/contracts';

export function runSurfaceSourceContract(name: string, make: () => SurfaceSource) {
  describe(`SurfaceSource contract: ${name}`, () => {
    it('declares its identity', () => {
      const source = make();
      expect(source.name).toBeTruthy();
      expect(['live', 'synthetic']).toContain(source.mode);
    });

    it('never throws, even for an unknown snapshot', async () => {
      const source = make();
      await expect(
        source.snapshot({ snapshotId: 'does-not-exist' })
      ).resolves.toBeDefined();
    });

    it('returns a well-formed result shape even when empty', async () => {
      const source = make();
      const result = await source.snapshot({ snapshotId: 'does-not-exist' });
      expect(Array.isArray(result.observations)).toBe(true);
      expect(Array.isArray(result.gaps)).toBe(true);
    });

    it('every observation validates against the schema', async () => {
      const source = make();
      const result = await source.snapshot({ snapshotId: 't0' });
      for (const obs of result.observations) {
        expect(() => SurfaceObservationSchema.parse(obs)).not.toThrow();
      }
    });

    it('never emits an observed_at timestamp in the future', async () => {
      const source = make();
      const result = await source.snapshot({ snapshotId: 't0' });
      const now = Date.now();
      for (const obs of result.observations) {
        expect(new Date(obs.observed_at).getTime()).toBeLessThanOrEqual(now);
      }
    });

    it('two reads of the same snapshot are identical (no jitter)', async () => {
      const source = make();
      const first = await source.snapshot({ snapshotId: 't0' });
      const second = await source.snapshot({ snapshotId: 't0' });
      expect(second.observations).toEqual(first.observations);
    });
  });
}

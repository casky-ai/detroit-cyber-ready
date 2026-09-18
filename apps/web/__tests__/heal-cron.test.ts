import { describe, it, expect } from 'vitest';
import { resolveHealAction, STUCK_THRESHOLD_MS } from '../lib/heal-logic';
import { COMPLETE_MARKER } from '../lib/constants';

const NOW = new Date('2026-09-18T12:00:00.000Z');

describe('resolveHealAction', () => {
  it('heals to completed when the marker is present, regardless of elapsed time', () => {
    const output = `narrative\n\n${COMPLETE_MARKER}`;
    const justStarted = new Date(NOW.getTime() - 1000).toISOString();
    expect(resolveHealAction({ status: 'running', output, workBeganAt: justStarted }, NOW)).toBe('heal-complete');
  });

  it('marks failed when stuck past the threshold with no marker', () => {
    const longAgo = new Date(NOW.getTime() - STUCK_THRESHOLD_MS - 1000).toISOString();
    expect(resolveHealAction({ status: 'running', output: 'partial', workBeganAt: longAgo }, NOW)).toBe(
      'mark-failed'
    );
  });

  it('does nothing when still within the threshold and no marker — may be a live connection', () => {
    const justStarted = new Date(NOW.getTime() - 5000).toISOString();
    expect(resolveHealAction({ status: 'running', output: 'partial', workBeganAt: justStarted }, NOW)).toBe('none');
  });

  it('does nothing for a queued investigation still within the threshold', () => {
    const justCreated = new Date(NOW.getTime() - 1000).toISOString();
    expect(resolveHealAction({ status: 'queued', output: null, workBeganAt: justCreated }, NOW)).toBe('none');
  });

  it('marks a queued investigation failed if it never started within the threshold', () => {
    const longAgo = new Date(NOW.getTime() - STUCK_THRESHOLD_MS - 1).toISOString();
    expect(resolveHealAction({ status: 'queued', output: null, workBeganAt: longAgo }, NOW)).toBe('mark-failed');
  });

  it('never touches an already-terminal investigation', () => {
    const longAgo = new Date(NOW.getTime() - STUCK_THRESHOLD_MS * 10).toISOString();
    for (const status of ['completed', 'failed', 'stopped']) {
      expect(resolveHealAction({ status, output: null, workBeganAt: longAgo }, NOW)).toBe('none');
      // Even with a marker present, an already-terminal row is left alone —
      // there is nothing to heal.
      expect(
        resolveHealAction({ status, output: `x ${COMPLETE_MARKER}`, workBeganAt: longAgo }, NOW)
      ).toBe('none');
    }
  });

  it('is exactly at the boundary: one millisecond under the threshold does nothing, one over marks failed', () => {
    const underThreshold = new Date(NOW.getTime() - STUCK_THRESHOLD_MS + 1).toISOString();
    const overThreshold = new Date(NOW.getTime() - STUCK_THRESHOLD_MS - 1).toISOString();
    expect(resolveHealAction({ status: 'running', output: null, workBeganAt: underThreshold }, NOW)).toBe('none');
    expect(resolveHealAction({ status: 'running', output: null, workBeganAt: overThreshold }, NOW)).toBe(
      'mark-failed'
    );
  });
});

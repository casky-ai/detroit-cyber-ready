import { describe, it, expect } from 'vitest';
import {
  COMPLETE_MARKER,
  isComplete,
  SSE_MAX_DURATION_MS,
  UI_STALE_TIMEOUT_MS,
} from '../lib/constants';

// L5 boundary, asserted from the first commit so the guard can never drift.
describe('completion marker', () => {
  it('detects a completed investigation', () => {
    expect(isComplete(`some output\n\n---\n\n${COMPLETE_MARKER}\n`)).toBe(true);
  });

  it('does not fire on partial output', () => {
    expect(isComplete('the investigation is still streaming')).toBe(false);
    expect(isComplete('')).toBe(false);
    expect(isComplete(null)).toBe(false);
    expect(isComplete(undefined)).toBe(false);
  });

  it('does not fire on a truncated marker', () => {
    // A stream cut mid-marker must not be read as success.
    const truncated = COMPLETE_MARKER.slice(0, COMPLETE_MARKER.length - 4);
    expect(isComplete(truncated)).toBe(false);
  });
});

describe('timeout ordering', () => {
  it('shows the UI stale banner before the SSE stream gives up', () => {
    // If this inverts, the user stares at a live-looking cursor on a dead stream.
    expect(UI_STALE_TIMEOUT_MS).toBeLessThan(SSE_MAX_DURATION_MS);
  });
});

// L4 boundary. These test the pure decision logic the SSE route is built
// on, not the route itself — no HTTP, no ReadableStream, no Supabase. See
// apps/web/lib/stream-logic.ts.

import { describe, it, expect } from 'vitest';
import { resolveTerminalState, shouldHeal } from '../lib/stream-logic';
import { COMPLETE_MARKER } from '../lib/constants';

describe('resolveTerminalState', () => {
  it('is done when status is already completed', () => {
    expect(resolveTerminalState('completed', 'some output')).toEqual({ done: true, status: 'completed' });
  });

  it('is done when status is failed', () => {
    expect(resolveTerminalState('failed', null)).toEqual({ done: true, status: 'failed' });
  });

  it('is done when status is stopped', () => {
    expect(resolveTerminalState('stopped', null)).toEqual({ done: true, status: 'stopped' });
  });

  it('is done on marker even when status is still "running" — the marker is the truth signal', () => {
    const output = `some narrative\n\n---\n\n${COMPLETE_MARKER}\n`;
    expect(resolveTerminalState('running', output)).toEqual({ done: true, status: 'completed' });
  });

  it('is NOT done when status is "running" and no marker is present', () => {
    expect(resolveTerminalState('running', 'partial output, still streaming')).toEqual({ done: false });
  });

  it('is NOT done when status is "queued"', () => {
    expect(resolveTerminalState('queued', null)).toEqual({ done: false });
  });

  it('does not fire on a truncated marker', () => {
    const truncated = COMPLETE_MARKER.slice(0, COMPLETE_MARKER.length - 3);
    expect(resolveTerminalState('running', `narrative\n\n${truncated}`)).toEqual({ done: false });
  });
});

describe('shouldHeal', () => {
  it('fires when the marker is present and status is not already terminal', () => {
    const output = `narrative\n\n${COMPLETE_MARKER}`;
    expect(shouldHeal('running', output)).toBe(true);
    expect(shouldHeal('queued', output)).toBe(true);
  });

  it('does NOT fire when status is already terminal, even with the marker present', () => {
    const output = `narrative\n\n${COMPLETE_MARKER}`;
    expect(shouldHeal('completed', output)).toBe(false);
    expect(shouldHeal('failed', output)).toBe(false);
    expect(shouldHeal('stopped', output)).toBe(false);
  });

  it('does NOT fire when there is no marker', () => {
    expect(shouldHeal('running', 'still streaming')).toBe(false);
    expect(shouldHeal('running', null)).toBe(false);
  });
});

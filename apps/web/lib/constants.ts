// Single source of truth for the investigation completion marker.
//
// This file deliberately imports nothing. It is read by every layer that needs
// to know whether an investigation finished: the agent that writes it, the heal
// cron, the SSE route, the UI, and the tests. Any layer that hardcodes the
// string instead of importing it is a bug waiting to happen.
//
// The marker is the truth signal, not the `status` column. A run whose output
// ends with this marker completed, even if the status write was lost.
export const COMPLETE_MARKER = '✅ **Investigation complete**';

/** Does this output represent a finished investigation? */
export function isComplete(output: string | null | undefined): boolean {
  return typeof output === 'string' && output.includes(COMPLETE_MARKER);
}

/** SSE poll cadence, and the hard wall that keeps us under Vercel's 300s limit. */
export const SSE_POLL_INTERVAL_MS = 2_000;
export const SSE_MAX_DURATION_MS = 270_000;

/**
 * UI stale banner threshold. Must stay strictly below SSE_MAX_DURATION_MS so the
 * user sees an escape hatch before the stream gives up. Asserted in tests.
 */
export const UI_STALE_TIMEOUT_MS = 3 * 60 * 1000;

export const TERMINAL_STATUSES = ['completed', 'failed', 'stopped'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

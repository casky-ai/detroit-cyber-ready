// Re-exports the completion marker from @dcr/investigate, the package that
// actually writes it into an investigation's output, so this app's SSE
// route, heal cron, and UI all check the exact same string without a second
// definition anywhere to drift out of sync.
export { COMPLETE_MARKER, isComplete, TERMINAL_STATUSES, type TerminalStatus } from '@dcr/investigate/constants';

/** SSE poll cadence, and the hard wall that keeps us under Vercel's 300s limit. */
export const SSE_POLL_INTERVAL_MS = 2_000;
export const SSE_MAX_DURATION_MS = 270_000;

/**
 * UI stale banner threshold. Must stay strictly below SSE_MAX_DURATION_MS so the
 * user sees an escape hatch before the stream gives up. Asserted in tests.
 */
export const UI_STALE_TIMEOUT_MS = 3 * 60 * 1000;

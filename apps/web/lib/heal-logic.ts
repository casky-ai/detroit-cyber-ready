// L3 boundary: pure decision logic for the heal cron. Mirrors
// stream-logic.ts's approach — testable without a database, a cron
// invocation, or a clock mock more elaborate than passing `now` explicitly.

import { isComplete } from '@dcr/investigate/constants';

export type HealAction = 'heal-complete' | 'mark-failed' | 'none';

/**
 * An investigation stuck in 'queued' or 'running' for longer than this is
 * not "still working" — the agent's own internal timeouts (see
 * packages/investigate/src/llm.ts) cap a real run well under this, and the
 * SSE route's own outer wall is SSE_MAX_DURATION_MS (270s). This threshold
 * is deliberately well above both, so it never fires on a run that is
 * genuinely still in progress.
 */
export const STUCK_THRESHOLD_MS = 6 * 60 * 1000;

export interface HealCandidate {
  status: string;
  output: string | null;
  /** started_at if set, otherwise created_at — whichever marks when work began. */
  workBeganAt: string;
}

/**
 * Decides what a stuck-looking investigation needs, given the current time.
 * Marker present -> heal to completed regardless of how long it has been
 * stuck (the work is genuinely done, only the status write was lost).
 * No marker, but past the stuck threshold -> mark failed.
 * No marker, still within the threshold -> leave it alone; it may be a
 * live SSE connection actively driving it.
 */
export function resolveHealAction(candidate: HealCandidate, now: Date): HealAction {
  if (candidate.status === 'completed' || candidate.status === 'failed' || candidate.status === 'stopped') {
    return 'none';
  }
  if (isComplete(candidate.output)) {
    return 'heal-complete';
  }
  const elapsedMs = now.getTime() - new Date(candidate.workBeganAt).getTime();
  if (elapsedMs > STUCK_THRESHOLD_MS) {
    return 'mark-failed';
  }
  return 'none';
}

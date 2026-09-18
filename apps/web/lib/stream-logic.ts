// Pure decision logic extracted from the SSE route so it can be unit
// tested without simulating an HTTP connection or a ReadableStream. This is
// the L4 guard's actual substance: does `done` fire on the right signal,
// and does a heal write fire only when it should.

import { isComplete, TERMINAL_STATUSES, type TerminalStatus } from '@dcr/investigate/constants';

export type TerminalDecision = { done: true; status: TerminalStatus } | { done: false };

function isTerminalStatus(status: string): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Should the SSE route consider this investigation finished? True either
 * because the status column already says so, OR because the completion
 * marker is present in the output even though the status write was lost —
 * the marker is the truth signal, never the status column alone.
 */
export function resolveTerminalState(status: string, output: string | null): TerminalDecision {
  if (isTerminalStatus(status)) {
    return { done: true, status };
  }
  if (isComplete(output)) {
    return { done: true, status: 'completed' };
  }
  return { done: false };
}

/**
 * Should a heal write fire right now? Only when the marker is present AND
 * the status is not already terminal — healing an already-terminal row
 * would be a pointless write at best and a race at worst.
 */
export function shouldHeal(status: string, output: string | null): boolean {
  return !isTerminalStatus(status) && isComplete(output);
}

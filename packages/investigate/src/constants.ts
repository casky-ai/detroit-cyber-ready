// The completion marker. Canonical here because this package is what
// actually writes it into an investigation's output — every other layer
// (the heal cron, the SSE route, the UI) imports this constant rather than
// defining its own copy or hardcoding the string.
//
// This file deliberately imports nothing else, so it carries zero risk of
// pulling in the Anthropic SDK or Supabase client just to check a string.
export const COMPLETE_MARKER = '✅ **Investigation complete**';

/** Does this output represent a finished investigation? */
export function isComplete(output: string | null | undefined): boolean {
  return typeof output === 'string' && output.includes(COMPLETE_MARKER);
}

export const TERMINAL_STATUSES = ['completed', 'failed', 'stopped'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

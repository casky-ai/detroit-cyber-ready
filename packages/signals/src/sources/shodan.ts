// NOT ENABLED. Committed so the swap point from synthetic to live external
// attack surface data is visible in the codebase, not only in a design
// document. See docs/connectors.md and synthetic-surface.ts, which is what
// this system actually runs against today.
//
// To bring this online: implement snapshot() against the Shodan API, add
// SHODAN_API_KEY to .env.example, and run this file against
// __tests__/contract/surface-source.contract.ts UNCHANGED. If it passes,
// it is a drop-in replacement for SyntheticSurfaceSource wherever a
// SurfaceSource is consumed.

import type { SurfaceSource } from '../contracts';

export function makeShodanSurfaceSource(_apiKey: string): SurfaceSource {
  return {
    name: 'shodan',
    mode: 'live',

    async snapshot() {
      throw new Error('not enabled: implement against the Shodan API, see the header comment');
    },
  };
}

// NOT ENABLED. See shodan.ts — same reasoning, same swap point, same
// contract. Committed so the interface this system is built against is
// visible in the repository regardless of which vendor a city already uses.

import type { SurfaceSource } from '../contracts';

export function makeCensysSurfaceSource(_apiId: string, _apiSecret: string): SurfaceSource {
  return {
    name: 'censys',
    mode: 'live',

    async snapshot() {
      throw new Error('not enabled: implement against the Censys API, see the header comment');
    },
  };
}

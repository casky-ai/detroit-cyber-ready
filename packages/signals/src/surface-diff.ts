// The surface diff engine. Real logic, regardless of whether its input comes
// from the synthetic source or a future live one — this is the file that
// proves two unrelated signal types (a KEV addition, an attack surface
// change) can run through one investigation pipeline with no branching.
//
// A change here becomes a RawSignal with kind: 'surface-change' and enters
// the same matcher, propagation, and scoring path as everything else.

import type { SurfaceChange, SurfaceObservation } from './contracts';

function observationKey(obs: SurfaceObservation): string {
  return `${obs.host}:${obs.port}:${obs.transport}`;
}

/**
 * Diff two point-in-time surface snapshots. Deterministic: the same pair of
 * inputs always produces the same list of changes, in the same order, which
 * __tests__/surface-diff.test.ts asserts directly.
 */
export function diffSurface(
  before: SurfaceObservation[],
  after: SurfaceObservation[]
): SurfaceChange[] {
  const beforeByKey = new Map(before.map((o) => [observationKey(o), o]));
  const afterByKey = new Map(after.map((o) => [observationKey(o), o]));
  const beforeHosts = new Set(before.map((o) => o.host));
  const changes: SurfaceChange[] = [];

  for (const [key, afterObs] of afterByKey) {
    const beforeObs = beforeByKey.get(key);

    if (!beforeObs) {
      // A host we have never seen at all is a stronger signal than a new
      // port on a host we already knew about.
      const kind = beforeHosts.has(afterObs.host) ? 'new-service' : 'new-host';
      changes.push({ kind, before: null, after: afterObs });
      continue;
    }

    if (beforeObs.version !== afterObs.version) {
      changes.push({ kind: 'version-changed', before: beforeObs, after: afterObs });
    }

    if (beforeObs.tls_cert_sha256 !== afterObs.tls_cert_sha256) {
      changes.push({ kind: 'certificate-changed', before: beforeObs, after: afterObs });
    } else if (isExpiringSoon(afterObs.tls_not_after)) {
      changes.push({ kind: 'certificate-expiring', before: beforeObs, after: afterObs });
    }
  }

  for (const [key, beforeObs] of beforeByKey) {
    if (!afterByKey.has(key)) {
      changes.push({ kind: 'removed-service', before: beforeObs, after: null });
    }
  }

  return changes;
}

const CERT_EXPIRY_WARNING_DAYS = 30;

function isExpiringSoon(notAfter: string | null): boolean {
  if (!notAfter) return false;
  const msRemaining = new Date(notAfter).getTime() - Date.now();
  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
  return daysRemaining > 0 && daysRemaining <= CERT_EXPIRY_WARNING_DAYS;
}

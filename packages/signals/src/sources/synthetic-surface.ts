// Synthetic replacement for Shodan/Censys. Reads committed point-in-time
// snapshots from data/detroit/surface/. Every host and IP in those fixtures
// is deliberately unresolvable (RFC 2606 / RFC 5737) — see
// __tests__/seed-data-safety.test.ts, which enforces this against the files
// on disk, not just against this reader.
//
// This is not a placeholder for a demo. It is the SurfaceSource this system
// runs against today, implementing the exact interface a live Shodan or
// Censys connector will implement tomorrow. See docs/connectors.md.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SurfaceObservation, SurfaceScope, SurfaceSnapshotResult, SurfaceSource } from '../contracts';
import { SurfaceObservationSchema } from '../contracts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/signals/src/sources -> repo root is four levels up.
const REPO_ROOT = path.resolve(HERE, '../../../..');
const SURFACE_DIR = path.join(REPO_ROOT, 'data/detroit/surface');

async function readSnapshotFile(snapshotId: string): Promise<SurfaceObservation[] | null> {
  const filePath = path.join(SURFACE_DIR, `${snapshotId}.json`);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const observations: SurfaceObservation[] = [];
  for (const item of parsed) {
    const result = SurfaceObservationSchema.safeParse(item);
    // A malformed row in a fixture file is skipped, not thrown — the same
    // discipline a real scanner's occasional garbage record would need.
    if (result.success) observations.push(result.data);
  }
  return observations;
}

export function makeSyntheticSurfaceSource(): SurfaceSource {
  return {
    name: 'synthetic-surface',
    mode: 'synthetic',

    async snapshot(scope: SurfaceScope): Promise<SurfaceSnapshotResult> {
      const observations = await readSnapshotFile(scope.snapshotId);
      if (observations === null) {
        return {
          observations: [],
          gaps: [`synthetic-surface: no snapshot found for "${scope.snapshotId}"`],
        };
      }
      return { observations, gaps: [] };
    },
  };
}

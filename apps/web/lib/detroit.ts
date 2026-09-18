// The Detroit inventory (services, infrastructure, dependencies,
// technologies) is authored in data/detroit/*.yaml and seeded into
// Supabase by scripts/seed-detroit-data.ts, but the API routes read it
// straight from the YAML via @dcr/impact rather than round-tripping through
// Postgres on every request. The YAML is the source of truth; the database
// rows are a seeded projection of it, not a second copy that could drift.
// This module just caches that read for the lifetime of the server
// instance, since Fluid Compute reuses instances across requests.

import { loadDetroitInventory, type DetroitInventory } from '@dcr/impact/data';

let cached: DetroitInventory | null = null;

export async function getDetroitInventory(): Promise<DetroitInventory> {
  if (!cached) {
    cached = await loadDetroitInventory();
  }
  return cached;
}

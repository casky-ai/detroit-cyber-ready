// Seeds the four Detroit inventory YAML files into Supabase. Idempotent:
// every table is upserted on its natural key, so running this repeatedly
// (after editing data/detroit/*.yaml) converges rather than duplicating.
//
// Run with `pnpm db:seed` (sources .env.local; tsx does not auto-load it).

import { createClient } from '@supabase/supabase-js';
import { loadDetroitInventory, validateInventory } from '@dcr/impact/data';

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set. ' +
        'Run via `pnpm db:seed`, which sources .env.local.'
    );
  }

  const inventory = await loadDetroitInventory();
  const errors = validateInventory(inventory);
  if (errors.length > 0) {
    throw new Error(`Detroit inventory failed referential integrity:\n${errors.join('\n')}`);
  }

  // Service role key: bypasses RLS by design, exactly as documented in
  // supabase/migrations/0001_init.sql. Never use this key outside a
  // server-only context.
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log(`Seeding ${inventory.services.length} city services...`);
  const { error: servicesError } = await supabase.from('city_services').upsert(
    inventory.services.map((s) => ({
      slug: s.slug,
      name: s.name,
      department: s.department,
      // Not persisted to city_services: the app always reads service
      // metadata (name, department, address, resident_impact, ...) from
      // this YAML via getDetroitInventory(), never back from the DB. This
      // table exists for referential integrity (FKs from investigations,
      // signal_matches) — adding an `address` column here would need a
      // schema migration, and direct Postgres (port 5432) is blocked from
      // this environment while the PostgREST/HTTPS path works fine. Adding
      // it later is a plain `alter table` whenever that access exists.
      criticality: s.criticality,
      resident_impact: s.resident_impact,
      impact_unit: s.impact_unit,
      externally_exposed: s.externally_exposed,
      lat: s.lat,
      lon: s.lon,
    })),
    { onConflict: 'slug' }
  );
  if (servicesError) throw servicesError;

  console.log(`Seeding ${inventory.infrastructure.length} shared infrastructure entries...`);
  const { error: infraError } = await supabase.from('shared_infrastructure').upsert(
    inventory.infrastructure.map((i) => ({
      slug: i.slug,
      name: i.name,
      description: i.description,
      exposure: i.exposure,
    })),
    { onConflict: 'slug' }
  );
  if (infraError) throw infraError;

  console.log(`Seeding ${inventory.dependencies.length} service dependencies...`);
  const { error: depsError } = await supabase.from('service_dependencies').upsert(
    inventory.dependencies.map((d) => ({
      service_slug: d.service_slug,
      infrastructure_slug: d.infrastructure_slug,
      kind: d.kind,
      criticality: d.criticality,
      rationale: d.rationale,
    })),
    { onConflict: 'service_slug,infrastructure_slug' }
  );
  if (depsError) throw depsError;

  console.log(`Seeding ${inventory.technologies.length} technology rows...`);
  // technologies has no natural unique key in the schema (a service or
  // infrastructure entry could in principle run more than one product), so
  // we replace the full set on every seed run rather than upserting by a
  // key that doesn't exist yet. Safe because this table is fully derived
  // from data/detroit/technologies.yaml — nothing else ever writes to it.
  const { error: deleteTechError } = await supabase.from('technologies').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (deleteTechError) throw deleteTechError;

  const { error: techError } = await supabase.from('technologies').insert(
    inventory.technologies.map((t) => ({
      service_slug: t.service_slug,
      infrastructure_slug: t.infrastructure_slug,
      vendor: t.vendor,
      product: t.product,
      version: t.version,
      cpe: t.cpe,
      exposure: t.exposure,
    }))
  );
  if (techError) throw techError;

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

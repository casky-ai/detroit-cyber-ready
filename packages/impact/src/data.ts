// Loads and validates the Detroit inventory: services, shared infrastructure,
// the dependency graph between them, and the (simulated) technology each one
// runs. This is the one package that reads data/detroit/*.yaml — the
// exposure matcher and risk scorer both consume its typed output rather than
// touching YAML directly.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/impact/src -> repo root is three levels up.
const REPO_ROOT = path.resolve(HERE, '../../..');
const DATA_DIR = path.join(REPO_ROOT, 'data/detroit');

export const CriticalityTierSchema = z.enum(['life-safety', 'critical', 'high', 'moderate', 'low']);
export type CriticalityTier = z.infer<typeof CriticalityTierSchema>;

export const CityServiceSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  department: z.string().min(1),
  criticality: CriticalityTierSchema,
  // .nullable().default(null), no .optional(): the key may be entirely
  // absent from a service's YAML entry (most are) or explicitly null,
  // and .default() already covers both cases. Stacking .optional() on
  // top makes zod's inferred TS type carry `| undefined` even though the
  // value can never actually be undefined at runtime, which fails a
  // stricter downstream type check (`next build`'s tsc pass) even though
  // vitest — which doesn't type-check — never catches it.
  impact_unit: z.string().nullable().default(null),
  resident_impact: z.string().min(1),
  externally_exposed: z.boolean(),
  lat: z.number(),
  lon: z.number(),
});
export type CityService = z.infer<typeof CityServiceSchema>;

export const SharedInfrastructureSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  exposure: z.enum(['internet-facing', 'partner-network', 'internal']),
});
export type SharedInfrastructure = z.infer<typeof SharedInfrastructureSchema>;

export const ServiceDependencySchema = z.object({
  service_slug: z.string().min(1),
  infrastructure_slug: z.string().min(1),
  kind: z.enum(['reachable-via', 'authenticates-via', 'routes-over', 'reads-from']),
  criticality: z.enum(['hard', 'soft']),
  rationale: z.string().min(1),
});
export type ServiceDependency = z.infer<typeof ServiceDependencySchema>;

// A version like "2024.2" is a valid YAML float (one decimal point) and
// parses as a number unless quoted in the source file. Rather than rely on
// every future edit remembering to quote it, coerce defensively here so a
// missing quote in data/detroit/technologies.yaml fails loudly in a test
// instead of silently breaking string-based CPE/vendor matching downstream.
const VersionLikeSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .nullable()
  .default(null);

// Attaches to exactly one of service_slug or infrastructure_slug.
export const TechnologySchema = z
  .object({
    service_slug: z.string().min(1).nullable().default(null),
    infrastructure_slug: z.string().min(1).nullable().default(null),
    vendor: z.string().min(1),
    product: z.string().min(1),
    version: VersionLikeSchema,
    cpe: z.string().nullable().default(null),
    exposure: z.enum(['internet-facing', 'partner-network', 'internal']),
  })
  .refine(
    (t) => Boolean(t.service_slug) !== Boolean(t.infrastructure_slug),
    'exactly one of service_slug or infrastructure_slug must be set'
  );
export type Technology = z.infer<typeof TechnologySchema>;

// Generic over the schema's own concrete type (S extends ZodTypeAny) and
// deriving the return type via z.infer<S>, rather than accepting
// z.ZodType<T> and inferring T from that abstract base. The latter looks
// equivalent but is NOT: inferring through ZodType<T>'s output position
// loses precision for schemas built from chained combinators
// (.nullable().default(...)), silently widening fields to include
// `| undefined` even though z.infer<typeof schema> computed directly (as
// every exported *Schema type alias in this file does) is exact. Caught by
// `next build`'s tsc pass, which type-checks; vitest does not.
async function loadYaml<S extends z.ZodTypeAny>(fileName: string, schema: S): Promise<z.infer<S>[]> {
  const raw = await readFile(path.join(DATA_DIR, fileName), 'utf-8');
  const parsed = parseYaml(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${fileName}: expected a top-level YAML list`);
  }
  return parsed.map((item, i) => {
    const result = schema.safeParse(item);
    if (!result.success) {
      throw new Error(`${fileName}[${i}]: ${result.error.message}`);
    }
    return result.data as z.infer<S>;
  });
}

export interface DetroitInventory {
  services: CityService[];
  infrastructure: SharedInfrastructure[];
  dependencies: ServiceDependency[];
  technologies: Technology[];
}

export async function loadDetroitInventory(): Promise<DetroitInventory> {
  const [services, infrastructure, dependencies, technologies] = await Promise.all([
    loadYaml('services.yaml', CityServiceSchema),
    loadYaml('infrastructure.yaml', SharedInfrastructureSchema),
    loadYaml('dependencies.yaml', ServiceDependencySchema),
    loadYaml('technologies.yaml', TechnologySchema),
  ]);
  return { services, infrastructure, dependencies, technologies };
}

/**
 * Referential integrity across the four files: every slug a dependency or
 * technology row points at must actually exist. Thrown errors here are
 * authoring mistakes (a typo'd slug), not runtime conditions to degrade from
 * — unlike the SignalSource/SurfaceSource contracts, this is data we own.
 */
export function validateInventory(inv: DetroitInventory): string[] {
  const errors: string[] = [];
  const serviceSlugs = new Set(inv.services.map((s) => s.slug));
  const infraSlugs = new Set(inv.infrastructure.map((i) => i.slug));

  for (const dep of inv.dependencies) {
    if (!serviceSlugs.has(dep.service_slug)) {
      errors.push(`dependencies.yaml: unknown service_slug "${dep.service_slug}"`);
    }
    if (!infraSlugs.has(dep.infrastructure_slug)) {
      errors.push(`dependencies.yaml: unknown infrastructure_slug "${dep.infrastructure_slug}"`);
    }
  }

  for (const tech of inv.technologies) {
    if (tech.service_slug && !serviceSlugs.has(tech.service_slug)) {
      errors.push(`technologies.yaml: unknown service_slug "${tech.service_slug}"`);
    }
    if (tech.infrastructure_slug && !infraSlugs.has(tech.infrastructure_slug)) {
      errors.push(`technologies.yaml: unknown infrastructure_slug "${tech.infrastructure_slug}"`);
    }
  }

  return errors;
}

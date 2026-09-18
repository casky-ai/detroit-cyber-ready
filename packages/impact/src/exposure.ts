// The exposure match. Deterministic, no LLM, two stages.
//
// Stage 1 asks: what did this signal land on, a city service's own
// technology or a piece of shared infrastructure?
// Stage 2 asks: if it landed on infrastructure, which city services depend
// on it, and how confident are we once that dependency is factored in?
//
// A model never decides whether Detroit is exposed. This file does, and the
// answer is always traceable to a specific matched field — see `matchedOn`
// on every result, which is the audit trail a CISO can actually read.

import type { RawSignal } from '@dcr/signals';
import type { CityService, ServiceDependency, Technology } from './data';

export type MatchBasis = 'cpe' | 'vendor+product' | 'surface-host' | 'advisory-keyword';

export interface AssetMatch {
  signal: RawSignal;
  /** Slug of a service or shared infrastructure entry, whichever matched. */
  landedOn: string;
  landedKind: 'service' | 'infrastructure';
  matchBasis: MatchBasis;
  /** Exactly what matched, for the audit trail. Never derived after the fact. */
  matchedOn: Record<string, unknown>;
  confidence: number;
}

export interface DependencyInfo {
  infrastructure: string;
  kind: ServiceDependency['kind'];
  criticality: ServiceDependency['criticality'];
  rationale: string;
}

export interface SignalMatch {
  signal: RawSignal;
  serviceSlug: string;
  landedOn: string;
  landedKind: 'service' | 'infrastructure';
  matchBasis: MatchBasis;
  matchedOn: Record<string, unknown>;
  /** 0 = landed on this service's own technology. 1 = via shared infrastructure. */
  hops: 0 | 1;
  dependency: DependencyInfo | null;
  confidence: number;
}

/** Confidence multiplier applied per hop of dependency propagation. */
export const HOP_DECAY = 0.85;

/**
 * Lowercase, strip punctuation and common corporate suffixes, collapse
 * whitespace. "Ivanti, Inc." and "ivanti" must compare equal; "Tyler
 * Technologies" must NOT get stripped down to "Tyler" since "Technologies"
 * is part of the actual company name, not a generic suffix like "Inc" or
 * "LLC".
 */
export function normalizeVendorName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[,.]/g, '')
    .replace(/\b(inc|llc|corp|corporation|ltd|co)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cpeMatches(signal: RawSignal, tech: Technology): boolean {
  if (!signal.cpe || !tech.cpe) return false;
  // Exact match on the normalized CPE URI. Version-range-aware matching
  // (NVD configurations carry versionStartIncluding/versionEndExcluding)
  // is real complexity deferred past this pass — see docs/connectors.md
  // for the productization backlog this belongs to.
  return signal.cpe.toLowerCase() === tech.cpe.toLowerCase();
}

function vendorProductMatches(signal: RawSignal, tech: Technology): boolean {
  if (!signal.vendor_project || !signal.product) return false;
  return (
    normalizeVendorName(signal.vendor_project) === normalizeVendorName(tech.vendor) &&
    normalizeVendorName(signal.product) === normalizeVendorName(tech.product)
  );
}

function advisoryKeywordMatches(signal: RawSignal, tech: Technology): boolean {
  if (signal.kind !== 'advisory') return false;
  const haystack = `${signal.title} ${signal.summary ?? ''}`.toLowerCase();
  const vendor = normalizeVendorName(tech.vendor);
  const product = normalizeVendorName(tech.product);
  return vendor.length > 0 && product.length > 0 && haystack.includes(vendor) && haystack.includes(product);
}

/**
 * Stage 1. Tries the highest-confidence match method first per technology
 * row; a technology matches at most once, via whichever method fired.
 */
export function matchSignalToAssets(
  signal: RawSignal,
  technologies: Technology[]
): AssetMatch[] {
  const matches: AssetMatch[] = [];

  for (const tech of technologies) {
    const landedOn = tech.service_slug ?? tech.infrastructure_slug;
    if (!landedOn) continue; // schema guarantees exactly one is set; defensive only
    const landedKind: 'service' | 'infrastructure' = tech.service_slug ? 'service' : 'infrastructure';

    if (cpeMatches(signal, tech)) {
      matches.push({
        signal,
        landedOn,
        landedKind,
        matchBasis: 'cpe',
        matchedOn: { cpe: tech.cpe },
        confidence: 0.95,
      });
      continue;
    }

    if (vendorProductMatches(signal, tech)) {
      // A surface-change signal is a direct, fresh observation of the
      // externally visible asset itself, not an inference from a public
      // catalog — it earns a higher confidence than an ordinary
      // vendor+product match on the same fields.
      const isSurfaceHost = signal.kind === 'surface-change';
      matches.push({
        signal,
        landedOn,
        landedKind,
        matchBasis: isSurfaceHost ? 'surface-host' : 'vendor+product',
        matchedOn: { vendor_project: signal.vendor_project, product: signal.product },
        confidence: isSurfaceHost ? 0.85 : 0.8,
      });
      continue;
    }

    if (advisoryKeywordMatches(signal, tech)) {
      matches.push({
        signal,
        landedOn,
        landedKind,
        matchBasis: 'advisory-keyword',
        matchedOn: { vendor: tech.vendor, product: tech.product, title: signal.title },
        confidence: 0.45,
      });
    }
  }

  return matches;
}

/**
 * Stage 2. One hop, not a graph walk. A match on a service's own technology
 * passes through unchanged at hops=0. A match on shared infrastructure
 * fans out to every service with a dependency on it, at hops=1 with
 * confidence multiplied by HOP_DECAY.
 *
 * There is deliberately no further traversal: infrastructure never depends
 * on infrastructure in this data model, so there is no hop 2 to take.
 */
export function propagateToServices(
  matches: AssetMatch[],
  dependencies: ServiceDependency[]
): SignalMatch[] {
  const results: SignalMatch[] = [];

  for (const match of matches) {
    if (match.landedKind === 'service') {
      results.push({
        signal: match.signal,
        serviceSlug: match.landedOn,
        landedOn: match.landedOn,
        landedKind: 'service',
        matchBasis: match.matchBasis,
        matchedOn: match.matchedOn,
        hops: 0,
        dependency: null,
        confidence: match.confidence,
      });
      continue;
    }

    const dependents = dependencies.filter((d) => d.infrastructure_slug === match.landedOn);
    for (const dep of dependents) {
      results.push({
        signal: match.signal,
        serviceSlug: dep.service_slug,
        landedOn: match.landedOn,
        landedKind: 'infrastructure',
        matchBasis: match.matchBasis,
        matchedOn: match.matchedOn,
        hops: 1,
        dependency: {
          infrastructure: match.landedOn,
          kind: dep.kind,
          criticality: dep.criticality,
          rationale: dep.rationale,
        },
        confidence: match.confidence * HOP_DECAY,
      });
    }
  }

  return results;
}

/** Convenience: run both stages and return only matches for a given service. */
export function matchesForService(
  serviceSlug: string,
  signal: RawSignal,
  technologies: Technology[],
  dependencies: ServiceDependency[]
): SignalMatch[] {
  const assetMatches = matchSignalToAssets(signal, technologies);
  return propagateToServices(assetMatches, dependencies).filter((m) => m.serviceSlug === serviceSlug);
}

export type { CityService };

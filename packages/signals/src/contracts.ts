// The connector contracts. Every source of external data implements one of the
// two interfaces below. Nothing else in this codebase is permitted to call
// fetch() — see the grep check in the root README / docs/connectors.md.
//
// Both interfaces share a rule: implementations never throw on a transport
// failure. A dead feed or an unreachable scanner is not the caller's problem
// to catch; it is this file's contract to make impossible to get wrong.
// Instead, a failure comes back as an empty result plus a human-readable gap
// string, and the caller decides what an empty result means for the
// investigation. See packages/signals/__tests__/contract/ for the suites that
// enforce this against every implementation, live or synthetic.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Provenance. Stamped on every record this package produces. The UI renders a
// "Simulated" chip wherever provenance is 'synthetic', and nothing downstream
// is allowed to drop this field while passing a record along.
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.enum(['live', 'synthetic']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ---------------------------------------------------------------------------
// SignalSource: the threat intelligence side.
// CISA KEV, NVD, EPSS, CISA advisories, abuse.ch, GreyNoise.
// ---------------------------------------------------------------------------

export const SignalKindSchema = z.enum([
  'kev-addition',
  'advisory',
  'ioc',
  'scanning-activity',
  'surface-change',
]);
export type SignalKind = z.infer<typeof SignalKindSchema>;

export const RawSignalSchema = z.object({
  source: z.string().min(1),
  provenance: ProvenanceSchema,
  /** The upstream identifier, e.g. a CVE ID. Not globally unique on its own. */
  external_id: z.string().min(1),
  kind: SignalKindSchema,
  title: z.string().min(1),
  summary: z.string().nullable().default(null),
  /** ISO 8601. Must not be in the future; see the contract suite. */
  published_at: z.string().datetime({ offset: true }),
  severity: z.string().nullable().default(null),
  /**
   * Fields the matcher reads directly, when the source provides them.
   * KEV supplies vendorProject/product. NVD supplies cpe and cvss.
   * Nothing here is required, because not every source carries every field.
   */
  vendor_project: z.string().nullable().default(null),
  product: z.string().nullable().default(null),
  cpe: z.string().nullable().default(null),
  cvss_score: z.number().min(0).max(10).nullable().default(null),
  epss_percentile: z.number().min(0).max(1).nullable().default(null),
  /** The untouched upstream record, for the audit trail and for debugging. */
  raw: z.unknown(),
});
export type RawSignal = z.infer<typeof RawSignalSchema>;

export interface SignalPollResult {
  signals: RawSignal[];
  /** Human-readable reasons this poll came back incomplete. Never thrown. */
  gaps: string[];
}

export interface SignalSource {
  readonly name: string;
  readonly mode: Provenance;
  readonly requiresKey: boolean;
  /**
   * Fetch signals published since the given time. Must never throw: a
   * transport failure, a malformed upstream record, or a rate limit all
   * become an empty (or partial) result plus a gap string.
   */
  poll(since: Date): Promise<SignalPollResult>;
}

// ---------------------------------------------------------------------------
// SurfaceSource: the external exposure side. Models the OUTPUT shape of a
// scanner like Shodan or Censys, not their API, so a synthetic implementation
// and a live one are interchangeable to every caller.
// ---------------------------------------------------------------------------

export const SurfaceObservationSchema = z.object({
  /** RFC 2606 reserved domain in every seed fixture: *.example. */
  host: z.string().min(1),
  /** RFC 5737 documentation range in every seed fixture. */
  ip: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  transport: z.enum(['tcp', 'udp']),
  service: z.string().min(1),
  vendor: z.string().min(1),
  product: z.string().min(1),
  version: z.string().nullable().default(null),
  cpe: z.string().nullable().default(null),
  tls_cert_sha256: z.string().nullable().default(null),
  tls_not_after: z.string().datetime({ offset: true }).nullable().default(null),
  banner: z.string().nullable().default(null),
  observed_at: z.string().datetime({ offset: true }),
});
export type SurfaceObservation = z.infer<typeof SurfaceObservationSchema>;

export interface SurfaceScope {
  /** Which snapshot to read: 't0' (baseline) or 't1' (the demo's "after"). */
  snapshotId: string;
}

export interface SurfaceSnapshotResult {
  observations: SurfaceObservation[];
  gaps: string[];
}

export interface SurfaceSource {
  readonly name: string;
  readonly mode: Provenance;
  /** One complete point-in-time view of the externally visible surface. */
  snapshot(scope: SurfaceScope): Promise<SurfaceSnapshotResult>;
}

// ---------------------------------------------------------------------------
// Surface change detection. Two consecutive snapshots in, a list of what
// changed out. Real logic regardless of whether the input is live or
// synthetic — see __tests__/surface-diff.test.ts.
// ---------------------------------------------------------------------------

export const SurfaceChangeKindSchema = z.enum([
  'new-service',
  'removed-service',
  'version-changed',
  'certificate-changed',
  'certificate-expiring',
  'new-host',
]);
export type SurfaceChangeKind = z.infer<typeof SurfaceChangeKindSchema>;

export interface SurfaceChange {
  kind: SurfaceChangeKind;
  before: SurfaceObservation | null;
  after: SurfaceObservation | null;
}

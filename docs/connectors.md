# Connectors

How Detroit Cyber Ready gets data, what is live today, and exactly what it takes to swap a simulated source for a real one.

This document is also the architecture slide.

---

## The rule

> **Threat intelligence is real. Detroit's geography and service catalog are real. Only the technology inventory is simulated. Every simulated source implements the exact interface its real replacement will implement, and both must pass the same contract test suite.**

This is not a hackathon shortcut dressed up. It is the product posture. Detroit Cyber Ready does not scan cities. A city supplies its inventory, or we ingest it from the tooling it already pays for.

---

## Three contracts

Everything that crosses the boundary into this system implements one of three interfaces. Nothing else in the codebase is permitted to reach the network, and there is a test that greps for it.

### 1. `SignalSource`, the threat side

```ts
export interface SignalSource {
  readonly name: string;
  readonly mode: 'live' | 'synthetic';
  readonly requiresKey: boolean;
  /** Never throws. A failure returns [] plus a gap string. */
  poll(since: Date): Promise<{ signals: RawSignal[]; gaps: string[] }>;
}
```

### 2. `SurfaceSource`, the exposure side

Models the *output* of an external attack surface scanner, which is a stable and well documented shape, rather than any particular vendor's API.

```ts
export interface SurfaceObservation {
  host: string;              // RFC 2606 reserved domain in seed data
  ip: string;                // RFC 5737 documentation range in seed data
  port: number;
  transport: 'tcp' | 'udp';
  service: string;
  vendor: string;
  product: string;
  version: string | null;
  cpe: string | null;
  tls_cert_sha256: string | null;
  tls_not_after: string | null;
  banner: string | null;
  observed_at: string;
}

export interface SurfaceSource {
  readonly name: string;
  readonly mode: 'live' | 'synthetic';
  snapshot(scope: SurfaceScope): Promise<{ observations: SurfaceObservation[]; gaps: string[] }>;
}
```

`SyntheticSurfaceSource` reads committed snapshots from `data/detroit/surface/`. `ShodanSurfaceSource` and `CensysSurfaceSource` are committed stubs: the class shell, the config keys they will need, and a `throw new Error('not enabled')`. They exist so the swap point is visible in the repository rather than only on a slide.

### 3. `ContextEngineAdapter`, the enrichment side

Where Tenable, Wiz, CrowdStrike, ServiceNow and Microsoft land when productized.

```ts
export interface ContextEngineAdapter {
  readonly name: string;
  readonly requiredConfig: string[];
  enrich(input: InvestigationInput, config: Record<string, string>): Promise<AdapterResult>;
}
```

Adapters fan out under `Promise.allSettled`. A failing adapter contributes an evidence gap. It never fails the investigation.

---

## What is wired, and what it takes to go live

| Capability | Today | Productized | Interface | Work to swap |
|---|---|---|---|---|
| Actively exploited vulnerabilities | CISA KEV, **live** | same | `SignalSource` | none, already live |
| Vulnerability context, CVSS, CPE | NVD, **live** | same | `SignalSource` | none, already live |
| Exploitation probability | FIRST.org EPSS, **live** | same | `SignalSource` | none, already live |
| Advisories | CISA, **live** | same | `SignalSource` | none, already live |
| Malicious infrastructure | abuse.ch, **live** | same plus OTX | `SignalSource` | add one adapter |
| Scanning versus targeted | GreyNoise Community, **live** | GreyNoise Enterprise | `SignalSource` | swap base URL and key |
| Detroit geography and facilities | data.detroitmi.gov, **real** | same | committed GeoJSON | none |
| External attack surface | `SyntheticSurfaceSource` | Shodan, Censys | `SurfaceSource` | implement `snapshot()`, stub committed |
| Authoritative asset inventory | authored YAML | ServiceNow CMDB, Tenable asset export | `ContextEngineAdapter` | implement `enrich()` |
| Vulnerability scan results | not represented | Tenable, Qualys, Rapid7 | `ContextEngineAdapter` | implement `enrich()` |
| Endpoint and identity telemetry | not represented | CrowdStrike, Defender, Entra | `ContextEngineAdapter` | implement `enrich()` |
| Investigation playbooks, CVE analysis | Casky API, **live** | same | HTTPS, `csk_` key | none |

**The Tenable row is the go-to-market story in one line: it is an input, not a competitor.** The city already spent the money. We consume what it bought.

---

## Provenance

Every signal, observation and match carries `provenance` (`live` or `synthetic`) and `source_name`. The UI renders a `Simulated` chip on any card whose provenance is synthetic, and the CISO alert footer lists which inputs were live and which were simulated.

Three reasons this is not optional:

1. **Honesty.** Anyone looking at the screen can see what is real and what is not.
2. **It is how the real product works anyway.** A city onboarding in week one has live threat feeds and a partially populated inventory. Mixed mode is the steady state, not a transition.
3. **It makes going live a visible change**, not a silent one.

---

## Contract tests

One suite per interface, run against any implementation. The simulated implementations pass it today. Any real connector added later must pass the same file, unchanged.

```ts
// packages/signals/__tests__/contract/surface-source.contract.ts
export function runSurfaceSourceContract(name: string, make: () => SurfaceSource) { /* ... */ }
```

Asserted for every implementation:

- `snapshot()` and `poll()` never throw. A transport failure returns empty results plus gaps.
- Every record validates against its schema.
- Timestamps are valid ISO 8601 and not in the future.
- Two consecutive snapshots of unchanged input produce zero diffs, so the change detector cannot emit spurious alerts.
- `mode` is declared and is stamped onto every emitted record.

This is what makes "we can productize this" verifiable rather than a promise.

---

## What we deliberately do not do

There are no Shodan or Censys credentials in this project, and no code path that scans a real host. Running reconnaissance against a city's infrastructure without written authorization is not something we do, and a hackathon demo is not an authorization.

When this ships, external attack surface discovery runs only against assets a city has explicitly asked us to monitor.

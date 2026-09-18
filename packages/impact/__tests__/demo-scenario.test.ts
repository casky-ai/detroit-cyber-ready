// The spine, proven end to end against the REAL committed data files, not
// mocks: a CISA KEV addition on the remote access appliance reaches 911 at
// one hop over a hard dependency, scores exactly 91, and is escalated to
// P1. This is the "never cut" scenario from plans/001_prd.md — if this test
// ever breaks, the demo is broken, full stop.

import { describe, it, expect } from 'vitest';
import type { RawSignal } from '@dcr/signals';
import { loadDetroitInventory } from '../src/data';
import { matchSignalToAssets, propagateToServices } from '../src/exposure';
import { computeRiskScore } from '../src/scoring';

// Shaped exactly like what makeCisaKevSource() (packages/signals) actually
// produces: CISA's KEV feed carries vendorProject/product, never a CPE — CPE
// comes only from NVD. Giving this fixture a CPE would silently test a
// different, unrealistic code path (the 0.95 CPE match) instead of the one
// the real pipeline takes for a KEV-triggered investigation (0.80
// vendor+product) — which is exactly the PRD's worked example and demo.
const KEV_REMOTE_ACCESS_SIGNAL: RawSignal = {
  source: 'cisa-kev',
  provenance: 'live',
  external_id: 'CVE-2025-4427',
  kind: 'kev-addition',
  title: 'Ivanti Connect Secure Authentication Bypass',
  summary: 'An authentication bypass vulnerability in Ivanti Connect Secure.',
  published_at: '2025-09-17T00:00:00.000Z',
  severity: null,
  vendor_project: 'Ivanti',
  product: 'Connect Secure',
  cpe: null,
  cvss_score: null,
  epss_percentile: null, // EPSS is looked up separately, by CVE ID
  raw: {},
};

const EPSS_PERCENTILE_FOR_CVE = 0.85;

describe('demo scenario: KEV on remote access reaches 911', () => {
  it('stage 1 lands on the remote-access infrastructure entry via vendor+product, at confidence 0.8', async () => {
    const { technologies } = await loadDetroitInventory();
    const matches = matchSignalToAssets(KEV_REMOTE_ACCESS_SIGNAL, technologies);

    const remoteAccessMatch = matches.find((m) => m.landedOn === 'remote-access');
    expect(remoteAccessMatch).toBeDefined();
    expect(remoteAccessMatch?.landedKind).toBe('infrastructure');
    expect(remoteAccessMatch?.matchBasis).toBe('vendor+product');
    expect(remoteAccessMatch?.confidence).toBe(0.8);
  });

  it('a CPE-enriched version of the same CVE (as NVD would supply) matches with higher confidence', async () => {
    const { technologies } = await loadDetroitInventory();
    const nvdEnriched: RawSignal = {
      ...KEV_REMOTE_ACCESS_SIGNAL,
      source: 'nvd',
      cpe: 'cpe:2.3:a:ivanti:connect_secure:22.6r1:*:*:*:*:*:*:*',
    };
    const matches = matchSignalToAssets(nvdEnriched, technologies);
    const remoteAccessMatch = matches.find((m) => m.landedOn === 'remote-access');
    expect(remoteAccessMatch?.matchBasis).toBe('cpe');
    expect(remoteAccessMatch?.confidence).toBe(0.95);
  });

  it('stage 2 propagates to 911 at hops 1 over a hard dependency', async () => {
    const { technologies, dependencies } = await loadDetroitInventory();
    const assetMatches = matchSignalToAssets(KEV_REMOTE_ACCESS_SIGNAL, technologies);
    const signalMatches = propagateToServices(assetMatches, dependencies);

    const nineOneOne = signalMatches.find((m) => m.serviceSlug === '911-emergency-communications');
    expect(nineOneOne).toBeDefined();
    expect(nineOneOne?.hops).toBe(1);
    expect(nineOneOne?.dependency?.criticality).toBe('hard');
    expect(nineOneOne?.dependency?.infrastructure).toBe('remote-access');

    // No result anywhere in the batch ever exceeds one hop.
    expect(signalMatches.every((m) => m.hops <= 1)).toBe(true);
  });

  it('reaches other services too, so "N other services affected" is a real count, not a hardcoded string', async () => {
    const { technologies, dependencies } = await loadDetroitInventory();
    const assetMatches = matchSignalToAssets(KEV_REMOTE_ACCESS_SIGNAL, technologies);
    const signalMatches = propagateToServices(assetMatches, dependencies);

    const affectedServices = new Set(signalMatches.map((m) => m.serviceSlug));
    expect(affectedServices.size).toBeGreaterThan(1);
    expect(affectedServices.has('911-emergency-communications')).toBe(true);
  });

  it('scores exactly 91 and escalates to P1, matching the PRD worked example', async () => {
    const { services, technologies, dependencies } = await loadDetroitInventory();
    const assetMatches = matchSignalToAssets(KEV_REMOTE_ACCESS_SIGNAL, technologies);
    const signalMatches = propagateToServices(assetMatches, dependencies);

    const nineOneOne = signalMatches.find((m) => m.serviceSlug === '911-emergency-communications');
    const service = services.find((s) => s.slug === '911-emergency-communications');
    expect(nineOneOne).toBeDefined();
    expect(service).toBeDefined();

    const result = computeRiskScore(nineOneOne!, service!, EPSS_PERCENTILE_FOR_CVE);

    expect(result.score).toBe(91);
    expect(result.priority).toBe('P1');
    expect(result.escalated).toBe(true);
    expect(result.escalationReason).toMatch(/life-safety/i);
  });

  it('does not escalate 911 through the soft records-management dependency for an unrelated signal', async () => {
    const { services, dependencies } = await loadDetroitInventory();
    const service = services.find((s) => s.slug === '911-emergency-communications')!;

    const recordsMgmtDependency = dependencies.find(
      (d) => d.service_slug === '911-emergency-communications' && d.infrastructure_slug === 'records-management'
    )!;
    expect(recordsMgmtDependency.criticality).toBe('soft');

    const softMatch = {
      signal: { ...KEV_REMOTE_ACCESS_SIGNAL, vendor_project: 'Tyler Technologies', product: 'Records Management' },
      serviceSlug: service.slug,
      landedOn: 'records-management',
      landedKind: 'infrastructure' as const,
      matchBasis: 'vendor+product' as const,
      matchedOn: {},
      hops: 1 as const,
      dependency: {
        infrastructure: 'records-management',
        kind: recordsMgmtDependency.kind,
        criticality: recordsMgmtDependency.criticality,
        rationale: recordsMgmtDependency.rationale,
      },
      confidence: 0.8 * 0.85,
    };

    const result = computeRiskScore(softMatch, service, EPSS_PERCENTILE_FOR_CVE);
    expect(result.escalated).toBe(false);
  });
});
